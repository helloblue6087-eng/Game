/**
 * Runtime bootstrap.
 *
 * Picks the transport for the session:
 *   - `websocket` when the user has saved a gateway URL in Settings,
 *   - `simulated` otherwise, so the console is fully usable out of the box and
 *     the real protocol can be exercised before the Gentoo agent is reachable.
 *
 * Settings are stored in localStorage under a single namespaced key so nothing
 * is written next to the existing deployment's own configuration.
 */

import { Controller } from "./store";
import { SimulatedTransport } from "../device/mockTransport";
import { VirtualFileSystem } from "../device/virtualFs";
import { WebSocketTransport } from "../core/transport";
import type { Transport } from "../core/transport";
import type { DeviceInfo } from "../core/types";

export interface GatewaySettings {
  url: string;
  token: string;
  deviceId: string;
  transport: "simulated" | "websocket";
  allowedRoots: string[];
}

const SETTINGS_KEY = "gacc.settings.v2";

export const DEFAULT_DEVICE: DeviceInfo = {
  id: "gentoo-desktop",
  name: "Gentoo Desktop",
  hostname: "gentoo",
  os: "Gentoo Linux",
  kernel: "6.12.9-gentoo-dist",
  gentooVersion: "2.17 (profile 23.0, desktop-hyprland)",
  init: "OpenRC 0.56",
  compositor: "Hyprland 0.45 (Wayland)",
  user: "blue",
  arch: "x86_64",
  tailscaleIp: "100.101.42.7",
  lanIp: "192.168.1.42",
  uptimeSeconds: 284_120,
  online: true,
};

export function loadSettings(): GatewaySettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultSettings();
    return { ...defaultSettings(), ...(JSON.parse(raw) as Partial<GatewaySettings>) };
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(settings: GatewaySettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function defaultSettings(): GatewaySettings {
  return {
    url: "wss://gentoo.tail-scale.ts.net/agent",
    token: "",
    deviceId: DEFAULT_DEVICE.id,
    transport: "simulated",
    allowedRoots: ["/home", "/etc", "/var", "/tmp"],
  };
}

export interface ControlCenterRuntime {
  controller: Controller;
  transport: Transport;
  simulated: SimulatedTransport | null;
  device: DeviceInfo;
  settings: GatewaySettings;
}

export function createRuntime(overrides?: Partial<GatewaySettings>): ControlCenterRuntime {
  const settings = { ...loadSettings(), ...overrides };
  const device = DEFAULT_DEVICE;

  let transport: Transport;
  let simulated: SimulatedTransport | null = null;

  if (settings.transport === "websocket" && settings.url) {
    transport = new WebSocketTransport({
      url: settings.url,
      token: settings.token,
      deviceId: settings.deviceId,
      clientId: `web-${Math.random().toString(36).slice(2, 10)}`,
    });
  } else {
    const fs = new VirtualFileSystem(settings.allowedRoots.length ? settings.allowedRoots : undefined);
    simulated = new SimulatedTransport({ ...device }, fs);
    transport = simulated;
  }

  const controller = new Controller({
    transport,
    kind: settings.transport === "websocket" ? "websocket" : "simulated",
  });

  return { controller, transport, simulated, device, settings };
}

/** The console's single runtime instance. */
export const runtime = createRuntime();

/**
 * Apply new gateway settings: persist them and swap the live transport in
 * place, so the console keeps its state (conversations, layout) while the
 * underlying link is replaced and re-authenticated.
 */
export function reconnectWith(settings: GatewaySettings): void {
  saveSettings(settings);
  const next = createRuntime(settings);
  runtime.settings = settings;
  if (runtime.simulated && runtime.simulated !== next.simulated) {
    runtime.simulated.dispose();
  }
  runtime.transport = next.transport;
  runtime.simulated = next.simulated;
  runtime.controller.replaceTransport(
    next.transport,
    settings.transport === "websocket" ? "websocket" : "simulated",
  );
}
