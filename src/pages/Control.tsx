/**
 * PC Control — power, services and processes.
 *
 * Every mutating action here is routed through the same confirmation layer the
 * agent uses: the operation is classified, shown with its risk level and
 * command, and only dispatched after an explicit approval. Nothing is silent.
 */

import { useEffect, useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Panel,
  SectionHeader,
  Segmented,
  StatusDot,
} from "../components/ui";
import { controlStore, connectionStore, useStore } from "../state/store";
import { runtime } from "../state/bootstrap";
import { classifyCommand } from "../core/risk";
import { formatMb } from "../core/format";
import type { RiskLevel } from "../core/types";

type PowerAction = "shutdown" | "reboot" | "suspend" | "lock";

const POWER: {
  action: PowerAction;
  label: string;
  icon: "power" | "refresh" | "bolt" | "lock";
  command: string;
  description: string;
  danger: boolean;
}[] = [
  { action: "lock", label: "Lock", icon: "lock", command: "loginctl lock-session", description: "Lock the active Wayland session.", danger: false },
  { action: "suspend", label: "Suspend", icon: "bolt", command: "systemctl suspend", description: "Suspend to RAM. The agent stays reachable over Tailscale once awake.", danger: false },
  { action: "reboot", label: "Reboot", icon: "refresh", command: "systemctl reboot", description: "Restart the machine immediately.", danger: true },
  { action: "shutdown", label: "Power off", icon: "power", command: "systemctl poweroff", description: "Power the machine down. Remote access ends until it is powered on locally.", danger: true },
];

export function ControlPage() {
  const control = useStore(controlStore);
  const connection = useStore(connectionStore);
  const [pending, setPending] = useState<
    | { kind: "power"; action: PowerAction; label: string; command: string; risk: RiskLevel; description: string }
    | { kind: "service"; name: string; action: "start" | "stop" | "restart" }
    | { kind: "process"; pid: number; command: string; signal: string }
    | null
  >(null);
  const [procSort, setProcSort] = useState<"cpu" | "mem">("cpu");
  const [result, setResult] = useState<{ title: string; body: string } | null>(null);

  useEffect(() => {
    void runtime.controller.refreshControl();
  }, []);

  const processes = useMemo(
    () => [...control.processes].sort((a, b) => (procSort === "mem" ? b.mem - a.mem : b.cpu - a.cpu)),
    [control.processes, procSort],
  );

  const offline = connection.status !== "CONNECTED";

  const runPending = async () => {
    if (!pending) return;
    if (pending.kind === "power") {
      const message = await runtime.controller.powerAction(pending.action);
      setResult({ title: `${pending.label} dispatched`, body: message });
    } else if (pending.kind === "service") {
      await runtime.controller.serviceAction(pending.name, pending.action);
      setResult({
        title: `rc-service ${pending.name} ${pending.action}`,
        body: `Command dispatched. Current state: ${
          control.services.find((s) => s.name === pending.name)?.state ?? "unknown"
        }`,
      });
    } else {
      await runtime.controller.killProcess(pending.pid, pending.signal);
      setResult({ title: `SIG${pending.signal} → PID ${pending.pid}`, body: pending.command });
    }
    setPending(null);
  };

  const classifyForService = (action: string, name: string) =>
    classifyCommand(`sudo rc-service ${name} ${action}`).level;

  return (
    <div className="space-y-4">
      {result ? (
        <Panel className="border-accent/25 bg-accent/[0.07] p-3.5">
          <div className="flex items-start gap-3">
            <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-accent-soft" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-white">{result.title}</p>
              <pre className="mono mt-1 whitespace-pre-wrap text-[11.5px] text-white/65">{result.body}</pre>
            </div>
            <IconButton icon="close" label="Dismiss" onClick={() => setResult(null)} />
          </div>
        </Panel>
      ) : null}

      {/* Power */}
      <div>
        <SectionHeader title="Power" icon="power" subtitle="requires explicit confirmation" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {POWER.map((item) => (
            <button
              key={item.action}
              disabled={offline}
              onClick={() =>
                setPending({
                  kind: "power",
                  action: item.action,
                  label: item.label,
                  command: item.command,
                  risk: classifyCommand(item.command).level,
                  description: item.description,
                })
              }
              className={`flex flex-col items-start gap-2 rounded-2xl border p-3.5 text-left transition-colors disabled:opacity-40 ${
                item.danger
                  ? "border-rose-400/25 bg-rose-500/[0.08] hover:bg-rose-500/[0.14]"
                  : "border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.07]"
              }`}
            >
              <Icon name={item.icon} className={`h-5 w-5 ${item.danger ? "text-rose-300" : "text-accent-soft"}`} />
              <span className="text-[13px] font-semibold text-white/90">{item.label}</span>
              <span className="mono text-[10px] text-white/40">{item.command}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Services */}
      <Panel className="p-4">
        <SectionHeader
          title="OpenRC services"
          icon="bolt"
          action={
            <Button variant="quiet" icon="refresh" onClick={() => void runtime.controller.refreshControl()}>
              Refresh
            </Button>
          }
        />
        {control.services.length === 0 ? (
          <EmptyState icon="bolt" title="No service data" description="Connect to a device to list OpenRC services." />
        ) : (
          <div className="space-y-2">
            {control.services.map((service) => (
              <div key={service.name} className="rounded-xl border border-white/[0.07] p-3">
                <div className="flex items-center gap-2.5">
                  <StatusDot
                    tone={service.state === "started" ? "ok" : service.state === "crashed" ? "danger" : "idle"}
                    pulse={service.state === "started"}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="mono truncate text-[13px] font-medium text-white/90">{service.name}</p>
                    <p className="truncate text-[11.5px] text-white/45">{service.description}</p>
                  </div>
                  <Badge tone={service.state === "started" ? "ok" : service.state === "crashed" ? "danger" : "neutral"}>
                    {service.state}
                  </Badge>
                  <Badge tone="neutral">{service.boot}</Badge>
                </div>
                <div className="mt-2.5 flex gap-2">
                  <Button
                    variant="ghost"
                    className="flex-1"
                    disabled={offline}
                    onClick={() => setPending({ kind: "service", name: service.name, action: "restart" })}
                  >
                    Restart
                  </Button>
                  <Button
                    variant="quiet"
                    className="flex-1 border border-white/10"
                    disabled={offline}
                    onClick={() =>
                      setPending({
                        kind: "service",
                        name: service.name,
                        action: service.state === "started" ? "stop" : "start",
                      })
                    }
                  >
                    {service.state === "started" ? "Stop" : "Start"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* Processes */}
      <Panel className="p-4">
        <SectionHeader
          title="Processes"
          icon="cpu"
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
        {processes.length === 0 ? (
          <EmptyState icon="cpu" title="No process data" description="Connect to a device to read the process table." />
        ) : (
          <div className="space-y-1.5">
            {processes.map((proc) => (
              <div key={proc.pid} className="flex items-center gap-3 rounded-xl border border-white/[0.06] px-3 py-2">
                <span className="mono w-12 shrink-0 text-[11px] text-white/35">{proc.pid}</span>
                <div className="min-w-0 flex-1">
                  <p className="mono truncate text-[12.5px] text-white/85">{proc.command}</p>
                  <p className="mono text-[10.5px] text-white/40">
                    {proc.user} · {proc.cpu.toFixed(1)}% cpu · {formatMb(proc.mem)}
                  </p>
                </div>
                <button
                  disabled={offline}
                  onClick={() => setPending({ kind: "process", pid: proc.pid, command: proc.command, signal: "15" })}
                  className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] text-white/60 transition-colors hover:border-rose-400/40 hover:text-rose-200 disabled:opacity-40"
                >
                  Kill
                </button>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <ConfirmDialog
        open={Boolean(pending)}
        title={
          pending?.kind === "power"
            ? `${pending.label} the machine?`
            : pending?.kind === "service"
              ? `${pending.action} ${pending.name}?`
              : pending?.kind === "process"
                ? `Send SIG${pending.signal} to PID ${pending.pid}?`
                : ""
        }
        risk={
          pending?.kind === "power"
            ? pending.risk
            : pending?.kind === "service"
              ? classifyForService(pending.action, pending.name)
              : "MEDIUM"
        }
        command={
          pending?.kind === "power"
            ? pending.command
            : pending?.kind === "service"
              ? `sudo rc-service ${pending.name} ${pending.action}`
              : pending?.kind === "process"
                ? `kill -${pending.signal} ${pending.pid}   # ${pending.command}`
                : undefined
        }
        irreversible={pending?.kind === "power" && pending.action === "shutdown"}
        confirmLabel="Confirm"
        confirmVariant={
          pending?.kind === "power" && (pending.action === "reboot" || pending.action === "shutdown")
            ? "danger"
            : "primary"
        }
        description={
          pending?.kind === "power"
            ? pending.description
            : pending?.kind === "service"
              ? "Restarting or stopping a service interrupts anything using it. The agent will re-check its state afterwards."
              : pending?.kind === "process"
                ? "The process receives the signal immediately. Choose a stronger signal only if it ignores SIGTERM."
                : ""
        }
        extraActions={
          pending?.kind === "process" ? (
            <Button
              variant="danger"
              block
              onClick={() => setPending({ ...pending, signal: "9" })}
            >
              Use SIGKILL instead
            </Button>
          ) : null
        }
        onCancel={() => setPending(null)}
        onConfirm={() => void runPending()}
      />

      <Panel className="flex items-start gap-2.5 p-3.5">
        <Icon name="shield" className="mt-0.5 h-4 w-4 shrink-0 text-accent-soft" />
        <p className="text-[12px] leading-relaxed text-white/50">
          Each of these actions is classified before it is sent — reboot and power-off are CRITICAL, so they can
          only be approved once and always require this dialog. Last control action:{" "}
          {control.lastResult ? `“${control.lastResult.action}”` : "none yet"}.
        </p>
      </Panel>
    </div>
  );
}
