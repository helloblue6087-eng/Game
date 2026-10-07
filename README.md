# Gentoo Agent Control Center

A mobile-first control console for a Gentoo Linux machine: talk to GPT or Claude
and let them inspect, explain and — with your explicit approval — change things
on your PC, plus a terminal, file manager, process/service control and live
metrics, all over one permission-checked channel.

This repository contains the **control center** (the client). It ships with a
complete, in-browser simulation of the Gentoo device so the whole console runs
and can be tested with no server present, and it speaks the same structured
WebSocket protocol the real agent uses — point it at your agent and the
simulation is simply replaced.

---

## What is actually in here

| Area | Status |
| --- | --- |
| Mobile-first UI (bottom nav) + desktop sidebar | Implemented |
| Home dashboard, live metrics, monitor, logs | Implemented |
| AI agent chat: streaming, plans, tool cards, reasoning, usage, stop/retry | Implemented |
| Multiple agent sessions with provider, model, prompt and profile | Implemented |
| Permission engine + risk classifier (LOW → CRITICAL) | Implemented, unit tested |
| Approval center with once / session / deny verdicts | Implemented |
| Tasks with status lifecycle and cancellation | Implemented |
| Interactive terminal (SGR colour, key handling, fullscreen) | Implemented |
| PC control: power, OpenRC services, processes | Implemented |
| Remote file manager with editor and sensitive-path guards | Implemented |
| Devices page, security page, settings | Implemented |
| Structured WebSocket protocol + reconnecting client | Implemented |
| Simulated Gentoo device (agent loop, tools, PTY, FS, metrics) | Implemented |
| Provider abstraction: local planner, OpenAI, Anthropic | Implemented |
| `ExistingWebSocketAdapter` for an older protocol | Implemented (maps known legacy frame names) |

Run `bun run test` for the 48 unit + integration tests, including the full
USER → AI → TOOL → APPROVAL → COMMAND → RESULT → AI → USER path.

**Not in this repository:** the Python agent process, `install.sh`, and the
OpenRC service file. Those live on the Gentoo machine; this repo defines the
protocol and tool contract they must implement (see
[docs/AGENT_INTEGRATION.md](docs/AGENT_INTEGRATION.md)).

---

## Running it

```bash
bun install
bun run dev          # dev server (HMR disabled by the platform)
bun run test         # unit + integration tests
bun run typecheck    # tsc -b --noEmit
bun run build        # production bundle into dist/
```

Open the app and press **Enter console**. It starts against the simulated
device, so every screen is functional immediately.

**Running it from your phone?** Start here:
**[docs/PHONE_SETUP.md](docs/PHONE_SETUP.md)** — agent on the PC, HTTPS host,
Tailscale on the phone, auth, and adding it to your home screen.

### Connecting to your real PC

Settings → **Configure gateway**:

1. Set **Transport** to *Live WebSocket gateway*.
2. Enter the `wss://` URL of your agent (its Tailscale address is fine).
3. Paste the **session token** the agent issued.
4. Save — the console re-handshakes and re-authenticates in place.

Provider API keys are **never** entered here. They belong in the agent's
environment on the Gentoo machine.

---

## Architecture at a glance

```
UI (pages)  ──►  Stores (7 small, independent)  ──►  Controller
                                                        │
                                                   Transport
                                          ┌─────────────┴─────────────┐
                                  WebSocketTransport            SimulatedTransport
                                  (wss:// + reconnect)                  │
                                                                  DeviceRuntime
                                                       (agent loop · tools · PTY · FS · metrics)
```

The permission layer sits between the agent loop and every tool:

```
AI provider → tool_call → risk classifier → permission profile → approval → execute
```

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Documentation

- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — layers, state stores, data flow
- [PHONE_SETUP.md](docs/PHONE_SETUP.md) — **phone-first walkthrough: get it running on your phone**
- [PROTOCOL.md](docs/PROTOCOL.md) — every WebSocket frame, with examples
- [SECURITY.md](docs/SECURITY.md) — permission model, risk rules, guarantees
- [AGENT_TOOLS.md](docs/AGENT_TOOLS.md) — the tool registry and schemas
- [AGENT_INTEGRATION.md](docs/AGENT_INTEGRATION.md) — what the Python agent must implement
- [MOBILE.md](docs/MOBILE.md) — phone-first layout rules and breakpoints
- [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) — symptoms and fixes
