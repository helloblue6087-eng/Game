/**
 * Transport abstraction + production WebSocket transport.
 *
 * The rest of the app only ever talks to a {@link Transport}. That lets the
 * same UI run against:
 *   - the real Gentoo agent over `wss://` (through Tailscale),
 *   - the built-in simulated device (so the console is usable and testable
 *     with no server present),
 *   - the legacy adapter that maps an older website protocol onto these events.
 */

import { decode, encode, PROTOCOL_VERSION } from "./protocol";
import type { AgentMessage, ClientMessage } from "./protocol";
import type { ConnectionState } from "./types";

export interface ConnectionMeta {
  latencyMs: number | null;
  attempt: number;
  nextRetryMs: number | null;
  route: string;
}

export interface Transport {
  readonly id: string;
  connect(): void;
  disconnect(): void;
  send(message: ClientMessage): void;
  onMessage(handler: (message: AgentMessage) => void): () => void;
  onStateChange(handler: (state: ConnectionState, meta: ConnectionMeta) => void): () => void;
}

export interface WebSocketTransportOptions {
  url: string;
  token: string;
  deviceId: string;
  clientId: string;
  heartbeatMs?: number;
  pongTimeoutMs?: number;
  maxQueue?: number;
  /** Injected for tests. */
  socketFactory?: (url: string) => WebSocket;
}

const BACKOFF_BASE_MS = 600;
const BACKOFF_FACTOR = 1.7;
const BACKOFF_MAX_MS = 15_000;

export function backoffDelay(attempt: number, random = Math.random): number {
  const raw = Math.min(BACKOFF_BASE_MS * BACKOFF_FACTOR ** attempt, BACKOFF_MAX_MS);
  // Full jitter avoids reconnect storms when many devices come back at once.
  return Math.round(raw * (0.6 + random() * 0.4));
}

export class WebSocketTransport implements Transport {
  readonly id = "websocket";

  private socket: WebSocket | null = null;
  private state: ConnectionState = "OFFLINE";
  private meta: ConnectionMeta = { latencyMs: null, attempt: 0, nextRetryMs: null, route: "" };
  private queue: ClientMessage[] = [];
  private messageHandlers = new Set<(message: AgentMessage) => void>();
  private stateHandlers = new Set<(state: ConnectionState, meta: ConnectionMeta) => void>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pongDeadline = 0;
  private closedByUser = false;
  private lastPingAt = 0;

  constructor(private readonly options: WebSocketTransportOptions) {
    this.meta.route = options.url;
  }

  private get maxQueue(): number {
    return this.options.maxQueue ?? 250;
  }

  connect(): void {
    this.closedByUser = false;
    this.openSocket();
  }

  disconnect(): void {
    this.closedByUser = true;
    this.clearTimers();
    if (this.socket) {
      try {
        this.socket.close(1000, "client disconnect");
      } catch {
        /* socket already closing */
      }
      this.socket = null;
    }
    this.setState("OFFLINE", { latencyMs: null, nextRetryMs: null, attempt: 0 });
  }

  send(message: ClientMessage): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN && this.state === "CONNECTED") {
      this.socket.send(encode(message));
      return;
    }
    // Queue rather than drop: the user's intent survives a tunnel blip.
    // Ephemeral terminal keystrokes are dropped to avoid replaying garbage.
    if (message.type === "terminal.input" || message.type === "terminal.resize") return;
    this.queue.push(message);
    if (this.queue.length > this.maxQueue) this.queue.shift();
  }

  onMessage(handler: (message: AgentMessage) => void): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onStateChange(handler: (state: ConnectionState, meta: ConnectionMeta) => void): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  private setState(state: ConnectionState, patch: Partial<ConnectionMeta> = {}): void {
    this.state = state;
    this.meta = { ...this.meta, ...patch };
    for (const handler of this.stateHandlers) handler(this.state, this.meta);
  }

  private openSocket(): void {
    this.setState("AUTHENTICATING", { attempt: this.meta.attempt, nextRetryMs: null });
    let socket: WebSocket;
    try {
      socket = this.options.socketFactory
        ? this.options.socketFactory(this.options.url)
        : new WebSocket(this.options.url);
    } catch (error) {
      this.scheduleReconnect((error as Error).message);
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.setState("AUTHENTICATING");
      socket.send(
        encode({
          type: "client.hello",
          clientId: this.options.clientId,
          token: this.options.token,
          protocol: PROTOCOL_VERSION,
          deviceId: this.options.deviceId,
        }),
      );
      this.startHeartbeat();
    };

    socket.onmessage = (event: MessageEvent<string>) => {
      let message: AgentMessage;
      try {
        message = decode<AgentMessage>(event.data);
      } catch {
        return; // Ignore malformed frames instead of tearing down the socket.
      }
      if (message.type === "server.hello") {
        this.setState("CONNECTED", { attempt: 0, latencyMs: this.meta.latencyMs, nextRetryMs: null });
        this.flushQueue();
      }
      if (message.type === "server.pong") {
        this.meta.latencyMs = Date.now() - message.at;
        this.setState(this.state, { latencyMs: this.meta.latencyMs });
      }
      for (const handler of this.messageHandlers) handler(message);
    };

    socket.onerror = () => {
      /* onclose carries the actionable detail */
    };

    socket.onclose = (event: CloseEvent) => {
      this.clearHeartbeat();
      this.socket = null;
      if (this.closedByUser) {
        this.setState("OFFLINE");
        return;
      }
      this.scheduleReconnect(`socket closed (${event.code})`);
    };
  }

  private flushQueue(): void {
    const pending = this.queue;
    this.queue = [];
    for (const message of pending) this.send(message);
  }

  private scheduleReconnect(reason: string): void {
    const attempt = this.meta.attempt;
    const delay = backoffDelay(attempt);
    this.setState("RECONNECTING", {
      attempt: attempt + 1,
      nextRetryMs: delay,
      route: this.options.url,
    });
    void reason;
    this.reconnectTimer = setTimeout(() => this.openSocket(), delay);
  }

  private startHeartbeat(): void {
    this.clearHeartbeat();
    const interval = this.options.heartbeatMs ?? 15_000;
    this.heartbeatTimer = setInterval(() => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
      const now = Date.now();
      if (this.pongDeadline && now > this.pongDeadline) {
        // Stale connection: force a close so onclose drives the backoff.
        this.pongDeadline = 0;
        this.socket.close(4000, "heartbeat timeout");
        return;
      }
      this.lastPingAt = now;
      this.pongDeadline = now + (this.options.pongTimeoutMs ?? 10_000);
      this.socket.send(encode({ type: "client.ping", at: now }));
    }, interval);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private clearTimers(): void {
    this.clearHeartbeat();
    this.pongDeadline = 0;
    void this.lastPingAt;
  }
}

/**
 * Maps a legacy website protocol ("{cmd, data}" style frames) onto the
 * structured event system so an existing deployment keeps working unchanged.
 */
export class ExistingWebSocketAdapter implements Transport {
  readonly id = "legacy-adapter";
  private inner: WebSocketTransport;

  constructor(options: WebSocketTransportOptions) {
    this.inner = new WebSocketTransport(options);
  }

  connect(): void {
    this.inner.connect();
  }

  disconnect(): void {
    this.inner.disconnect();
  }

  send(message: ClientMessage): void {
    this.inner.send(message);
  }

  onMessage(handler: (message: AgentMessage) => void): () => void {
    return this.inner.onMessage((message) => handler(mapLegacyMessage(message)));
  }

  onStateChange(handler: (state: ConnectionState, meta: ConnectionMeta) => void): () => void {
    return this.inner.onStateChange(handler);
  }
}

/** Normalises legacy shapes (snake_case, alternate type names) to v2. */
export function mapLegacyMessage(message: AgentMessage): AgentMessage {
  const legacy = message as unknown as Record<string, unknown>;
  const type = typeof legacy.type === "string" ? legacy.type : "";
  const aliases: Record<string, string> = {
    "agent.delta": "agent.message.delta",
    "tool.output": "tool.output",
    "ws.status": "device.status",
    "metrics.update": "metrics.snapshot",
  };
  const mapped = aliases[type];
  if (mapped && mapped !== type) {
    return { ...(legacy as object), type: mapped } as AgentMessage;
  }
  return message;
}
