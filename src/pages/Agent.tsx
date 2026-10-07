/**
 * AI Agent — the chat surface.
 *
 * Renders the full agent turn: reasoning trace, plan, every tool call with its
 * captured output, the streamed answer, token usage and the timeline. Streaming
 * deltas go straight into a dedicated streaming slot so partial text never
 * re-renders finished messages.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { Markdown } from "../components/Markdown";
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  Panel,
  RiskBadge,
  Sheet,
  StatusDot,
  timeAgo,
  useCopy,
} from "../components/ui";
import { chatStore, connectionStore, useStore } from "../state/store";
import { runtime } from "../state/bootstrap";
import type { ChatMessage, ToolCall } from "../core/types";
import { formatClock } from "../core/format";

const QUICK_PROMPTS = [
  "Check why my system is using so much RAM.",
  "Show me the processes responsible.",
  "My PipeWire audio is broken — diagnose it.",
  "Is my root filesystem running out of space?",
  "Which services crashed since boot?",
  "Install a Wayland screenshot tool.",
];

export function AgentPage() {
  const chat = useStore(chatStore);
  const connection = useStore(connectionStore);
  const [draft, setDraft] = useState("");
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [copiedText, copyText] = useCopy();
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const activeId = chat.activeSessionId;
  const session = chat.sessions.find((s) => s.id === activeId) ?? null;
  const messages = activeId ? (chat.messages[activeId] ?? []) : [];
  const streaming = activeId ? chat.streaming[activeId] : undefined;
  const timeline = activeId ? (chat.timeline[activeId] ?? []) : [];
  const approvals = chat.approvals.filter((a) => a.sessionId === activeId);
  const isStreaming = Boolean(streaming);
  const offline = connection.status !== "CONNECTED";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, streaming?.text.length, streaming?.toolCalls.length]);

  useEffect(() => {
    if (!activeId && chat.sessions.length > 0) {
      runtime.controller.selectSession(chat.sessions[0].id);
    }
  }, [activeId, chat.sessions]);

  const send = () => {
    if (!activeId || !draft.trim()) return;
    runtime.controller.sendMessage(activeId, draft);
    setDraft("");
    setEditing(null);
  };

  const retry = (message: ChatMessage) => {
    if (!activeId) return;
    runtime.controller.sendMessage(activeId, message.content);
  };

  const exportConversation = () => {
    const text = messages
      .map((m) => {
        const tools = (m.toolCalls ?? [])
          .map((t) => `  [tool] ${t.tool} -> exit ${t.exitCode ?? "?"}\n${t.stdout ?? ""}`)
          .join("\n");
        return `## ${m.role} — ${new Date(m.createdAt).toISOString()}\n${m.content}\n${tools}`;
      })
      .join("\n\n");
    copyText(text || "empty conversation");
  };

  if (!session) {
    return (
      <EmptyState
        icon="agent"
        title="No agent session yet"
        description="Create a session to choose a provider, model and permission profile."
        action={
          <Button variant="primary" icon="plus" onClick={() => setSessionsOpen(true)}>
            Create session
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col" style={{ minHeight: "calc(100vh - 190px)" }}>
      {/* Session bar */}
      <Panel className="mb-3 flex items-center gap-3 px-3 py-2.5">
        <StatusDot
          tone={session.status === "idle" ? "idle" : session.status === "error" ? "danger" : "ok"}
          pulse={session.status === "thinking" || session.status === "running"}
        />
        <button
          onClick={() => setSessionsOpen(true)}
          className="min-w-0 flex-1 text-left"
        >
          <p className="truncate text-[13px] font-semibold text-white">{session.name}</p>
          <p className="mono truncate text-[11px] text-white/45">
            {session.provider} · {session.model} · {session.profile.replace("_", " ").toLowerCase()}
          </p>
        </button>
        <Badge tone={isStreaming ? "accent" : "neutral"}>
          {isStreaming ? session.status.toUpperCase() : "IDLE"}
        </Badge>
        <IconButton icon="clock" label="Activity timeline" onClick={() => setTimelineOpen(true)} />
        <IconButton icon="devices" label="Switch session" onClick={() => setSessionsOpen(true)} />
      </Panel>

      {/* Messages */}
      <div ref={scrollRef} className="scroll-area flex-1 space-y-3 pb-3">
        {messages.length === 0 && !streaming ? (
          <div className="space-y-3">
            <EmptyState
              icon="bolt"
              title={`${session.name} is ready`}
              description="Ask a question and the agent will plan, inspect the system through permission-checked tools, and explain what it finds."
            />
            <div className="flex flex-wrap gap-2">
              {QUICK_PROMPTS.slice(0, 4).map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => setDraft(prompt)}
                  className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-left text-[12px] text-white/65 transition-colors hover:border-accent/40 hover:text-white"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            onRetry={() => retry(message)}
            onEdit={() => {
              setEditing(message);
              setDraft(message.content);
            }}
            onCopy={() => copyText(message.content)}
          />
        ))}

        {streaming ? (
          <div className="space-y-2">
            {streaming.plan.length > 0 ? <PlanCard steps={streaming.plan} /> : null}
            {streaming.reasoning ? <ReasoningPanel text={streaming.reasoning} /> : null}
            {streaming.toolCalls.map((call) => (
              <ToolCallCard key={call.id} call={call} />
            ))}
            {streaming.text ? (
              <Panel className="p-3.5">
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="mono text-[10px] font-semibold uppercase tracking-[0.18em] text-accent-soft/80">
                    agent
                  </span>
                </div>
                <Markdown content={streaming.text} className="streaming-caret" />
              </Panel>
            ) : streaming.status === "thinking" && streaming.toolCalls.length === 0 && !streaming.plan.length ? (
              <ThinkingIndicator />
            ) : null}
          </div>
        ) : null}

        <div ref={bottomRef} />
      </div>

      {/* Inline approvals */}
      {approvals.map((approval) => (
        <Panel key={approval.id} className="mb-3 border-amber-400/25 bg-amber-500/[0.07] p-3.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Icon name="shield" className="h-4 w-4 text-amber-200" />
              <span className="text-[13px] font-semibold text-amber-100">Approval required</span>
            </div>
            <RiskBadge level={approval.risk} />
          </div>
          <pre className="mono mt-2 overflow-x-auto rounded-xl border border-white/10 bg-black/40 p-3 text-[12px] text-accent-soft">
            {approval.command}
          </pre>
          <p className="mt-2 text-[12px] text-white/60">{approval.reason}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button variant="danger" icon="close" onClick={() => runtime.controller.decideApproval(approval.id, "deny")}>
              Deny
            </Button>
            <Button variant="primary" icon="check" onClick={() => runtime.controller.decideApproval(approval.id, "approve_once")}>
              Approve once
            </Button>
          </div>
          {approval.risk !== "CRITICAL" ? (
            <Button
              variant="quiet"
              block
              className="mt-2"
              onClick={() => runtime.controller.decideApproval(approval.id, "approve_session")}
            >
              Approve for this session
            </Button>
          ) : (
            <p className="mt-2 text-center text-[11px] text-rose-200/80">
              Irreversible — session approval is disabled for CRITICAL operations.
            </p>
          )}
        </Panel>
      ))}

      {/* Composer */}
      <div className="sticky bottom-[70px] z-20 lg:bottom-0">
        {editing ? (
          <div className="mb-2 flex items-center gap-2 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2 text-[12px] text-accent-soft">
            <Icon name="edit" className="h-3.5 w-3.5" />
            Editing a previous message — sending will start a new turn.
            <button className="ml-auto text-white/60 hover:text-white" onClick={() => setEditing(null)}>
              <Icon name="close" className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}
        <Panel solid className="flex items-end gap-2 p-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder={offline ? "Offline — messages will queue until the device reconnects" : "Ask the agent to inspect or change something…"}
            className="max-h-40 min-h-[42px] flex-1 resize-none bg-transparent px-2 py-2.5 text-[14px] text-white/90 placeholder:text-white/30 focus:outline-none"
            style={{ height: Math.min(160, 42 + draft.split("\n").length * 20) }}
          />
          {isStreaming ? (
            <IconButton
              icon="stop"
              label="Stop generation"
              className="border-rose-400/30 bg-rose-500/15 text-rose-200"
              onClick={() => runtime.controller.stopGeneration(session.id)}
            />
          ) : (
            <IconButton
              icon="send"
              label="Send message"
              className="border-accent/40 bg-accent/25 text-white disabled:opacity-40"
              disabled={!draft.trim()}
              onClick={send}
            />
          )}
        </Panel>
        <div className="mt-1.5 flex items-center justify-between px-1">
          <span className="mono text-[10px] text-white/30">
            {messages.length} messages · {timeline.length} timeline events
          </span>
          <button className="mono text-[10px] text-white/40 hover:text-white/70" onClick={exportConversation}>
            {copiedText ? "copied!" : "export conversation"}
          </button>
        </div>
      </div>

      <SessionsSheet open={sessionsOpen} onClose={() => setSessionsOpen(false)} />

      <Sheet open={timelineOpen} onClose={() => setTimelineOpen(false)} title="Agent activity timeline" size="tall">
        {timeline.length === 0 ? (
          <p className="text-sm text-white/50">No activity recorded for this session yet.</p>
        ) : (
          <ol className="relative space-y-3 border-l border-white/10 pl-4">
            {timeline
              .slice()
              .reverse()
              .map((event) => (
                <li key={event.id} className="relative">
                  <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-accent" />
                  <div className="flex items-baseline gap-2">
                    <span className="mono text-[11px] text-white/40">{formatClock(event.at)}</span>
                    <span className="text-[13px] font-medium text-white/85">{event.label}</span>
                  </div>
                  {event.detail ? (
                    <p className="mono mt-0.5 text-[11px] text-white/45">{event.detail}</p>
                  ) : null}
                </li>
              ))}
          </ol>
        )}
      </Sheet>

    </div>
  );
}

/* ------------------------------------------------------------- message view */

function MessageBubble({
  message,
  onRetry,
  onEdit,
  onCopy,
}: {
  message: ChatMessage;
  onRetry: () => void;
  onEdit: () => void;
  onCopy: () => void;
}) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[88%] rounded-2xl rounded-br-md border border-accent/25 bg-accent/[0.14] px-3.5 py-2.5">
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-white/90">{message.content}</p>
          <div className="mt-1.5 flex items-center justify-end gap-2">
            <span className="mono text-[10px] text-white/35">{formatClock(message.createdAt)}</span>
            <button className="text-white/35 hover:text-white/70" onClick={onEdit} title="Edit and resend">
              <Icon name="edit" className="h-3.5 w-3.5" />
            </button>
            <button className="text-white/35 hover:text-white/70" onClick={onCopy} title="Copy">
              <Icon name="copy" className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {message.plan && message.plan.length > 0 ? <PlanCard steps={message.plan} /> : null}
      {message.toolCalls?.map((call) => <ToolCallCard key={call.id} call={call} />)}

      {message.error ? (
        <Panel className="border-rose-400/25 bg-rose-500/[0.08] p-3.5">
          <div className="flex items-center gap-2">
            <Icon name="alert" className="h-4 w-4 text-rose-300" />
            <p className="text-[13px] font-semibold text-rose-100">{message.error.message}</p>
          </div>
          <details className="mt-2">
            <summary className="cursor-pointer text-[11px] text-white/50">Technical details</summary>
            <pre className="mono mt-1.5 overflow-x-auto text-[11px] text-white/45">{message.error.technical}</pre>
          </details>
        </Panel>
      ) : null}

      {message.content ? (
        <Panel className="p-3.5">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="mono text-[10px] font-semibold uppercase tracking-[0.18em] text-accent-soft/80">
              agent
            </span>
            <span className="mono text-[10px] text-white/30">{formatClock(message.createdAt)}</span>
            {message.usage ? (
              <span className="mono ml-auto text-[10px] text-white/30">
                {message.usage.promptTokens}↑ {message.usage.completionTokens}↓ tok
              </span>
            ) : null}
          </div>
          <Markdown content={message.content} />
          <div className="mt-2 flex items-center gap-3">
            <button className="mono text-[10px] text-white/35 hover:text-white/70" onClick={onCopy}>
              copy
            </button>
            <button className="mono text-[10px] text-white/35 hover:text-white/70" onClick={onRetry}>
              regenerate
            </button>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

function PlanCard({ steps }: { steps: string[] }) {
  return (
    <Panel className="p-3.5">
      <div className="mb-2 flex items-center gap-2">
        <Icon name="list" className="h-4 w-4 text-accent-soft" />
        <span className="mono text-[10px] font-semibold uppercase tracking-[0.18em] text-accent-soft/80">
          plan
        </span>
        <span className="mono ml-auto text-[10px] text-white/30">{steps.length} steps</span>
      </div>
      <ol className="space-y-1.5">
        {steps.map((step, index) => (
          <li key={index} className="flex items-start gap-2.5 text-[13px] text-white/75">
            <span
              className="mono mt-0.5 flex shrink-0 items-center justify-center rounded-md border border-accent/30 bg-accent/10 text-[10px] text-accent-soft"
              style={{ height: 18, width: 18 }}
            >
              {index + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function ReasoningPanel({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const lines = text.trim().split("\n").filter(Boolean);
  return (
    <Panel className="p-3.5">
      <button className="flex w-full items-center gap-2" onClick={() => setOpen((value) => !value)}>
        <Icon name="bolt" className="h-4 w-4 text-accent-soft/80" />
        <span className="mono text-[10px] font-semibold uppercase tracking-[0.18em] text-accent-soft/80">
          reasoning
        </span>
        <span className="mono ml-auto text-[10px] text-white/35">{lines.length} steps</span>
        <Icon name={open ? "chevronDown" : "chevronRight"} className="h-3.5 w-3.5 text-white/40" />
      </button>
      {open ? (
        <div className="mt-2 space-y-1">
          {lines.map((line, index) => (
            <p key={index} className="mono text-[11.5px] leading-relaxed text-white/50">
              {line}
            </p>
          ))}
        </div>
      ) : (
        <p className="mono mt-1.5 truncate text-[11.5px] text-white/45">{lines[lines.length - 1]}</p>
      )}
    </Panel>
  );
}

const TOOL_STATUS_TONE: Record<ToolCall["status"], "ok" | "warn" | "danger" | "neutral" | "accent"> = {
  pending: "neutral",
  awaiting_approval: "warn",
  running: "accent",
  ok: "ok",
  failed: "danger",
  denied: "danger",
};

function ToolCallCard({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(call.status === "awaiting_approval" || call.status === "failed");
  const command = useMemo(() => {
    const entries = Object.entries(call.args);
    if (entries.length === 0) return call.tool;
    return `${call.tool} ${entries.map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(" ")}`;
  }, [call]);
  const duration = call.finishedAt ? `${call.finishedAt - call.startedAt} ms` : "running…";

  return (
    <Panel className="overflow-hidden">
      <button className="flex w-full items-center gap-2.5 px-3.5 py-2.5" onClick={() => setOpen((value) => !value)}>
        <Icon
          name={call.status === "ok" ? "check" : call.status === "failed" || call.status === "denied" ? "close" : "terminal"}
          className={`h-4 w-4 shrink-0 ${
            call.status === "ok"
              ? "text-emerald-300"
              : call.status === "failed" || call.status === "denied"
                ? "text-rose-300"
                : "text-accent-soft"
          }`}
        />
        <span className="mono shrink-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">
          tool
        </span>
        <span className="mono min-w-0 flex-1 truncate text-left text-[12px] text-white/80">{command}</span>
        <Badge tone={TOOL_STATUS_TONE[call.status]}>{call.status.replace("_", " ")}</Badge>
        <Icon name={open ? "chevronDown" : "chevronRight"} className="h-3.5 w-3.5 shrink-0 text-white/35" />
      </button>
      <div className="flex items-center gap-3 border-t border-white/[0.06] px-3.5 py-1.5">
        <RiskBadge level={call.risk} />
        <span className="mono text-[10px] text-white/35">{call.category.replace("_", " ")}</span>
        <span className="mono ml-auto text-[10px] text-white/35">{duration}</span>
        {call.exitCode !== undefined ? (
          <span className={`mono text-[10px] ${call.exitCode === 0 ? "text-emerald-300" : "text-rose-300"}`}>
            exit {call.exitCode}
          </span>
        ) : null}
      </div>
      {open ? (
        <div className="border-t border-white/[0.06] bg-black/35 p-3">
          {call.stdout ? (
            <pre className="mono scroll-area max-h-64 overflow-auto whitespace-pre-wrap text-[11.5px] leading-relaxed text-white/75">
              {call.stdout}
            </pre>
          ) : null}
          {call.stderr ? (
            <pre className="mono mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-[11.5px] leading-relaxed text-rose-200/85">
              {call.stderr}
            </pre>
          ) : null}
          {!call.stdout && !call.stderr ? (
            <p className="mono text-[11.5px] text-white/40">
              {call.status === "awaiting_approval" ? "Waiting for your approval…" : "Executing…"}
            </p>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}

function ThinkingIndicator() {
  return (
    <Panel className="flex items-center gap-3 p-3.5">
      <span className="flex gap-1">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent-soft"
            style={{ animationDelay: `${index * 120}ms` }}
          />
        ))}
      </span>
      <span className="mono text-[12px] text-white/50">planning and inspecting…</span>
    </Panel>
  );
}

/* ------------------------------------------------------------ session sheet */

function SessionsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const chat = useStore(chatStore);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("demo");
  const [profile, setProfile] = useState("STANDARD");
  const connection = useStore(connectionStore);

  const providers = connection.providers.length
    ? connection.providers
    : [{ id: "demo", label: "Local planner (no key)", models: ["gentoo-planner-v1"], configured: true, kind: "demo" as const }];

  const create = () => {
    const selected = providers.find((p) => p.id === provider) ?? providers[0];
    runtime.controller.createSession({
      name: name.trim() || "New agent",
      provider: selected.id,
      model: selected.models[0],
      profile,
    });
    setCreating(false);
    setName("");
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title="Agent sessions" size="tall">
      <div className="space-y-2">
        {chat.sessions.map((session) => {
          const active = session.id === chat.activeSessionId;
          return (
            <button
              key={session.id}
              onClick={() => {
                runtime.controller.selectSession(session.id);
                onClose();
              }}
              className={`flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors ${
                active ? "border-accent/40 bg-accent/12" : "border-white/[0.08] hover:bg-white/[0.04]"
              }`}
            >
              <StatusDot
                tone={session.status === "idle" ? "idle" : session.status === "error" ? "danger" : "ok"}
                pulse={session.status === "thinking" || session.status === "running"}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-medium text-white/90">{session.name}</p>
                <p className="mono truncate text-[11px] text-white/45">
                  {session.provider} · {session.model}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Badge tone={session.profile === "ADMIN" ? "warn" : session.profile === "READ_ONLY" ? "ok" : "neutral"}>
                  {session.profile.replace("_", " ")}
                </Badge>
                <span className="mono text-[10px] text-white/30">{timeAgo(session.lastActivity)} ago</span>
              </div>
            </button>
          );
        })}
      </div>

      {creating ? (
        <div className="mt-4 space-y-3 rounded-xl border border-white/[0.08] p-3.5">
          <label className="block">
            <span className="label">Name</span>
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Build agent" />
          </label>
          <label className="block">
            <span className="label">Provider</span>
            <select className="field" value={provider} onChange={(e) => setProvider(e.target.value)}>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {p.configured ? "" : " (needs key)"}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">Permission profile</span>
            <select className="field" value={profile} onChange={(e) => setProfile(e.target.value)}>
              <option value="READ_ONLY">Read only</option>
              <option value="STANDARD">Standard</option>
              <option value="ADMIN">Admin</option>
              <option value="DANGEROUS">Dangerous (always confirm)</option>
            </select>
          </label>
          <div className="flex gap-2">
            <Button variant="quiet" block onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button variant="primary" block icon="check" onClick={create}>
              Create
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="ghost" block icon="plus" className="mt-4" onClick={() => setCreating(true)}>
          New session
        </Button>
      )}
    </Sheet>
  );
}
