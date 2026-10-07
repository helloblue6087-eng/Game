/**
 * Logs — centralized, streaming activity.
 *
 * Agent turns, executed commands, WebSocket lifecycle and permission decisions
 * all append to one ring buffer in the store. Filtering and searching happen
 * over that in-memory buffer (bounded to 1500 entries) so a busy machine never
 * makes this view heavy.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { Badge, Button, EmptyState, Panel, Segmented, Toggle, useCopy } from "../components/ui";
import { chatStore, logStore, useStore } from "../state/store";
import type { LogEntry, LogSeverity } from "../core/types";

const SEVERITIES: LogSeverity[] = ["debug", "info", "warn", "error"];
const SOURCES: LogEntry["source"][] = ["agent", "command", "websocket", "system", "audit"];

const SEVERITY_TEXT: Record<LogSeverity, string> = {
  debug: "text-white/40",
  info: "text-sky-300",
  warn: "text-amber-300",
  error: "text-rose-300",
};

export function LogsPage() {
  const logs = useStore(logStore);
  const chat = useStore(chatStore);
  const [minSeverity, setMinSeverity] = useState<LogSeverity>("info");
  const [source, setSource] = useState<"all" | LogEntry["source"]>("all");
  const [sessionFilter, setSessionFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [tail, setTail] = useState(true);
  const [copied, copy] = useCopy();
  const scroller = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const minRank = SEVERITIES.indexOf(minSeverity);
    const needle = query.trim().toLowerCase();
    return logs.entries.filter((entry) => {
      if (SEVERITIES.indexOf(entry.severity) < minRank) return false;
      if (source !== "all" && entry.source !== source) return false;
      if (sessionFilter !== "all" && entry.sessionId !== sessionFilter) return false;
      if (needle && !`${entry.message} ${entry.source}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [logs.entries, minSeverity, source, sessionFilter, query]);

  useEffect(() => {
    if (tail) {
      scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
    }
  }, [filtered.length, tail]);

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const entry of logs.entries) map[entry.severity] = (map[entry.severity] ?? 0) + 1;
    return map;
  }, [logs.entries]);

  const exportLogs = () => {
    const text = filtered
      .map((entry) => `${new Date(entry.timestamp).toISOString()} [${entry.severity}] [${entry.source}] ${entry.message}`)
      .join("\n");
    copy(text || "no log entries");
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2">
        {SEVERITIES.map((severity) => (
          <Panel key={severity} className="px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">{severity}</p>
            <p className={`mono mt-0.5 text-lg font-semibold ${SEVERITY_TEXT[severity]}`}>
              {counts[severity] ?? 0}
            </p>
          </Panel>
        ))}
      </div>

      <Panel className="space-y-3 p-3.5">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
            <input
              className="field pl-9"
              placeholder="Filter log text…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <Button variant="ghost" icon="copy" onClick={exportLogs}>
            {copied ? "Copied" : "Export"}
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <span className="label">Minimum severity</span>
            <Segmented
              value={minSeverity}
              onChange={setMinSeverity}
              options={SEVERITIES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))}
            />
          </div>
          <div>
            <span className="label">Source</span>
            <select className="field" value={source} onChange={(event) => setSource(event.target.value as typeof source)}>
              <option value="all">All sources</option>
              {SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-end gap-3">
          <label className="flex-1">
            <span className="label">Session</span>
            <select className="field" value={sessionFilter} onChange={(event) => setSessionFilter(event.target.value)}>
              <option value="all">All sessions</option>
              {chat.sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-2 pb-2.5">
            <Toggle checked={tail} onChange={setTail} label="Follow output" />
            <span className="text-[12px] text-white/60">Follow</span>
          </div>
        </div>
      </Panel>

      <Panel className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-3.5 py-2">
          <span className="mono text-[11px] text-white/45">
            {filtered.length} of {logs.entries.length} entries
          </span>
          <div className="flex items-center gap-2">
            <Badge tone={tail ? "ok" : "neutral"}>{tail ? "streaming" : "paused"}</Badge>
          </div>
        </div>
        <div ref={scroller} className="scroll-area max-h-[60vh] overflow-y-auto bg-black/30">
          {filtered.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon="list"
                title="No entries match"
                description="Loosen the severity filter or clear the search to see more of the stream."
              />
            </div>
          ) : (
            <ul className="divide-y divide-white/[0.04]">
              {filtered.slice(-400).map((entry) => (
                <li key={entry.id} className="flex items-start gap-3 px-3.5 py-2">
                  <span className="mono shrink-0 text-[10.5px] text-white/30">
                    {new Date(entry.timestamp).toLocaleTimeString([], { hour12: false })}
                  </span>
                  <span
                    className={`mono w-11 shrink-0 text-[10.5px] font-semibold uppercase ${SEVERITY_TEXT[entry.severity]}`}
                  >
                    {entry.severity}
                  </span>
                  <span className="mono w-20 shrink-0 truncate text-[10.5px] text-white/35">{entry.source}</span>
                  <span className="min-w-0 flex-1 break-words text-[12.5px] text-white/75">{entry.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>

      <Panel className="flex items-start gap-2.5 p-3.5">
        <Icon name="bolt" className="mt-0.5 h-4 w-4 shrink-0 text-accent-soft" />
        <p className="text-[12px] leading-relaxed text-white/50">
          Entries stream in over the same WebSocket as everything else — no polling endpoints. The buffer holds
          the most recent 1500 records and is trimmed as new ones arrive.
        </p>
      </Panel>
    </div>
  );
}
