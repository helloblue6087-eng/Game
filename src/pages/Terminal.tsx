/**
 * Terminal — interactive shell over the WebSocket.
 *
 * The device side owns a PTY (or attaches to an existing tmux session) and
 * streams raw bytes; this view renders them with a small SGR/256-colour
 * interpreter and forwards keystrokes, including control sequences and terminal
 * resize reports, back over the same channel.
 *
 * Input is captured on a real <input> so mobile keyboards, autocorrect-off and
 * IME composition all behave natively.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { Badge, Button, EmptyState, IconButton, Panel, Sheet, useCopy } from "../components/ui";
import { connectionStore, terminalStore, useStore } from "../state/store";
import { runtime } from "../state/bootstrap";

interface Span {
  text: string;
  className: string;
}

const COLOR_256: Record<number, string> = {
  0: "text-zinc-400",
  1: "text-rose-300",
  2: "text-emerald-300",
  3: "text-amber-300",
  4: "text-sky-300",
  5: "text-fuchsia-300",
  6: "text-cyan-300",
  7: "text-white/80",
  8: "text-white/35",
  9: "text-rose-400",
  10: "text-emerald-400",
  11: "text-amber-200",
  12: "text-sky-200",
  13: "text-fuchsia-200",
  14: "text-cyan-200",
  15: "text-white",
  111: "text-sky-200",
  114: "text-emerald-300",
  141: "text-accent-soft",
  203: "text-rose-400",
  245: "text-white/35",
};

/** Parse SGR sequences in a single output line into styled spans. */
function parseLine(line: string): Span[] {
  const spans: Span[] = [];
  let className = "";
  let buffer = "";
  let index = 0;

  const flush = () => {
    if (buffer) {
      spans.push({ text: buffer, className });
      buffer = "";
    }
  };

  while (index < line.length) {
    const char = line[index];
    if (char === "\u001b" && line[index + 1] === "[") {
      const end = line.indexOf("m", index);
      if (end === -1) break;
      const code = line.slice(index + 2, end);
      flush();
      const parts = code.split(";").map((value) => Number(value || 0));
      if (parts[0] === 0) className = "";
      else if (parts[0] === 1) className = `${className} font-semibold`.trim();
      else if (parts[0] === 38 && parts[1] === 5) className = COLOR_256[parts[2]] ?? className;
      else if (parts[0] === 31) className = "text-rose-300";
      else if (parts[0] === 32) className = "text-emerald-300";
      else if (parts[0] === 33) className = "text-amber-300";
      else if (parts[0] === 34) className = "text-sky-300";
      index = end + 1;
      continue;
    }
    buffer += char;
    index += 1;
  }
  flush();
  return spans.length ? spans : [{ text: "", className: "" }];
}

export function TerminalPage() {
  const terminal = useStore(terminalStore);
  const connection = useStore(connectionStore);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [shell, setShell] = useState("/bin/zsh");
  const [tmuxSession, setTmuxSession] = useState("gentoo");
  const [copied, copy] = useCopy();
  const inputRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  const active = terminal.terminals.find((t) => t.id === terminal.activeId) ?? null;

  useEffect(() => {
    if (terminal.terminals.length === 0) {
      runtime.controller.openTerminal("term_main", "gentoo", "/bin/zsh", "gentoo");
    }
  }, [terminal.terminals.length]);

  useEffect(() => {
    const el = outputRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [active?.buffer]);

  const lines = useMemo(() => {
    if (!active) return [];
    return active.buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  }, [active]);

  const sendKey = (data: string) => {
    if (!active) return;
    runtime.controller.terminalInput(active.id, data);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!active) return;
    const key = event.key;
    if (key === "Enter") {
      event.preventDefault();
      sendKey("\r");
      return;
    }
    if (key === "Backspace") {
      event.preventDefault();
      sendKey("\u007f");
      return;
    }
    if (key === "Tab") {
      event.preventDefault();
      sendKey("\t");
      return;
    }
    if (key === "ArrowUp") {
      event.preventDefault();
      sendKey("\u001b[A");
      return;
    }
    if (key === "ArrowDown") {
      event.preventDefault();
      sendKey("\u001b[B");
      return;
    }
    if (key === "ArrowLeft") {
      event.preventDefault();
      sendKey("\u001b[D");
      return;
    }
    if (key === "ArrowRight") {
      event.preventDefault();
      sendKey("\u001b[C");
      return;
    }
    if (event.ctrlKey && key.toLowerCase() === "c") {
      event.preventDefault();
      sendKey("\u0003");
      return;
    }
    if (event.ctrlKey && key.toLowerCase() === "d") {
      event.preventDefault();
      sendKey("\u0004");
      return;
    }
    if (key.length === 1 && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      sendKey(key);
    }
  };

  const offline = connection.status !== "CONNECTED";

  return (
    <div className={terminal.fullscreen ? "fixed inset-0 z-50 flex flex-col bg-[rgb(var(--bg))]" : "flex flex-col"}>
      {/* Toolbar */}
      <Panel className="mb-2 flex flex-wrap items-center gap-2 px-2.5 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto no-scrollbar">
          {terminal.terminals.map((term) => (
            <button
              key={term.id}
              onClick={() => runtime.controller.setActiveTerminal(term.id)}
              className={`mono flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11.5px] transition-colors ${
                term.id === terminal.activeId
                  ? "border-accent/40 bg-accent/15 text-white"
                  : "border-white/10 text-white/55 hover:text-white/85"
              }`}
            >
              <Icon name="terminal" className="h-3.5 w-3.5" />
              {term.name}
              {term.exitCode !== null ? <span className="text-rose-300">·{term.exitCode}</span> : null}
            </button>
          ))}
          <button
            onClick={() => setPickerOpen(true)}
            className="shrink-0 rounded-lg border border-dashed border-white/15 px-2.5 py-1.5 text-[11.5px] text-white/45 hover:text-white/80"
          >
            + new
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <Badge tone={offline ? "danger" : "ok"}>{offline ? "offline" : "pty attached"}</Badge>
          <IconButton
            icon="copy"
            label="Copy terminal buffer"
            onClick={() => copy(active?.buffer.replace(/\u001b\[[0-9;]*m/g, "") ?? "")}
          />
          <IconButton
            icon="expand"
            label="Toggle fullscreen"
            onClick={() => runtime.controller.toggleTerminalFullscreen()}
          />
          {terminal.fullscreen ? (
            <IconButton icon="close" label="Exit fullscreen" onClick={() => runtime.controller.toggleTerminalFullscreen()} />
          ) : null}
        </div>
      </Panel>

      {/* Output */}
      <Panel
        solid
        className={`flex min-h-[46vh] flex-1 flex-col overflow-hidden bg-black/70 ${
          terminal.fullscreen ? "m-3 mt-0" : ""
        }`}
      >
        <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-1.5">
          <span className="mono text-[10.5px] text-white/35">
            {active ? `${active.name} · ${shell} · tmux/${tmuxSession}` : "no session"}
          </span>
          <span className="mono text-[10.5px] text-white/30">
            {active ? `${(active.buffer.length / 1024).toFixed(1)} KB buffered` : "—"}
          </span>
        </div>

        <div
          ref={outputRef}
          onClick={() => inputRef.current?.focus()}
          className="scroll-area flex-1 overflow-y-auto px-3 py-2.5"
        >
          {!active ? (
            <EmptyState
              icon="terminal"
              title="No terminal session"
              description="Open a shell or attach to an existing tmux session on the Gentoo machine."
              action={
                <Button variant="primary" icon="plus" onClick={() => setPickerOpen(true)}>
                  Open terminal
                </Button>
              }
            />
          ) : (
            <pre className="mono whitespace-pre-wrap break-words text-[12.5px] leading-[1.55]">
              {lines.map((line, index) => (
                <div key={index}>
                  {parseLine(line).map((span, spanIndex) => (
                    <span key={spanIndex} className={span.className}>
                      {span.text}
                    </span>
                  ))}
                </div>
              ))}
            </pre>
          )}
        </div>

        {/* Hidden input drives the PTY */}
        <div className="flex items-center gap-2 border-t border-white/[0.06] px-3 py-2">
          <span className="mono shrink-0 text-[12px] text-accent-soft">blue@gentoo</span>
          <input
            ref={inputRef}
            value=""
            onChange={() => undefined}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            placeholder={offline ? "offline — reconnecting" : "tap to focus the terminal"}
            className="mono min-w-0 flex-1 bg-transparent text-[12.5px] text-white/85 placeholder:text-white/25 focus:outline-none"
            disabled={offline || !active}
          />
          {copied ? <span className="mono text-[10px] text-emerald-300">copied</span> : null}
        </div>
      </Panel>

      <p className="mt-2 flex items-start gap-2 px-1 text-[11.5px] leading-relaxed text-white/40">
        <Icon name="bolt" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-soft/70" />
        The PTY lives on the Gentoo machine; only bytes cross the network. Resize events are forwarded so
        full-screen tools such as nvim, htop and tmux behave correctly.
      </p>

      <Sheet open={pickerOpen} onClose={() => setPickerOpen(false)} title="Open a terminal">
        <div className="space-y-3.5">
          <label className="block">
            <span className="label">Shell</span>
            <select className="field" value={shell} onChange={(event) => setShell(event.target.value)}>
              <option value="/bin/zsh">/bin/zsh</option>
              <option value="/bin/bash">/bin/bash</option>
              <option value="/bin/sh">/bin/sh</option>
              <option value="/usr/bin/fish">/usr/bin/fish</option>
            </select>
          </label>
          <label className="block">
            <span className="label">tmux session</span>
            <select className="field" value={tmuxSession} onChange={(event) => setTmuxSession(event.target.value)}>
              <option value="gentoo">gentoo (existing)</option>
              <option value="work">work (existing)</option>
              <option value="new">create new session</option>
            </select>
          </label>
          <p className="text-[12px] text-white/50">
            Attaching to an existing tmux session keeps long-running work alive across reconnects — the
            agent keeps running even if the phone drops off the network.
          </p>
          <Button
            variant="primary"
            block
            icon="terminal"
            onClick={() => {
              const id = `term_${Date.now()}`;
              const name = tmuxSession === "new" ? `shell ${terminal.terminals.length + 1}` : tmuxSession;
              runtime.controller.openTerminal(id, name, shell, tmuxSession === "new" ? undefined : tmuxSession);
              setPickerOpen(false);
            }}
          >
            Open terminal
          </Button>
          {active ? (
            <Button
              variant="danger"
              block
              icon="close"
              onClick={() => {
                runtime.controller.closeTerminal(active.id);
                setPickerOpen(false);
              }}
            >
              Close current terminal
            </Button>
          ) : null}
        </div>
      </Sheet>
    </div>
  );
}
