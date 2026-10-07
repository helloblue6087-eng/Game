/**
 * End-to-end integration tests.
 *
 * These drive the real protocol: a simulated Gentoo device on one side and a
 * client on the other, exchanging structured frames over the same message flow
 * a live `wss://` connection uses. They cover the full requested path —
 * USER → AI → TOOL → APPROVAL → COMMAND → RESULT → AI → USER — plus the
 * refusal paths that must never execute.
 */

import { afterEach, describe, expect, it } from "vitest";
import { SimulatedTransport } from "../device/mockTransport";
import { VirtualFileSystem } from "../device/virtualFs";
import { DEFAULT_DEVICE } from "../state/bootstrap";
import type { AgentMessage } from "../core/protocol";
import type { ToolCall } from "../core/types";

interface Harness {
  transport: SimulatedTransport;
  seen: AgentMessage[];
}

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function createHarness(): Harness {
  const fs = new VirtualFileSystem(["/home", "/etc", "/var", "/tmp"]);
  const transport = new SimulatedTransport({ ...DEFAULT_DEVICE }, fs);
  const seen: AgentMessage[] = [];
  transport.onMessage((message) => seen.push(message));
  cleanups.push(() => transport.dispose());
  return { transport, seen };
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${label}`);
}

const completed = (seen: AgentMessage[]) => seen.filter((m) => m.type === "agent.message.completed");
const toolOutputs = (seen: AgentMessage[]) =>
  seen.filter((m): m is Extract<AgentMessage, { type: "tool.output" }> => m.type === "tool.output");
const toolCalls = (seen: AgentMessage[]) =>
  seen
    .filter((m): m is Extract<AgentMessage, { type: "agent.tool" }> => m.type === "agent.tool")
    .map((m) => m.toolCall);

async function handshake(harness: Harness): Promise<void> {
  harness.transport.connect();
  await waitFor(() => harness.seen.some((m) => m.type === "server.hello"), "the device handshake");
}

describe("agent loop", () => {
  it("answers a diagnostics question through read-only tools with no approval", async () => {
    const harness = createHarness();
    await handshake(harness);

    harness.transport.send({
      type: "agent.message",
      sessionId: "sess_gentoo_admin",
      message: "Check why my system is using so much RAM.",
    });

    await waitFor(() => completed(harness.seen).length === 1, "the first completed answer");

    const outputs = toolOutputs(harness.seen);
    expect(outputs.length).toBeGreaterThan(0);
    expect(outputs.every((output) => output.exitCode === 0)).toBe(true);

    const plans = harness.seen.filter((m) => m.type === "agent.plan");
    expect(plans.length).toBeGreaterThan(0);

    const memory = outputs.find((output) => output.stdout.includes("MemTotal"));
    expect(memory, "the memory tool should have run").toBeDefined();

    const answer = completed(harness.seen)[0];
    expect(answer.message.role).toBe("assistant");
    expect(answer.message.content.length).toBeGreaterThan(80);
    expect(answer.message.toolCalls?.length).toBeGreaterThan(0);
    expect(answer.message.plan?.length).toBeGreaterThan(0);

    // Read-only work must never prompt.
    expect(harness.seen.some((m) => m.type === "approval.request")).toBe(false);

    const processCall = toolCalls(harness.seen).find((call) => call.tool === "get_processes" && call.status === "ok");
    expect(processCall, "the process listing should have run").toBeDefined();
    expect(processCall?.stdout ?? "").toMatch(/\d+\s+\w+\s+[\d.]+%\s+\d+M/);
  });

  it("routes a service restart through approval, then verifies the result", async () => {
    const harness = createHarness();
    await handshake(harness);

    harness.transport.send({
      type: "agent.message",
      sessionId: "sess_gentoo_admin",
      message: "My PipeWire audio is broken, restart the service.",
    });

    await waitFor(
      () => harness.seen.some((m) => m.type === "approval.request"),
      "an approval request",
    );

    const approvalFrame = harness.seen.find(
      (m): m is Extract<AgentMessage, { type: "approval.request" }> => m.type === "approval.request",
    )!;
    expect(approvalFrame.approval.risk).toBe("HIGH");
    expect(approvalFrame.approval.category).toBe("service");
    expect(approvalFrame.approval.command).toMatch(/rc-service pipewire restart/);

    // Nothing may execute while the request is pending.
    const beforeApproval = toolOutputs(harness.seen).length;
    expect(
      toolOutputs(harness.seen).every((output) => !output.stdout.includes("Starting pipewire")),
    ).toBe(true);

    harness.transport.send({
      type: "approval.decision",
      approvalId: approvalFrame.approval.id,
      decision: "approve_once",
    });

    await waitFor(() => completed(harness.seen).length === 1, "the answer after approval");

    const restart = toolOutputs(harness.seen).find((output) => output.stdout.includes("Starting pipewire"));
    expect(restart, "the restart should have executed").toBeDefined();
    expect(restart?.exitCode).toBe(0);
    expect(toolOutputs(harness.seen).length).toBeGreaterThan(beforeApproval);
    expect(harness.seen.some((m) => m.type === "approval.resolved")).toBe(true);
  });

  it("honours a denial: the command does not run and the turn still completes", async () => {
    const harness = createHarness();
    await handshake(harness);

    harness.transport.send({
      type: "agent.message",
      sessionId: "sess_gentoo_admin",
      message: "Restart the pipewire service for me.",
    });

    await waitFor(() => harness.seen.some((m) => m.type === "approval.request"), "an approval request");
    const approval = harness.seen.find(
      (m): m is Extract<AgentMessage, { type: "approval.request" }> => m.type === "approval.request",
    )!;

    harness.transport.send({ type: "approval.decision", approvalId: approval.approval.id, decision: "deny" });

    await waitFor(() => completed(harness.seen).length === 1, "the answer after denial");

    const denial = toolOutputs(harness.seen).find((output) => output.stderr.includes("Denied by user"));
    expect(denial, "the denial should be reported").toBeDefined();
    expect(denial?.exitCode).toBe(126);
    expect(toolOutputs(harness.seen).every((output) => !output.stdout.includes("Starting pipewire"))).toBe(true);
  });

  it("refuses package installation outright for a READ_ONLY session", async () => {
    const harness = createHarness();
    await handshake(harness);

    harness.transport.send({
      type: "agent.message",
      sessionId: "sess_monitor",
      message: "Install a Wayland screenshot tool.",
    });

    await waitFor(() => completed(harness.seen).length === 1, "the answer for a read-only session");

    const denied = toolOutputs(harness.seen).find((output) =>
      output.stderr.includes("Denied by permission profile"),
    );
    expect(denied, "the package tool must be denied by profile").toBeDefined();
    expect(denied?.exitCode).toBe(126);

    // A deny verdict never produces an approval prompt.
    expect(harness.seen.some((m) => m.type === "approval.request")).toBe(false);
    // And nothing was installed.
    expect(toolOutputs(harness.seen).every((output) => !output.stdout.includes(">>> Emerging"))).toBe(true);
  });
});

describe("device services over the protocol", () => {
  it("streams metrics snapshots on subscribe and stops on unsubscribe", async () => {
    const harness = createHarness();
    await handshake(harness);

    harness.transport.send({ type: "metrics.subscribe", intervalMs: 500 });
    await waitFor(
      () => harness.seen.filter((m) => m.type === "metrics.snapshot").length >= 2,
      "two metrics samples",
    );

    const snapshot = harness.seen.find(
      (m): m is Extract<AgentMessage, { type: "metrics.snapshot" }> => m.type === "metrics.snapshot",
    )!;
    expect(snapshot.snapshot.cpu.perCore.length).toBeGreaterThan(0);
    expect(snapshot.snapshot.memory.totalMb).toBeGreaterThan(0);
    expect(snapshot.snapshot.disk.length).toBeGreaterThan(0);
    expect(snapshot.snapshot.temps.length).toBeGreaterThan(0);

    harness.transport.send({ type: "metrics.unsubscribe" });
    const count = harness.seen.filter((m) => m.type === "metrics.snapshot").length;
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(harness.seen.filter((m) => m.type === "metrics.snapshot").length).toBe(count);
  });

  it("lists files and rejects traversal outside the allowed roots", async () => {
    const harness = createHarness();
    await handshake(harness);

    harness.transport.send({ type: "fs.list", requestId: "r1", path: "/home/blue", showHidden: false });
    await waitFor(
      () => harness.seen.some((m) => m.type === "fs.list.result" && m.requestId === "r1"),
      "a directory listing",
    );
    const listing = harness.seen.find(
      (m): m is Extract<AgentMessage, { type: "fs.list.result" }> => m.type === "fs.list.result",
    )!;
    expect(listing.entries.some((entry) => entry.name === "projects")).toBe(true);
    expect(listing.entries.every((entry) => entry.hidden === false)).toBe(true);

    // `/root` is outside the configured roots, so the device must refuse it.
    harness.transport.send({ type: "fs.write", requestId: "r2", path: "/root/.ssh/authorized_keys", content: "x" });
    await waitFor(
      () => harness.seen.some((m) => m.type === "fs.ack" && m.requestId === "r2"),
      "the refusal",
    );
    const refusal = harness.seen.find(
      (m): m is Extract<AgentMessage, { type: "fs.ack" }> => m.type === "fs.ack" && m.requestId === "r2",
    )!;
    expect(refusal.ok).toBe(false);
    expect(refusal.message).toMatch(/outside the allowed roots/);
  });

  it("serves terminal output and echoes shell interaction", async () => {
    const harness = createHarness();
    await handshake(harness);

    harness.transport.send({ type: "terminal.open", terminalId: "t1", shell: "/bin/zsh", tmuxSession: "gentoo" });
    await waitFor(
      () => harness.seen.some((m) => m.type === "terminal.output" && m.terminalId === "t1"),
      "terminal banner output",
    );

    harness.transport.send({ type: "terminal.input", terminalId: "t1", data: "whoami\r" });
    await waitFor(() => {
      const output = harness.seen
        .filter((m): m is Extract<AgentMessage, { type: "terminal.output" }> => m.type === "terminal.output")
        .map((m) => m.data)
        .join("");
      return output.includes("blue");
    }, "the shell response");
  });

  it("records audit log entries for executed commands", async () => {
    const harness = createHarness();
    await handshake(harness);

    harness.transport.send({ type: "svc.list", requestId: "s1" });
    await waitFor(() => harness.seen.some((m) => m.type === "svc.list.result"), "service data");

    const services = harness.seen.find(
      (m): m is Extract<AgentMessage, { type: "svc.list.result" }> => m.type === "svc.list.result",
    )!;
    expect(services.services.some((service) => service.name === "pipewire")).toBe(true);

    harness.transport.send({ type: "svc.action", requestId: "s2", name: "pipewire", action: "restart" });
    await waitFor(
      () => harness.seen.some((m) => m.type === "log.append" && m.entry.source === "command"),
      "an audit entry",
    );
    const audit = harness.seen.find((m) => m.type === "log.append")!;
    expect(audit.type).toBe("log.append");
  });

  it("tracks a task for every agent turn", async () => {
    const harness = createHarness();
    await handshake(harness);

    harness.transport.send({ type: "agent.message", sessionId: "sess_debug", message: "How is CPU load looking?" });
    await waitFor(() => completed(harness.seen).length === 1, "the answer");

    const tasks = harness.seen
      .filter((m): m is Extract<AgentMessage, { type: "task.updated" }> => m.type === "task.updated")
      .map((m) => m.task);
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks[tasks.length - 1].status).toBe("COMPLETED");
  });
});

describe("tool call metadata", () => {
  it("grades every tool call and reports exit codes", async () => {
    const harness = createHarness();
    await handshake(harness);

    harness.transport.send({ type: "agent.message", sessionId: "sess_gentoo_admin", message: "Is my root disk full?" });
    await waitFor(() => completed(harness.seen).length === 1, "the answer");

    const calls: ToolCall[] = toolCalls(harness.seen);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).toContain(call.risk);
      expect(call.category).toBeTruthy();
      expect(call.status).not.toBe("pending");
    }
    const finished = calls.filter((call) => call.status === "ok");
    expect(finished.length).toBeGreaterThan(0);
    expect(finished.every((call) => call.exitCode === 0)).toBe(true);
  });
});
