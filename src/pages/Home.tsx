/**
 * Home — the live dashboard.
 *
 * Subscribes to the single metrics stream while mounted and renders the device
 * identity, utilisation gauges, throughput sparklines, pending approvals and
 * recent activity. Nothing here polls independently; every value arrives from
 * the stream.
 */

import { useEffect, useMemo } from "react";
import { Icon } from "../components/Icon";
import {
  Badge,
  Button,
  Gauge,
  Meter,
  Panel,
  RiskBadge,
  SectionHeader,
  StatTile,
  StatusDot,
} from "../components/ui";
import type { RouteId } from "../components/Shell";
import { chatStore, connectionStore, logStore, metricsStore, useStore } from "../state/store";
import { runtime } from "../state/bootstrap";
import { formatDuration, formatMb, percent } from "../core/format";

export function HomePage({ onNavigate }: { onNavigate: (route: RouteId) => void }) {
  const connection = useStore(connectionStore);
  const metrics = useStore(metricsStore);
  const chat = useStore(chatStore);
  const logs = useStore(logStore);

  useEffect(() => {
    runtime.controller.subscribeMetrics(1000);
    return () => runtime.controller.unsubscribeMetrics();
  }, []);

  const snapshot = metrics.latest;
  const device = connection.device;

  const cpuHistory = useMemo(() => metrics.history.map((s) => s.cpu.total), [metrics.history]);
  const netHistory = useMemo(
    () => metrics.history.map((s) => s.network.reduce((sum, n) => sum + n.rxKbs + n.txKbs, 0)),
    [metrics.history],
  );

  const rootDisk = snapshot?.disk.find((d) => d.mount === "/") ?? snapshot?.disk[0];
  const cpuTemp = snapshot?.temps.find((t) => t.label === "CPU")?.celsius ?? 0;

  const recentCommands = logs.entries.filter((entry) => entry.source === "command").slice(-4).reverse();
  const recentErrors = logs.entries.filter((entry) => entry.severity === "error").slice(-3).reverse();
  const activeSessions = chat.sessions.filter((s) => s.status !== "idle");

  const memPercent = snapshot ? percent(snapshot.memory.usedMb, snapshot.memory.totalMb) : 0;
  const diskPercent = rootDisk ? percent(rootDisk.usedGb, rootDisk.totalGb) : 0;

  return (
    <div className="space-y-4">
      {/* Device identity */}
      <Panel className="overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.06] px-4 py-3.5">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-accent/35 bg-accent/12 text-accent-soft">
              <Icon name="pc" className="h-5 w-5" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-[15px] font-semibold text-white">{device?.name ?? "Unpaired device"}</p>
                <StatusDot tone={connection.status === "CONNECTED" ? "ok" : "danger"} pulse={connection.status === "CONNECTED"} />
              </div>
              <p className="mono text-[11px] text-white/45">
                {device ? `${device.user}@${device.hostname} · ${device.arch}` : "waiting for handshake"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={connection.status === "CONNECTED" ? "ok" : "danger"}>
              {connection.status === "CONNECTED" ? "ONLINE" : connection.status}
            </Badge>
            <Badge tone="neutral">
              <Icon name="network" className="h-3 w-3" />
              {connection.meta.latencyMs !== null ? `${connection.meta.latencyMs} ms` : "— ms"}
            </Badge>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3.5 sm:grid-cols-4">
          <Detail label="Uptime" value={device ? formatDuration(device.uptimeSeconds) : "—"} icon="clock" />
          <Detail label="Kernel" value={device?.kernel ?? "—"} icon="cpu" mono />
          <Detail label="Init" value={device?.init ?? "—"} icon="bolt" />
          <Detail label="Compositor" value={device?.compositor ?? "—"} icon="expand" />
          <Detail label="Gentoo" value={device?.gentooVersion ?? "—"} icon="shield" />
          <Detail label="Tailscale" value={device?.tailscaleIp ?? "not connected"} icon="network" mono />
          <Detail label="LAN" value={device?.lanIp ?? "—"} icon="devices" mono />
          <Detail label="Route" value={runtime.settings.transport === "websocket" ? "gateway + tailscale" : "simulated"} icon="activity" />
        </div>
      </Panel>

      {/* Pending approvals */}
      {chat.approvals.length > 0 ? (
        <Panel className="border-amber-400/25 bg-amber-500/[0.07] p-4">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-amber-400" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-400" />
            </span>
            <p className="text-[13px] font-semibold text-amber-100">
              {chat.approvals.length} action{chat.approvals.length > 1 ? "s" : ""} waiting for your approval
            </p>
          </div>
          <ul className="mt-3 space-y-2">
            {chat.approvals.slice(0, 2).map((approval) => (
              <li key={approval.id} className="rounded-xl border border-white/10 bg-black/25 p-3">
                <div className="flex items-center justify-between gap-2">
                  <RiskBadge level={approval.risk} />
                  <span className="mono truncate text-[11px] text-white/45">{approval.sessionId}</span>
                </div>
                <pre className="mono mt-2 overflow-x-auto text-[12px] text-accent-soft">{approval.command}</pre>
              </li>
            ))}
          </ul>
          <Button variant="primary" className="mt-3" block icon="shield" onClick={() => onNavigate("approvals")}>
            Review approvals
          </Button>
        </Panel>
      ) : null}

      {/* Utilisation */}
      <div>
        <SectionHeader title="Utilisation" icon="activity" subtitle="sampled once per second over one stream" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Panel className="flex items-center justify-center p-4">
            <Gauge value={snapshot?.cpu.total ?? 0} label="CPU" sublabel={snapshot ? `load ${snapshot.cpu.load[0]}` : "—"} />
          </Panel>
          <Panel className="flex items-center justify-center p-4">
            <Gauge
              value={memPercent}
              label="Memory"
              tone={memPercent > 85 ? "danger" : memPercent > 70 ? "warn" : "ok"}
              sublabel={snapshot ? formatMb(snapshot.memory.usedMb) : "—"}
            />
          </Panel>
          <Panel className="flex items-center justify-center p-4">
            <Gauge
              value={diskPercent}
              label="Root FS"
              tone={diskPercent > 90 ? "danger" : diskPercent > 75 ? "warn" : "ok"}
              sublabel={rootDisk ? `${rootDisk.usedGb.toFixed(0)}/${rootDisk.totalGb.toFixed(0)}G` : "—"}
            />
          </Panel>
          <Panel className="flex items-center justify-center p-4">
            <Gauge
              value={(cpuTemp / 100) * 100}
              label="CPU temp"
              tone={cpuTemp > 80 ? "danger" : cpuTemp > 68 ? "warn" : "ok"}
              sublabel={`${cpuTemp.toFixed(1)} °C`}
            />
          </Panel>
        </div>
      </div>

      {/* Throughput */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel className="p-4">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">CPU trend</span>
            <span className="mono text-[11px] text-white/50">{snapshot?.cpu.frequencyMhz ?? 0} MHz</span>
          </div>
          <SparkBars values={cpuHistory} />
          <div className="mt-3 grid grid-cols-3 gap-2">
            {metrics.history.slice(-1).map((s) => (
              <div key={s.timestamp} className="contents">
                <MiniMetric label="Load 1m" value={s.cpu.load[0].toFixed(2)} />
                <MiniMetric label="Cores" value={String(s.cpu.perCore.length)} />
                <MiniMetric label="Busiest" value={`${Math.max(...s.cpu.perCore).toFixed(0)}%`} />
              </div>
            ))}
            {metrics.history.length === 0 ? (
              <>
                <MiniMetric label="Load 1m" value="—" />
                <MiniMetric label="Cores" value="—" />
                <MiniMetric label="Busiest" value="—" />
              </>
            ) : null}
          </div>
        </Panel>

        <Panel className="p-4">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">Network</span>
            <span className="mono text-[11px] text-white/50">
              {snapshot ? `${snapshot.network.length} interfaces` : "—"}
            </span>
          </div>
          <SparkBars values={netHistory} tone="info" />
          <div className="mt-3 space-y-2">
            {(snapshot?.network ?? []).slice(0, 3).map((iface) => (
              <div key={iface.iface} className="flex items-center gap-3">
                <span className="mono w-24 shrink-0 truncate text-[11px] text-white/60">{iface.iface}</span>
                <Meter value={percent(iface.rxKbs, 15_000)} tone="accent" className="flex-1" />
                <span className="mono w-24 shrink-0 text-right text-[11px] text-white/50">
                  ↓{iface.rxKbs} ↑{iface.txKbs}
                </span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* Memory detail + sessions */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel className="p-4">
          <SectionHeader title="Memory" icon="memory" />
          {snapshot ? (
            <div className="space-y-3">
              <Row label="Used" value={formatMb(snapshot.memory.usedMb)} meter={percent(snapshot.memory.usedMb, snapshot.memory.totalMb)} />
              <Row label="Cached" value={formatMb(snapshot.memory.cachedMb)} meter={percent(snapshot.memory.cachedMb, snapshot.memory.totalMb)} tone="info" />
              <Row label="Available" value={formatMb(snapshot.memory.availableMb)} meter={percent(snapshot.memory.availableMb, snapshot.memory.totalMb)} tone="ok" />
              <Row label="Swap" value={`${snapshot.memory.swapUsedMb} / ${snapshot.memory.swapTotalMb} MB`} meter={percent(snapshot.memory.swapUsedMb, snapshot.memory.swapTotalMb)} tone="warn" />
            </div>
          ) : (
            <p className="text-sm text-white/40">Waiting for the first sample…</p>
          )}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <StatTile label="Top CPU" value={(snapshot?.processes[0]?.command.split(" ")[0] ?? "—").slice(0, 14)} sub={`${snapshot?.processes[0]?.cpu ?? 0}%`} icon="cpu" tone="accent" />
            <StatTile
              label="Top memory"
              value={[...(snapshot?.processes ?? [])].sort((a, b) => b.mem - a.mem)[0]?.command.split(" ")[0].slice(0, 14) ?? "—"}
              sub={formatMb([...(snapshot?.processes ?? [])].sort((a, b) => b.mem - a.mem)[0]?.mem ?? 0)}
              icon="memory"
              tone="warn"
            />
          </div>
        </Panel>

        <div className="space-y-3">
          <Panel className="p-4">
            <SectionHeader
              title="Agent sessions"
              icon="agent"
              action={
                <Button variant="quiet" onClick={() => onNavigate("sessions")}>
                  Manage
                </Button>
              }
            />
            {chat.sessions.length === 0 ? (
              <p className="text-sm text-white/40">No sessions yet.</p>
            ) : (
              <ul className="space-y-2">
                {chat.sessions.slice(0, 4).map((session) => (
                  <li key={session.id} className="flex items-center gap-3 rounded-xl border border-white/[0.07] px-3 py-2">
                    <StatusDot
                      tone={session.status === "idle" ? "idle" : session.status === "error" ? "danger" : "ok"}
                      pulse={session.status === "thinking" || session.status === "running"}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-white/85">{session.name}</p>
                      <p className="mono truncate text-[11px] text-white/40">
                        {session.provider} · {session.model}
                      </p>
                    </div>
                    <Badge tone={session.profile === "ADMIN" ? "warn" : session.profile === "READ_ONLY" ? "ok" : "neutral"}>
                      {session.profile.replace("_", " ")}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
            <Button variant="primary" block className="mt-3" icon="agent" onClick={() => onNavigate("agent")}>
              Open AI agent
            </Button>
          </Panel>

          <Panel className="p-4">
            <SectionHeader title="Recent activity" icon="list" />
            {recentCommands.length === 0 && recentErrors.length === 0 ? (
              <p className="text-sm text-white/40">No commands executed yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {recentErrors.map((entry) => (
                  <li key={entry.id} className="mono flex items-start gap-2 text-[11.5px] text-rose-200/90">
                    <Icon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{entry.message}</span>
                  </li>
                ))}
                {recentCommands.map((entry) => (
                  <li key={entry.id} className="mono flex items-start gap-2 text-[11.5px] text-white/55">
                    <Icon name="terminal" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-soft/70" />
                    <span className="truncate">{entry.message}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 grid grid-cols-3 gap-2">
              <QuickAction icon="terminal" label="Terminal" onClick={() => onNavigate("terminal")} />
              <QuickAction icon="activity" label="Monitor" onClick={() => onNavigate("monitor")} />
              <QuickAction icon="shield" label="Approvals" onClick={() => onNavigate("approvals")} />
            </div>
          </Panel>
        </div>
      </div>

      {activeSessions.length > 0 ? (
        <Panel className="p-4">
          <SectionHeader title="Running tasks" icon="clock" />
          <div className="flex flex-wrap gap-2">
            {activeSessions.map((session) => (
              <Badge key={session.id} tone="accent">
                <StatusDot tone="ok" pulse />
                {session.name} · {session.status}
              </Badge>
            ))}
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

function Detail({
  label,
  value,
  icon,
  mono,
}: {
  label: string;
  value: string;
  icon: "clock" | "cpu" | "bolt" | "expand" | "shield" | "network" | "devices" | "activity";
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon name={icon} className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/30" />
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">{label}</p>
        <p className={`truncate text-[12.5px] text-white/80 ${mono ? "mono" : ""}`}>{value}</p>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  meter,
  tone = "accent",
}: {
  label: string;
  value: string;
  meter: number;
  tone?: "accent" | "ok" | "warn" | "danger" | "info";
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[12px]">
        <span className="text-white/60">{label}</span>
        <span className="mono text-white/80">{value}</span>
      </div>
      <Meter value={meter} tone={tone === "info" ? "accent" : tone} />
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/[0.07] bg-black/20 px-2.5 py-1.5">
      <p className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-white/35">{label}</p>
      <p className="mono text-[12px] text-white/80">{value}</p>
    </div>
  );
}

/** Lightweight bar chart — cheaper than a full chart library for 90 samples. */
function SparkBars({
  values,
  tone = "accent",
  max = 100,
}: {
  values: number[];
  tone?: "accent" | "info";
  max?: number;
}) {
  const colors = tone === "info" ? "from-sky-400/80 to-sky-300/40" : "from-accent/85 to-accent-soft/40";
  const padded = values.length ? values.slice(-48) : new Array(24).fill(0);
  const peak = Math.max(...padded, 1);
  return (
    <div className="flex h-16 items-end gap-[2px]">
      {padded.map((value, index) => (
        <div
          key={index}
          className={`flex-1 rounded-sm bg-gradient-to-t ${colors} transition-[height] duration-300`}
          style={{ height: `${Math.max(3, (Math.min(value, max) / Math.max(peak, max * 0.35)) * 100)}%` }}
        />
      ))}
    </div>
  );
}

function QuickAction({
  icon,
  label,
  onClick,
}: {
  icon: "terminal" | "activity" | "shield";
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] py-2.5 text-[11px] font-medium text-white/70 transition-colors hover:bg-white/[0.07] hover:text-white"
    >
      <Icon name={icon} className="h-4 w-4 text-accent-soft" />
      {label}
    </button>
  );
}
