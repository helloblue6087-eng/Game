/**
 * Tasks — long-running work started by agents.
 *
 * A task is created for every agent turn and can also represent a standing
 * job such as "watch disk usage". Status transitions come from the device over
 * the protocol, so this view is a pure projection of streamed state.
 */

import { useState } from "react";
import { Icon } from "../components/Icon";
import { Badge, Button, EmptyState, Panel, SectionHeader, Segmented, timeAgo } from "../components/ui";
import { chatStore, useStore } from "../state/store";
import { runtime } from "../state/bootstrap";
import type { Task, TaskStatus } from "../core/types";

const STATUS_TONE: Record<TaskStatus, "ok" | "warn" | "danger" | "neutral" | "accent"> = {
  QUEUED: "neutral",
  RUNNING: "accent",
  WAITING_APPROVAL: "warn",
  COMPLETED: "ok",
  FAILED: "danger",
  CANCELLED: "neutral",
};

type Filter = "all" | "active" | "done";

export function TasksPage() {
  const chat = useStore(chatStore);
  const [filter, setFilter] = useState<Filter>("all");

  const tasks = chat.tasks.filter((task) => {
    if (filter === "active") return task.status === "RUNNING" || task.status === "QUEUED" || task.status === "WAITING_APPROVAL";
    if (filter === "done") return task.status === "COMPLETED" || task.status === "FAILED" || task.status === "CANCELLED";
    return true;
  });

  const counts = {
    active: chat.tasks.filter((t) => t.status === "RUNNING" || t.status === "QUEUED").length,
    waiting: chat.tasks.filter((t) => t.status === "WAITING_APPROVAL").length,
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <MiniStat label="Total" value={chat.tasks.length} />
        <MiniStat label="Active" value={counts.active} tone="accent" />
        <MiniStat label="Waiting" value={counts.waiting} tone="warn" />
      </div>

      <Segmented
        value={filter}
        onChange={setFilter}
        options={[
          { value: "all", label: "All" },
          { value: "active", label: "Active" },
          { value: "done", label: "Finished" },
        ]}
      />

      <SectionHeader title="Agent tasks" icon="clock" />
      {tasks.length === 0 ? (
        <EmptyState
          icon="clock"
          title="No tasks"
          description="Every agent turn records a task so you can see what ran, how long it took and what it produced."
        />
      ) : (
        <div className="space-y-2.5">
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} sessionName={sessionName(chat.sessions, task.sessionId)} />
          ))}
        </div>
      )}
    </div>
  );
}

function TaskRow({ task, sessionName }: { task: Task; sessionName: string }) {
  const [expanded, setExpanded] = useState(false);
  const cancellable = task.status === "RUNNING" || task.status === "QUEUED" || task.status === "WAITING_APPROVAL";

  return (
    <Panel className="overflow-hidden">
      <button className="flex w-full items-start gap-3 px-4 py-3 text-left" onClick={() => setExpanded((v) => !v)}>
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-accent-soft">
          <Icon
            name={task.status === "COMPLETED" ? "check" : task.status === "FAILED" ? "alert" : "bolt"}
            className="h-4 w-4"
          />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-medium text-white/90">{task.title}</p>
          <p className="mono mt-0.5 truncate text-[11px] text-white/40">
            {sessionName} · {task.action} · updated {timeAgo(task.updatedAt)} ago
          </p>
        </div>
        <Badge tone={STATUS_TONE[task.status]}>{task.status.replace("_", " ")}</Badge>
      </button>

      {expanded ? (
        <div className="border-t border-white/[0.06] px-4 py-3">
          <dl className="mono grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
            <Line label="id" value={task.id} />
            <Line label="status" value={task.status} />
            <Line label="created" value={new Date(task.createdAt).toLocaleTimeString()} />
            <Line label="updated" value={new Date(task.updatedAt).toLocaleTimeString()} />
          </dl>
          {task.result ? (
            <pre className="mono mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-black/40 p-3 text-[11.5px] text-white/70">
              {task.result}
            </pre>
          ) : null}
          {cancellable ? (
            <Button
              variant="danger"
              block
              className="mt-3"
              icon="stop"
              onClick={() => runtime.controller.cancelTask(task.id)}
            >
              Cancel task
            </Button>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-white/35">{label}</dt>
      <dd className="truncate text-white/70">{value}</dd>
    </div>
  );
}

function MiniStat({ label, value, tone = "neutral" }: { label: string; value: number; tone?: "neutral" | "accent" | "warn" }) {
  const color = tone === "accent" ? "text-accent-soft" : tone === "warn" ? "text-amber-300" : "text-white";
  return (
    <Panel className="px-3.5 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">{label}</p>
      <p className={`mono mt-1 text-xl font-semibold ${color}`}>{value}</p>
    </Panel>
  );
}

function sessionName(sessions: { id: string; name: string }[], id: string): string {
  return sessions.find((s) => s.id === id)?.name ?? "agent";
}
