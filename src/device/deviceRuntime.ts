/**
 * Device runtime — the agent side of the protocol.
 *
 * This is the reference implementation of everything the Python agent on the
 * Gentoo machine does: it owns the agent loop, enforces the permission layer,
 * executes tools, streams metrics and drives the PTY-backed terminal. Running
 * it in-process lets the console be exercised end to end with no server; the
 * same message flow is what a real `wss://` connection carries.
 */

import { ApprovalGrantStore, evaluatePermission } from "../core/permissions";
import { classifyCommand } from "../core/risk";
import { uid } from "../core/format";
import type {
  AgentMessage,
  ApprovalPayload,
  ClientMessage,
} from "../core/protocol";
import { PROTOCOL_VERSION } from "../core/protocol";
import type {
  AgentSession,
  Approval,
  ChatMessage,
  DeviceInfo,
  LogEntry,
  LogSeverity,
  Task,
  ToolCall,
} from "../core/types";
import type { AgentMessageHistory, AgentEvent, AIProvider, EnvironmentSummary } from "../agent/providers";
import { createProvider, PROVIDER_CATALOG } from "../agent/providers";
import { commandForTool, TOOL_INDEX, TOOLS } from "../agent/tools";
import { SimulatedSystem } from "./simulatedSystem";
import { VirtualFileSystem } from "./virtualFs";

interface PendingApproval {
  approval: Approval;
  toolCall: ToolCall;
  state: RunState;
}

interface RunState {
  sessionId: string;
  messageId: string;
  history: AgentMessageHistory[];
  plan: string[];
  toolCalls: ToolCall[];
  assistantText: string;
  usage?: { promptTokens: number; completionTokens: number };
  controller: AbortController;
}

const SYSTEM_PROMPT = [
  "You are the Gentoo Agent, an autonomous Linux assistant operating a Gentoo machine running OpenRC and Wayland.",
  "You may only act through the provided tools. Never invent tool output.",
  "Prefer read-only inspection first. Explain your plan before acting.",
  "Destructive or package/service operations require explicit user approval.",
].join(" ");

const MAX_TOOL_ROUNDS = 6;

export class DeviceRuntime {
  private sessions = new Map<string, AgentSession>();
  private approvals = new Map<string, PendingApproval>();
  private grants = new ApprovalGrantStore();
  private tasks = new Map<string, Task>();
  private buffers = new Map<string, { cwd: string; pending: string; name: string }>();
  private metricsTimer: ReturnType<typeof setInterval> | null = null;
  private running = new Set<string>();
  private system = new SimulatedSystem();
  private ticker: ReturnType<typeof setInterval> | null = null;
  private logs: LogEntry[] = [];

  constructor(
    private readonly device: DeviceInfo,
    private readonly emit: (message: AgentMessage) => void,
    private readonly fs: VirtualFileSystem,
  ) {
    this.ticker = setInterval(() => this.system.tick(), 1000);
    this.seedSessions();
  }

  dispose(): void {
    if (this.ticker) clearInterval(this.ticker);
    if (this.metricsTimer) clearInterval(this.metricsTimer);
    this.ticker = null;
    this.metricsTimer = null;
  }

  private seedSessions(): void {
    const seeds: AgentSession[] = [
      {
        id: "sess_gentoo_admin",
        name: "Gentoo Admin",
        provider: "demo",
        model: "gentoo-planner-v1",
        systemPrompt: SYSTEM_PROMPT,
        profile: "ADMIN",
        createdAt: Date.now() - 86_400_000,
        lastActivity: Date.now() - 120_000,
        status: "idle",
      },
      {
        id: "sess_coding",
        name: "Coding Agent",
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        systemPrompt: SYSTEM_PROMPT,
        profile: "STANDARD",
        createdAt: Date.now() - 43_200_000,
        lastActivity: Date.now() - 900_000,
        status: "idle",
      },
      {
        id: "sess_debug",
        name: "Debugging Agent",
        provider: "openai",
        model: "gpt-4o",
        systemPrompt: SYSTEM_PROMPT,
        profile: "STANDARD",
        createdAt: Date.now() - 7_200_000,
        lastActivity: Date.now() - 3_600_000,
        status: "idle",
      },
      {
        id: "sess_monitor",
        name: "Monitoring Agent",
        provider: "demo",
        model: "gentoo-planner-v1",
        systemPrompt: SYSTEM_PROMPT,
        profile: "READ_ONLY",
        createdAt: Date.now() - 3_600_000,
        lastActivity: Date.now() - 600_000,
        status: "idle",
      },
    ];
    for (const session of seeds) this.sessions.set(session.id, session);
  }

  /* -------------------------------------------------------------- lifecycle */

  private log(entry: Omit<LogEntry, "id" | "timestamp">): void {
    const record: LogEntry = { id: uid("log"), timestamp: Date.now(), ...entry };
    this.logs.push(record);
    if (this.logs.length > 2000) this.logs.shift();
    this.emit({ type: "log.append", entry: record });
  }

  private timeline(label: string, severity: LogSeverity, source: LogEntry["source"], sessionId?: string): void {
    this.log({ severity, source, sessionId, message: label });
  }

  private session(sessionId: string): AgentSession {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    const created: AgentSession = {
      id: sessionId,
      name: "Agent Session",
      provider: "demo",
      model: "gentoo-planner-v1",
      systemPrompt: SYSTEM_PROMPT,
      profile: "STANDARD",
      createdAt: Date.now(),
      lastActivity: Date.now(),
      status: "idle",
    };
    this.sessions.set(sessionId, created);
    return created;
  }

  private environment(): EnvironmentSummary {
    const snapshot = this.system.snapshot();
    return {
      hostname: this.device.hostname,
      kernel: this.device.kernel,
      user: this.device.user,
      compositor: this.device.compositor,
      memoryUsedMb: snapshot.memory.usedMb,
      memoryTotalMb: snapshot.memory.totalMb,
      cpuTotal: snapshot.cpu.total,
      topMemory: this.system
        .processes("mem")
        .slice(0, 3)
        .map((p) => `${p.command.split(" ")[0]} ${p.mem.toFixed(0)}MB`)
        .join(", "),
      services: this.system
        .services()
        .map((s) => `${s.name}:${s.state}`)
        .join(" "),
    };
  }

  /* ---------------------------------------------------------- message entry */

  handle(message: ClientMessage): void {
    switch (message.type) {
      case "client.hello": {
        this.emit({
          type: "server.hello",
          protocol: PROTOCOL_VERSION,
          device: { ...this.device, uptimeSeconds: this.device.uptimeSeconds + 120 },
          providers: PROVIDER_CATALOG.map((p) => ({
            id: p.id,
            label: p.label,
            models: [...p.models],
            configured: p.configured,
          })),
          serverTime: Date.now(),
        });
        for (const session of this.sessions.values()) {
          this.emit({ type: "session.updated", session: session as unknown as Record<string, unknown> });
        }
        this.timeline("Client authenticated over WebSocket", "info", "websocket");
        break;
      }
      case "client.ping":
        this.emit({ type: "server.pong", at: message.at, serverTime: Date.now() });
        break;
      case "metrics.subscribe": {
        this.stopMetrics();
        const interval = Math.max(500, Math.min(message.intervalMs, 10_000));
        this.metricsTimer = setInterval(() => {
          this.emit({ type: "metrics.snapshot", snapshot: this.system.snapshot() });
        }, interval);
        this.emit({ type: "metrics.snapshot", snapshot: this.system.snapshot() });
        break;
      }
      case "metrics.unsubscribe":
        this.stopMetrics();
        break;
      case "agent.message":
        void this.runAgent(message.sessionId, message.message);
        break;
      case "agent.stop":
        this.stopSession(message.sessionId);
        break;
      case "session.create": {
        const session: AgentSession = {
          id: uid("sess"),
          name: message.name,
          provider: message.provider,
          model: message.model,
          systemPrompt: SYSTEM_PROMPT,
          profile: (message.profile as AgentSession["profile"]) ?? "STANDARD",
          createdAt: Date.now(),
          lastActivity: Date.now(),
          status: "idle",
        };
        this.sessions.set(session.id, session);
        this.emit({ type: "session.updated", session: session as unknown as Record<string, unknown> });
        this.timeline(`Session "${session.name}" created`, "info", "agent", session.id);
        break;
      }
      case "session.update": {
        const session = this.sessions.get(message.sessionId);
        if (!session) break;
        Object.assign(session, message.patch);
        this.emit({ type: "session.updated", session: session as unknown as Record<string, unknown> });
        break;
      }
      case "session.delete":
        this.sessions.delete(message.sessionId);
        this.emit({ type: "session.removed", sessionId: message.sessionId });
        this.timeline("Session deleted", "info", "agent", message.sessionId);
        break;
      case "approval.decision":
        this.resolveApproval(message.approvalId, message.decision);
        break;
      case "task.cancel": {
        const task = this.tasks.get(message.taskId);
        if (!task) break;
        task.status = "CANCELLED";
        task.updatedAt = Date.now();
        this.emit({ type: "task.updated", task });
        break;
      }
      case "terminal.open": {
        this.buffers.set(message.terminalId, {
          cwd: "/home/blue",
          pending: "",
          name: message.tmuxSession ?? "gentoo",
        });
        this.emit({
          type: "terminal.output",
          terminalId: message.terminalId,
          data: this.banner(message.shell, message.tmuxSession ?? "gentoo"),
        });
        this.emit({
          type: "terminal.output",
          terminalId: message.terminalId,
          data: `\u001b[38;5;141mblue@gentoo\u001b[0m:\u001b[38;5;111m~/projects\u001b[0m$ `,
        });
        break;
      }
      case "terminal.input":
        this.terminalInput(message.terminalId, message.data);
        break;
      case "terminal.resize":
        break;
      case "terminal.close":
        this.buffers.delete(message.terminalId);
        this.emit({ type: "terminal.exit", terminalId: message.terminalId, exitCode: 0 });
        break;
      case "fs.list": {
        try {
          const entries = this.fs.list(message.path, message.showHidden);
          this.emit({ type: "fs.list.result", requestId: message.requestId, path: message.path, entries });
        } catch (error) {
          this.emit({
            type: "fs.ack",
            requestId: message.requestId,
            ok: false,
            message: (error as Error).message,
          });
        }
        break;
      }
      case "fs.read": {
        try {
          const content = this.fs.read(message.path);
          this.emit({ type: "fs.file.result", requestId: message.requestId, path: message.path, content });
        } catch (error) {
          this.emit({ type: "fs.ack", requestId: message.requestId, ok: false, message: (error as Error).message });
        }
        break;
      }
      case "fs.write": {
        try {
          this.fs.write(message.path, message.content);
          this.emit({ type: "fs.ack", requestId: message.requestId, ok: true, message: `Wrote ${message.path}` });
          this.timeline(`File written: ${message.path}`, "warn", "command");
        } catch (error) {
          this.emit({ type: "fs.ack", requestId: message.requestId, ok: false, message: (error as Error).message });
        }
        break;
      }
      case "fs.mkdir":
      case "fs.rename":
      case "fs.delete": {
        try {
          if (message.type === "fs.mkdir") this.fs.mkdir(message.path);
          if (message.type === "fs.rename") this.fs.rename(message.from, message.to);
          if (message.type === "fs.delete") this.fs.delete(message.path);
          this.emit({ type: "fs.ack", requestId: message.requestId, ok: true, message: "ok" });
          this.timeline(`Filesystem change applied (${message.type})`, "warn", "command");
        } catch (error) {
          this.emit({ type: "fs.ack", requestId: message.requestId, ok: false, message: (error as Error).message });
        }
        break;
      }
      case "proc.list":
        this.emit({ type: "proc.list.result", requestId: message.requestId, processes: this.system.processes("cpu") });
        break;
      case "proc.kill": {
        const process = this.system.processes("cpu").find((p) => p.pid === message.pid);
        this.timeline(`SIG${message.signal} → PID ${message.pid}`, "warn", "command");
        this.emit({
          type: "proc.list.result",
          requestId: message.requestId,
          processes: this.system.processes("cpu").filter((p) => p.pid !== message.pid),
        });
        void process;
        break;
      }
      case "svc.list":
        this.emit({ type: "svc.list.result", requestId: message.requestId, services: this.system.services() });
        break;
      case "svc.action": {
        const result = this.system.restartService(message.name);
        this.timeline(`Service ${message.name} ${message.action}`, "warn", "command");
        this.emit({ type: "svc.list.result", requestId: message.requestId, services: this.system.services() });
        this.emit({
          type: "power.result",
          requestId: message.requestId,
          action: `${message.action} ${message.name}`,
          message: result.output,
        });
        break;
      }
      case "power.action": {
        const messages: Record<string, string> = {
          shutdown: "System going down NOW.\nBroadcasting message to all users...",
          reboot: "Restarting system.\nSyncing filesystems ... done.",
          suspend: "Suspending to RAM. Resume over Tailscale when ready.",
          lock: "Session locked. elogind: lock applied to seat0.",
        };
        this.timeline(`Power action requested: ${message.action}`, "error", "command");
        this.emit({
          type: "power.result",
          requestId: message.requestId,
          action: message.action,
          message: messages[message.action] ?? "ok",
        });
        break;
      }
      case "logs.subscribe":
        for (const entry of this.logs.slice(-200)) this.emit({ type: "log.append", entry });
        break;
      default:
        break;
    }
  }

  private stopMetrics(): void {
    if (this.metricsTimer) clearInterval(this.metricsTimer);
    this.metricsTimer = null;
  }

  /* -------------------------------------------------------------- agent loop */

  private stopSession(sessionId: string): void {
    const state = this.activeRuns.get(sessionId);
    if (state) {
      state.controller.abort();
      this.activeRuns.delete(sessionId);
      this.running.delete(sessionId);
      this.setStatus(sessionId, "idle");
      this.timeline("Generation stopped by user", "warn", "agent", sessionId);
    }
  }

  private activeRuns = new Map<string, RunState>();

  private setStatus(sessionId: string, status: AgentSession["status"]): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = status;
      session.lastActivity = Date.now();
    }
    this.emit({ type: "agent.status", sessionId, status });
  }

  private providerFor(session: AgentSession): AIProvider {
    const providerId = PROVIDER_CATALOG.some((p) => p.id === session.provider) ? session.provider : "demo";
    return createProvider(providerId, { model: session.model });
  }

  private async runAgent(sessionId: string, userMessage: string): Promise<void> {
    if (this.running.has(sessionId)) {
      this.timeline("Rejected concurrent run for session", "warn", "agent", sessionId);
      return;
    }
    // Ensures the session exists and is registered before the turn starts.
    this.session(sessionId);
    const state: RunState = {
      sessionId,
      messageId: uid("msg"),
      history: [
        { role: "user", content: userMessage },
      ],
      plan: [],
      toolCalls: [],
      assistantText: "",
      controller: new AbortController(),
    };
    this.running.add(sessionId);
    this.activeRuns.set(sessionId, state);
    this.setStatus(sessionId, "thinking");
    this.timeline("User message received", "info", "agent", sessionId);

    const task: Task = {
      id: uid("task"),
      sessionId,
      title: userMessage.slice(0, 72),
      action: "agent.turn",
      status: "RUNNING",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.tasks.set(task.id, task);
    this.emit({ type: "task.updated", task });

    try {
      await this.runLoop(state);
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      this.fail(state, "The agent runtime hit an unexpected error.", (error as Error).message);
    } finally {
      this.running.delete(sessionId);
      this.activeRuns.delete(sessionId);
    }
  }

  private async runLoop(state: RunState): Promise<void> {
    const session = this.session(state.sessionId);
    const provider = this.providerFor(session);
    let paused = false;

    for (let round = 0; round < MAX_TOOL_ROUNDS && !paused; round += 1) {
      const calls: { id: string; tool: string; args: Record<string, unknown> }[] = [];
      const stream = provider.run(
        {
          system: session.systemPrompt || SYSTEM_PROMPT,
          history: [{ role: "system", content: session.systemPrompt || SYSTEM_PROMPT }, ...state.history],
          tools: TOOLS,
          environment: this.environment(),
        },
        state.controller.signal,
      );

      for await (const event of this.consume(stream, state)) {
        if (event.kind === "tool_call") calls.push(event.call);
      }

      if (calls.length === 0) break;

      for (const call of calls) {
        const outcome = await this.handleToolCall(state, call);
        if (outcome === "pause") {
          paused = true;
          return;
        }
      }
    }

    this.finish(state);
  }

  /** Bridges provider events onto protocol frames. */
  private async *consume(
    stream: AsyncGenerator<AgentEvent>,
    state: RunState,
  ): AsyncGenerator<AgentEvent> {
    try {
      for await (const event of stream) {
        switch (event.kind) {
          case "reasoning":
            this.emit({ type: "agent.reasoning", sessionId: state.sessionId, delta: event.delta });
            break;
          case "plan":
            state.plan = event.steps;
            this.emit({ type: "agent.plan", sessionId: state.sessionId, steps: event.steps });
            this.timeline("Plan produced", "info", "agent", state.sessionId);
            break;
          case "text":
            state.assistantText += event.delta;
            this.emit({
              type: "agent.message.delta",
              sessionId: state.sessionId,
              messageId: state.messageId,
              content: event.delta,
            });
            break;
          case "usage":
            state.usage = { promptTokens: event.promptTokens, completionTokens: event.completionTokens };
            break;
          case "error":
            this.fail(state, event.message, event.technical);
            break;
          default:
            break;
        }
        yield event;
      }
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      this.fail(state, "The AI provider stream was interrupted.", (error as Error).message);
    }
  }

  private async handleToolCall(
    state: RunState,
    call: { id: string; tool: string; args: Record<string, unknown> },
  ): Promise<"continue" | "pause"> {
    const session = this.session(state.sessionId);
    const meta = TOOL_INDEX[call.tool];
    if (!meta) {
      state.history.push({ role: "tool", name: call.tool, content: `Unknown tool: ${call.tool}` });
      this.timeline(`Unknown tool requested: ${call.tool}`, "error", "agent", state.sessionId);
      return "continue";
    }

    const command = commandForTool(call.tool, call.args);
    const classification = classifyCommand(command);
    const toolCall: ToolCall = {
      id: call.id,
      tool: call.tool,
      args: call.args,
      risk: classification.level,
      category: meta.category,
      startedAt: Date.now(),
      status: "pending",
    };
    state.toolCalls.push(toolCall);
    this.emit({ type: "agent.tool", sessionId: state.sessionId, toolCall });
    this.timeline(`Tool call: ${call.tool}`, "info", "agent", state.sessionId);

    const decision = evaluatePermission(session.profile, meta.category, command);
    const hasGrant = this.grants.has(state.sessionId, meta.category);

    if (decision.verdict === "deny") {
      toolCall.status = "denied";
      toolCall.finishedAt = Date.now();
      this.emit({ type: "agent.tool", sessionId: state.sessionId, toolCall });
      this.emit({
        type: "tool.output",
        sessionId: state.sessionId,
        toolCallId: toolCall.id,
        stdout: "",
        stderr: `Denied by permission profile ${session.profile}: ${decision.reason}`,
        exitCode: 126,
        risk: classification.level,
        category: meta.category,
      });
      state.history.push({
        role: "tool",
        name: call.tool,
        content: `DENIED by policy: ${decision.reason}`,
      });
      this.timeline(`Tool denied by policy: ${call.tool}`, "warn", "audit", state.sessionId);
      return "continue";
    }

    if (decision.verdict === "confirm" && !hasGrant) {
      const approval: Approval = {
        id: uid("appr"),
        sessionId: state.sessionId,
        command,
        cwd: "/home/blue",
        user: this.device.user,
        risk: classification.level,
        reason: decision.reason,
        category: meta.category,
        createdAt: Date.now(),
        status: "pending",
      };
      toolCall.status = "awaiting_approval";
      this.emit({ type: "agent.tool", sessionId: state.sessionId, toolCall });

      const payload: ApprovalPayload = {
        id: approval.id,
        sessionId: approval.sessionId,
        command: approval.command,
        cwd: approval.cwd,
        user: approval.user,
        risk: approval.risk,
        reason: approval.reason,
        category: approval.category,
        createdAt: approval.createdAt,
        irreversible: classification.irreversible,
      };
      this.approvals.set(approval.id, { approval, toolCall, state });
      this.emit({ type: "approval.request", approval: payload });
      this.setStatus(state.sessionId, "waiting");
      this.timeline(`Approval requested: ${approval.command}`, "warn", "audit", state.sessionId);
      return "pause";
    }

    await this.executeTool(state, toolCall, command, classification.level, meta.category);
    return "continue";
  }

  private async executeTool(
    state: RunState,
    toolCall: ToolCall,
    command: string,
    risk: ToolCall["risk"],
    category: ToolCall["category"],
  ): Promise<void> {
    toolCall.status = "running";
    this.emit({ type: "agent.tool", sessionId: state.sessionId, toolCall });
    this.timeline(`Executing: ${command}`, "info", "command", state.sessionId);

    const result = await this.runTool(toolCall.tool, toolCall.args);
    toolCall.status = result.exitCode === 0 ? "ok" : "failed";
    toolCall.finishedAt = Date.now();
    toolCall.stdout = result.stdout;
    toolCall.stderr = result.stderr;
    toolCall.exitCode = result.exitCode;

    this.emit({ type: "agent.tool", sessionId: state.sessionId, toolCall });
    this.emit({
      type: "tool.output",
      sessionId: state.sessionId,
      toolCallId: toolCall.id,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      risk,
      category,
    });
    this.log({
      severity: result.exitCode === 0 ? "info" : "error",
      source: "command",
      sessionId: state.sessionId,
      message: `$ ${command} → exit ${result.exitCode}`,
    });
    state.history.push({ role: "tool", name: toolCall.tool, content: result.stdout || result.stderr });
  }

  private async runTool(
    tool: string,
    args: Record<string, unknown>,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const str = (key: string) => (typeof args[key] === "string" ? (args[key] as string) : "");
    const num = (key: string, fallback: number) => (typeof args[key] === "number" ? args[key] : fallback);
    await new Promise((resolve) => setTimeout(resolve, 120));

    try {
      switch (tool) {
        case "system_info":
          return {
            stdout: [
              `Hostname:     ${this.device.hostname}`,
              `OS:           ${this.device.os}`,
              `Kernel:       ${this.device.kernel}`,
              `Gentoo:       ${this.device.gentooVersion}`,
              `Init:         ${this.device.init}`,
              `Compositor:   ${this.device.compositor}`,
              `User:         ${this.device.user}`,
              `Arch:         ${this.device.arch}`,
              `Tailscale:    ${this.device.tailscaleIp ?? "not connected"}`,
            ].join("\n"),
            stderr: "",
            exitCode: 0,
          };
        case "get_cpu_info": {
          const snap = this.system.snapshot();
          return {
            stdout: [
              ...snap.cpu.perCore.map((c, i) => `cpu${i}: ${c.toFixed(1)}%`),
              `total: ${snap.cpu.total}%`,
              `frequency: ${snap.cpu.frequencyMhz} MHz`,
              `load: ${snap.cpu.load.join(" ")}`,
            ].join("\n"),
            stderr: "",
            exitCode: 0,
          };
        }
        case "get_memory_info": {
          const m = this.system.snapshot().memory;
          return {
            stdout: [
              `MemTotal:     ${m.totalMb} MB`,
              `MemUsed:      ${m.usedMb} MB`,
              `MemAvailable: ${m.availableMb} MB`,
              `Cached:       ${m.cachedMb} MB`,
              `SwapTotal:    ${m.swapTotalMb} MB`,
              `SwapUsed:     ${m.swapUsedMb} MB`,
            ].join("\n"),
            stderr: "",
            exitCode: 0,
          };
        }
        case "get_disk_info":
          return {
            stdout: this.system
              .snapshot()
              .disk.map(
                (d) =>
                  `${d.mount.padEnd(8)} ${d.usedGb.toFixed(1)}G / ${d.totalGb.toFixed(1)}G  r:${d.readKbs}kB/s w:${d.writeKbs}kB/s`,
              )
              .join("\n"),
            stderr: "",
            exitCode: 0,
          };
        case "get_network_info":
          return {
            stdout: this.system
              .snapshot()
              .network.map((n) => `${n.iface.padEnd(12)} ${n.ipv4.padEnd(16)} rx:${n.rxKbs}kB/s tx:${n.txKbs}kB/s`)
              .join("\n"),
            stderr: "",
            exitCode: 0,
          };
        case "get_processes": {
          const sort = str("sort") === "mem" ? "mem" : "cpu";
          const limit = num("limit", 10);
          return {
            stdout: this.system
              .processes(sort)
              .slice(0, limit)
              .map((p) => `${String(p.pid).padStart(6)} ${p.user.padEnd(6)} ${p.cpu.toFixed(1).padStart(5)}% ${p.mem.toFixed(0).padStart(6)}M  ${p.command}`)
              .join("\n"),
            stderr: "",
            exitCode: 0,
          };
        }
        case "get_services":
          return {
            stdout: this.system
              .services()
              .map((s) => `${s.name.padEnd(16)} ${s.state.padEnd(8)} [${s.boot}]  ${s.description}`)
              .join("\n"),
            stderr: "",
            exitCode: 0,
          };
        case "get_logs":
          return { stdout: this.system.logs(str("unit"), num("lines", 40)), stderr: "", exitCode: 0 };
        case "list_directory":
          return {
            stdout: this.fs
              .list(str("path") || "/home/blue", true)
              .map((e) => `${e.mode} ${e.owner.padEnd(5)} ${String(e.size).padStart(8)} ${e.name}`)
              .join("\n"),
            stderr: "",
            exitCode: 0,
          };
        case "read_file":
          return { stdout: this.fs.read(str("path")), stderr: "", exitCode: 0 };
        case "search_files": {
          const hits = this.fs.search(str("query"), str("root") || "/");
          return {
            stdout: hits.length ? hits.map((h) => h.path).join("\n") : "no matches",
            stderr: "",
            exitCode: 0,
          };
        }
        case "write_file":
          this.fs.write(str("path"), str("content"));
          return { stdout: `Wrote ${str("path")}`, stderr: "", exitCode: 0 };
        case "search_package":
          return { stdout: this.system.searchPackage(str("query")), stderr: "", exitCode: 0 };
        case "install_package":
          return { stdout: this.system.installPackage(str("package")), stderr: "", exitCode: 0 };
        case "restart_service": {
          const result = this.system.restartService(str("service"));
          return { stdout: result.output, stderr: result.ok ? "" : result.output, exitCode: result.ok ? 0 : 1 };
        }
        case "terminal":
          return { stdout: `attached to tmux session ${str("session") || "gentoo"}`, stderr: "", exitCode: 0 };
        case "execute_command": {
          const command = str("command");
          const classification = classifyCommand(command);
          if (classification.level === "CRITICAL") {
            return { stdout: "", stderr: "Refused: command classified CRITICAL", exitCode: 1 };
          }
          return { stdout: this.interpret(command, "/home/blue").output, stderr: "", exitCode: 0 };
        }
        default:
          return { stdout: "", stderr: `Tool ${tool} has no handler`, exitCode: 127 };
      }
    } catch (error) {
      return { stdout: "", stderr: (error as Error).message, exitCode: 1 };
    }
  }

  private fail(state: RunState, message: string, technical: string): void {
    this.emit({ type: "agent.error", sessionId: state.sessionId, message, technical });
    this.log({ severity: "error", source: "agent", sessionId: state.sessionId, message: technical });
    this.setStatus(state.sessionId, "error");
  }

  private finish(state: RunState): void {
    const message: ChatMessage = {
      id: state.messageId,
      sessionId: state.sessionId,
      role: "assistant",
      content: state.assistantText,
      createdAt: Date.now(),
      plan: state.plan.length ? state.plan : undefined,
      toolCalls: state.toolCalls.length ? state.toolCalls : undefined,
      usage: state.usage,
    };
    this.emit({ type: "agent.message.completed", sessionId: state.sessionId, message });
    this.setStatus(state.sessionId, "idle");
    this.timeline("Turn completed", "info", "agent", state.sessionId);

    for (const [id, task] of this.tasks) {
      if (task.sessionId === state.sessionId && task.status === "RUNNING") {
        task.status = "COMPLETED";
        task.updatedAt = Date.now();
        task.result = state.assistantText.slice(0, 400);
        this.emit({ type: "task.updated", task });
        void id;
      }
    }
  }

  /* --------------------------------------------------------------- approvals */

  private resolveApproval(approvalId: string, decision: "deny" | "approve_once" | "approve_session"): void {
    const pending = this.approvals.get(approvalId);
    if (!pending) return;
    this.approvals.delete(approvalId);

    const { approval, toolCall, state } = pending;
    approval.status = decision === "deny" ? "denied" : "approved";
    approval.scope = decision === "approve_session" ? "session" : decision === "deny" ? undefined : "once";
    this.emit({ type: "approval.resolved", approvalId, decision });
    this.timeline(
      decision === "deny" ? `Denied: ${approval.command}` : `Approved: ${approval.command}`,
      decision === "deny" ? "warn" : "info",
      "audit",
      approval.sessionId,
    );

    if (decision === "deny") {
      toolCall.status = "denied";
      toolCall.finishedAt = Date.now();
      this.emit({ type: "agent.tool", sessionId: state.sessionId, toolCall });
      this.emit({
        type: "tool.output",
        sessionId: state.sessionId,
        toolCallId: toolCall.id,
        stdout: "",
        stderr: "Denied by user.",
        exitCode: 126,
        risk: toolCall.risk,
        category: toolCall.category,
      });
      state.history.push({ role: "tool", name: toolCall.tool, content: "DENIED by user — do not retry." });
      void this.resume(state);
      return;
    }

    if (decision === "approve_session") {
      this.grants.grant(state.sessionId, toolCall.category);
    }

    void (async () => {
      await this.executeTool(state, toolCall, approval.command, toolCall.risk, toolCall.category);
      await this.resume(state);
    })();
  }

  private async resume(state: RunState): Promise<void> {
    this.setStatus(state.sessionId, "thinking");
    this.running.add(state.sessionId);
    try {
      await this.runLoop(state);
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        this.fail(state, "Resuming the agent loop failed.", (error as Error).message);
      }
    } finally {
      this.running.delete(state.sessionId);
      this.activeRuns.delete(state.sessionId);
    }
  }

  /* ---------------------------------------------------------------- terminal */

  private banner(shell: string, tmux: string): string {
    return [
      `\u001b[38;5;141mgentoo-agent\u001b[0m  attaching to tmux session \u001b[1m${tmux}\u001b[0m`,
      `shell: ${shell}   host: ${this.device.hostname}   ${this.device.os}`,
      "",
    ].join("\r\n");
  }

  private terminalInput(terminalId: string, data: string): void {
    const buffer = this.buffers.get(terminalId);
    if (!buffer) return;

    const emitOut = (text: string) =>
      this.emit({ type: "terminal.output", terminalId, data: text.replace(/\n/g, "\r\n") });

    for (const char of data) {
      if (char === "\r" || char === "\n") {
        emitOut("\r\n");
        const command = buffer.pending.trim();
        buffer.pending = "";
        if (command) {
          const result = this.interpret(command, buffer.cwd);
          if (result.cwd) buffer.cwd = result.cwd;
          if (result.clear) {
            this.emit({ type: "terminal.output", terminalId, data: "\u001b[2J\u001b[H" });
          }
          if (result.output) emitOut(`${result.output}\n`);
        }
        emitOut(this.prompt(buffer.cwd));
      } else if (char === "\u007f") {
        if (buffer.pending.length > 0) {
          buffer.pending = buffer.pending.slice(0, -1);
          this.emit({ type: "terminal.output", terminalId, data: "\b \b" });
        }
      } else if (char === "\u0003") {
        buffer.pending = "";
        emitOut("^C\n" + this.prompt(buffer.cwd));
      } else if (char >= " ") {
        buffer.pending += char;
        this.emit({ type: "terminal.output", terminalId, data: char });
      }
    }
  }

  private prompt(cwd: string): string {
    const display = cwd.replace("/home/blue", "~");
    return `\u001b[38;5;141mblue@gentoo\u001b[0m:\u001b[38;5;111m${display}\u001b[0m$ `;
  }

  /** Minimal shell used by both the terminal tab and the execute_command tool. */
  private interpret(command: string, cwd: string): { output: string; cwd?: string; clear?: boolean } {
    const [bin, ...rest] = command.split(/\s+/);
    const args = rest.filter(Boolean);

    switch (bin) {
      case "clear":
        return { output: "", clear: true };
      case "pwd":
        return { output: cwd };
      case "whoami":
        return { output: "blue" };
      case "hostname":
        return { output: this.device.hostname };
      case "help":
        return {
          output: [
            "Available in this simulated shell: ls, cd, pwd, cat, echo, whoami, hostname, uname,",
            "uptime, free, df, ps, sensors, neofetch, rc-service, rc-status, equery, emerge,",
            "tmux, tailscale, clear, help.",
          ].join("\n"),
        };
      case "echo":
        return { output: args.join(" ") };
      case "cd": {
        const target = args[0] ?? "/home/blue";
        const next = target.startsWith("/")
          ? target
          : target === ".."
            ? cwd.slice(0, cwd.lastIndexOf("/")) || "/"
            : `${cwd.replace(/\/$/, "")}/${target}`;
        return { output: "", cwd: next };
      }
      case "ls": {
        const showHidden = args.includes("-a") || args.includes("-la") || args.includes("-al");
        const path = args.find((a) => !a.startsWith("-")) ?? cwd;
        const entries = this.fs.list(path, showHidden);
        if (!entries.length) return { output: "" };
        return {
          output: entries
            .map((e) =>
              e.type === "dir"
                ? `\u001b[38;5;111m${e.name}/\u001b[0m`
                : e.hidden
                  ? `\u001b[38;5;245m${e.name}\u001b[0m`
                  : e.name,
            )
            .join("  "),
        };
      }
      case "cat": {
        if (!args[0]) return { output: "cat: missing operand" };
        try {
          return { output: this.fs.read(args[0]) };
        } catch (error) {
          return { output: `cat: ${(error as Error).message}` };
        }
      }
      case "uname":
        return { output: args.includes("-a") ? `Linux ${this.device.hostname} ${this.device.kernel} #1 SMP PREEMPT_DYNAMIC x86_64 GNU/Linux` : "Linux" };
      case "uptime": {
        const s = this.system.snapshot();
        return { output: ` ${new Date().toTimeString().slice(0, 8)} up 3 days,  4:12,  1 user,  load average: ${s.cpu.load.join(", ")}` };
      }
      case "free": {
        const m = this.system.snapshot().memory;
        return {
          output: [
            "               total        used        free      shared  buff/cache   available",
            `Mem:      ${(m.totalMb / 1024).toFixed(1)}Gi     ${(m.usedMb / 1024).toFixed(1)}Gi     ${(m.availableMb / 1024).toFixed(1)}Gi       0.4Gi      ${(m.cachedMb / 1024).toFixed(1)}Gi      ${(m.availableMb / 1024).toFixed(1)}Gi`,
            `Swap:      ${(m.swapTotalMb / 1024).toFixed(1)}Gi     ${(m.swapUsedMb / 1024).toFixed(1)}Gi`,
          ].join("\n"),
        };
      }
      case "df":
        return {
          output: [
            "Filesystem      Size  Used Avail Use% Mounted on",
            ...this.system
              .snapshot()
              .disk.map(
                (d) =>
                  `${d.mount.padEnd(14)} ${d.totalGb.toFixed(0)}G  ${d.usedGb.toFixed(0)}G  ${(d.totalGb - d.usedGb).toFixed(0)}G  ${((d.usedGb / d.totalGb) * 100).toFixed(0)}% ${d.mount}`,
              ),
          ].join("\n"),
        };
      case "ps":
        return {
          output: [
            "  PID USER     %CPU    MEM COMMAND",
            ...this.system
              .processes("cpu")
              .slice(0, 12)
              .map((p) => `${String(p.pid).padStart(6)} ${p.user.padEnd(8)} ${p.cpu.toFixed(1).padStart(4)} ${p.mem.toFixed(0).padStart(6)}M ${p.command}`),
          ].join("\n"),
        };
      case "sensors":
        return { output: this.system.snapshot().temps.map((t) => `${t.label.padEnd(8)} +${t.celsius}°C`).join("\n") };
      case "neofetch": {
        const s = this.system.snapshot();
        return {
          output: [
            "\u001b[38;5;141m       .---.        \u001b[0m blue@" + this.device.hostname,
            "\u001b[38;5;141m      /     \\       \u001b[0m OS: " + this.device.os,
            "\u001b[38;5;141m     | () () |      \u001b[0m Kernel: " + this.device.kernel,
            "\u001b[38;5;141m      \\  ^  /       \u001b[0m Init: " + this.device.init,
            "\u001b[38;5;141m       |||||        \u001b[0m Shell: zsh 5.9",
            `                       CPU: Ryzen 9 7950X (${s.cpu.total}%)`,
            `                       Memory: ${(s.memory.usedMb / 1024).toFixed(1)}Gi / ${(s.memory.totalMb / 1024).toFixed(1)}Gi`,
            `                       Temp: ${s.temps[0]?.celsius}°C`,
          ].join("\n"),
        };
      }
      case "rc-status":
        return {
          output: this.system
            .services()
            .map((s) => ` ${s.name.padEnd(16)} [ ${s.state === "started" ? "\u001b[38;5;114mstarted\u001b[0m" : "\u001b[38;5;203mcrashed\u001b[0m"} ]`)
            .join("\n"),
        };
      case "rc-service": {
        const [name, action] = args;
        if (!name) return { output: "rc-service: usage: rc-service <service> <action>" };
        if (action === "status") {
          const svc = this.system.services().find((s) => s.name === name);
          return { output: svc ? ` * status: ${svc.state}` : ` * rc-service: service \`${name}' does not exist` };
        }
        const result = this.system.restartService(name);
        return { output: result.output };
      }
      case "equery":
        return { output: this.system.searchPackage(args.join(" ")) };
      case "emerge":
        return { output: this.system.installPackage(args.filter((a) => !a.startsWith("-")).join(" ") || "app-editors/neovim") };
      case "tmux":
        return { output: "gentoo: 2 windows (created Wed Oct 7 09:12:44 2026) (attached)\nwork: 1 windows (created Wed Oct 7 08:02:10 2026)" };
      case "tailscale":
        return { output: `100.101.42.7   ${this.device.hostname}   blue@   linux   -` };
      case "sudo":
        return { output: "This simulated shell is already privileged; rerun without sudo." };
      default:
        return { output: `zsh: command not found: ${bin}` };
    }
  }

  /* -------------------------------------------------------------- read-only */

  currentApprovals(): Approval[] {
    return [...this.approvals.values()].map((p) => p.approval);
  }
}
