/**
 * Application root.
 *
 * Owns the two top-level experiences: the connection gate (first run / offline
 * landing) and the console shell. Routing is hash-based so deep links survive a
 * reload and the browser back button behaves, without pulling in a router
 * dependency.
 */

import { useCallback, useEffect, useState } from "react";
import { Shell, type RouteId } from "./components/Shell";
import { Connect } from "./pages/Connect";
import { HomePage } from "./pages/Home";
import { AgentPage } from "./pages/Agent";
import { TerminalPage } from "./pages/Terminal";
import { ControlPage } from "./pages/Control";
import { FilesPage } from "./pages/Files";
import { MonitorPage } from "./pages/Monitor";
import { LogsPage } from "./pages/Logs";
import { ApprovalsPage } from "./pages/Approvals";
import { TasksPage } from "./pages/Tasks";
import { SessionsPage } from "./pages/Sessions";
import { DevicesPage } from "./pages/Devices";
import { SecurityPage } from "./pages/Security";
import { SettingsPage } from "./pages/Settings";
import { MorePage } from "./pages/More";
import { runtime } from "./state/bootstrap";
import { chatStore, connectionStore, useStore } from "./state/store";

const ROUTES: RouteId[] = [
  "home",
  "agent",
  "terminal",
  "control",
  "files",
  "monitor",
  "logs",
  "approvals",
  "tasks",
  "sessions",
  "devices",
  "security",
  "settings",
  "more",
];

const TITLES: Record<RouteId, { title: string; subtitle?: string }> = {
  home: { title: "Home", subtitle: "live system state" },
  agent: { title: "AI Agent" },
  terminal: { title: "Terminal", subtitle: "pty · tmux" },
  control: { title: "PC Control", subtitle: "power · services · processes" },
  files: { title: "Files", subtitle: "browse and edit" },
  monitor: { title: "Monitor", subtitle: "real-time sampling" },
  logs: { title: "Logs", subtitle: "streaming activity" },
  approvals: { title: "Approvals", subtitle: "permission center" },
  tasks: { title: "Tasks", subtitle: "long running work" },
  sessions: { title: "Agent sessions" },
  devices: { title: "Devices", subtitle: "target selection" },
  security: { title: "Security", subtitle: "permissions and audit" },
  settings: { title: "Settings" },
  more: { title: "More" },
};

function parseHash(): RouteId {
  const raw = window.location.hash.replace(/^#\/?/, "").split("?")[0];
  return (ROUTES.find((route) => route === raw) ?? "home") as RouteId;
}

let bootstrapped = false;

export default function App() {
  const connection = useStore(connectionStore);
  const chat = useStore(chatStore);
  const [route, setRoute] = useState<RouteId>(() => parseHash());
  const [entered, setEntered] = useState(() => parseHash() !== "home" || sessionStorage.getItem("gacc.entered") === "1");

  useEffect(() => {
    if (bootstrapped) return;
    bootstrapped = true;
    runtime.controller.connect();
  }, []);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const navigate = useCallback((next: RouteId) => {
    setRoute(next);
    window.location.hash = `#/${next}`;
    sessionStorage.setItem("gacc.entered", "1");
  }, []);

  const enter = useCallback(() => {
    setEntered(true);
    sessionStorage.setItem("gacc.entered", "1");
  }, []);

  if (!entered) {
    return <Connect onEnter={enter} />;
  }

  const meta = TITLES[route];
  const pendingApprovals = chat.approvals.length;

  return (
    <Shell
      route={route}
      onNavigate={navigate}
      title={meta.title}
      subtitle={route === "home" ? `${connection.device?.hostname ?? "unpaired"} · ${meta.subtitle ?? ""}` : meta.subtitle}
      headerActions={
        pendingApprovals > 0 && route !== "approvals" ? (
          <button
            onClick={() => navigate("approvals")}
            className="flex items-center gap-1.5 rounded-xl border border-amber-400/30 bg-amber-500/15 px-2.5 py-1.5 text-[11px] font-semibold text-amber-100"
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-amber-400" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
            </span>
            {pendingApprovals} pending
          </button>
        ) : null
      }
    >
      {renderRoute(route, navigate, enter)}
    </Shell>
  );
}

function renderRoute(route: RouteId, navigate: (route: RouteId) => void, enter: () => void) {
  switch (route) {
    case "agent":
      return <AgentPage />;
    case "terminal":
      return <TerminalPage />;
    case "control":
      return <ControlPage />;
    case "files":
      return <FilesPage />;
    case "monitor":
      return <MonitorPage />;
    case "logs":
      return <LogsPage />;
    case "approvals":
      return <ApprovalsPage />;
    case "tasks":
      return <TasksPage />;
    case "sessions":
      return <SessionsPage />;
    case "devices":
      return <DevicesPage />;
    case "security":
      return <SecurityPage />;
    case "settings":
      return <SettingsPage />;
    case "more":
      return <MorePage onNavigate={navigate} onExit={enter} />;
    case "home":
    default:
      return <HomePage onNavigate={navigate} />;
  }
}
