/**
 * More — the hub for everything that does not fit the five-slot mobile bar.
 *
 * Mirrors the desktop sidebar so nothing is desktop-only, and surfaces the
 * live status summary that the connection gate shows on first run.
 */

import { Icon, type IconName } from "../components/Icon";
import { Badge, Button, Panel, SectionHeader, StatusDot } from "../components/ui";
import type { RouteId } from "../components/Shell";
import { chatStore, connectionStore, logStore, metricsStore, useStore } from "../state/store";
import { runtime } from "../state/bootstrap";
import { formatDuration, formatMb } from "../core/format";

const LINKS: { id: RouteId; label: string; icon: IconName; description: string }[] = [
  { id: "files", label: "Files", icon: "folder", description: "Browse, edit and organise the machine's files" },
  { id: "monitor", label: "Monitor", icon: "activity", description: "CPU, memory, disk, network and thermals" },
  { id: "logs", label: "Logs", icon: "list", description: "Everything the agent, commands and socket did" },
  { id: "approvals", label: "Approvals", icon: "shield", description: "Requests waiting for your verdict" },
  { id: "tasks", label: "Tasks", icon: "clock", description: "Long running work and its results" },
  { id: "sessions", label: "Sessions", icon: "devices", description: "Agent identities, providers and profiles" },
  { id: "devices", label: "Devices", icon: "pc", description: "Choose the target machine" },
  { id: "security", label: "Security", icon: "lock", description: "Permissions, risk engine and audit" },
  { id: "settings", label: "Settings", icon: "settings", description: "Gateway, providers and preferences" },
];

export function MorePage({
  onNavigate,
  onExit,
}: {
  onNavigate: (route: RouteId) => void;
  onExit: () => void;
}) {
  const connection = useStore(connectionStore);
  const chat = useStore(chatStore);
  const metrics = useStore(metricsStore);
  const logs = useStore(logStore);
  const device = connection.device;
  const snapshot = metrics.latest;

  return (
    <div className="space-y-4">
      <Panel className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-accent/35 bg-accent/12 text-accent-soft">
            <Icon name="terminal" className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-[15px] font-semibold text-white">{device?.name ?? "Unpaired device"}</p>
              <StatusDot tone={connection.status === "CONNECTED" ? "ok" : "danger"} pulse={connection.status === "CONNECTED"} />
            </div>
            <p className="mono truncate text-[11px] text-white/45">
              {device ? `${device.user}@${device.hostname} · ${device.kernel}` : "no handshake yet"}
            </p>
          </div>
          <Badge tone={connection.transportKind === "simulated" ? "warn" : "accent"}>
            {connection.transportKind === "simulated" ? "simulated" : "gateway"}
          </Badge>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MiniStat label="Uptime" value={device ? formatDuration(device.uptimeSeconds) : "—"} />
          <MiniStat label="Sessions" value={String(chat.sessions.length)} />
          <MiniStat label="Pending" value={String(chat.approvals.length)} />
          <MiniStat label="Log lines" value={String(logs.entries.length)} />
        </div>

        {snapshot ? (
          <p className="mono mt-3 text-[11px] text-white/40">
            cpu {snapshot.cpu.total.toFixed(1)}% · mem {formatMb(snapshot.memory.usedMb)} · load {snapshot.cpu.load[0].toFixed(2)}
          </p>
        ) : null}
      </Panel>

      <div>
        <SectionHeader title="Console" icon="list" />
        <div className="grid gap-2.5 sm:grid-cols-2">
          {LINKS.map((link) => (
            <button
              key={link.id}
              onClick={() => onNavigate(link.id)}
              className="flex items-start gap-3 rounded-2xl border border-white/[0.07] p-3.5 text-left transition-colors hover:border-accent/30 hover:bg-white/[0.04]"
            >
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-accent-soft">
                <Icon name={link.icon} className="h-[18px] w-[18px]" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-[13.5px] font-semibold text-white/90">{link.label}</p>
                  {link.id === "approvals" && chat.approvals.length > 0 ? (
                    <span className="mono rounded-full bg-accent/30 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      {chat.approvals.length}
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-[12px] leading-relaxed text-white/50">{link.description}</p>
              </div>
              <Icon name="chevronRight" className="mt-1 h-4 w-4 shrink-0 text-white/25" />
            </button>
          ))}
        </div>
      </div>

      <Panel className="p-4">
        <SectionHeader title="Session" icon="lock" />
        <p className="text-[12.5px] leading-relaxed text-white/55">
          Connected to {connection.meta.route || "the configured gateway"} as{" "}
          <span className="mono text-accent-soft">{runtime.settings.deviceId}</span>. Provider keys live on the
          agent, not here — this console holds only the device session token.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="ghost" icon="home" onClick={onExit}>
            Show connection screen
          </Button>
          <Button variant="ghost" icon="settings" onClick={() => onNavigate("settings")}>
            Settings
          </Button>
          <Button
            variant="danger"
            icon="lock"
            onClick={() => runtime.controller.disconnect()}
          >
            Disconnect
          </Button>
        </div>
      </Panel>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">{label}</p>
      <p className="mono mt-0.5 text-[15px] font-semibold text-white">{value}</p>
    </div>
  );
}
