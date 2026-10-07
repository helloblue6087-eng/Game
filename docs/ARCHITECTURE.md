# Architecture

## Layers

```
src/
  core/        protocol, transport, risk, permissions, domain types, formatting
  agent/       AI provider abstraction + tool registry
  device/      simulated Gentoo device: runtime, system model, virtual FS, transport
  state/       stores, controller, bootstrap
  components/  shell, UI primitives, markdown renderer, icons
  pages/       one module per route
  integration/ end-to-end protocol tests
```

Data only ever flows one way around the loop:

```
page  →  controller method  →  transport.send(ClientMessage)
                                      │
                              (network / simulation)
                                      │
      store update  ←  controller.reduce(AgentMessage)  ←  transport.onMessage
```

Pages never talk to a transport directly and never hold server state in local
component state.

## State stores

Seven small immutable stores, each with its own subscriber set. A store notifies
only its own listeners, so:

- a 10 Hz metrics sample re-renders the dashboard and monitor, not the chat;
- a keystroke echoed by the PTY re-renders the terminal, not the dashboard;
- a log line re-renders the logs view only.

| Store | Holds |
| --- | --- |
| `connectionStore` | status, latency, backoff attempt, device info, provider inventory |
| `chatStore` | sessions, messages, the in-flight streaming turn, approvals, tasks, per-session timeline |
| `metricsStore` | latest snapshot + a bounded 90-sample history |
| `logStore` | ring buffer of the most recent 1500 log entries |
| `terminalStore` | terminal tabs and their output buffers (200 KB cap per terminal) |
| `filesStore` | current directory, entries, hidden flag, editor buffer |
| `controlStore` | services, processes, last action result |

Every store is read through `useStore(store)` (`useSyncExternalStore`), so
components subscribe to exactly the slices they render.

## The controller

`Controller` (in `src/state/store.ts`) is the only place that understands the
protocol. It:

- registers `onMessage` / `onStateChange` on the active transport;
- reduces each `AgentMessage` into the appropriate store;
- exposes intent methods (`sendMessage`, `decideApproval`, `listFiles`,
  `serviceAction`, `powerAction`, …);
- implements request/response for CRUD-style calls: it generates a request id,
  stores a predicate, and resolves when the matching `*.result` frame arrives
  (with a timeout, so a dead link fails fast instead of hanging the UI);
- supports `replaceTransport()` so Settings can swap the live transport without
  discarding conversation state.

## Transports

`Transport` is a five-method interface (`connect`, `disconnect`, `send`,
`onMessage`, `onStateChange`). Two implementations ship:

- **`WebSocketTransport`** — heartbeat ping/pong with a stale-connection
  deadline, exponential backoff with full jitter (600 ms base, ×1.7, 15 s cap),
  a bounded outbound queue that survives a blip (`terminal.input` frames are
  deliberately *not* queued — replaying keystrokes would corrupt the session),
  and connection states `OFFLINE → AUTHENTICATING → CONNECTED → RECONNECTING`.
- **`SimulatedTransport`** — the same contract, routed in-process to
  `DeviceRuntime`, with a small injected latency and a `simulateDrop()` hook so
  the backoff/offline UI is exercised for real.

`ExistingWebSocketAdapter` wraps a transport and rewrites known legacy frame
names (`agent.delta` → `agent.message.delta`, etc.) onto v2 events.

## The device runtime

`DeviceRuntime` is the reference implementation of everything the Python agent
must do. It owns:

- the **agent loop** — run the provider, stream events, execute or gate tool
  calls, feed results back, repeat (max 6 rounds), then emit the finished
  message;
- the **permission gate** — classify the concrete command, consult the session
  profile, and either execute, create an approval, or deny;
- **tool execution** — one handler per registry entry;
- **services** — metrics ticker, OpenRC service model, process table, PTY
  emulation, virtual filesystem, and the audit log.

`SimulatedSystem` produces the telemetry with a bounded random walk (thermal
coupling, occasional build bursts) so charts move plausibly rather than
teleporting.

## AI providers

```
AIProvider.run(input, signal) -> AsyncGenerator<AgentEvent>
    AgentEvent = reasoning | plan | text | tool_call | usage | error
```

- `DemoProvider` — deterministic local planner. Detects intent, emits a plan,
  calls read-only tools, then answers with the real captured output. Used by the
  simulated device; needs no key and no network.
- `OpenAIProvider` / `AnthropicProvider` — streaming chat-completions and
  messages APIs with tool calling, routed through a server-side proxy
  (`VITE_AGENT_PROXY_URL` or the agent's `proxy_url`) so the browser never holds
  an API key.

Everything is cancellable: `AbortSignal` unwinds a provider mid-stream, which is
what "stop generation" is wired to.

## Routing

Hash-based (`#/agent`, `#/monitor`, …) with a `RouteId` union. Deep links survive
a reload and the back button works, with no router dependency. The connection
gate and the console shell are separate top-level experiences.
