/**
 * Application shell.
 *
 * Mobile (<768px): a compact 52px top bar, a 5-slot bottom navigation with
 * safe-area padding, and full-height content. Desktop: a fixed sidebar with
 * the full navigation tree and a wider content column. A live connection
 * banner sits above the content whenever the link is not healthy.
 */

import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { Badge, StatusDot } from "./ui";
import { chatStore, connectionStore, useStore } from "../state/store";

export type RouteId =
  | "home"
  | "agent"
  | "terminal"
  | "control"
  | "files"
  | "monitor"
  | "logs"
  | "approvals"
  | "tasks"
  | "sessions"
  | "devices"
  | "security"
  | "settings"
  | "more";

export interface NavItem {
  id: RouteId;
  label: string;
  icon: IconName;
  group: "primary" | "console" | "system";
  mobile?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { id: "home", label: "Home", icon: "home", group: "primary", mobile: true },
  { id: "agent", label: "Agent", icon: "agent", group: "primary", mobile: true },
  { id: "terminal", label: "Terminal", icon: "terminal", group: "primary", mobile: true },
  { id: "control", label: "PC Control", icon: "pc", group: "primary", mobile: true },
  { id: "more", label: "More", icon: "more", group: "primary", mobile: true },
  { id: "files", label: "Files", icon: "folder", group: "console" },
  { id: "monitor", label: "Monitor", icon: "activity", group: "console" },
  { id: "logs", label: "Logs", icon: "list", group: "console" },
  { id: "approvals", label: "Approvals", icon: "shield", group: "system" },
  { id: "tasks", label: "Tasks", icon: "clock", group: "system" },
  { id: "sessions", label: "Sessions", icon: "devices", group: "system" },
  { id: "devices", label: "Devices", icon: "pc", group: "system" },
  { id: "security", label: "Security", icon: "lock", group: "system" },
  { id: "settings", label: "Settings", icon: "settings", group: "system" },
];

const GROUP_LABELS: Record<NavItem["group"], string> = {
  primary: "Console",
  console: "System console",
  system: "Administration",
};

interface ShellProps {
  route: RouteId;
  onNavigate: (route: RouteId) => void;
  children: ReactNode;
  title: string;
  subtitle?: string;
  headerActions?: ReactNode;
}

function connectionTone(status: string): "ok" | "warn" | "danger" | "idle" {
  switch (status) {
    case "CONNECTED":
      return "ok";
    case "AUTHENTICATING":
      return "warn";
    case "RECONNECTING":
      return "warn";
    default:
      return "danger";
  }
}

export function Shell({ route, onNavigate, children, title, subtitle, headerActions }: ShellProps) {
  const connection = useStore(connectionStore);
  const chat = useStore(chatStore);
  const pendingApprovals = chat.approvals.length;
  const unread = Object.values(chat.unread).reduce((sum, value) => sum + value, 0);

  const badgeFor = (id: RouteId): number => {
    if (id === "approvals") return pendingApprovals;
    if (id === "agent") return unread;
    return 0;
  };

  const statusLabel =
    connection.status === "CONNECTED"
      ? "ONLINE"
      : connection.status === "AUTHENTICATING"
        ? "AUTH"
        : connection.status === "RECONNECTING"
          ? "RETRY"
          : "OFFLINE";

  return (
    <div className="flex min-h-full">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-white/[0.06] bg-black/25 backdrop-blur-xl lg:flex">
        <div className="px-5 py-5">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-accent/40 bg-accent/15 text-accent-soft">
              <Icon name="terminal" className="h-[18px] w-[18px]" />
            </span>
            <div className="leading-tight">
              <p className="text-[13px] font-semibold tracking-tight text-white">
                Gentoo Agent
              </p>
              <p className="mono text-[10px] uppercase tracking-[0.2em] text-accent-soft/80">
                control center
              </p>
            </div>
          </div>
        </div>

        <nav className="scroll-area flex-1 overflow-y-auto px-3 pb-4">
          {(["primary", "console", "system"] as const).map((group) => (
            <div key={group} className="mb-4">
              <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/30">
                {GROUP_LABELS[group]}
              </p>
              <div className="space-y-0.5">
                {NAV_ITEMS.filter((item) => item.group === group).map((item) => {
                  const active = route === item.id;
                  const badge = badgeFor(item.id);
                  return (
                    <button
                      key={item.id}
                      onClick={() => onNavigate(item.id)}
                      className={`group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-sm font-medium transition-colors ${
                        active
                          ? "bg-accent/15 text-white shadow-[inset_0_0_0_1px_rgba(160,107,255,0.28)]"
                          : "text-white/60 hover:bg-white/[0.05] hover:text-white/90"
                      }`}
                    >
                      <Icon
                        name={item.icon}
                        className={`h-[18px] w-[18px] ${active ? "text-accent-soft" : "text-white/45 group-hover:text-white/70"}`}
                      />
                      <span className="flex-1 text-left">{item.label}</span>
                      {badge > 0 ? (
                        <span className="mono rounded-full bg-accent/30 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                          {badge}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-white/[0.06] px-4 py-3.5">
          <div className="flex items-center gap-2">
            <StatusDot tone={connectionTone(connection.status)} pulse={connection.status === "CONNECTED"} />
            <span className="mono text-[11px] font-semibold tracking-widest text-white/70">
              {statusLabel}
            </span>
            {connection.meta.latencyMs !== null ? (
              <span className="mono ml-auto text-[11px] text-white/40">{connection.meta.latencyMs}ms</span>
            ) : null}
          </div>
          <p className="mono mt-1 truncate text-[11px] text-white/35">
            {connection.device?.hostname ?? "unpaired"} · {connection.device?.init ?? "—"}
          </p>
          {connection.transportKind === "simulated" ? (
            <p className="mt-2 rounded-lg border border-amber-400/20 bg-amber-500/10 px-2 py-1 text-[10px] font-medium text-amber-200/90">
              SIMULATED DEVICE
            </p>
          ) : null}
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="safe-top sticky top-0 z-30 border-b border-white/[0.06] bg-[rgb(var(--bg))]/85 backdrop-blur-xl">
          <div className="flex items-center gap-3 px-4 py-2.5 lg:px-7 lg:py-4">
            <div className="flex items-center gap-2 lg:hidden">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-accent/40 bg-accent/15 text-accent-soft">
                <Icon name="terminal" className="h-4 w-4" />
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[15px] font-semibold leading-tight text-white lg:text-lg">
                {title}
              </h1>
              {subtitle ? (
                <p className="mono truncate text-[11px] text-white/40">{subtitle}</p>
              ) : null}
            </div>
            <div className="lg:hidden">
              <StatusDot tone={connectionTone(connection.status)} pulse={connection.status === "CONNECTED"} />
            </div>
            {headerActions}
          </div>
          <ConnectionBanner />
        </header>

        <main className="flex-1 px-4 pb-24 pt-4 lg:px-7 lg:pb-8 lg:pt-6">
          <div className="mx-auto w-full max-w-5xl">{children}</div>
        </main>

        {/* Mobile bottom navigation */}
        <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.07] bg-[rgb(var(--panel))]/95 backdrop-blur-xl lg:hidden">
          <div className="grid grid-cols-5">
            {NAV_ITEMS.filter((item) => item.mobile).map((item) => {
              const active = route === item.id || (item.id === "more" && !NAV_ITEMS.some((n) => n.mobile && n.id === route));
              const badge = badgeFor(item.id);
              return (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                  aria-current={active ? "page" : undefined}
                  className={`relative flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-semibold tracking-wide transition-colors ${
                    active ? "text-accent-soft" : "text-white/45"
                  }`}
                >
                  {active ? (
                    <span className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-accent" />
                  ) : null}
                  <Icon name={item.icon} className="h-[19px] w-[19px]" />
                  <span>{item.label.split(" ")[0]}</span>
                  {badge > 0 ? (
                    <span className="absolute right-[22%] top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold text-white">
                      {badge > 9 ? "9+" : badge}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}

function ConnectionBanner() {
  const connection = useStore(connectionStore);
  if (connection.status === "CONNECTED") return null;

  const detail =
    connection.status === "RECONNECTING"
      ? `Reconnecting to ${connection.meta.route || "the device"} — attempt ${connection.meta.attempt}${
          connection.meta.nextRetryMs ? `, next in ${Math.round(connection.meta.nextRetryMs / 100) / 10}s` : ""
        }.`
      : connection.status === "AUTHENTICATING"
        ? "Authenticating with the Gentoo agent…"
        : "The console is offline. Cached information is still readable; remote actions are paused.";

  return (
    <div
      className={`flex items-center gap-2 border-t px-4 py-2 text-[12px] lg:px-7 ${
        connection.status === "AUTHENTICATING"
          ? "border-amber-400/20 bg-amber-500/10 text-amber-100"
          : "border-rose-400/20 bg-rose-500/10 text-rose-100"
      }`}
    >
      <Icon name="offline" className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{detail}</span>
      <Badge tone={connection.status === "AUTHENTICATING" ? "warn" : "danger"} className="hidden sm:inline-flex">
        {connection.status}
      </Badge>
    </div>
  );
}
