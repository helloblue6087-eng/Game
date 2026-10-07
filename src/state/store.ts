/**
 * Application state.
 *
 * State is split into small independent stores (connection, chat, metrics,
 * logs, terminal, files, control) instead of one giant object. Each store is
 * immutable and notifies only its own subscribers, so a 10 Hz metrics sample
 * never re-renders the chat, and a terminal character never re-renders the
 * dashboard. The {@link Controller} is the single place that turns protocol
 * frames into store updates.
 */

import { useSyncExternalStore } from "react";
import type {
  AgentMessage,
  ApprovalPayload,
  ClientMessage,
} from "../core/protocol";
import type { ConnectionMeta, Transport } from "../core/transport";
import type {
  AgentSession,
  Approval,
  ChatMessage,
  ConnectionState,
  DeviceInfo,
  FileEntry,
  LogEntry,
  ProcessInfo,
  ProviderConfig,
  ServiceInfo,
  SystemSnapshot,
  Task,
  TimelineEvent,
  ToolCall,
} from "../core/types";

/* ------------------------------------------------------------------ store */

export interface Store<T> {
  get(): T;
  set(next: T): void;
  update(updater: (current: T) => T): void;
  subscribe(listener: () => void): () => void;
}

function createStore<T>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next) {
      if (next === state) return;
      state = next;
      for (const listener of listeners) listener();
    },
    update(updater) {
      const next = updater(state);
      if (next === state) return;
      state = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/* ------------------------------------------------------------ connection */

export interface ConnectionStateShape {
  status: ConnectionState;
  meta: ConnectionMeta;
  device: DeviceInfo | null;
  providers: ProviderConfig[];
  transportKind: "simulated" | "websocket";
}

export const connectionStore = createStore<ConnectionStateShape>({
  status: "OFFLINE",
  meta: { latencyMs: null, attempt: 0, nextRetryMs: null, route: "" },
  device: null,
  providers: [],
  transportKind: "simulated",
});

/* ------------------------------------------------------------------ chat */

export interface StreamingTurn {
  messageId: string;
  text: string;
  reasoning: string;
  plan: string[];
  toolCalls: ToolCall[];
  status: AgentSession["status"];
}

export interface ChatState {
  sessions: AgentSession[];
  activeSessionId: string | null;
  messages: Record<string, ChatMessage[]>;
  streaming: Record<string, StreamingTurn>;
  approvals: Approval[];
  tasks: Task[];
  timeline: Record<string, TimelineEvent[]>;
  unread: Record<string, number>;
}

export const chatStore = createStore<ChatState>({
  sessions: [],
  activeSessionId: null,
  messages: {},
  streaming: {},
  approvals: [],
  tasks: [],
  timeline: {},
  unread: {},
});

/* --------------------------------------------------------------- metrics */

export interface MetricsState {
  latest: SystemSnapshot | null;
  history: SystemSnapshot[];
  subscribed: boolean;
}

export const metricsStore = createStore<MetricsState>({
  latest: null,
  history: [],
  subscribed: false,
});

const METRIC_HISTORY = 90;

/* ------------------------------------------------------------------ logs */

export interface LogState {
  entries: LogEntry[];
}

export const logStore = createStore<LogState>({ entries: [] });

const LOG_LIMIT = 1500;

/* -------------------------------------------------------------- terminal */

export interface TerminalState {
  terminals: { id: string; name: string; buffer: string; exitCode: number | null }[];
  activeId: string | null;
  fullscreen: boolean;
}

export const terminalStore = createStore<TerminalState>({
  terminals: [],
  activeId: null,
  fullscreen: false,
});

const TERMINAL_BUFFER_LIMIT = 200_000;

/* ----------------------------------------------------------------- files */

export interface FilesState {
  cwd: string;
  entries: FileEntry[];
  hidden: boolean;
  loading: boolean;
  error: string | null;
  editor: { path: string; content: string; dirty: boolean } | null;
  pendingRequestId: string | null;
}

export const filesStore = createStore<FilesState>({
  cwd: "/home/blue",
  entries: [],
  hidden: false,
  loading: false,
  error: null,
  editor: null,
  pendingRequestId: null,
});

/* --------------------------------------------------------------- control */

export interface ControlState {
  services: ServiceInfo[];
  processes: ProcessInfo[];
  lastResult: { action: string; message: string; ok: boolean } | null;
  busy: boolean;
}

export const controlStore = createStore<ControlState>({
  services: [],
  processes: [],
  lastResult: null,
  busy: false,
});

/* -------------------------------------------------------------- controller */

export interface ControllerOptions {
  transport: Transport;
  kind: "simulated" | "websocket";
  /** Preferred start session. */
  initialSessionId?: string;
}

export class Controller {
  private transport: Transport;
  /** Request id -> predicate that consumes its matching result frame. */
  private requestHandlers = new Map<string, (message: AgentMessage) => boolean>();
  private requestSeq = 0;

  constructor(options: ControllerOptions) {
    this.transport = options.transport;
    connectionStore.update((s) => ({ ...s, transportKind: options.kind }));
    this.bind(options.transport);
  }

  private readonly handleState = (status: ConnectionState, meta: ConnectionMeta): void => {
    connectionStore.update((s) => ({ ...s, status, meta }));
    if (status === "OFFLINE" || status === "RECONNECTING") {
      metricsStore.update((s) => ({ ...s, subscribed: false }));
    }
  };

  private readonly handleMessage = (message: AgentMessage): void => {
    this.reduce(message);
  };

  private bind(transport: Transport): void {
    transport.onStateChange(this.handleState);
    transport.onMessage(this.handleMessage);
  }

  /** Swap the live transport (used when the user switches gateway settings). */
  replaceTransport(transport: Transport, kind: ControllerOptions["kind"]): void {
    try {
      this.transport.disconnect();
    } catch {
      /* already closed */
    }
    this.transport = transport;
    this.requestHandlers.clear();
    connectionStore.update((s) => ({ ...s, transportKind: kind, device: null }));
    this.bind(transport);
    transport.connect();
  }

  connect(): void {
    this.transport.connect();
  }

  disconnect(): void {
    this.transport.disconnect();
  }

  send(message: ClientMessage): void {
    this.transport.send(message);
  }

  /** Fire a request and resolve when the matching `*.result` frame arrives. */
  private request<T extends AgentMessage>(
    message: ClientMessage,
    requestId: string,
    matcher: (m: AgentMessage) => boolean,
    timeoutMs = 8000,
  ): Promise<T | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.requestHandlers.delete(requestId);
        resolve(null);
      }, timeoutMs);
      this.requestHandlers.set(requestId, (incoming) => {
        if (!matcher(incoming)) return false;
        clearTimeout(timer);
        this.requestHandlers.delete(requestId);
        resolve(incoming as T);
        return true;
      });
      this.send(message);
    });
  }

  private nextRequestId(): string {
    this.requestSeq += 1;
    return `req_${this.requestSeq}`;
  }

  /* ------------------------------------------------------------- commands */

  createSession(input: { name: string; provider: string; model: string; profile: string }): void {
    this.send({ type: "session.create", ...input });
  }

  updateSession(sessionId: string, patch: Partial<AgentSession>): void {
    chatStore.update((s) => ({
      ...s,
      sessions: s.sessions.map((session) =>
        session.id === sessionId ? { ...session, ...patch } : session,
      ),
    }));
    this.send({ type: "session.update", sessionId, patch: patch as Record<string, unknown> });
  }

  deleteSession(sessionId: string): void {
    this.send({ type: "session.delete", sessionId });
    chatStore.update((s) => {
      const messages = { ...s.messages };
      delete messages[sessionId];
      const sessions = s.sessions.filter((session) => session.id !== sessionId);
      return {
        ...s,
        sessions,
        messages,
        activeSessionId:
          s.activeSessionId === sessionId ? (sessions[0]?.id ?? null) : s.activeSessionId,
      };
    });
  }

  selectSession(sessionId: string): void {
    chatStore.update((s) => ({
      ...s,
      activeSessionId: sessionId,
      unread: { ...s.unread, [sessionId]: 0 },
    }));
  }

  sendMessage(sessionId: string, text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    const message: ChatMessage = {
      id: `user_${Date.now()}`,
      sessionId,
      role: "user",
      content: trimmed,
      createdAt: Date.now(),
    };
    chatStore.update((s) => ({
      ...s,
      messages: { ...s.messages, [sessionId]: [...(s.messages[sessionId] ?? []), message] },
      streaming: {
        ...s.streaming,
        [sessionId]: { messageId: "", text: "", reasoning: "", plan: [], toolCalls: [], status: "thinking" },
      },
      timeline: {
        ...s.timeline,
        [sessionId]: [
          ...(s.timeline[sessionId] ?? []),
          { id: `tl_${Date.now()}`, at: Date.now(), kind: "user_message", label: "You sent a message", detail: trimmed },
        ],
      },
    }));
    this.send({ type: "agent.message", sessionId, message: trimmed });
  }

  stopGeneration(sessionId: string): void {
    this.send({ type: "agent.stop", sessionId });
    chatStore.update((s) => {
      const streaming = { ...s.streaming };
      delete streaming[sessionId];
      return { ...s, streaming };
    });
  }

  decideApproval(approvalId: string, decision: "deny" | "approve_once" | "approve_session"): void {
    this.send({ type: "approval.decision", approvalId, decision });
    chatStore.update((s) => ({
      ...s,
      approvals: s.approvals.filter((approval) => approval.id !== approvalId),
    }));
  }

  cancelTask(taskId: string): void {
    this.send({ type: "task.cancel", taskId });
  }

  subscribeMetrics(intervalMs = 1000): void {
    metricsStore.update((s) => ({ ...s, subscribed: true }));
    this.send({ type: "metrics.subscribe", intervalMs });
  }

  unsubscribeMetrics(): void {
    metricsStore.update((s) => ({ ...s, subscribed: false }));
    this.send({ type: "metrics.unsubscribe" });
  }

  /* -------------------------------------------------------------- terminal */

  openTerminal(id: string, name: string, shell = "/bin/zsh", tmuxSession?: string): void {
    terminalStore.update((s) =>
      s.terminals.some((t) => t.id === id)
        ? { ...s, activeId: id }
        : {
            ...s,
            activeId: id,
            terminals: [...s.terminals, { id, name, buffer: "", exitCode: null }],
          },
    );
    this.send({ type: "terminal.open", terminalId: id, shell, tmuxSession });
  }

  closeTerminal(id: string): void {
    this.send({ type: "terminal.close", terminalId: id });
    terminalStore.update((s) => {
      const terminals = s.terminals.filter((t) => t.id !== id);
      return { ...s, terminals, activeId: terminals[0]?.id ?? null };
    });
  }

  terminalInput(id: string, data: string): void {
    this.send({ type: "terminal.input", terminalId: id, data });
  }

  terminalResize(id: string, cols: number, rows: number): void {
    this.send({ type: "terminal.resize", terminalId: id, cols, rows });
  }

  setActiveTerminal(id: string): void {
    terminalStore.update((s) => ({ ...s, activeId: id }));
  }

  toggleTerminalFullscreen(): void {
    terminalStore.update((s) => ({ ...s, fullscreen: !s.fullscreen }));
  }

  /* ----------------------------------------------------------------- files */

  async listFiles(path: string, showHidden = filesStore.get().hidden): Promise<void> {
    const requestId = this.nextRequestId();
    filesStore.update((s) => ({ ...s, loading: true, error: null, cwd: path, hidden: showHidden }));
    const result = await this.request<Extract<AgentMessage, { type: "fs.list.result" }>>(
      { type: "fs.list", requestId, path, showHidden },
      requestId,
      (m) => m.type === "fs.list.result" && m.requestId === requestId,
    );
    if (!result) {
      filesStore.update((s) => ({ ...s, loading: false, error: "The device did not respond (offline?)." }));
      return;
    }
    filesStore.update((s) => ({ ...s, loading: false, entries: result.entries }));
  }

  async openFile(path: string): Promise<void> {
    const requestId = this.nextRequestId();
    const result = await this.request<Extract<AgentMessage, { type: "fs.file.result" }>>(
      { type: "fs.read", requestId, path },
      requestId,
      (m) => m.type === "fs.file.result" && m.requestId === requestId,
    );
    if (!result) {
      filesStore.update((s) => ({ ...s, error: "Unable to read file." }));
      return;
    }
    filesStore.update((s) => ({ ...s, editor: { path: result.path, content: result.content, dirty: false } }));
  }

  editFileContent(content: string): void {
    filesStore.update((s) => (s.editor ? { ...s, editor: { ...s.editor, content, dirty: true } } : s));
  }

  async saveFile(): Promise<boolean> {
    const editor = filesStore.get().editor;
    if (!editor) return false;
    const requestId = this.nextRequestId();
    const result = await this.request<Extract<AgentMessage, { type: "fs.ack" }>>(
      { type: "fs.write", requestId, path: editor.path, content: editor.content },
      requestId,
      (m) => m.type === "fs.ack" && m.requestId === requestId,
    );
    if (!result || !result.ok) {
      filesStore.update((s) => ({ ...s, error: result?.message ?? "Write failed." }));
      return false;
    }
    filesStore.update((s) => ({ ...s, editor: s.editor ? { ...s.editor, dirty: false } : null }));
    await this.listFiles(filesStore.get().cwd);
    return true;
  }

  closeEditor(): void {
    filesStore.update((s) => ({ ...s, editor: null }));
  }

  async fileOperation(
    op: "mkdir" | "rename" | "delete",
    payload: { path?: string; from?: string; to?: string },
  ): Promise<string | null> {
    const requestId = this.nextRequestId();
    const message: ClientMessage =
      op === "mkdir"
        ? { type: "fs.mkdir", requestId, path: payload.path! }
        : op === "rename"
          ? { type: "fs.rename", requestId, from: payload.from!, to: payload.to! }
          : { type: "fs.delete", requestId, path: payload.path! };
    const result = await this.request<Extract<AgentMessage, { type: "fs.ack" }>>(
      message,
      requestId,
      (m) => m.type === "fs.ack" && m.requestId === requestId,
    );
    await this.listFiles(filesStore.get().cwd);
    if (!result) return "No response from device.";
    return result.ok ? null : result.message;
  }

  /* --------------------------------------------------------------- control */

  async refreshControl(): Promise<void> {
    controlStore.update((s) => ({ ...s, busy: true }));
    const svcId = this.nextRequestId();
    const procId = this.nextRequestId();
    const [services, processes] = await Promise.all([
      this.request<Extract<AgentMessage, { type: "svc.list.result" }>>(
        { type: "svc.list", requestId: svcId },
        svcId,
        (m) => m.type === "svc.list.result" && m.requestId === svcId,
      ),
      this.request<Extract<AgentMessage, { type: "proc.list.result" }>>(
        { type: "proc.list", requestId: procId },
        procId,
        (m) => m.type === "proc.list.result" && m.requestId === procId,
      ),
    ]);
    controlStore.update((s) => ({
      ...s,
      busy: false,
      services: services?.services ?? s.services,
      processes: processes?.processes ?? s.processes,
    }));
  }

  async serviceAction(name: string, action: "start" | "stop" | "restart"): Promise<void> {
    const requestId = this.nextRequestId();
    const result = await this.request<Extract<AgentMessage, { type: "svc.list.result" }>>(
      { type: "svc.action", requestId, name, action },
      requestId,
      (m) => m.type === "svc.list.result" && m.requestId === requestId,
    );
    if (result) controlStore.update((s) => ({ ...s, services: result.services }));
    controlStore.update((s) => ({
      ...s,
      lastResult: { action: `${action} ${name}`, message: "Service action dispatched.", ok: true },
    }));
  }

  async killProcess(pid: number, signal = "15"): Promise<void> {
    const requestId = this.nextRequestId();
    const result = await this.request<Extract<AgentMessage, { type: "proc.list.result" }>>(
      { type: "proc.kill", requestId, pid, signal },
      requestId,
      (m) => m.type === "proc.list.result" && m.requestId === requestId,
    );
    if (result) controlStore.update((s) => ({ ...s, processes: result.processes }));
  }

  async powerAction(action: "shutdown" | "reboot" | "suspend" | "lock"): Promise<string> {
    const requestId = this.nextRequestId();
    const result = await this.request<Extract<AgentMessage, { type: "power.result" }>>(
      { type: "power.action", requestId, action },
      requestId,
      (m) => m.type === "power.result" && m.requestId === requestId,
    );
    const text = result?.message ?? "No response from device — the machine may be offline.";
    controlStore.update((s) => ({ ...s, lastResult: { action, message: text, ok: Boolean(result) } }));
    return text;
  }

  /* --------------------------------------------------------------- reduce */

  private reduce(message: AgentMessage): void {
    for (const handler of [...this.requestHandlers.values()]) {
      if (handler(message)) return;
    }

    switch (message.type) {
      case "server.hello":
        connectionStore.update((s) => ({
          ...s,
          device: message.device,
          providers: message.providers.map((p) => ({
            id: p.id,
            label: p.label,
            kind: (p.id === "demo" ? "demo" : p.id === "local" ? "local" : (p.id as "openai" | "anthropic")),
            models: p.models,
            configured: p.configured || p.id === "demo",
          })),
        }));
        break;

      case "device.status":
        connectionStore.update((s) => ({ ...s, device: message.device }));
        break;

      case "metrics.snapshot":
        metricsStore.update((s) => ({
          ...s,
          latest: message.snapshot,
          history: [...s.history, message.snapshot].slice(-METRIC_HISTORY),
        }));
        break;

      case "log.append":
        logStore.update((s) => ({ ...s, entries: [...s.entries, message.entry].slice(-LOG_LIMIT) }));
        break;

      case "session.updated": {
        const session = message.session as unknown as AgentSession;
        chatStore.update((s) => {
          const exists = s.sessions.some((x) => x.id === session.id);
          const sessions = exists
            ? s.sessions.map((x) => (x.id === session.id ? session : x))
            : [...s.sessions, session];
          return {
            ...s,
            sessions,
            activeSessionId: s.activeSessionId ?? session.id,
            streaming: s.streaming[session.id]
              ? { ...s.streaming, [session.id]: { ...s.streaming[session.id], status: session.status } }
              : s.streaming,
          };
        });
        break;
      }

      case "session.removed":
        chatStore.update((s) => ({
          ...s,
          sessions: s.sessions.filter((x) => x.id !== message.sessionId),
          activeSessionId:
            s.activeSessionId === message.sessionId
              ? (s.sessions.find((x) => x.id !== message.sessionId)?.id ?? null)
              : s.activeSessionId,
        }));
        break;

      case "agent.status":
        chatStore.update((s) => ({
          ...s,
          sessions: s.sessions.map((x) => (x.id === message.sessionId ? { ...x, status: message.status } : x)),
          streaming: s.streaming[message.sessionId]
            ? { ...s.streaming, [message.sessionId]: { ...s.streaming[message.sessionId], status: message.status } }
            : s.streaming,
        }));
        break;

      case "agent.reasoning":
        chatStore.update((s) => {
          const turn = s.streaming[message.sessionId] ?? emptyTurn();
          return {
            ...s,
            streaming: {
              ...s.streaming,
              [message.sessionId]: { ...turn, reasoning: turn.reasoning + message.delta },
            },
          };
        });
        break;

      case "agent.plan":
        chatStore.update((s) => {
          const turn = s.streaming[message.sessionId] ?? emptyTurn();
          return {
            ...s,
            streaming: { ...s.streaming, [message.sessionId]: { ...turn, plan: message.steps } },
            timeline: {
              ...s.timeline,
              [message.sessionId]: [
                ...(s.timeline[message.sessionId] ?? []),
                { id: `tl_${Date.now()}`, at: Date.now(), kind: "plan", label: "Plan produced", detail: message.steps.join(" → ") },
              ],
            },
          };
        });
        break;

      case "agent.message.delta":
        chatStore.update((s) => {
          const turn = s.streaming[message.sessionId] ?? emptyTurn();
          return {
            ...s,
            streaming: {
              ...s.streaming,
              [message.sessionId]: {
                ...turn,
                messageId: message.messageId,
                text: turn.text + message.content,
              },
            },
          };
        });
        break;

      case "agent.message.completed":
        chatStore.update((s) => {
          const streaming = { ...s.streaming };
          delete streaming[message.sessionId];
          return {
            ...s,
            streaming,
            messages: {
              ...s.messages,
              [message.sessionId]: [...(s.messages[message.sessionId] ?? []), message.message],
            },
            sessions: s.sessions.map((x) =>
              x.id === message.sessionId ? { ...x, lastActivity: Date.now(), status: "idle" } : x,
            ),
            unread:
              s.activeSessionId === message.sessionId
                ? s.unread
                : { ...s.unread, [message.sessionId]: (s.unread[message.sessionId] ?? 0) + 1 },
            timeline: {
              ...s.timeline,
              [message.sessionId]: [
                ...(s.timeline[message.sessionId] ?? []),
                { id: `tl_${Date.now()}`, at: Date.now(), kind: "completed", label: "Agent completed the turn" },
              ],
            },
          };
        });
        break;

      case "agent.error":
        chatStore.update((s) => {
          const streaming = { ...s.streaming };
          delete streaming[message.sessionId];
          const errorMessage: ChatMessage = {
            id: `err_${Date.now()}`,
            sessionId: message.sessionId,
            role: "assistant",
            content: message.message,
            createdAt: Date.now(),
            error: { message: message.message, technical: message.technical },
          };
          return {
            ...s,
            streaming,
            messages: {
              ...s.messages,
              [message.sessionId]: [...(s.messages[message.sessionId] ?? []), errorMessage],
            },
            sessions: s.sessions.map((x) => (x.id === message.sessionId ? { ...x, status: "error" } : x)),
            timeline: {
              ...s.timeline,
              [message.sessionId]: [
                ...(s.timeline[message.sessionId] ?? []),
                { id: `tl_${Date.now()}`, at: Date.now(), kind: "error", label: message.message, detail: message.technical },
              ],
            },
          };
        });
        break;

      case "agent.tool":
        chatStore.update((s) => {
          const turn = s.streaming[message.sessionId] ?? emptyTurn();
          const existingIndex = turn.toolCalls.findIndex((c) => c.id === message.toolCall.id);
          const toolCalls =
            existingIndex >= 0
              ? turn.toolCalls.map((c, i) => (i === existingIndex ? message.toolCall : c))
              : [...turn.toolCalls, message.toolCall];
          return {
            ...s,
            streaming: { ...s.streaming, [message.sessionId]: { ...turn, toolCalls } },
          };
        });
        break;

      case "tool.output":
        chatStore.update((s) => {
          const turn = s.streaming[message.sessionId] ?? emptyTurn();
          const toolCalls = turn.toolCalls.map((call) =>
            call.id === message.toolCallId
              ? {
                  ...call,
                  stdout: message.stdout,
                  stderr: message.stderr,
                  exitCode: message.exitCode,
                  status: message.exitCode === 0 ? ("ok" as const) : ("failed" as const),
                  finishedAt: Date.now(),
                }
              : call,
          );
          return {
            ...s,
            streaming: { ...s.streaming, [message.sessionId]: { ...turn, toolCalls } },
            timeline: {
              ...s.timeline,
              [message.sessionId]: [
                ...(s.timeline[message.sessionId] ?? []),
                {
                  id: `tl_${Date.now()}`,
                  at: Date.now(),
                  kind: "tool_result" as const,
                  label: `exit ${message.exitCode}`,
                  detail: (message.stdout || message.stderr).slice(0, 240),
                },
              ],
            },
          };
        });
        break;

      case "approval.request":
        chatStore.update((s) => ({
          ...s,
          approvals: [...s.approvals.filter((a) => a.id !== message.approval.id), approvalFromPayload(message.approval)],
          timeline: {
            ...s.timeline,
            [message.approval.sessionId]: [
              ...(s.timeline[message.approval.sessionId] ?? []),
              {
                id: `tl_${Date.now()}`,
                at: Date.now(),
                kind: "approval_requested" as const,
                label: "Approval requested",
                detail: message.approval.command,
              },
            ],
          },
        }));
        break;

      case "approval.resolved":
        chatStore.update((s) => ({
          ...s,
          approvals: s.approvals.filter((a) => a.id !== message.approvalId),
        }));
        break;

      case "task.updated":
        chatStore.update((s) => {
          const exists = s.tasks.some((t) => t.id === message.task.id);
          return {
            ...s,
            tasks: exists
              ? s.tasks.map((t) => (t.id === message.task.id ? message.task : t))
              : [message.task, ...s.tasks],
          };
        });
        break;

      case "terminal.output":
        terminalStore.update((s) => ({
          ...s,
          terminals: s.terminals.map((t) =>
            t.id === message.terminalId
              ? { ...t, buffer: (t.buffer + message.data).slice(-TERMINAL_BUFFER_LIMIT) }
              : t,
          ),
        }));
        break;

      case "terminal.exit":
        terminalStore.update((s) => ({
          ...s,
          terminals: s.terminals.map((t) =>
            t.id === message.terminalId ? { ...t, exitCode: message.exitCode } : t,
          ),
        }));
        break;

      default:
        break;
    }
  }
}

function emptyTurn(): StreamingTurn {
  return { messageId: "", text: "", reasoning: "", plan: [], toolCalls: [], status: "idle" };
}

function approvalFromPayload(payload: ApprovalPayload): Approval {
  return {
    id: payload.id,
    sessionId: payload.sessionId,
    taskId: payload.taskId,
    command: payload.command,
    cwd: payload.cwd,
    user: payload.user,
    risk: payload.risk,
    reason: payload.reason,
    category: payload.category,
    createdAt: payload.createdAt,
    status: "pending",
  };
}
