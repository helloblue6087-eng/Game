/**
 * Approval center.
 *
 * One place for every pending request, regardless of which session produced it.
 * The available actions depend on how dangerous the operation is: CRITICAL
 * operations can only be denied or approved once — session-wide approval is
 * never offered for something irreversible.
 */

import { useState } from "react";
import { Icon } from "../components/Icon";
import { Badge, Button, EmptyState, Panel, RiskBadge, SectionHeader, timeAgo } from "../components/ui";
import { chatStore, logStore, useStore } from "../state/store";
import { runtime } from "../state/bootstrap";

const RISK_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;

export function ApprovalsPage() {
  const chat = useStore(chatStore);
  const logs = useStore(logStore);
  const [busy, setBusy] = useState<string | null>(null);

  const approvals = [...chat.approvals].sort(
    (a, b) => RISK_ORDER.indexOf(a.risk) - RISK_ORDER.indexOf(b.risk) || b.createdAt - a.createdAt,
  );

  const auditTrail = logs.entries
    .filter((entry) => entry.source === "audit" || entry.severity === "warn" || entry.severity === "error")
    .slice(-12)
    .reverse();

  const decide = (id: string, decision: "deny" | "approve_once" | "approve_session") => {
    setBusy(id);
    runtime.controller.decideApproval(id, decision);
    setTimeout(() => setBusy(null), 400);
  };

  return (
    <div className="space-y-4">
      <Panel className="border-accent/20 bg-accent/[0.06] p-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-accent/35 bg-accent/12 text-accent-soft">
            <Icon name="shieldCheck" className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[13.5px] font-semibold text-white">Nothing runs without a verdict</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-white/60">
              Every command is parsed, classified LOW → CRITICAL and checked against the session's
              permission profile. Commands it cannot justify are denied before they reach the shell,
              and everything that does run is appended to the audit trail.
            </p>
          </div>
        </div>
      </Panel>

      <div>
        <SectionHeader
          title="Pending"
          icon="bell"
          subtitle={
            approvals.length ? `${approvals.length} request${approvals.length > 1 ? "s" : ""} waiting` : undefined
          }
        />
        {approvals.length === 0 ? (
          <EmptyState
            icon="check"
            title="No pending approvals"
            description="When an agent wants to install a package, restart a service or touch something irreversible, the request appears here."
          />
        ) : (
          <div className="space-y-3">
            {approvals.map((approval) => (
              <Panel key={approval.id} className="overflow-hidden">
                <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <RiskBadge level={approval.risk} />
                    <Badge tone="neutral">{approval.category.replace("_", " ")}</Badge>
                  </div>
                  <span className="mono text-[11px] text-white/35">{timeAgo(approval.createdAt)} ago</span>
                </div>

                <div className="px-4 py-3">
                  <pre className="mono overflow-x-auto rounded-xl border border-white/10 bg-black/45 p-3 text-[12.5px] text-accent-soft">
                    <code>{approval.command}</code>
                  </pre>
                  <dl className="mono mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-white/45">
                    <div className="flex justify-between gap-2">
                      <dt>session</dt>
                      <dd className="truncate text-white/70">{approval.sessionId}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>cwd</dt>
                      <dd className="truncate text-white/70">{approval.cwd}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>user</dt>
                      <dd className="text-white/70">{approval.user}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>risk</dt>
                      <dd className="text-white/70">{approval.risk}</dd>
                    </div>
                  </dl>
                  <p className="mt-3 text-[12.5px] text-white/65">
                    <span className="text-white/45">Reason: </span>
                    {approval.reason}
                  </p>
                </div>

                <div className="flex flex-col gap-2 border-t border-white/[0.06] px-4 py-3 sm:flex-row-reverse">
                  <Button
                    variant="primary"
                    block
                    icon="check"
                    disabled={busy === approval.id}
                    onClick={() => decide(approval.id, "approve_once")}
                  >
                    Approve once
                  </Button>
                  <Button variant="danger" block icon="close" onClick={() => decide(approval.id, "deny")}>
                    Deny
                  </Button>
                  {approval.risk === "CRITICAL" ? (
                    <p className="flex flex-1 items-center gap-2 text-[12px] text-rose-200/85">
                      <Icon name="lock" className="h-4 w-4" />
                      Irreversible — no session-wide approval.
                    </p>
                  ) : (
                    <Button
                      variant="ghost"
                      block
                      disabled={busy === approval.id}
                      onClick={() => decide(approval.id, "approve_session")}
                    >
                      Approve for session
                    </Button>
                  )}
                </div>
              </Panel>
            ))}
          </div>
        )}
      </div>

      <div>
        <SectionHeader title="Audit trail" icon="list" subtitle="warnings, errors and permission decisions" />
        <Panel className="divide-y divide-white/[0.05]">
          {auditTrail.length === 0 ? (
            <p className="px-4 py-4 text-sm text-white/45">No audit events yet.</p>
          ) : (
            auditTrail.map((entry) => (
              <div key={entry.id} className="flex items-start gap-3 px-4 py-2.5">
                <span
                  className={`mono mt-0.5 shrink-0 text-[10px] font-semibold uppercase ${
                    entry.severity === "error"
                      ? "text-rose-300"
                      : entry.severity === "warn"
                        ? "text-amber-300"
                        : "text-white/35"
                  }`}
                >
                  {entry.severity}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] text-white/75">{entry.message}</p>
                  <p className="mono text-[10.5px] text-white/30">
                    {entry.source} · {new Date(entry.timestamp).toLocaleTimeString()}
                  </p>
                </div>
              </div>
            ))
          )}
        </Panel>
      </div>
    </div>
  );
}
