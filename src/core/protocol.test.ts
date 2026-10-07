import { describe, expect, it } from "vitest";
import { decode, encode, PROTOCOL_VERSION } from "./protocol";
import type { AgentMessage, ClientMessage } from "./protocol";
import { backoffDelay, mapLegacyMessage } from "./transport";

describe("protocol codec", () => {
  it("round-trips a client frame", () => {
    const frame: ClientMessage = { type: "agent.message", sessionId: "s1", message: "hi" };
    expect(decode<AgentMessage>(encode(frame) as unknown as string)).toEqual(frame as never);
  });

  it("round-trips an agent frame with nested payloads", () => {
    const frame: AgentMessage = {
      type: "approval.request",
      approval: {
        id: "a1",
        sessionId: "s1",
        command: "sudo emerge --ask app-editors/neovim",
        cwd: "/home/blue",
        user: "blue",
        risk: "HIGH",
        reason: "installs a package",
        category: "package",
        createdAt: 1,
        irreversible: false,
      },
    };
    expect(decode<AgentMessage>(encode(frame))).toEqual(frame);
  });

  it("rejects frames without a discriminator", () => {
    expect(() => decode("{}")).toThrow(/discriminator/);
    expect(() => decode("null")).toThrow(/discriminator/);
    expect(() => decode("not json")).toThrow();
  });

  it("exposes a protocol version for the handshake", () => {
    expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(2);
  });
});

describe("ExistingWebSocketAdapter compatibility", () => {
  it("maps legacy type names onto v2 events", () => {
    const legacy = { type: "agent.delta", sessionId: "s1", messageId: "m1", content: "hello" } as unknown as AgentMessage;
    expect(mapLegacyMessage(legacy).type).toBe("agent.message.delta");
  });

  it("passes already-correct frames through unchanged", () => {
    const frame = { type: "server.pong", at: 1, serverTime: 2 } as AgentMessage;
    expect(mapLegacyMessage(frame)).toBe(frame);
  });
});

describe("reconnect backoff", () => {
  it("grows with attempts and stays bounded", () => {
    const delays = [0, 1, 2, 3, 4, 8, 20].map((attempt) => backoffDelay(attempt, () => 1));
    for (const delay of delays) {
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThanOrEqual(15_000);
    }
    expect(delays[1]).toBeGreaterThan(delays[0]);
    expect(delays[3]).toBeGreaterThan(delays[1]);
    expect(delays[6]).toBe(15_000);
  });

  it("applies jitter so clients do not reconnect in lockstep", () => {
    const low = backoffDelay(3, () => 0);
    const high = backoffDelay(3, () => 1);
    expect(low).toBeLessThan(high);
  });
});
