/**
 * Settings — gateway, providers and console preferences.
 *
 * The gateway sheet is exported because the landing screen reuses it: the same
 * form configures the console before first entry and afterwards from Settings.
 * Secrets never live here — only the gateway URL and the session token issued
 * by the agent, which the browser legitimately needs in order to authenticate.
 */

import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { Badge, Button, Field, Panel, SectionHeader, Sheet, Toggle } from "../components/ui";
import { chatStore, connectionStore, useStore } from "../state/store";
import { reconnectWith, runtime, saveSettings, type GatewaySettings } from "../state/bootstrap";

const PREFS_KEY = "gacc.prefs.v1";

interface Prefs {
  compactMetrics: boolean;
  confirmPowerActions: boolean;
  showSimulatedBanner: boolean;
}

function loadPrefs(): Prefs {
  try {
    return { compactMetrics: false, confirmPowerActions: true, showSimulatedBanner: true, ...(JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<Prefs>) };
  } catch {
    return { compactMetrics: false, confirmPowerActions: true, showSimulatedBanner: true };
  }
}

export function SettingsPage() {
  const connection = useStore(connectionStore);
  const chat = useStore(chatStore);
  const [gatewayOpen, setGatewayOpen] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);

  useEffect(() => {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  }, [prefs]);

  const device = connection.device;

  return (
    <div className="space-y-4">
      <Panel className="p-4">
        <SectionHeader title="Connection" icon="network" subtitle="where the console looks for your agent" />
        <dl className="space-y-2.5">
          <Row label="Transport" value={connection.transportKind === "websocket" ? "Live WebSocket gateway" : "Simulated device (in-browser)"} />
          <Row label="Gateway URL" value={runtime.settings.url || "—"} mono />
          <Row label="Device ID" value={runtime.settings.deviceId} mono />
          <Row label="Session token" value={runtime.settings.token ? "••••••••configured" : "not set — the agent will reject authentication"} />
          <Row label="Allowed roots" value={runtime.settings.allowedRoots.join(", ") || "/"} mono />
          <Row label="Route" value={connection.meta.route || "—"} mono />
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" icon="settings" onClick={() => setGatewayOpen(true)}>
            Configure gateway
          </Button>
          <Button variant="ghost" icon="refresh" onClick={() => runtime.controller.connect()}>
            Reconnect now
          </Button>
          {connection.transportKind === "simulated" && runtime.simulated ? (
            <Button variant="ghost" icon="offline" onClick={() => runtime.simulated?.simulateDrop()}>
              Simulate a drop
            </Button>
          ) : null}
        </div>
      </Panel>

      <Panel className="p-4">
        <SectionHeader title="AI providers" icon="agent" subtitle="inventory reported by the device" />
        {connection.providers.length === 0 ? (
          <p className="text-sm text-white/45">No provider inventory yet — connect to a device.</p>
        ) : (
          <div className="space-y-2">
            {connection.providers.map((provider) => (
              <div key={provider.id} className="flex items-center gap-3 rounded-xl border border-white/[0.07] p-3">
                <Icon name="bolt" className="h-4 w-4 shrink-0 text-accent-soft" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-white/90">{provider.label}</p>
                  <p className="mono truncate text-[11px] text-white/45">{provider.models.join(" · ")}</p>
                </div>
                <Badge tone={provider.configured ? "ok" : "warn"}>
                  {provider.configured ? "ready" : "needs key"}
                </Badge>
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 rounded-xl border border-white/[0.07] bg-black/25 p-3 text-[12px] leading-relaxed text-white/55">
          Provider API keys are held by the agent process on the Gentoo machine, never in this bundle. Requests
          for OpenAI and Anthropic go through that process, so the browser only ever sees the agent's own
          token. Set <span className="mono text-accent-soft">OPENAI_API_KEY</span> or{" "}
          <span className="mono text-accent-soft">ANTHROPIC_API_KEY</span> in the agent's environment (or its
          config file) and restart it.
        </p>
      </Panel>

      <Panel className="p-4">
        <SectionHeader title="Console preferences" icon="settings" />
        <div className="space-y-3">
          <PrefRow
            label="Confirm power actions"
            description="Always ask before shutdown, reboot, suspend or lock."
            checked={prefs.confirmPowerActions}
            onChange={(value) => setPrefs({ ...prefs, confirmPowerActions: value })}
          />
          <PrefRow
            label="Compact metrics"
            description="Reduce chart heights on small screens."
            checked={prefs.compactMetrics}
            onChange={(value) => setPrefs({ ...prefs, compactMetrics: value })}
          />
          <PrefRow
            label="Show simulated-device banner"
            description="Remind me when the console is not talking to real hardware."
            checked={prefs.showSimulatedBanner}
            onChange={(value) => setPrefs({ ...prefs, showSimulatedBanner: value })}
          />
        </div>
      </Panel>

      <Panel className="p-4">
        <SectionHeader title="Local console state" icon="trash" subtitle="stored in this browser only" />
        <p className="text-[12.5px] leading-relaxed text-white/55">
          The console keeps {chat.sessions.length} sessions and their conversations in memory plus a small
          amount of local storage. Clearing it does not affect anything on the Gentoo machine.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="ghost"
            icon="trash"
            onClick={() => {
              localStorage.removeItem(PREFS_KEY);
              setPrefs(loadPrefs());
            }}
          >
            Reset preferences
          </Button>
          <Button
            variant="danger"
            icon="alert"
            onClick={() => {
              if (confirm("Clear saved gateway settings in this browser? The agent is not affected.")) {
                localStorage.removeItem("gacc.settings.v2");
              }
            }}
          >
            Forget gateway settings
          </Button>
        </div>
      </Panel>

      <Panel className="p-4">
        <SectionHeader title="About" icon="terminal" />
        <dl className="space-y-2">
          <Row label="Application" value="Gentoo Agent Control Center" />
          <Row label="Protocol" value="v2 (structured WebSocket frames)" />
          <Row label="Device" value={device ? `${device.os} · ${device.kernel}` : "—"} mono />
          <Row label="Init" value={device?.init ?? "—"} />
          <Row label="Session" value={device?.user ?? "—"} mono />
        </dl>
      </Panel>

      <GatewaySheet open={gatewayOpen} onClose={() => setGatewayOpen(false)} settings={runtime.settings} onSave={() => setGatewayOpen(false)} />
    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-[12.5px] text-white/45">{label}</dt>
      <dd className={`min-w-0 break-all text-right text-[12.5px] text-white/80 ${mono ? "mono" : ""}`}>{value}</dd>
    </div>
  );
}

function PrefRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-white/85">{label}</p>
        <p className="mt-0.5 text-[12px] text-white/45">{description}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} label={label} />
    </div>
  );
}

/** Reusable gateway form — also used by the landing screen. */
export function GatewaySheet({
  open,
  onClose,
  settings,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  settings: GatewaySettings;
  onSave: (next: GatewaySettings) => void;
}) {
  const [draft, setDraft] = useState<GatewaySettings>(settings);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (open) setDraft(settings);
  }, [open, settings]);

  const apply = () => {
    setApplying(true);
    saveSettings(draft);
    reconnectWith(draft);
    setTimeout(() => {
      setApplying(false);
      onSave(draft);
    }, 400);
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Gateway settings"
      size="tall"
      footer={
        <div className="flex gap-2">
          <Button variant="quiet" block onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" block icon="check" disabled={applying} onClick={apply}>
            {applying ? "Reconnecting…" : "Save and reconnect"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Transport" hint="Use the simulated device to explore the console without a live agent.">
          <select
            className="field"
            value={draft.transport}
            onChange={(event) => setDraft({ ...draft, transport: event.target.value as GatewaySettings["transport"] })}
          >
            <option value="simulated">Simulated device (in-browser)</option>
            <option value="websocket">Live WebSocket gateway</option>
          </select>
        </Field>

        {draft.transport === "websocket" ? (
          <>
            <Field label="Gateway URL" hint="Your WebSocket endpoint, e.g. wss://gentoo.tail-scale.ts.net/agent">
              <input
                className="field mono"
                value={draft.url}
                onChange={(event) => setDraft({ ...draft, url: event.target.value })}
                placeholder="wss://host/agent"
              />
            </Field>
            <Field label="Session token" hint="Issued by the agent. Stored locally; never sent anywhere else.">
              <input
                className="field mono"
                type="password"
                value={draft.token}
                onChange={(event) => setDraft({ ...draft, token: event.target.value })}
                placeholder="paste the agent token"
              />
            </Field>
            <Field label="Device ID">
              <input
                className="field mono"
                value={draft.deviceId}
                onChange={(event) => setDraft({ ...draft, deviceId: event.target.value })}
              />
            </Field>
          </>
        ) : null}

        <Field
          label="Allowed filesystem roots"
          hint="Comma separated. The device refuses any path that resolves outside these roots."
        >
          <input
            className="field mono"
            value={draft.allowedRoots.join(", ")}
            onChange={(event) =>
              setDraft({
                ...draft,
                allowedRoots: event.target.value
                  .split(",")
                  .map((value) => value.trim())
                  .filter(Boolean),
              })
            }
          />
        </Field>

        <div className="flex items-start gap-2.5 rounded-xl border border-white/[0.07] bg-black/25 p-3">
          <Icon name="lock" className="mt-0.5 h-4 w-4 shrink-0 text-accent-soft" />
          <p className="text-[12px] leading-relaxed text-white/55">
            The token is the only credential this console holds. It is scoped to a single device and can be
            revoked from the agent at any time, which invalidates this browser immediately.
          </p>
        </div>
      </div>
    </Sheet>
  );
}
