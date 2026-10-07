/**
 * Devices — target selection.
 *
 * The console is already architectured around a device manager: one runtime
 * per target, selected here. Only the Gentoo desktop is reachable today; the
 * remaining entries describe the extension points the architecture already
 * supports (a second PC, a server, a Raspberry Pi, a VM) and render honestly as
 * unreachable rather than pretending to be live.
 */

import { useState } from "react";
import { Icon } from "../components/Icon";
import { Badge, Button, Panel, SectionHeader, StatusDot } from "../components/ui";
import { connectionStore, metricsStore, useStore } from "../state/store";
import { runtime } from "../state/bootstrap";
import { formatDuration, formatMb, percent } from "../core/format";

interface DeviceTarget {
  id: string;
  name: string;
  kind: string;
  address: string;
  present: boolean;
}

const KNOWN_TARGETS: DeviceTarget[] = [
  { id: "gentoo-desktop", name: "Gentoo Desktop", kind: "Workstation · OpenRC · Wayland", address: "100.101.42.7", present: true },
  { id: "gentoo-laptop", name: "Gentoo Laptop", kind: "Laptop · OpenRC · Wayland", address: "100.101.42.18", present: false },
  { id: "build-server", name: "Build Server", kind: "Server · OpenRC · headless", address: "100.101.42.31", present: false },
  { id: "pi-4", name: "Raspberry Pi 4", kind: "ARM64 · OpenRC", address: "100.101.42.44", present: false },
  { id: "vm-gentoo", name: "Gentoo VM", kind: "KVM guest · OpenRC", address: "100.101.42.52", present: false },
];

export function DevicesPage() {
  const connection = useStore(connectionStore);
  const metrics = useStore(metricsStore);
  const [selected, setSelected] = useState("gentoo-desktop");

  const device = connection.device;
  const snapshot = metrics.latest;
  const isSelected = selected === runtime.settings.deviceId;

  return (
    <div className="space-y-4">
      <div>
        <SectionHeader title="My devices" icon="devices" subtitle="selecting a device changes the active target" />
        <div className="space-y-2.5">
          {KNOWN_TARGETS.map((target) => {
            const online = target.present && target.id === runtime.settings.deviceId && connection.status === "CONNECTED";
            const active = target.id === selected;
            return (
              <button
                key={target.id}
                onClick={() => setSelected(target.id)}
                className={`flex w-full items-center gap-3 rounded-2xl border p-3.5 text-left transition-colors ${
                  active ? "border-accent/40 bg-accent/12" : "border-white/[0.07] hover:bg-white/[0.04]"
                }`}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-accent-soft">
                  <Icon name={target.id.includes("pi") ? "cpu" : target.id.includes("server") ? "disk" : "pc"} className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <StatusDot tone={online ? "ok" : target.present ? "warn" : "idle"} pulse={online} />
                    <p className="truncate text-[13.5px] font-semibold text-white/90">{target.name}</p>
                    {active ? <Badge tone="accent">selected</Badge> : null}
                  </div>
                  <p className="mono mt-0.5 truncate text-[11px] text-white/45">
                    {target.kind} · {target.address}
                  </p>
                </div>
                <Badge tone={online ? "ok" : "neutral"}>{online ? "ONLINE" : "OFFLINE"}</Badge>
              </button>
            );
          })}
        </div>
      </div>

      <Panel className="p-4">
        <SectionHeader title="Selected target" icon="activity" />
        {isSelected && device ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <StatusDot tone={connection.status === "CONNECTED" ? "ok" : "danger"} pulse={connection.status === "CONNECTED"} />
              <span className="text-[13px] font-medium text-white/85">
                {device.name} is {connection.status === "CONNECTED" ? "reachable" : "unreachable"}
              </span>
            </div>
            <dl className="mono grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11.5px]">
              <Line label="hostname" value={device.hostname} />
              <Line label="user" value={device.user} />
              <Line label="tailscale" value={device.tailscaleIp ?? "—"} />
              <Line label="lan" value={device.lanIp ?? "—"} />
              <Line label="kernel" value={device.kernel} />
              <Line label="uptime" value={formatDuration(device.uptimeSeconds)} />
              {snapshot ? (
                <>
                  <Line label="cpu" value={`${snapshot.cpu.total.toFixed(1)}%`} />
                  <Line label="memory" value={`${formatMb(snapshot.memory.usedMb)} (${percent(snapshot.memory.usedMb, snapshot.memory.totalMb).toFixed(0)}%)`} />
                </>
              ) : null}
            </dl>
            <Button
              variant="ghost"
              icon="refresh"
              onClick={() => {
                runtime.controller.disconnect();
                runtime.controller.connect();
              }}
            >
              Re-handshake with this device
            </Button>
          </div>
        ) : (
          <div className="flex items-start gap-2.5 rounded-xl border border-white/[0.07] bg-black/25 p-3">
            <Icon name="offline" className="mt-0.5 h-4 w-4 shrink-0 text-white/40" />
            <p className="text-[12.5px] leading-relaxed text-white/55">
              This target is not reachable from this session. Point the gateway at its address in Settings, or
              start its agent, then select it again. The console keeps one runtime per target, so switching
              devices never mixes their state.
            </p>
          </div>
        )}
      </Panel>

      <Panel className="p-4">
        <SectionHeader title="Connection route" icon="network" />
        <div className="mono space-y-1.5 text-[11.5px] text-white/55">
          <p>this browser</p>
          <p className="pl-3">↓ {connection.transportKind === "websocket" ? "wss (TLS)" : "in-process (simulated)"}</p>
          <p className="pl-3">↓ {connection.meta.route || runtime.settings.url || "—"}</p>
          <p className="pl-3">↓ tailscale0 {device?.tailscaleIp ?? "—"}</p>
          <p className="pl-3">↓ gentoo-agent (OpenRC)</p>
          <p className="pl-3">↓ permission layer → system tools</p>
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-white/45">
          No port forwarding is involved: the phone and any second PC join the same tailnet, and the agent only
          listens on the mesh interface.
        </p>
      </Panel>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-white/35">{label}</dt>
      <dd className="truncate text-white/75">{value}</dd>
    </div>
  );
}
