/**
 * Core domain model for the Gentoo Agent Control Center.
 *
 * These types are transport-agnostic: the same shapes are used by the
 * WebSocket client, the simulated local agent, and the UI store so a single
 * source of truth describes the whole system.
 */

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type PermissionProfile =
  | "READ_ONLY"
  | "STANDARD"
  | "ADMIN"
  | "DANGEROUS";

export type ToolCategory =
  | "read"
  | "filesystem_write"
  | "process"
  | "service"
  | "package"
  | "network"
  | "power"
  | "shell"
  | "admin";

export type PermissionVerdict = "allow" | "confirm" | "deny";

export type ConnectionState =
  | "CONNECTED"
  | "RECONNECTING"
  | "OFFLINE"
  | "AUTHENTICATING";

export type SessionStatus = "idle" | "thinking" | "running" | "waiting" | "error";

export type TaskStatus =
  | "QUEUED"
  | "RUNNING"
  | "WAITING_APPROVAL"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type ApprovalDecision = "deny" | "approve_once" | "approve_session";

export type LogSeverity = "debug" | "info" | "warn" | "error";

export interface DeviceInfo {
  id: string;
  name: string;
  hostname: string;
  os: string;
  kernel: string;
  gentooVersion: string;
  init: string;
  compositor: string;
  user: string;
  arch: string;
  tailscaleIp: string | null;
  lanIp: string | null;
  uptimeSeconds: number;
  online: boolean;
}

export interface ProviderConfig {
  id: string;
  label: string;
  kind: "openai" | "anthropic" | "local" | "demo";
  models: string[];
  /** Never a real key in the browser — only whether the server has one. */
  configured: boolean;
}

export interface SystemSnapshot {
  timestamp: number;
  cpu: {
    total: number;
    perCore: number[];
    frequencyMhz: number;
    load: [number, number, number];
  };
  memory: {
    totalMb: number;
    usedMb: number;
    availableMb: number;
    cachedMb: number;
    swapTotalMb: number;
    swapUsedMb: number;
  };
  disk: {
    mount: string;
    usedGb: number;
    totalGb: number;
    readKbs: number;
    writeKbs: number;
  }[];
  network: {
    iface: string;
    rxKbs: number;
    txKbs: number;
    ipv4: string;
  }[];
  temps: { label: string; celsius: number }[];
  processes: ProcessInfo[];
}

export interface ProcessInfo {
  pid: number;
  user: string;
  cpu: number;
  mem: number;
  command: string;
}

export interface ServiceInfo {
  name: string;
  description: string;
  state: "started" | "stopped" | "crashed";
  boot: "enabled" | "disabled";
}

export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink";
  size: number;
  owner: string;
  group: string;
  mode: string;
  modified: number;
  hidden: boolean;
}

export interface AgentSession {
  id: string;
  name: string;
  provider: string;
  model: string;
  systemPrompt: string;
  profile: PermissionProfile;
  createdAt: number;
  lastActivity: number;
  status: SessionStatus;
}

export interface ToolCall {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  risk: RiskLevel;
  category: ToolCategory;
  startedAt: number;
  finishedAt?: number;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  status: "pending" | "awaiting_approval" | "running" | "ok" | "failed" | "denied";
}

export type MessageRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  createdAt: number;
  streaming?: boolean;
  plan?: string[];
  toolCalls?: ToolCall[];
  usage?: { promptTokens: number; completionTokens: number };
  error?: { message: string; technical: string };
  reasoning?: string;
}

export interface Task {
  id: string;
  sessionId: string;
  title: string;
  action: string;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  result?: string;
}

export interface Approval {
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
  status: "pending" | "approved" | "denied" | "expired";
  scope?: "once" | "session";
}

export interface LogEntry {
  id: string;
  timestamp: number;
  severity: LogSeverity;
  source: "agent" | "command" | "websocket" | "system" | "audit";
  sessionId?: string;
  message: string;
}

export interface TimelineEvent {
  id: string;
  at: number;
  kind:
    | "user_message"
    | "reasoning"
    | "plan"
    | "tool"
    | "tool_result"
    | "approval_requested"
    | "approval_resolved"
    | "command"
    | "completed"
    | "error";
  label: string;
  detail?: string;
}

export interface Conversation {
  id: string;
  sessionId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}
