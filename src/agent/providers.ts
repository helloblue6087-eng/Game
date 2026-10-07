/**
 * AI provider abstraction.
 *
 * The agent loop only depends on {@link AIProvider}. Three implementations ship
 * here:
 *
 *  - {@link DemoProvider}   fully local, deterministic tool-calling planner.
 *                           Used by the built-in simulated device so the
 *                           console is useful with no API key and no network.
 *  - {@link OpenAIProvider} OpenAI chat-completions with streaming + tool calls.
 *  - {@link AnthropicProvider} Anthropic messages API with streaming + tool use.
 *
 * The two hosted providers never see an API key in the browser: they call a
 * small server-side proxy ({@link ProviderOptions.proxyBaseUrl}) that injects
 * the key and forwards the request. Keys stay in the agent's environment.
 */

import type { ToolMeta } from "./tools";

export interface AgentMessageHistory {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  toolCallId?: string;
}

export interface ToolInvocation {
  id: string;
  tool: string;
  args: Record<string, unknown>;
}

export type AgentEvent =
  | { kind: "reasoning"; delta: string }
  | { kind: "plan"; steps: string[] }
  | { kind: "text"; delta: string }
  | { kind: "tool_call"; call: ToolInvocation }
  | { kind: "usage"; promptTokens: number; completionTokens: number }
  | { kind: "error"; message: string; technical: string };

export interface EnvironmentSummary {
  hostname: string;
  kernel: string;
  user: string;
  compositor: string;
  memoryUsedMb: number;
  memoryTotalMb: number;
  cpuTotal: number;
  topMemory: string;
  services: string;
}

export interface ProviderRunInput {
  system: string;
  history: AgentMessageHistory[];
  tools: ToolMeta[];
  environment: EnvironmentSummary;
}

export interface AIProvider {
  id: string;
  label: string;
  models: string[];
  /** True when the provider can run without external credentials. */
  local: boolean;
  run(input: ProviderRunInput, signal: AbortSignal): AsyncGenerator<AgentEvent>;
}

export interface ProviderOptions {
  /** Base URL of the server-side proxy that holds the real API key. */
  proxyBaseUrl?: string;
  model?: string;
}

/* ------------------------------------------------------------------- demo */

const INTENTS: { name: string; words: string[]; tools: string[] }[] = [
  { name: "memory", words: ["ram", "memory", "mem"], tools: ["get_memory_info", "get_processes"] },
  { name: "cpu", words: ["cpu", "load", "core", "frequency"], tools: ["get_cpu_info"] },
  { name: "disk", words: ["disk", "storage", "space", "filesystem", "ssd", "nvme"], tools: ["get_disk_info"] },
  { name: "network", words: ["network", "wifi", "ethernet", "connection", "ip"], tools: ["get_network_info"] },
  { name: "service", words: ["service", "pipewire", "restart", "openrc", "daemon"], tools: ["get_services", "restart_service"] },
  { name: "package", words: ["install", "emerge", "package", "portage", "ebuild"], tools: ["search_package", "install_package"] },
  { name: "logs", words: ["log", "error", "journal", "dmesg", "warning"], tools: ["get_logs"] },
  { name: "file", words: ["file", "read", "config", "cat", "directory"], tools: ["read_file"] },
  { name: "process", words: ["process", "kill", "pid", "hanging", "slow"], tools: ["get_processes"] },
];

function detectIntent(message: string): { name: string; tools: string[] } {
  const lower = message.toLowerCase();
  let best = { name: "general", tools: ["system_info"] as string[] };
  let score = 0;
  for (const intent of INTENTS) {
    const hits = intent.words.filter((word) => lower.includes(word)).length;
    if (hits > score) {
      score = hits;
      best = { name: intent.name, tools: intent.tools };
    }
  }
  return best;
}

function extractPath(message: string): string | null {
  const match = message.match(/(\/[A-Za-z0-9._\-/]+)/);
  return match ? match[1] : null;
}

/**
 * Deterministic planner. It reasons about the request, emits a plan, calls the
 * read-only tools it needs, and only then answers — the same shape a hosted
 * model produces, which makes it a faithful harness for the whole pipeline.
 */
export class DemoProvider implements AIProvider {
  readonly id = "demo";
  readonly label = "Local planner (no key)";
  readonly models = ["gentoo-planner-v1"];
  readonly local = true;

  async *run(input: ProviderRunInput, signal: AbortSignal): AsyncGenerator<AgentEvent> {
    const lastUser = [...input.history].reverse().find((m) => m.role === "user");
    const message = lastUser?.content ?? "";
    const intent = detectIntent(message);
    const calledTools = new Set(
      input.history.filter((m) => m.role === "tool" && m.name).map((m) => m.name as string),
    );

    const pending = intent.tools.filter((tool) => !calledTools.has(tool));

    if (pending.length > 0) {
      const next = pending[0];

      if (calledTools.size === 0) {
        yield { kind: "reasoning", delta: `Thinking about: “${message.trim()}”\n` };
        await pause(signal, 180);
        const steps = buildPlan(intent.name, intent.tools, message);
        yield { kind: "plan", steps };
        for (const step of steps) {
          await pause(signal, 120);
          yield { kind: "reasoning", delta: `→ ${step}\n` };
        }
      }

      const args = buildArgs(next, message, input);
      yield { kind: "tool_call", call: { id: makeId(), tool: next, args } };
      return;
    }

    yield* this.answer(input, intent.name, message, signal);
  }

  private async *answer(
    input: ProviderRunInput,
    intent: string,
    message: string,
    signal: AbortSignal,
  ): AsyncGenerator<AgentEvent> {
    const env = input.environment;
    const text = composeAnswer(intent, message, input);
    const words = text.split(/(\s+)/);
    for (const word of words) {
      if (signal.aborted) return;
      yield { kind: "text", delta: word };
      await pause(signal, 12);
    }
    yield {
      kind: "usage",
      promptTokens: Math.round((message.length + JSON.stringify(input.history).length) / 4),
      completionTokens: Math.round(text.length / 4),
    };
    void env;
  }
}

function buildPlan(intent: string, tools: string[], message: string): string[] {
  const steps: string[] = ["Interpret the request and identify the affected subsystem"];
  if (intent === "service") {
    steps.push("List OpenRC services and locate the failing unit");
    steps.push("Read the last log lines for that unit");
    if (/restart|fix|repair/i.test(message)) {
      steps.push("Request approval, then restart the service");
      steps.push("Verify the service reports started and re-check logs");
    }
  } else if (intent === "package") {
    steps.push("Search the Portage tree for a matching package");
    steps.push("Ask permission before installing (emerge)");
    steps.push("Install and verify the binary is on PATH");
  } else if (intent === "memory") {
    steps.push("Read /proc/meminfo totals and available memory");
    steps.push("Rank processes by resident memory");
    steps.push("Explain what is consuming RAM and whether it is normal");
  } else {
    for (const tool of tools) {
      steps.push(`Query ${tool.replace(/_/g, " ")} for the current state`);
    }
    steps.push("Summarise findings and recommend next actions");
  }
  steps.push("Report the result back to the user");
  return steps;
}

function buildArgs(tool: string, message: string, input: ProviderRunInput): Record<string, unknown> {
  const path = extractPath(message);
  switch (tool) {
    case "get_processes":
      return { sort: /mem|ram/i.test(message) ? "mem" : "cpu", limit: 8 };
    case "get_logs":
      return { unit: /pipewire/i.test(message) ? "pipewire" : "system", lines: 60 };
    case "read_file":
      return { path: path ?? "/etc/portage/make.conf" };
    case "restart_service":
      return { service: /pipewire/i.test(message) ? "pipewire" : "networkmanager" };
    case "search_package":
      return { query: /screenshot/i.test(message) ? "screenshot" : "neovim" };
    case "install_package":
      return { package: /screenshot/i.test(message) ? "x11-misc/grim" : "app-editors/neovim" };
    case "get_disk_info":
      return {};
    default:
      void input;
      return {};
  }
}

function composeAnswer(intent: string, message: string, input: ProviderRunInput): string {
  const results: string[] = [];
  for (const entry of input.history) {
    if (entry.role === "tool" && entry.name) {
      results.push(`### ${entry.name}\n\`\`\`\n${entry.content.trim().slice(0, 1200)}\n\`\`\``);
    }
  }
  const evidence = results.length ? results.join("\n\n") : "_No tool output was required._";
  const header = `Here is what I found for **${message.trim() || "your request"}**.`;

  const verdicts: Record<string, string> = {
    memory:
      "Memory pressure looks **normal**. The kernel is using the free pages for page cache, which is reclaimed on demand — the number that matters is *available*, not *used*.",
    service:
      "I inspected the service state and its recent log lines. If a restart was applied, confirm the unit now reports `started`.",
    package:
      "The package resolves in the Portage tree. Any install step waited for your explicit approval before running `emerge`.",
    disk: "Disk utilisation is summarised below. Watch the filesystem closest to capacity for growth.",
    cpu: "CPU utilisation and load average are shown below. Sustained load above the core count means real contention.",
    network: "Interface throughput and addresses are listed below.",
    process: "The process table below is ranked by resource use; the top entry is the usual suspect.",
    logs: "Recent log lines are below. Lines marked `error` are the ones to act on.",
    file: "File contents are below.",
    general: "System summary is below.",
  };

  return [
    header,
    "",
    verdicts[intent] ?? verdicts.general,
    "",
    "**Evidence**",
    "",
    evidence,
  ].join("\n");
}

function makeId(): string {
  return `call_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Abortable pause. Every provider step is cancellable so "stop generation"
 * unwinds immediately instead of waiting for the next token.
 */
function pause(signal: AbortSignal, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/* ------------------------------------------------- hosted providers (proxy) */

/** Shared SSE line reader for the hosted providers. */
async function* sseLines(response: Response): AsyncGenerator<string> {
  if (!response.body) throw new Error("Provider returned an empty stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    for (const line of parts) yield line;
  }
  if (buffer) yield buffer;
}

function toOpenAITools(tools: ToolMeta[]) {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: "object",
        properties: Object.fromEntries(
          tool.params.map((p) => [p.name, { type: p.type, description: p.description }]),
        ),
        required: tool.params.filter((p) => p.required).map((p) => p.name),
      },
    },
  }));
}

/**
 * OpenAI chat completions via the server-side proxy. The proxy is expected to
 * forward to `https://api.openai.com/v1/chat/completions` with the real key
 * attached, so the browser never sees it.
 */
export class OpenAIProvider implements AIProvider {
  readonly id = "openai";
  readonly label = "OpenAI / GPT";
  readonly models = ["gpt-4o", "gpt-4o-mini", "o4-mini"];
  readonly local = false;

  constructor(private readonly options: ProviderOptions = {}) {}

  async *run(input: ProviderRunInput, signal: AbortSignal): AsyncGenerator<AgentEvent> {
    if (!this.options.proxyBaseUrl) {
      yield {
        kind: "error",
        message: "The OpenAI provider is not connected yet.",
        technical:
          "No proxy base URL configured. Set VITE_AGENT_PROXY_URL (or the agent's proxy_url) so requests go through the server that holds the API key.",
      };
      return;
    }

    const response = await fetch(`${this.options.proxyBaseUrl}/v1/chat/completions`, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.options.model ?? this.models[0],
        stream: true,
        messages: [
          { role: "system", content: input.system },
          ...input.history.map((m) =>
            m.role === "tool"
              ? { role: "tool", tool_call_id: m.toolCallId, content: m.content }
              : { role: m.role, content: m.content },
          ),
        ],
        tools: toOpenAITools(input.tools),
      }),
    });

    if (!response.ok) {
      yield {
        kind: "error",
        message: "The AI provider rejected the request.",
        technical: `HTTP ${response.status} from provider proxy`,
      };
      return;
    }

    const calls = new Map<number, ToolInvocation>();
    for await (const line of sseLines(response)) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      const chunk = JSON.parse(payload) as {
        choices?: {
          delta?: {
            content?: string;
            tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[];
          };
        }[];
      };
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.content) yield { kind: "text", delta: delta.content };
      for (const call of delta?.tool_calls ?? []) {
        const existing = calls.get(call.index) ?? { id: call.id ?? makeId(), tool: "", args: {} };
        if (call.id) existing.id = call.id;
        if (call.function?.name) existing.tool = call.function.name;
        if (call.function?.arguments) {
          existing.args = { ...existing.args, ...safeParse(call.function.arguments) };
        }
        calls.set(call.index, existing);
      }
    }
    for (const call of calls.values()) {
      if (call.tool) yield { kind: "tool_call", call };
    }
  }
}

/** Anthropic messages API via the same server-side proxy pattern. */
export class AnthropicProvider implements AIProvider {
  readonly id = "anthropic";
  readonly label = "Anthropic / Claude";
  readonly models = ["claude-sonnet-4-5", "claude-opus-4-1", "claude-haiku-4-5"];
  readonly local = false;

  constructor(private readonly options: ProviderOptions = {}) {}

  async *run(input: ProviderRunInput, signal: AbortSignal): AsyncGenerator<AgentEvent> {
    if (!this.options.proxyBaseUrl) {
      yield {
        kind: "error",
        message: "The Anthropic provider is not connected yet.",
        technical:
          "No proxy base URL configured. Set VITE_AGENT_PROXY_URL (or the agent's proxy_url) so requests go through the server that holds the API key.",
      };
      return;
    }

    const response = await fetch(`${this.options.proxyBaseUrl}/v1/messages`, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.options.model ?? this.models[0],
        max_tokens: 2048,
        stream: true,
        system: input.system,
        messages: input.history
          .filter((m) => m.role !== "system")
          .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })),
        tools: input.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: {
            type: "object",
            properties: Object.fromEntries(
              tool.params.map((p) => [p.name, { type: p.type, description: p.description }]),
            ),
            required: tool.params.filter((p) => p.required).map((p) => p.name),
          },
        })),
      }),
    });

    if (!response.ok) {
      yield {
        kind: "error",
        message: "The AI provider rejected the request.",
        technical: `HTTP ${response.status} from provider proxy`,
      };
      return;
    }

    const partial = new Map<number, ToolInvocation>();
    for await (const line of sseLines(response)) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      const event = JSON.parse(payload) as {
        type?: string;
        delta?: { type?: string; text?: string; partial_json?: string; id?: string; name?: string };
        index?: number;
      };
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) {
        yield { kind: "text", delta: event.delta.text };
      }
      if (event.type === "content_block_start" && event.delta?.name) {
        partial.set(event.index ?? 0, { id: event.delta.id ?? makeId(), tool: event.delta.name, args: {} });
      }
      if (event.type === "content_block_delta" && event.delta?.partial_json) {
        const current = partial.get(event.index ?? 0);
        if (current) current.args = { ...current.args, ...safeParse(event.delta.partial_json) };
      }
    }
    for (const call of partial.values()) {
      if (call.tool) yield { kind: "tool_call", call };
    }
  }
}

function safeParse(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function createProvider(
  id: string,
  options: ProviderOptions = {},
): AIProvider {
  switch (id) {
    case "openai":
      return new OpenAIProvider(options);
    case "anthropic":
      return new AnthropicProvider(options);
    default:
      return new DemoProvider();
  }
}

export const PROVIDER_CATALOG = [
  { id: "demo", label: "Local planner (no key)", models: ["gentoo-planner-v1"], configured: true, local: true },
  { id: "openai", label: "OpenAI / GPT", models: ["gpt-4o", "gpt-4o-mini", "o4-mini"], configured: false, local: false },
  {
    id: "anthropic",
    label: "Anthropic / Claude",
    models: ["claude-sonnet-4-5", "claude-opus-4-1", "claude-haiku-4-5"],
    configured: false,
    local: false,
  },
] as const;
