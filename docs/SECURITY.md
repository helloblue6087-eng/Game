# Security

## The single chokepoint

AI output is untrusted input. A model may only emit `{ tool, args }`; it cannot
reach a shell. Between that and execution sits one path every action must take:

```
AI tool_call
   │
   ├─ resolve tool            unknown tool  → rejected, nothing runs
   ├─ build the real command  (commandForTool — the exact string that would run)
   ├─ classify                LOW | MEDIUM | HIGH | CRITICAL  + reasons
   ├─ evaluate profile        allow | confirm | deny
   ├─ ask if needed           approval center, single-use token
   └─ execute                 capture stdout/stderr/exit, append to audit log
```

There is no second route to system tools: the PC Control page, the file manager
and the terminal all call the same classifier before dispatching.

## Risk classification

`src/core/risk.ts`. Rules are ordered most-destructive first and the first match
per pipeline segment wins, so a dangerous segment inside `a && b` is never
downgraded by a benign neighbour.

**CRITICAL** (irreversible):

- `rm -rf` / `rm -fr`
- `mkfs`, `fdisk`, `sfdisk`, `parted`, `gdisk`
- `dd … of=/dev/nvme*|sd*` and `> /dev/sd*`
- bootloader changes (`grub-install`, `efibootmgr`, `update-grub`)
- writes to `/etc/passwd`, `/etc/shadow`, `/etc/sudoers`, `passwd`, `visudo`
- firewall flushes (`iptables -F`, `nft flush`)
- `chmod -R` on `/` or `~`
- power state changes (`reboot`, `shutdown`, `poweroff`, `halt`)

**HIGH**: `sudo`/`doas`/`su`, package install/removal, service lifecycle
changes, `kill -9`, mount/umount/swap, user and group account edits.

**MEDIUM**: file and directory writes (`mv`, `cp -r`, `rm`, `tee`, `chmod`,
`chown`, redirection), network configuration, plain `kill`, and any compound or
piped command — because composition is behaviour we cannot fully reason about.

**LOW**: the read-only inspection set (`ls`, `cat`, `grep`, `ps`, `free`, `df`,
`journalctl`, `loginctl`, `equery list`, …).

Two deliberate defaults:

- **Unknown commands are not safe.** An unrecognised command is graded MEDIUM
  with the reason *"Unrecognised command — treated as write-capable"*.
- **Anything irreversible is forced to CRITICAL**, whatever else matched.

## Permission profiles

| Profile | Allows without asking | Confirms | Denies |
| --- | --- | --- | --- |
| `READ_ONLY` | read, network | HIGH-risk reads | file writes, process, service, package, power, shell, admin |
| `STANDARD` | read, network, project file writes | process, shell, service, package | admin, power |
| `ADMIN` | read, network, file writes | process, shell, service, package, power | admin |
| `DANGEROUS` | read, network | every mutating category | — |

Escalation: within an *allowed* category, a command the classifier raises to
HIGH (or CRITICAL) is confirmed anyway. CRITICAL always confirms and, in every
profile, sets `allowSessionApproval: false`.

## Approvals

- **Deny** — the command is reported as denied (exit 126), the turn continues so
  the model can adapt, and the event is audited.
- **Approve once** — a single execution.
- **Approve for session** — a category grant with a 30-minute TTL, keyed per
  session (`ApprovalGrantStore`), revocable, and never offered for irreversible
  operations.

The dialog always shows the exact command, its risk level, the category, the
reason, the working directory and the user. Dangerous operations are never
silent.

## Injection and traversal

- Tool arguments that are meant to be literals (paths, service names, package
  atoms) are rejected by `detectInjection()` if they contain shell
  metacharacters (`; & | \` $ ( ) { } < > \`), newlines or NUL bytes — so a crafted
  filename cannot become a second command.
- `safeResolve()` normalises `..` and rejects anything that escapes the
  configured roots, and rejects a traversal above `/`. Both are exercised in
  `src/core/risk.test.ts`, including `/home/blue/../../../root/.ssh/id_rsa`.
- Sensitive locations (`/etc`, `/boot`, `/usr`, `/var`, `/home`, `/root`, `/dev`,
  `/proc`, `/sys`) are flagged in the file manager, and a write there always asks
  first, even when the profile would allow it.

## Credentials

- Provider API keys are held by the agent process on the Gentoo machine. The
  browser only ever holds the device session token, and the hosted providers
  route through a server-side proxy.
- The token is stored in `localStorage` under `gacc.settings.v2` in this browser
  only. Revoking it on the agent invalidates this console immediately, and
  Security → *Revoke this device session* drops the link and clears the
  authenticated state.
- Production environment variables are managed outside the console; nothing
  secret is bundled. No `VITE_*` variable in this app carries a key.

## Audit

Every decision and every execution appends a `log.append` entry: which command,
which session, exit code, and whether it was allowed by profile, approved by a
human, or denied. Denials are recorded too — a refusal is as interesting as an
execution. The Logs page filters by severity, source and session, and the
Approvals page shows the recent audit trail.

## What this design does not claim

- It is not a sandbox. It is an authorisation layer in front of a machine you
  already control; a CRITICAL command you approve will really run.
- The classifier is pattern-based, not a proof. It catches the shapes that
  destroy systems reliably, and it errs toward asking. Treat an unfamiliar
  command as unfamiliar.
- Transport security comes from TLS (`wss://`) over Tailscale. The console does
  not implement its own encryption.
