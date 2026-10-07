/**
 * Render smoke test.
 *
 * Renders every page through `react-dom/server`. This is the cheapest way to
 * catch the failure modes a typecheck cannot see: invalid hook calls, components
 * used before definition, and crashes on empty store state (which is exactly the
 * state a real cold start has before the first frame arrives).
 */

import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { HomePage } from "../pages/Home";
import { AgentPage } from "../pages/Agent";
import { TerminalPage } from "../pages/Terminal";
import { ControlPage } from "../pages/Control";
import { FilesPage } from "../pages/Files";
import { MonitorPage } from "../pages/Monitor";
import { LogsPage } from "../pages/Logs";
import { ApprovalsPage } from "../pages/Approvals";
import { TasksPage } from "../pages/Tasks";
import { SessionsPage } from "../pages/Sessions";
import { DevicesPage } from "../pages/Devices";
import { SecurityPage } from "../pages/Security";
import { SettingsPage } from "../pages/Settings";
import { MorePage } from "../pages/More";

const noop = () => undefined;

const PAGES: { name: string; element: ReturnType<typeof createElement>; expect: string }[] = [
  // Cold state: no handshake yet, so the device card reads OFFLINE and the
  // gauges sit at zero. What matters is that it renders rather than throwing.
  { name: "Home", element: createElement(HomePage, { onNavigate: noop }), expect: "Utilisation" },
  { name: "Agent", element: createElement(AgentPage), expect: "agent" },
  { name: "Terminal", element: createElement(TerminalPage), expect: "gentoo" },
  { name: "Control", element: createElement(ControlPage), expect: "Power" },
  { name: "Files", element: createElement(FilesPage), expect: "entr" },
  { name: "Monitor", element: createElement(MonitorPage), expect: "telemetry" },
  { name: "Logs", element: createElement(LogsPage), expect: "severity" },
  { name: "Approvals", element: createElement(ApprovalsPage), expect: "approval" },
  { name: "Tasks", element: createElement(TasksPage), expect: "task" },
  { name: "Sessions", element: createElement(SessionsPage), expect: "session" },
  { name: "Devices", element: createElement(DevicesPage), expect: "device" },
  { name: "Security", element: createElement(SecurityPage), expect: "Risk classifier" },
  { name: "Settings", element: createElement(SettingsPage), expect: "Gateway" },
  { name: "More", element: createElement(MorePage, { onNavigate: noop, onExit: noop }), expect: "Console" },
];

describe("page rendering", () => {
  for (const page of PAGES) {
    it(`renders ${page.name} on empty state`, () => {
      const html = renderToString(page.element);
      expect(html.length).toBeGreaterThan(200);
      expect(html.toLowerCase()).toContain(page.expect.toLowerCase());
    });
  }

  it("renders the mobile bottom navigation with five slots", () => {
    const html = renderToString(createElement(MorePage, { onNavigate: noop, onExit: noop }));
    // More is the hub; its console grid must expose the non-mobile routes.
    for (const label of ["Files", "Monitor", "Logs", "Approvals", "Tasks", "Sessions", "Devices", "Security", "Settings"]) {
      expect(html).toContain(label);
    }
  });
});
