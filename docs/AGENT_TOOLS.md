# Agent tools

The registry in `src/agent/tools.ts` is the contract between the model and the
machine. A model can only name one of these tools; the runtime resolves it,
classifies the concrete command it would produce, checks the session profile and
only then executes.

Every entry carries: `name`, `description`, `category`, `baseRisk`, `timeoutMs`,
`params` (name / type / required / description) and, where the tool builds a
shell command, `commandLike: true`.

`commandForTool(tool, args)` builds the **exact** string that would hit the
shell. The classifier runs on that string, never on a paraphrase — so what you
approve in the dialog is literally what executes.

| Tool | Category | Base risk | Parameters |
| --- | --- | --- | --- |
| `system_info` | read | LOW | — |
| `get_cpu_info` | read | LOW | — |
| `get_memory_info` | read | LOW | — |
| `get_disk_info` | read | LOW | — |
| `get_network_info` | read | LOW | — |
| `get_processes` | read | LOW | `sort` (`cpu`\|`mem`), `limit` |
| `get_services` | read | LOW | — |
| `get_logs` | read | LOW | `unit`, `lines` |
| `list_directory` | read | LOW | `path` † |
| `read_file` | read | LOW | `path` † |
| `search_files` | read | LOW | `query`, `root` † |
| `search_package` | read | LOW | `query` |
| `write_file` | filesystem_write | MEDIUM | `path` †, `content` |
| `execute_command` | shell | MEDIUM | `command`, `cwd` |
| `install_package` | package | HIGH | `package` † |
| `restart_service` | service | HIGH | `service` † |
| `terminal` | shell | HIGH | `session` |

† Arguments marked with a dagger are treated as literals: shell metacharacters
are rejected before the tool runs, and paths are resolved and confined to the
configured roots.

## Command construction

| Tool | Command the classifier sees |
| --- | --- |
| `execute_command` | the `command` argument verbatim |
| `install_package` | `sudo emerge --ask <package>` |
| `restart_service` | `sudo rc-service <service> restart` |
| `search_package` | `equery list <query>` |
| `write_file` | `tee <path>` |
| `get_logs` | `journalctl -u <unit> -n <lines>` |
| `terminal` | `tmux attach -t <session>` |

This is why `install_package` can never sneak past as a read: the string it
produces contains `sudo` and `emerge`, which the classifier grades HIGH, and the
`package` category is a `confirm` for every non-`READ_ONLY` profile.

## Execution contract

Each tool returns `{ stdout, stderr, exitCode }`:

- `exitCode 0` — success; the result is appended to the model's context.
- non-zero with `stderr` — reported to the model and shown in the tool card.
- `exitCode 126` — refused. Used both for a `deny` verdict
  (`"Denied by permission profile STANDARD: …"`) and for a user denial
  (`"Denied by user."`). The model is told *not to retry* the same tool.
- unknown tool — the call is rejected and nothing runs.

Timeouts come from `timeoutMs` (4 s for inspection, up to 600 s for package
builds). The agent loop caps a single turn at 6 tool rounds so a model cannot
loop indefinitely.

## Where results come from

In this repository the handlers run against `SimulatedSystem` and
`VirtualFileSystem`. On the Gentoo machine, the Python agent implements the same
handler per tool, using `/proc`, `/sys`, `rc-status`, `equery` and a real PTY.
The tool names, parameter names and risk/category metadata must match exactly —
the console renders and gates them by name.

## Audit

Every executed tool call produces an `agent.tool` frame (status
`pending → running → ok|failed|denied`), a `tool.output` frame, and a
`log.append` entry with the command and exit code. The chat renders all three;
the Logs page shows the text form.
