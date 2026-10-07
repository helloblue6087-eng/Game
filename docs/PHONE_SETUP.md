# Setting up on your phone

Everything in this console is designed to be operated from a phone: bottom
navigation, sheets instead of modals, safe-area padding, a terminal that drives
your phone's own keyboard, and approvals that appear one tap above the composer.

This walkthrough goes from "nothing installed" to "talking to my Gentoo PC from
the home screen".

---

## What you need

| Thing | Why |
| --- | --- |
| Your Gentoo PC running the agent | the machine you are controlling |
| Tailscale on the PC **and** on the phone | the network path — no port forwarding |
| This console reachable over HTTPS | browsers refuse `wss://` from an `http://` page |
| The session token the agent printed | authenticates this browser to that agent |

---

## Step 1 — Start the agent on the Gentoo PC

On the machine itself:

```bash
# as your desktop user, not root
python3 /opt/gentoo-agent/agent.py --config /etc/gentoo-agent/config.toml
```

Note two things it reports:

- the **WebSocket URL**, e.g. `wss://100.101.42.7:8765/agent`
- the **session token** it generated on first run

It must listen on the Tailscale address (or `0.0.0.0`), not `127.0.0.1` — a phone
cannot reach loopback. Confirm with:

```bash
tailscale status | grep gentoo     # your PC is online in the mesh
rc-service gentoo-agent status     # if you installed the OpenRC service
```

The full contract for this process is in
[AGENT_INTEGRATION.md](AGENT_INTEGRATION.md).

> **No agent yet?** The console ships a built-in simulated device. Do Steps 2–4
> anyway, leave the transport on *Simulated device*, and every screen works with
> nothing running on the PC. It is the fastest way to try the UI on a phone.

---

## Step 2 — Put the console somewhere HTTPS

Browsers only permit a secure WebSocket from a secure page, so the console must
be served over `https://` for a real gateway connection.

**Option A — Freebuff hosting (no server to manage):**

```bash
freebuff-preview set-install "bun install"
freebuff-preview set-build    "vite build"
freebuff-deploy check
freebuff-deploy start
```

The build emits static files into `dist/` and exits, which is what the deploy
builder expects. It gives you a real `https://` URL.

**Option B — self-host:** `bun run build`, then serve `dist/` with any static
host behind TLS (Caddy, nginx, Cloudflare Pages). A reverse proxy terminating
TLS in front of `dist/` is enough.

Either way you get one HTTPS URL that the phone opens directly.

---

## Step 3 — Make sure Tailscale is on the phone

- **iOS:** install Tailscale from the App Store, sign in, toggle it on.
- **Android:** install from Play Store, sign in, toggle it on.

Verify in the app that your Gentoo PC appears and is *Connected*. If the phone is
not on the same tailnet, nothing below will connect — the console will sit in
RECONNECTING, which is the correct behaviour rather than a hang.

---

## Step 4 — Open it and authenticate

1. Open the HTTPS URL in the phone's browser.
2. On the connection screen tap **Gateway settings**.
3. Set **Transport** to *Live WebSocket gateway*.
4. Paste the **WebSocket URL** from Step 1 (`wss://…`).
5. Paste the **Session token**.
6. Save — the console re-handshakes in place and the status chip turns green.
7. Tap **Enter console**.

You should see `ONLINE` with a latency figure, and the gauges start filling
within about a second. Leave the transport on *Simulated device* if you are only
demoing.

Settings → Connection shows exactly what the console is using (URL, device id,
whether a token is set), which is the first thing to check if it will not come
up.

---

## Step 5 — Add it to your home screen

**iPhone (Safari):** Share → *Add to Home Screen* → name it *Gentoo*.

**Android (Chrome):** ⋮ → *Add to Home screen* (or *Install app*).

This gives you a full-screen icon and opens straight into the console. Note
honestly: this is a home-screen shortcut, not a packaged PWA — the app does not
ship a service worker or offline cache yet, so it still needs the network on
first load.

---

## Using it from a phone

| You want | Where |
| --- | --- |
| Health of the machine | **Home** — CPU / RAM / disk / temp gauges, live |
| Ask GPT or Claude to fix something | **Agent** — type, watch it plan and run tools |
| Approve a risky command | the banner appears directly above the composer, or via the amber chip in the header |
| A real shell | **Terminal** — tap the black area to raise the keyboard; `expand` for fullscreen |
| Stop a service, kill a process | **PC Control** — every action asks first |
| Edit a config file | **More → Files** — sensitive paths ask before saving |
| Why is it slow? | **More → Monitor** — per-core bars, thermals, disk throughput |
| What did the agent actually run | **More → Logs** — filter by severity or session |

### Keyboard tips for the terminal

- Tap anywhere in the output to re-focus the input.
- `Enter` sends `\r`, Backspace sends DEL, arrows and Tab are mapped.
- `Ctrl+C` is available from the phone's own keyboard layout; on iOS, add a
  Ctrl key to your keyboard toolbar or use `^C` and press Ctrl.

---

## When it will not connect

Work down the list — the console deliberately distinguishes these states.

| Symptom | Cause |
| --- | --- |
| `AUTHENTICATING` then back to `RECONNECTING` | bad or missing token — the agent rejects `client.hello` |
| Stuck `RECONNECTING` with a growing attempt counter | phone not on the tailnet, PC asleep, or agent not listening on the mesh interface |
| Connects then drops every ~25 s | agent is not answering `client.ping` with `server.pong` |
| Page loads but no `ONLINE` | you are still on *Simulated device* transport |
| Host not allowed error | the dev server's `server.allowedHosts` — production hosts do not need this |

Full list with fixes: [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

---

## Second PC / tablet

Nothing changes. Open the same HTTPS URL from any machine on the tailnet, use the
same token, and you get the desktop sidebar layout automatically at ≥1024 px.
Multiple devices against one agent is exactly the same path — the token scopes a
session, not a device.
