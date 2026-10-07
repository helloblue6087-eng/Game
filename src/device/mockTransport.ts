/**
 * Simulated transport.
 *
 * Presents the exact {@link Transport} contract as the WebSocket implementation
 * but routes frames to the in-process {@link DeviceRuntime}. It injects a small
 * amount of latency and a reconnect cycle on demand so the connection UI
 * (backoff, offline mode, reconnection banner) is exercised for real rather
 * than only on a live network.
 */

import { PROTOCOL_VERSION } from "../core/protocol";
import type { AgentMessage, ClientMessage } from "../core/protocol";
import type { ConnectionMeta, Transport } from "../core/transport";
import type { ConnectionState, DeviceInfo } from "../core/types";
import { DeviceRuntime } from "./deviceRuntime";
import { VirtualFileSystem } from "./virtualFs";

const HANDSHAKE_MS = 340;
const FRAME_LATENCY_MS = 24;

export class SimulatedTransport implements Transport {
  readonly id = "simulated";
  private runtime: DeviceRuntime;
  private handlers = new Set<(message: AgentMessage) => void>();
  private stateHandlers = new Set<(state: ConnectionState, meta: ConnectionMeta) => void>();
  private state: ConnectionState = "OFFLINE";
  private meta: ConnectionMeta = {
    latencyMs: FRAME_LATENCY_MS,
    attempt: 0,
    nextRetryMs: null,
    route: "tailscale → 100.101.42.7 (simulated)",
  };
  private timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(device: DeviceInfo, fs: VirtualFileSystem) {
    this.runtime = new DeviceRuntime(device, (message) => this.deliver(message), fs);
  }

  private later(fn: () => void, ms: number): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      fn();
    }, ms);
    this.timers.add(timer);
  }

  connect(): void {
    this.setState("AUTHENTICATING", { attempt: 0, nextRetryMs: null });
    this.later(() => {
      this.runtime.handle({
        type: "client.hello",
        clientId: "sim-client",
        token: "sim-token",
        protocol: PROTOCOL_VERSION,
        deviceId: "gentoo-desktop",
      });
    }, HANDSHAKE_MS);
  }

  disconnect(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.setState("OFFLINE", { attempt: 0, nextRetryMs: null });
  }

  /** Test/UX hook: drop the link and come back so recovery is observable. */
  simulateDrop(recoveryMs = 1800): void {
    this.setState("RECONNECTING", { attempt: 1, nextRetryMs: recoveryMs });
    this.later(() => {
      this.setState("CONNECTED", { attempt: 0, nextRetryMs: null });
      this.deliver({
        type: "log.append",
        entry: {
          id: `log_reconnect_${Date.now()}`,
          timestamp: Date.now(),
          severity: "info",
          source: "websocket",
          message: "Connection restored. Missed frames replayed from the device buffer.",
        },
      });
    }, recoveryMs);
  }

  send(message: ClientMessage): void {
    if (message.type === "terminal.input") {
      this.runtime.handle(message);
      return;
    }
    this.later(() => this.runtime.handle(message), FRAME_LATENCY_MS);
  }

  onMessage(handler: (message: AgentMessage) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onStateChange(handler: (state: ConnectionState, meta: ConnectionMeta) => void): () => void {
    this.stateHandlers.add(handler);
    handler(this.state, this.meta);
    return () => this.stateHandlers.delete(handler);
  }

  private deliver(message: AgentMessage): void {
    if (message.type === "server.hello") {
      this.setState("CONNECTED", { attempt: 0, nextRetryMs: null });
    }
    for (const handler of this.handlers) handler(message);
  }

  private setState(state: ConnectionState, patch: Partial<ConnectionMeta>): void {
    this.state = state;
    this.meta = { ...this.meta, ...patch };
    for (const handler of this.stateHandlers) handler(state, this.meta);
  }

  dispose(): void {
    this.disconnect();
    this.runtime.dispose();
  }
}
