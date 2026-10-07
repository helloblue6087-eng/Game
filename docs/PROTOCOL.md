# Protocol

Structured JSON frames over one WebSocket. Every frame has a discriminating
`type`; there is no free-form string channel. `PROTOCOL_VERSION` is `2` and is
negotiated in the handshake, so an older client can be served by the adapter.

Definitions live in `src/core/protocol.ts`.

## Handshake

The client sends `client.hello` as soon as the socket opens. The device answers
with `server.hello` (which is the only thing that moves the connection to
`CONNECTED`) and then re-emits `session.updated` for every session it holds.

```jsonc
// client → agent
{ "type": "client.hello", "clientId": "web-3f2a", "token": "…", "protocol": 2, "deviceId": "gentoo-desktop" }

// agent → client
{
  "type": "server.hello",
  "protocol": 2,
  "device": { "id": "gentoo-desktop", "hostname": "gentoo", "kernel": "6.12.9-gentoo-dist", "init": "OpenRC 0.56", "compositor": "Hyprland 0.45 (Wayland)", "tailscaleIp": "100.101.42.7", "uptimeSeconds": 284120, "online": true },
  "providers": [
    { "id": "demo", "label": "Local planner (no key)", "models": ["gentoo-planner-v1"], "configured": true },
    { "id": "openai", "label": "OpenAI / GPT", "models": ["gpt-4o"], "configured": false }
  ],
  "serverTime": 1759827600000
}
```

## Keepalive

The client pings every 15 s and expects a pong within 10 s; a missed deadline
closes the socket so the backoff path runs.

```jsonc
{ "type": "client.ping", "at": 1759827600000 }
{ "type": "server.pong", "at": 1759827600000, "serverTime": 1759827600018 }
```

## Agent turn

The full sequence for `"Check why my system is using so much RAM."`:

```jsonc
{ "type": "agent.message", "sessionId": "sess_gentoo_admin", "message": "Check why my system is using so much RAM." }

{ "type": "agent.status", "sessionId": "sess_gentoo_admin", "status": "thinking" }
{ "type": "agent.reasoning", "sessionId": "sess_gentoo_admin", "delta": "Thinking about: …\n" }
{ "type": "agent.plan", "sessionId": "sess_gentoo_admin", "steps": ["Interpret the request…", "Read /proc/meminfo…", "Rank processes by resident memory", "…"] }

{ "type": "agent.tool", "sessionId": "sess_gentoo_admin", "toolCall": {
  "id": "call_9f2", "tool": "get_memory_info", "args": {}, "risk": "LOW", "category": "read",
  "startedAt": 1759827601100, "status": "pending" } }

{ "type": "tool.output", "sessionId": "sess_gentoo_admin", "toolCallId": "call_9f2",
  "stdout": "MemTotal: 65536 MB\nMemUsed: 21400 MB\n…", "stderr": "", "exitCode": 0,
  "risk": "LOW", "category": "read" }

{ "type": "agent.message.delta", "sessionId": "sess_gentoo_admin", "messageId": "msg_71c", "content": "Here is " }
{ "type": "agent.message.completed", "sessionId": "sess_gentoo_admin", "message": {
  "id": "msg_71c", "sessionId": "sess_gentoo_admin", "role": "assistant",
  "content": "…markdown…", "createdAt": 1759827605000,
  "plan": ["…"], "toolCalls": [ /* ToolCall[] */ ],
  "usage": { "promptTokens": 412, "completionTokens": 188 } } }

{ "type": "agent.status", "sessionId": "sess_gentoo_admin", "status": "idle" }
```

`agent.error` is emitted instead of completion on failure, carrying a
human-readable `message` and the raw `technical` detail the UI hides behind a
disclosure.

To cancel: `{ "type": "agent.stop", "sessionId": "…" }`.

## Approval

When the permission gate needs a verdict it emits `approval.request` and pauses
the turn; nothing executes until a decision arrives.

```jsonc
{ "type": "approval.request", "approval": {
  "id": "appr_55a", "sessionId": "sess_gentoo_admin",
  "command": "sudo rc-service pipewire restart", "cwd": "/home/blue", "user": "blue",
  "risk": "HIGH", "reason": "Service lifecycle change. Service lifecycle change",
  "category": "service", "createdAt": 1759827602000, "irreversible": false } }

{ "type": "approval.decision", "approvalId": "appr_55a", "decision": "approve_once" }
{ "type": "approval.resolved", "approvalId": "appr_55a", "decision": "approve_once" }
```

`decision` is `deny`, `approve_once` or `approve_session`. `approve_session` is
never offered when `irreversible` is true — the device also ignores it in that
case.

## Sessions

```jsonc
{ "type": "session.create", "name": "Build agent", "provider": "demo", "model": "gentoo-planner-v1", "profile": "STANDARD" }
{ "type": "session.update", "sessionId": "sess_1", "patch": { "profile": "ADMIN" } }
{ "type": "session.delete", "sessionId": "sess_1" }

{ "type": "session.updated", "session": { /* AgentSession */ } }
{ "type": "session.removed", "sessionId": "sess_1" }
```

## Streaming data

```jsonc
{ "type": "metrics.subscribe", "intervalMs": 1000 }
{ "type": "metrics.snapshot", "snapshot": { "cpu": { "total": 18.4, "perCore": [/*…*/], "frequencyMhz": 4012, "load": [2.9, 2.7, 2.5] }, "memory": { /*…*/ }, "disk": [/*…*/], "network": [/*…*/], "temps": [/*…*/], "processes": [/*…*/] } }
{ "type": "metrics.unsubscribe" }

{ "type": "logs.subscribe", "minSeverity": "info" }
{ "type": "log.append", "entry": { "id": "log_1", "timestamp": 1759827603000, "severity": "warn", "source": "command", "sessionId": "sess_1", "message": "$ sudo rc-service pipewire restart → exit 0" } }
```

`source` is one of `agent | command | websocket | system | audit`.

## Terminal

```jsonc
{ "type": "terminal.open", "terminalId": "t1", "shell": "/bin/zsh", "tmuxSession": "gentoo" }
{ "type": "terminal.input", "terminalId": "t1", "data": "ls -la\r" }
{ "type": "terminal.resize", "terminalId": "t1", "cols": 92, "rows": 28 }
{ "type": "terminal.close", "terminalId": "t1" }

{ "type": "terminal.output", "terminalId": "t1", "data": "\u001b[38;5;141mblue@gentoo\u001b[0m:~/projects$ " }
{ "type": "terminal.exit", "terminalId": "t1", "exitCode": 0 }
```

`data` is raw PTY bytes (including SGR escapes and `\r\n`). The client renders
them with a 256-colour interpreter; it does not interpret them itself.

## Filesystem

Request/response, correlated by `requestId`.

```jsonc
{ "type": "fs.list", "requestId": "req_1", "path": "/home/blue", "showHidden": false }
{ "type": "fs.list.result", "requestId": "req_1", "path": "/home/blue", "entries": [ { "name": "projects", "path": "/home/blue/projects", "type": "dir", "size": 4096, "owner": "blue", "group": "blue", "mode": "drwxr-xr-x", "modified": 1759741200000, "hidden": false } ] }

{ "type": "fs.read",  "requestId": "req_2", "path": "/etc/portage/make.conf" }
{ "type": "fs.file.result", "requestId": "req_2", "path": "…", "content": "COMMON_FLAGS=\"-O2 -pipe\"\n" }

{ "type": "fs.write",  "requestId": "req_3", "path": "…", "content": "…" }
{ "type": "fs.mkdir",  "requestId": "req_4", "path": "…" }
{ "type": "fs.rename", "requestId": "req_5", "from": "…", "to": "…" }
{ "type": "fs.delete", "requestId": "req_6", "path": "…" }
{ "type": "fs.ack",    "requestId": "req_3", "ok": false, "message": "Path is outside the allowed roots (/home, /etc, /var, /tmp)" }
```

A `fs.ack` with `ok: false` is a normal answer, not a protocol error.

## Processes, services, power

```jsonc
{ "type": "proc.list", "requestId": "req_7" }
{ "type": "proc.list.result", "requestId": "req_7", "processes": [ { "pid": 2610, "user": "blue", "cpu": 1.4, "mem": 210.5, "command": "python3 /opt/gentoo-agent/agent.py" } ] }
{ "type": "proc.kill", "requestId": "req_8", "pid": 4012, "signal": "15" }

{ "type": "svc.list", "requestId": "req_9" }
{ "type": "svc.list.result", "requestId": "req_9", "services": [ { "name": "pipewire", "description": "Multimedia server", "state": "crashed", "boot": "enabled" } ] }
{ "type": "svc.action", "requestId": "req_10", "name": "pipewire", "action": "restart" }

{ "type": "power.action", "requestId": "req_11", "action": "reboot" }
{ "type": "power.result", "requestId": "req_11", "action": "reboot", "message": "Restarting system.\nSyncing filesystems ... done." }
```

## Tasks

```jsonc
{ "type": "task.updated", "task": { "id": "task_1", "sessionId": "sess_1", "title": "Check RAM usage", "action": "agent.turn", "status": "RUNNING", "createdAt": 1, "updatedAt": 2 } }
{ "type": "task.cancel", "taskId": "task_1" }
```

Statuses: `QUEUED | RUNNING | WAITING_APPROVAL | COMPLETED | FAILED | CANCELLED`.

## Backwards compatibility

`ExistingWebSocketAdapter` (`src/core/transport.ts`) rewrites legacy frame names
onto v2 before the controller sees them:

| Legacy | v2 |
| --- | --- |
| `agent.delta` | `agent.message.delta` |
| `ws.status` | `device.status` |
| `metrics.update` | `metrics.snapshot` |

Unknown frames are ignored rather than treated as fatal, so an older peer can
keep talking to a newer console.
