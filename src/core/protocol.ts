/**
 * Structured WebSocket protocol.
 *
 * Every frame is a JSON envelope with a discriminating `type`. There is no
 * free-form string channel: the client and the Gentoo agent both switch
 * exhaustively over `ClientMessage` / `AgentMessage`, so adding a capability is
 * a compile error until both ends handle it.
 *
 * `PROTOCOL_VERSION` is negotiated in the handshake and lets the agent keep
 * older clients working via the {@link ExistingWebSocketAdapter}.
 */

import type {
  ApprovalDecision,
  ChatMessage,
  DeviceInfo,
  FileEntry,
  LogEntry,
  ProcessInfo,
  RiskLevel,
  ServiceInfo,
  SessionStatus,
  SystemSnapshot,
  Task,
  TaskStatus,
  ToolCategory,
  ToolCall,
} from "./types";

export const PROTOCOL_VERSION = 2 as const;

/* ------------------------------------------------------------------ client */

export type ClientMessage =
  | { type: "client.hello"; clientId: string; token: string; protocol: number; deviceId: string }
  | { type: "client.ping"; at: number }
  | { type: "metrics.subscribe"; intervalMs: number }
  | { type: "metrics.unsubscribe" }
  | { type: "agent.message"; sessionId: string; message: string }
  | { type: "agent.stop"; sessionId: string }
  | { type: "session.create"; name: string; provider: string; model: string; profile: string }
  | { type: "session.update"; sessionId: string; patch: Record<string, unknown> }
  | { type: "session.delete"; sessionId: string }
  | { type: "approval.decision"; approvalId: string; decision: ApprovalDecision }
  | { type: "task.cancel"; taskId: string }
  | { type: "terminal.open"; terminalId: string; shell: string; tmuxSession?: string }
  | { type: "terminal.input"; terminalId: string; data: string }
  | { type: "terminal.resize"; terminalId: string; cols: number; rows: number }
  | { type: "terminal.close"; terminalId: string }
  | { type: "fs.list"; requestId: string; path: string; showHidden: boolean }
  | { type: "fs.read"; requestId: string; path: string }
  | { type: "fs.write"; requestId: string; path: string; content: string }
  | { type: "fs.mkdir"; requestId: string; path: string }
  | { type: "fs.rename"; requestId: string; from: string; to: string }
  | { type: "fs.delete"; requestId: string; path: string }
  | { type: "proc.list"; requestId: string }
  | { type: "proc.kill"; requestId: string; pid: number; signal: string }
  | { type: "svc.list"; requestId: string }
  | { type: "svc.action"; requestId: string; name: string; action: "start" | "stop" | "restart" }
  | { type: "power.action"; requestId: string; action: "shutdown" | "reboot" | "suspend" | "lock" }
  | { type: "logs.subscribe"; minSeverity: string };

/* ------------------------------------------------------------------- agent */

export type AgentMessage =
  | {
      type: "server.hello";
      protocol: number;
      device: DeviceInfo;
      providers: { id: string; label: string; models: string[]; configured: boolean }[];
      serverTime: number;
    }
  | { type: "server.pong"; at: number; serverTime: number }
  | { type: "device.status"; device: DeviceInfo }
  | { type: "metrics.snapshot"; snapshot: SystemSnapshot }
  | { type: "session.updated"; session: Record<string, unknown> }
  | { type: "session.removed"; sessionId: string }
  | { type: "agent.status"; sessionId: string; status: SessionStatus }
  | { type: "agent.reasoning"; sessionId: string; delta: string }
  | { type: "agent.plan"; sessionId: string; steps: string[] }
  | { type: "agent.message.delta"; sessionId: string; messageId: string; content: string }
  | {
      type: "agent.message.completed";
      sessionId: string;
      message: ChatMessage;
    }
  | { type: "agent.error"; sessionId: string; message: string; technical: string }
  | { type: "agent.tool"; sessionId: string; toolCall: ToolCall }
  | {
      type: "tool.output";
      sessionId: string;
      toolCallId: string;
      stdout: string;
      stderr: string;
      exitCode: number;
      risk: RiskLevel;
      category: ToolCategory;
    }
  | { type: "approval.request"; approval: ApprovalPayload }
  | { type: "approval.resolved"; approvalId: string; decision: ApprovalDecision }
  | { type: "task.updated"; task: Task }
  | { type: "task.status"; taskId: string; status: TaskStatus }
  | { type: "terminal.output"; terminalId: string; data: string }
  | { type: "terminal.exit"; terminalId: string; exitCode: number }
  | { type: "fs.list.result"; requestId: string; path: string; entries: FileEntry[] }
  | { type: "fs.file.result"; requestId: string; path: string; content: string }
  | { type: "fs.ack"; requestId: string; ok: boolean; message: string }
  | { type: "proc.list.result"; requestId: string; processes: ProcessInfo[] }
  | { type: "svc.list.result"; requestId: string; services: ServiceInfo[] }
  | { type: "power.result"; requestId: string; action: string; message: string }
  | { type: "log.append"; entry: LogEntry };

export interface ApprovalPayload {
  id: string;
  sessionId: string;
  taskId?: string;
  command: string;
  cwd: string;
  user: string;
  risk: RiskLevel;
  reason: string;
  category: ToolCategory;
  createdAt: number;
  irreversible: boolean;
}

export function encode(message: ClientMessage | AgentMessage): string {
  return JSON.stringify(message);
}

export function decode<T extends AgentMessage>(raw: string): T {
  const parsed = JSON.parse(raw) as T;
  if (!parsed || typeof (parsed as { type?: unknown }).type !== "string") {
    throw new Error("Malformed protocol frame: missing discriminator");
  }
  return parsed;
}
