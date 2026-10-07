/**
 * Agent tool registry.
 *
 * The AI never touches the OS directly. It may only emit a tool call naming one
 * of these tools; the runtime resolves the tool, checks the session's
 * permission profile against the tool's category and the concrete command's
 * risk, and only then executes it.
 *
 * The Python agent on the Gentoo machine implements exactly the same registry,
 * so the schemas here are the contract between the two implementations.
 */

import type { RiskLevel, ToolCategory } from "../core/types";

export interface ToolParamSpec {
  name: string;
  type: "string" | "number" | "boolean";
  required: boolean;
  description: string;
}

export interface ToolMeta {
  name: string;
  description: string;
  category: ToolCategory;
  /** Risk when the tool is invoked with benign arguments. */
  baseRisk: RiskLevel;
  timeoutMs: number;
  params: ToolParamSpec[];
  /** When true the tool builds a shell command that the risk engine re-checks. */
  commandLike?: boolean;
}

export const TOOLS: ToolMeta[] = [
  {
    name: "system_info",
    description: "Hostname, kernel, Gentoo version, init system, compositor, uptime and logged-in user.",
    category: "read",
    baseRisk: "LOW",
    timeoutMs: 4_000,
    params: [],
  },
  {
    name: "get_cpu_info",
    description: "Per-core utilisation, load average and current clock frequency.",
    category: "read",
    baseRisk: "LOW",
    timeoutMs: 4_000,
    params: [],
  },
  {
    name: "get_memory_info",
    description: "RAM and swap totals, used, available and cached amounts.",
    category: "read",
    baseRisk: "LOW",
    timeoutMs: 4_000,
    params: [],
  },
  {
    name: "get_disk_info",
    description: "Mounted filesystems with capacity, free space and read/write throughput.",
    category: "read",
    baseRisk: "LOW",
    timeoutMs: 4_000,
    params: [],
  },
  {
    name: "get_network_info",
    description: "Interfaces, addresses, throughput and active connection count.",
    category: "read",
    baseRisk: "LOW",
    timeoutMs: 4_000,
    params: [],
  },
  {
    name: "get_processes",
    description: "Process table sorted by resource use.",
    category: "read",
    baseRisk: "LOW",
    timeoutMs: 5_000,
    params: [
      { name: "sort", type: "string", required: false, description: "'cpu' or 'mem'" },
      { name: "limit", type: "number", required: false, description: "Maximum rows" },
    ],
  },
  {
    name: "get_services",
    description: "OpenRC services with run state and boot status.",
    category: "read",
    baseRisk: "LOW",
    timeoutMs: 5_000,
    params: [],
  },
  {
    name: "get_logs",
    description: "Read recent system or service logs.",
    category: "read",
    baseRisk: "LOW",
    timeoutMs: 6_000,
    params: [
      { name: "unit", type: "string", required: false, description: "Service or log file to read" },
      { name: "lines", type: "number", required: false, description: "Number of lines" },
    ],
  },
  {
    name: "list_directory",
    description: "List the contents of a directory.",
    category: "read",
    baseRisk: "LOW",
    timeoutMs: 4_000,
    params: [{ name: "path", type: "string", required: true, description: "Absolute path" }],
  },
  {
    name: "read_file",
    description: "Read a text file from disk.",
    category: "read",
    baseRisk: "LOW",
    timeoutMs: 4_000,
    params: [{ name: "path", type: "string", required: true, description: "Absolute file path" }],
  },
  {
    name: "search_files",
    description: "Search file names and contents under a root path.",
    category: "read",
    baseRisk: "LOW",
    timeoutMs: 8_000,
    params: [
      { name: "query", type: "string", required: true, description: "Search text" },
      { name: "root", type: "string", required: false, description: "Root path" },
    ],
  },
  {
    name: "write_file",
    description: "Create or overwrite a text file. Requires write permission.",
    category: "filesystem_write",
    baseRisk: "MEDIUM",
    timeoutMs: 5_000,
    params: [
      { name: "path", type: "string", required: true, description: "Absolute file path" },
      { name: "content", type: "string", required: true, description: "New file contents" },
    ],
  },
  {
    name: "search_package",
    description: "Query the Portage tree for a package without installing it.",
    category: "read",
    baseRisk: "LOW",
    timeoutMs: 10_000,
    commandLike: true,
    params: [{ name: "query", type: "string", required: true, description: "Package name or keyword" }],
  },
  {
    name: "execute_command",
    description: "Run a single shell command and capture stdout, stderr and exit code.",
    category: "shell",
    baseRisk: "MEDIUM",
    timeoutMs: 30_000,
    commandLike: true,
    params: [
      { name: "command", type: "string", required: true, description: "Command line" },
      { name: "cwd", type: "string", required: false, description: "Working directory" },
    ],
  },
  {
    name: "install_package",
    description: "Install one or more packages from the Gentoo tree.",
    category: "package",
    baseRisk: "HIGH",
    timeoutMs: 600_000,
    commandLike: true,
    params: [{ name: "package", type: "string", required: true, description: "atom, e.g. app-editors/neovim" }],
  },
  {
    name: "restart_service",
    description: "Restart an OpenRC service.",
    category: "service",
    baseRisk: "HIGH",
    timeoutMs: 30_000,
    commandLike: true,
    params: [{ name: "service", type: "string", required: true, description: "OpenRC service name" }],
  },
  {
    name: "terminal",
    description: "Attach to or create an interactive tmux session.",
    category: "shell",
    baseRisk: "HIGH",
    timeoutMs: 15_000,
    commandLike: true,
    params: [{ name: "session", type: "string", required: false, description: "tmux session name" }],
  },
];

export const TOOL_INDEX: Record<string, ToolMeta> = Object.fromEntries(
  TOOLS.map((tool) => [tool.name, tool]),
);

/**
 * Build the concrete command line a tool would run. Keeping this in one place
 * means the risk engine always classifies the *actual* string that would hit
 * the shell, not a paraphrase of it.
 */
export function commandForTool(tool: string, args: Record<string, unknown>): string {
  const str = (key: string) => (typeof args[key] === "string" ? (args[key] as string) : "");
  switch (tool) {
    case "execute_command":
      return str("command");
    case "install_package":
      return `sudo emerge --ask ${str("package")}`;
    case "restart_service":
      return `sudo rc-service ${str("service")} restart`;
    case "search_package":
      return `equery list ${str("query")}`;
    case "write_file":
      return `tee ${str("path")} > /dev/null`;
    case "get_logs":
      return `journalctl -u ${str("unit") || "system"} -n ${String(args.lines ?? 100)}`;
    case "terminal":
      return `tmux attach -t ${str("session") || "gentoo"}`;
    default:
      return `${tool}(${JSON.stringify(args)})`;
  }
}
