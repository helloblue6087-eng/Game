/**
 * Monitor — real-time system telemetry.
 *
 * All figures come from the single metrics subscription started here; the page
 * never spawns its own sampling. History is bounded in the store (90 samples)
 * so the charts stay cheap regardless of how long the console is left open.
 */

import { useEffect, useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { Badge, Meter, Panel, SectionHeader, Sparkline, StatTile, Segmented } from "../components/ui";
import { metricsStore, useStore } from "../state/store";
import { runtime } from "../state/bootstrap";
import { formatMb, percent } from "../core/format";

export function MonitorPage() {
  const metrics = useStore(metricsStore);
  const [procSort, setProcSort] = useState<"cpu" | "mem">("cpu");
  const [interval, setIntervalMs] = useState(1000);

  useEffect(() => {
    runtime.controller.subscribeMetrics(interval);
    return () => runtime.controller.unsubscribeMetrics();
  }, [interval]);

  const snapshot = metrics.latest;
  const cpuHistory = useMemo(() => metrics.history.map((s) => s.cpu.total), [metrics.history]);
  const memHistory = useMemo(() => metrics.history.map((s) => percent(s.memory.usedMb, s.memory.totalMb)), [metrics.history]);
  const tempHistory = useMemo(() => metrics.history.map((s) => s.temps.find((t) => t.label === "CPU")?.celsius ?? 0), [metrics.history]);
  const ioHistory = useMemo(
    () => metrics.history.map((s) => (s.disk[0]?.readKbs ?? 0) + (s.disk[0]?.writeKbs ?? 0)),
    [metrics.history],
  );

  const processes = useMemo(() => {
    if (!snapshot) return [];
    return [...snapshot.processes].sort((a, b) => (procSort === "mem" ? b.mem - a.mem : b.cpu - a.cpu));
  }, [snapshot, procSort]);

  if (!snapshot) {
    return (
      <Panel className="flex items-center gap-3 p-5">
        <span className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent-soft" style={{ animationDelay: `${i * 120}ms` }} />
          ))}
        </span>
        <p className="text-sm text-white/60">Waiting for the first telemetry sample…</p>
      </Panel>
    );
  }

  const memPercent = percent(snapshot.memory.usedMb, snapshot.memory.totalMb);

  return (
    <div className="space-y-4">
      <Panel className="flex flex-wrap items-center justify-between gap-3 p-3.5">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-signal-ok" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-signal-ok" />
          </span>
          <span className="mono text-[12px] text-white/70">live sampling</span>
          <span className="mono text-[11px] text-white/35">
            {metrics.history.length}/{90} samples buffered
          </span>
        </div>
        <div className="w-56">
          <Segmented
            value={String(interval)}
            onChange={(value) => setIntervalMs(Number(value))}
            options={[
              { value: "1000", label: "1s" },
              { value: "2000", label: "2s" },
              { value: "5000", label: "5s" },
            ]}
          />
        </div>
      </Panel>

      <div className="grid gap-3 lg:grid-cols-[1.3fr_1fr]">
        {/* CPU */}
        <Panel className="p-4">
          <SectionHeader
            title="CPU"
            icon="cpu"
            action={<Badge tone="accent">{snapshot.cpu.frequencyMhz} MHz</Badge>}
          />
          <div className="flex items-end justify-between gap-3">
            <div className="mono text-3xl font-semibold text-white">{snapshot.cpu.total.toFixed(1)}%</div>
            <div className="text-right">
              <p className="mono text-[11px] text-white/45">
                load {snapshot.cpu.load.map((l) => l.toFixed(2)).join("  ")}
              </p>
              <p className="mono text-[11px] text-white/35">{snapshot.cpu.perCore.length} threads</p>
            </div>
          </div>
          <Sparkline values={cpuHistory} className="mt-2" height={48} max={100} />
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {snapshot.cpu.perCore.map((core, index) => (
              <div key={index} className="rounded-lg border border-white/[0.07] bg-black/20 px-2 py-1.5">
                <div className="flex items-center justify-between">
                  <span className="mono text-[10px] text-white/35">cpu{index}</span>
                  <span className="mono text-[10px] text-white/65">{core.toFixed(0)}%</span>
                </div>
                <Meter
                  value={core}
                  height={3}
                  tone={core > 85 ? "danger" : core > 60 ? "warn" : "accent"}
                  className="mt-1"
                />
              </div>
            ))}
          </div>
        </Panel>

        {/* Memory */}
        <Panel className="p-4">
          <SectionHeader title="Memory" icon="memory" action={<Badge tone={memPercent > 85 ? "danger" : memPercent > 70 ? "warn" : "ok"}>{memPercent.toFixed(0)}%</Badge>} />
          <Sparkline values={memHistory} tone={memPercent > 85 ? "danger" : "accent"} height={48} max={100} />
          <div className="mt-3 space-y-2.5">
            <MemRow label="Used" value={formatMb(snapshot.memory.usedMb)} pct={percent(snapshot.memory.usedMb, snapshot.memory.totalMb)} />
            <MemRow label="Cached" value={formatMb(snapshot.memory.cachedMb)} pct={percent(snapshot.memory.cachedMb, snapshot.memory.totalMb)} tone="info" />
            <MemRow label="Available" value={formatMb(snapshot.memory.availableMb)} pct={percent(snapshot.memory.availableMb, snapshot.memory.totalMb)} tone="ok" />
            <MemRow label="Swap" value={`${snapshot.memory.swapUsedMb} MB`} pct={percent(snapshot.memory.swapUsedMb, snapshot.memory.swapTotalMb)} tone="warn" />
          </div>
          <p className="mono mt-3 text-[11px] text-white/35">
            total {formatMb(snapshot.memory.totalMb)} · swap {formatMb(snapshot.memory.swapTotalMb)}
          </p>
        </Panel>
      </div>

      {/* Thermals + IO */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel className="p-4">
          <SectionHeader title="Thermals" icon="temp" />
          <div className="grid grid-cols-3 gap-3">
            {snapshot.temps.map((temp) => (
              <StatTile
                key={temp.label}
                label={temp.label}
                value={`${temp.celsius}°`}
                tone={temp.celsius > 80 ? "danger" : temp.celsius > 68 ? "warn" : "ok"}
                icon="temp"
              />
            ))}
          </div>
          <Sparkline values={tempHistory} tone="warn" height={44} max={100} className="mt-3" />
        </Panel>

        <Panel className="p-4">
          <SectionHeader title="Disk throughput" icon="disk" />
          <Sparkline values={ioHistory} tone="info" height={44} />
          <div className="mt-3 space-y-2.5">
            {snapshot.disk.map((disk) => (
              <div key={disk.mount}>
                <div className="mb-1 flex items-center justify-between text-[12px]">
                  <span className="mono text-white/70">{disk.mount}</span>
                  <span className="mono text-white/45">
                    {disk.usedGb.toFixed(0)}/{disk.totalGb.toFixed(0)} GB · ↓{disk.readKbs} ↑{disk.writeKbs} kB/s
                  </span>
                </div>
                <Meter
                  value={percent(disk.usedGb, disk.totalGb)}
                  tone={percent(disk.usedGb, disk.totalGb) > 90 ? "danger" : percent(disk.usedGb, disk.totalGb) > 75 ? "warn" : "accent"}
                />
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* Network */}
      <Panel className="p-4">
        <SectionHeader title="Network" icon="network" />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12.5px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-[0.14em] text-white/35">
                <th className="pb-2 pr-3 font-semibold">Interface</th>
                <th className="pb-2 pr-3 font-semibold">Address</th>
                <th className="pb-2 pr-3 font-semibold">Down</th>
                <th className="pb-2 font-semibold">Up</th>
              </tr>
            </thead>
            <tbody className="mono">
              {snapshot.network.map((iface) => (
                <tr key={iface.iface} className="border-t border-white/[0.05]">
                  <td className="py-2 pr-3 text-white/80">{iface.iface}</td>
                  <td className="py-2 pr-3 text-white/55">{iface.ipv4}</td>
                  <td className="py-2 pr-3 text-sky-300">{iface.rxKbs} kB/s</td>
                  <td className="py-2 text-accent-soft">{iface.txKbs} kB/s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Processes */}
      <Panel className="p-4">
        <SectionHeader
          title="Top processes"
          icon="list"
          action={
            <div className="w-44">
              <Segmented
                value={procSort}
                onChange={setProcSort}
                options={[
                  { value: "cpu", label: "CPU" },
                  { value: "mem", label: "Memory" },
                ]}
              />
            </div>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12.5px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-[0.14em] text-white/35">
                <th className="pb-2 pr-3 font-semibold">PID</th>
                <th className="pb-2 pr-3 font-semibold">User</th>
                <th className="pb-2 pr-3 font-semibold">CPU</th>
                <th className="pb-2 pr-3 font-semibold">MEM</th>
                <th className="pb-2 font-semibold">Command</th>
              </tr>
            </thead>
            <tbody className="mono">
              {processes.slice(0, 12).map((proc) => (
                <tr key={proc.pid} className="border-t border-white/[0.05]">
                  <td className="py-2 pr-3 text-white/45">{proc.pid}</td>
                  <td className="py-2 pr-3 text-white/60">{proc.user}</td>
                  <td className={`py-2 pr-3 ${proc.cpu > 50 ? "text-rose-300" : "text-white/80"}`}>{proc.cpu.toFixed(1)}%</td>
                  <td className="py-2 pr-3 text-white/60">{proc.mem.toFixed(0)}M</td>
                  <td className="truncate py-2 text-white/75">{proc.command}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-white/35">
          <Icon name="bolt" className="h-3.5 w-3.5" />
          Read from the device's proc sampler — the console never spawns a shell for metrics.
        </p>
      </Panel>
    </div>
  );
}

function MemRow({ label, value, pct, tone = "accent" }: { label: string; value: string; pct: number; tone?: "accent" | "ok" | "warn" | "info" }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[12px]">
        <span className="text-white/60">{label}</span>
        <span className="mono text-white/80">{value}</span>
      </div>
      <Meter value={pct} tone={tone === "info" ? "accent" : tone} />
    </div>
  );
}
