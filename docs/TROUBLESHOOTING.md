# Troubleshooting

## The banner says OFFLINE / RECONNECTING forever

The console queues your work and keeps rendering cached state; it is not frozen.
Work through the hops in order.

1. **Is the gateway URL right?** Settings → Connection shows the URL actually in
   use, plus the device id and whether a token is set.
2. **Is a token set?** A missing token makes the agent reject `client.hello`, and
   the socket closes immediately — which looks like a network problem but is an
   auth problem.
3. **Transport set to simulated?** If Connection says *Simulated device*, you are
   talking to the built-in device. Switch to *Live WebSocket gateway*.
4. **Is the agent listening on the mesh interface and not just localhost?** Bind
   to the Tailscale address or `0.0.0.0`, not `127.0.0.1`.
5. **Protocol mismatch.** If the agent is filtering on `protocol`, make sure it
   accepts `2`.
6. **Heartbeat.** If the link connects and then drops every ~25 s, the agent is
   not answering `client.ping` with `server.pong`. The client treats a missed
   pong (10 s) as a dead socket by design.

## The console shows the simulated device and I cannot switch

Settings → Configure gateway → set Transport to *Live WebSocket gateway*, then
enter the URL and token. The gateway settings persist in this browser under
`gacc.settings.v2`; *Forget gateway settings* in Settings clears them.

## The AI answers, but every tool is denied

The session's permission profile is doing its job. Check the profile on the
Sessions page, and check the reason text on the tool card — it names the category
and the profile (`"Profile Read only does not permit package actions."`). Raise
the profile to Standard or Admin if you want package and service work gated by
approval instead of refused.

## An install/service command keeps asking even after "approve for session"

Session grants are per category with a 30-minute TTL, and are refused entirely
for CRITICAL commands — those can only ever be approved once. If the command
grades CRITICAL, expect a prompt every time; that is intentional.

## "Denied by user. Do not retry."

The model was told not to repeat that tool in this turn. Send a new message (or
regenerate) and it will re-plan from scratch.

## A provider says "not connected yet"

`OpenAIProvider` and `AnthropicProvider` need a server-side proxy base URL so the
API key stays off the browser. Set `VITE_AGENT_PROXY_URL` (or the agent's
`proxy_url`) and make sure that process holds `OPENAI_API_KEY` /
`ANTHROPIC_API_KEY`. The Technical details disclosure shows the HTTP status the
proxy returned. Use the built-in *Local planner* provider if you just want the
console to be functional.

## The terminal is blank or keystrokes do nothing

- Tap inside the black area — the hidden input must be focused for the phone
  keyboard to appear.
- If the status chip says *offline*, the PTY is gone; open a new terminal.
- If output looks like `[38;5;141m` text, the device is sending raw SGR bytes
  without the escape prefix; the client expects `ESC [ … m`.
- If nothing echoes at all, the agent is not attaching a real PTY. `terminal.input`
  must be written into the pty master, not interpreted by the agent.

## Files: "Path is outside the allowed roots"

The device resolves every path and refuses anything that lands outside the
configured roots. Adjust *Allowed filesystem roots* in gateway settings, or
browse somewhere inside them. This is the anti-traversal guard working as
designed — see [SECURITY.md](SECURITY.md).

## Writing to `/etc/...` always asks

Yes. Sensitive locations always require confirmation, even under a profile that
would otherwise allow the write.

## Metrics look frozen

The stream pauses when the connection is not `CONNECTED` (the store clears the
subscribed flag on `RECONNECTING`/`OFFLINE`, then the page resubscribes). If the
link is healthy and the numbers still do not move, the agent is likely sampling
once and not repeating — it must keep emitting `metrics.snapshot` at the
requested interval until `metrics.unsubscribe`.

## The dashboard is empty on first load

On a cold start the shell shows the connection gate. Press **Enter console**; the
handshake takes ~340 ms against the simulated device and the first metrics sample
arrives within a second.

## Typecheck or tests fail locally

```bash
bun install
bun run typecheck
bun run test
```

`bun run test` runs 48 unit + integration tests. The integration suite drives the
real protocol end to end and takes ~20 s, since the simulated provider paces its
streaming deliberately.
