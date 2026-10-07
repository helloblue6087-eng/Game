/**
 * Sessions — manage agent identities.
 *
 * Each session owns its provider, model, system prompt, permission profile and
 * conversation context. Changing the profile here changes what the permission
 * layer will allow for every subsequent tool call in that session.
 */

import { useState } from "react";
import { Icon } from "../components/Icon";
import {
  Badge,
  Button,
  EmptyState,
  Panel,
  SectionHeader,
  Sheet,
  StatusDot,
  timeAgo,
} from "../components/ui";
import { PROFILES } from "../core/permissions";
import type { AgentSession, PermissionProfile } from "../core/types";
import { chatStore, connectionStore, useStore } from "../state/store";
import { runtime } from "../state/bootstrap";

export function SessionsPage() {
  const chat = useStore(chatStore);
  const connection = useStore(connectionStore);
  const [editing, setEditing] = useState<AgentSession | null>(null);
  const [creating, setCreating] = useState(false);

  const providers = connection.providers.length
    ? connection.providers
    : [{ id: "demo", label: "Local planner (no key)", models: ["gentoo-planner-v1"], configured: true, kind: "demo" as const }];

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Agent sessions"
        icon="devices"
        subtitle="each session keeps its own context, provider and permissions"
        action={
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
            New
          </Button>
        }
      />

      {chat.sessions.length === 0 ? (
        <EmptyState
          icon="agent"
          title="No sessions"
          description="Create a session to pick a provider and a permission profile."
          action={
            <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
              Create session
            </Button>
          }
        />
      ) : (
        <div className="space-y-2.5">
          {chat.sessions.map((session) => {
            const profile = PROFILES[session.profile];
            const messageCount = (chat.messages[session.id] ?? []).length;
            return (
              <Panel key={session.id} className="p-4">
                <div className="flex items-start gap-3">
                  <StatusDot
                    tone={session.status === "idle" ? "idle" : session.status === "error" ? "danger" : "ok"}
                    pulse={session.status === "thinking" || session.status === "running"}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-[14px] font-semibold text-white">{session.name}</p>
                      <Badge tone={session.profile === "ADMIN" ? "warn" : session.profile === "READ_ONLY" ? "ok" : "neutral"}>
                        {profile.label}
                      </Badge>
                    </div>
                    <p className="mono mt-0.5 truncate text-[11px] text-white/45">
                      {session.provider} · {session.model} · {messageCount} messages · active {timeAgo(session.lastActivity)} ago
                    </p>
                    <p className="mt-2 text-[12px] leading-relaxed text-white/50">{profile.summary}</p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="ghost"
                    icon="agent"
                    onClick={() => {
                      runtime.controller.selectSession(session.id);
                      window.location.hash = "#/agent";
                    }}
                  >
                    Open
                  </Button>
                  <Button variant="ghost" icon="settings" onClick={() => setEditing(session)}>
                    Configure
                  </Button>
                  <Button
                    variant="quiet"
                    icon="trash"
                    className="border border-white/10"
                    onClick={() => {
                      if (confirm(`Delete session "${session.name}"? Its conversation history is removed.`)) {
                        runtime.controller.deleteSession(session.id);
                      }
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </Panel>
            );
          })}
        </div>
      )}

      <Panel className="p-4">
        <SectionHeader title="Permission profiles" icon="lock" />
        <div className="space-y-3">
          {(Object.keys(PROFILES) as PermissionProfile[]).map((key) => {
            const profile = PROFILES[key];
            return (
              <div key={key} className="rounded-xl border border-white/[0.07] p-3">
                <div className="flex items-center gap-2">
                  <Icon
                    name={key === "READ_ONLY" ? "eye" : key === "ADMIN" ? "shieldCheck" : key === "DANGEROUS" ? "alert" : "shield"}
                    className="h-4 w-4 text-accent-soft"
                  />
                  <span className="text-[13px] font-semibold text-white/90">{profile.label}</span>
                  <Badge tone="neutral" className="ml-auto">
                    confirms at {profile.confirmAtOrAbove}
                  </Badge>
                </div>
                <p className="mt-1.5 text-[12px] leading-relaxed text-white/55">{profile.summary}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {Object.entries(profile.categories)
                    .filter(([, verdict]) => verdict !== "deny")
                    .map(([category, verdict]) => (
                      <span
                        key={category}
                        className={`mono rounded-md border px-1.5 py-0.5 text-[10px] ${
                          verdict === "allow"
                            ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200"
                            : "border-amber-400/25 bg-amber-500/10 text-amber-200"
                        }`}
                      >
                        {category.replace("_", " ")}: {verdict}
                      </span>
                    ))}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      <SessionEditor
        open={creating || Boolean(editing)}
        session={editing}
        providers={providers}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />
    </div>
  );
}

function SessionEditor({
  open,
  session,
  providers,
  onClose,
}: {
  open: boolean;
  session: AgentSession | null;
  providers: { id: string; label: string; models: string[]; configured: boolean }[];
  onClose: () => void;
}) {
  const [name, setName] = useState(session?.name ?? "");
  const [providerId, setProviderId] = useState(session?.provider ?? providers[0]?.id ?? "demo");
  const [model, setModel] = useState(session?.model ?? providers[0]?.models[0] ?? "");
  const [profile, setProfile] = useState<PermissionProfile>(session?.profile ?? "STANDARD");
  const [prompt, setPrompt] = useState(session?.systemPrompt ?? "");
  const [key, setKey] = useState(session?.id ?? "new");

  // Re-seed local form state whenever a different session is opened.
  if (open && key !== (session?.id ?? "new")) {
    setKey(session?.id ?? "new");
    setName(session?.name ?? "");
    setProviderId(session?.provider ?? providers[0]?.id ?? "demo");
    setModel(session?.model ?? providers[0]?.models[0] ?? "");
    setProfile(session?.profile ?? "STANDARD");
    setPrompt(session?.systemPrompt ?? "");
  }

  const selectedProvider = providers.find((p) => p.id === providerId) ?? providers[0];

  const submit = () => {
    if (session) {
      runtime.controller.updateSession(session.id, {
        name: name.trim() || session.name,
        provider: providerId,
        model,
        profile,
        systemPrompt: prompt || session.systemPrompt,
      });
    } else {
      runtime.controller.createSession({
        name: name.trim() || "New agent",
        provider: providerId,
        model,
        profile,
      });
    }
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={session ? `Configure ${session.name}` : "New agent session"}
      footer={
        <div className="flex gap-2">
          <Button variant="quiet" block onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" block icon="check" onClick={submit}>
            {session ? "Save" : "Create"}
          </Button>
        </div>
      }
    >
      <div className="space-y-3.5">
        <label className="block">
          <span className="label">Session name</span>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Gentoo Admin" />
        </label>

        <label className="block">
          <span className="label">AI provider</span>
          <select
            className="field"
            value={providerId}
            onChange={(e) => {
              setProviderId(e.target.value);
              const next = providers.find((p) => p.id === e.target.value);
              if (next) setModel(next.models[0]);
            }}
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
                {p.configured ? "" : " — API key required"}
              </option>
            ))}
          </select>
          {selectedProvider && !selectedProvider.configured ? (
            <span className="mt-1.5 flex items-center gap-1.5 text-[11px] text-amber-200/85">
              <Icon name="alert" className="h-3.5 w-3.5" />
              This provider needs a server-side key before it can answer.
            </span>
          ) : null}
        </label>

        <label className="block">
          <span className="label">Model</span>
          <select className="field" value={model} onChange={(e) => setModel(e.target.value)}>
            {(selectedProvider?.models ?? []).map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="label">Permission profile</span>
          <select className="field" value={profile} onChange={(e) => setProfile(e.target.value as PermissionProfile)}>
            {(Object.keys(PROFILES) as PermissionProfile[]).map((p) => (
              <option key={p} value={p}>
                {PROFILES[p].label}
              </option>
            ))}
          </select>
          <span className="mt-1.5 block text-[11.5px] leading-relaxed text-white/50">
            {PROFILES[profile].summary}
          </span>
        </label>

        <label className="block">
          <span className="label">System prompt</span>
          <textarea
            className="field min-h-[110px] resize-y"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Leave empty to use the default Gentoo agent prompt."
          />
        </label>
      </div>
    </Sheet>
  );
}
