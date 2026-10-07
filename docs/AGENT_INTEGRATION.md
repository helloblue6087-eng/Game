# Connecting your Gentoo agent

This repository is the console. The Python agent process, `install.sh` and the
OpenRC service live on the Gentoo machine and are **not** included here — this
document is the contract they must satisfy, and an honest inventory of what you
have to build.

## What already works without a server

The console ships with `SimulatedTransport`, which routes frames in-process to
`DeviceRuntime`. That runtime is a full reference implementation: agent loop,
permission gate, tool handlers, PTY emulation, virtual filesystem, metrics
sampler and audit log. Use it as the spec — behaviour that differs from it will
differ in the UI too.

## What the Python agent must implement

1. **A WebSocket endpoint** that accepts the frames in
   [PROTOCOL.md](PROTOCOL.md) and validates `client.hello` (`protocol == 2`, a
   valid `token`, a known `deviceId`) before anything else. A bad token must
   close the socket, not answer it.
2. **The same tool registry** as [AGENT_TOOLS.md](AGENT_TOOLS.md): identical tool
   names, parameter names, categories and risk metadata. Handlers read real
   data — `/proc/meminfo`, `/proc/stat`, `/sys/class/thermal`, `rc-status`,
   `equery`, `sensors`.
3. **The permission gate before every execution.** Port the rules in
   `src/core/risk.ts` and `src/core/permissions.ts`, or better, keep them as the
   single source of truth and mirror them exactly. Classify the concrete command
   string, not a description of it.
4. **A PTY** (`pty.openpty()` + `os.forkpty`, or a `tmux new-session -A -s` child)
   streaming raw bytes as `terminal.output`, with `tcsetwinsize` on
   `terminal.resize`.
5. **Read-only by default filesystem access**, resolved against configured roots
   before any syscall, refusing traversal.
6. **A single metrics sampler** on a timer, not a subprocess per request.
7. **Provisioning on the AI side**: hold `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`
   in the agent's environment and expose the proxy endpoints the browser calls
   (`VITE_AGENT_PROXY_URL`). Keys must never reach the client.

## Configuration

A `config.toml` in the shape `/etc/gentoo-agent/config.toml` is the natural home
for: bind address and port, the session token, allowed filesystem roots,
provider selection and default model, database path, terminal defaults, logging
level, and the Tailscale interface to listen on. Keep secrets out of the file —
read them from the environment.

## Privilege separation

Run the agent as the desktop user (`blue`), not root. The tool handlers that need
privilege should be the only paths that escalate, via a narrowly scoped `doas` or
`sudo` rule — for example, allowing exactly `rc-service * restart` and
`emerge --ask *`. The permission gate then decides *whether* to escalate; the
sudoers rule decides *how far*.

## Suggested service shape

```
/etc/init.d/gentoo-agent
  command_user="blue"
  start:    /usr/bin/python3 /opt/gentoo-agent/agent.py --config /etc/gentoo-agent/config.toml
  restart:  respawn on non-zero exit, with backoff
  depends:  need net
  log:      /var/log/gentoo-agent/agent.log (also streamed as `log.append`)
```

and an `install.sh` that places the package under `/opt/gentoo-agent`, renders
`/etc/gentoo-agent/config.toml` **only if it does not already exist**, generates
the session token, installs the init script, and reports the address the console
should connect to. Never overwrite an existing config, database or certificate
without an explicit backup.

## Pointing the console at it

Settings → Configure gateway → *Live WebSocket gateway*, then the `wss://` URL
(the Tailscale address is right — no port forwarding) and the token. Saving
swaps the transport in place and re-handshakes; conversation state survives.

If the handshake never reaches `CONNECTED`, see
[TROUBLESHOOTING.md](TROUBLESHOOTING.md).

## Compatibility with an existing deployment

If you already have a website speaking a different frame shape, implement it
server-side or extend the alias table in `mapLegacyMessage()` (it currently maps
`agent.delta`, `ws.status` and `metrics.update`). Unknown frames are ignored
rather than fatal, so a newer console will not break an older server.
