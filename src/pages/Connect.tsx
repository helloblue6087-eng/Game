/**
 * First-run / landing screen.
 *
 * Shown before the console is entered and whenever the link is cold. It
 * performs the same job the agent's first-run setup does on the Gentoo side:
 * report what was detected and whether each hop of the chain is healthy, so a
 * misconfigured Tailscale route or a missing provider is obvious before the
 * operator starts issuing commands.
 */

import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { Badge, Button, Panel, StatusDot } from "../components/ui";
import { chatStore, connectionStore, useStore } from "../state/store";
import { runtime } from "../state/bootstrap";
import { GatewaySheet } from "./Settings";

interface ChecklistRow {
  label: string;
  detail: string;
  tone: "ok" | "warn" | "danger" | "idle";
}

export function Connect({ onEnter }: { onEnter: () => void }) {
  const connection = useStore(connectionStore);
  const chat = useStore(chatStore);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const device = connection.device;
  const connected = connection.status === "CONNECTED";
  const providers = connection.providers;
  const configuredProviders = providers.filter((p) => p.configured).length;

  const rows: ChecklistRow[] = [
    {
      label: "Gentoo PC",
      detail: device ? `${device.hostname} · ${device.arch} · ${device.compositor}` : "Not detected yet",
      tone: device ? "ok" : connection.status === "RECONNECTING" ? "warn" : "danger",
    },
    {
      label: "Local agent",
      detail: device ? `${device.os} · ${device.init}` : "Waiting for handshake",
      tone: device ? "ok" : "warn",
    },
    {
      label: "WebSocket gateway",
      detail:
        connection.status === "CONNECTED"
          ? `${connection.meta.route || "gateway"} · ${connection.meta.latencyMs ?? "—"}ms`
          : connection.status,
      tone: connected ? "ok" : connection.status === "RECONNECTING" ? "warn" : "danger",
    },
    {
      label: "Tailscale route",
      detail: device?.tailscaleIp ? `100.x mesh · ${device.tailscaleIp}` : "No mesh address reported",
      tone: device?.tailscaleIp ? "ok" : "warn",
    },
    {
      label: "AI providers",
      detail:
        providers.length === 0
          ? "Awaiting device inventory"
          : `${configuredProviders} of ${providers.length} configured`,
      tone: configuredProviders > 0 ? "ok" : "warn",
    },
  ];

  return (
    <div className="relative flex min-h-full flex-col">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-24 top-[-10%] h-[420px] w-[420px] rounded-full bg-accent/20 blur-[120px]" />
        <div className="absolute right-[-15%] top-[20%] h-[360px] w-[360px] rounded-full bg-sky-400/10 blur-[130px]" />
      </div>

      <div className="relative mx-auto flex w-full max-w-5xl flex-1 flex-col px-5 pb-10 pt-12 sm:px-8 sm:pt-16">
        <div className="flex items-center gap-3">
          <span className="relative flex h-11 w-11 items-center justify-center rounded-2xl border border-accent/40 bg-accent/15 text-accent-soft shadow-glow">
            <Icon name="terminal" className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[15px] font-semibold tracking-tight text-white">Gentoo Agent</p>
            <p className="mono text-[11px] uppercase tracking-[0.28em] text-accent-soft/80">
              control center
            </p>
          </div>
        </div>

        <div className="mt-10 grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div>
            <h1 className="text-balance text-[34px] font-semibold leading-[1.08] tracking-tight text-white sm:text-[46px]">
              An AI operating console for your{" "}
              <span className="bg-gradient-to-r from-accent-soft via-accent to-sky-300 bg-clip-text text-transparent">
                Gentoo machine
              </span>
              .
            </h1>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-white/65">
              Talk to GPT or Claude and let them inspect, explain and — with your explicit approval —
              change things on your PC. Terminal, files, services, processes and live metrics, all
              through one permission-checked channel over your Tailscale network.
            </p>

            <div className="mt-7 flex flex-col gap-2.5 sm:flex-row">
              <Button variant="primary" icon={connected ? "bolt" : "refresh"} onClick={onEnter}>
                {connected ? "Enter console" : "Open console offline"}
              </Button>
              <Button variant="ghost" icon="settings" onClick={() => setSettingsOpen(true)}>
                Gateway settings
              </Button>
            </div>

            <p className="mono mt-4 text-[11px] text-white/35">
              {connected
                ? `handshake ok · protocol v2 · ${elapsed}s session`
                : `connection state: ${connection.status} · ${elapsed}s elapsed`}
            </p>
          </div>

          <Panel className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <StatusDot tone={connected ? "ok" : "danger"} pulse={connected} />
                <span className="mono text-[11px] font-semibold uppercase tracking-[0.2em] text-white/70">
                  {connected ? "PC online" : "PC unreachable"}
                </span>
              </div>
              <Badge tone={connection.transportKind === "simulated" ? "warn" : "accent"}>
                {connection.transportKind === "simulated" ? "simulated device" : "live gateway"}
              </Badge>
            </div>

            <ul className="space-y-2.5">
              {rows.map((row) => (
                <li key={row.label} className="flex items-start gap-3">
                  <StatusDot tone={row.tone} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-white/85">{row.label}</p>
                    <p className="mono truncate text-[11px] text-white/45">{row.detail}</p>
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-5 grid grid-cols-3 gap-2 border-t border-white/[0.07] pt-4">
              <MiniStat label="Sessions" value={String(chat.sessions.length || "—")} />
              <MiniStat label="Pending" value={String(chat.approvals.length)} />
              <MiniStat label="Active" value={String(runtime.settings.transport === "websocket" ? "GW" : "SIM")} />
            </div>
          </Panel>
        </div>

        <div className="mt-12 grid gap-3 sm:grid-cols-3">
          <Feature
            icon="shieldCheck"
            title="Every action is graded"
            body="Commands are classified LOW → CRITICAL before execution. Critical operations can only ever be approved once."
          />
          <Feature
            icon="agent"
            title="Provider agnostic"
            body="OpenAI, Anthropic or a local planner behind one interface. Keys never reach the browser."
          />
          <Feature
            icon="network"
            title="Tailscale native"
            body="No port forwarding. The phone, the second PC and the Gentoo box meet on the same mesh."
          />
        </div>
      </div>

      {settingsOpen ? (
        <GatewaySheet
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          settings={runtime.settings}
          onSave={() => setSettingsOpen(false)}
        />
      ) : null}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/35">{label}</p>
      <p className="mono mt-1 text-base font-semibold text-white">{value}</p>
    </div>
  );
}

function Feature({ icon, title, body }: { icon: "shieldCheck" | "agent" | "network"; title: string; body: string }) {
  return (
    <Panel className="p-4">
      <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-accent-soft">
        <Icon name={icon} className="h-4 w-4" />
      </div>
      <p className="text-[13px] font-semibold text-white/90">{title}</p>
      <p className="mt-1 text-[12.5px] leading-relaxed text-white/55">{body}</p>
    </Panel>
  );
}
