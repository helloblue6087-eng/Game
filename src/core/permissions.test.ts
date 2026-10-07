import { describe, expect, it } from "vitest";
import { ApprovalGrantStore, evaluatePermission, PROFILES } from "./permissions";

describe("evaluatePermission", () => {
  it("allows read-only inspection for every profile", () => {
    for (const profile of ["READ_ONLY", "STANDARD", "ADMIN", "DANGEROUS"] as const) {
      const decision = evaluatePermission(profile, "read", "free -m");
      expect(decision.verdict, profile).toBe("allow");
    }
  });

  it("denies writes outright for READ_ONLY", () => {
    expect(evaluatePermission("READ_ONLY", "filesystem_write", "tee /home/blue/x").verdict).toBe("deny");
    expect(evaluatePermission("READ_ONLY", "package", "sudo emerge --ask app-editors/neovim").verdict).toBe("deny");
    expect(evaluatePermission("READ_ONLY", "shell", "ls -la").verdict).toBe("deny");
  });

  it("asks for confirmation on package and service changes", () => {
    expect(evaluatePermission("STANDARD", "package", "sudo emerge --ask app-editors/neovim").verdict).toBe("confirm");
    expect(evaluatePermission("ADMIN", "service", "sudo rc-service pipewire restart").verdict).toBe("confirm");
  });

  it("allows ordinary file writes under STANDARD", () => {
    expect(evaluatePermission("STANDARD", "filesystem_write", "tee /home/blue/notes.md").verdict).toBe("allow");
  });

  it("always confirms CRITICAL operations regardless of profile", () => {
    for (const profile of ["STANDARD", "ADMIN", "DANGEROUS"] as const) {
      const decision = evaluatePermission(profile, "shell", "rm -rf /home/blue");
      expect(decision.verdict, profile).toBe("confirm");
      expect(decision.risk).toBe("CRITICAL");
      expect(decision.allowSessionApproval).toBe(false);
    }
  });

  it("never auto-approves anything for the DANGEROUS profile", () => {
    expect(evaluatePermission("DANGEROUS", "filesystem_write", "tee /home/blue/notes.md").verdict).toBe("confirm");
    expect(evaluatePermission("DANGEROUS", "power", "systemctl reboot").verdict).toBe("confirm");
  });

  it("explains every verdict", () => {
    expect(evaluatePermission("READ_ONLY", "package", "emerge x").reason).toMatch(/does not permit/i);
    expect(evaluatePermission("ADMIN", "shell", "rm -rf /").reason).toMatch(/delete|irreversible|approved/i);
  });

  it("describes each profile fully", () => {
    for (const profile of Object.values(PROFILES)) {
      expect(profile.summary.length).toBeGreaterThan(20);
      expect(Object.keys(profile.categories)).toHaveLength(9);
    }
  });
});

describe("ApprovalGrantStore", () => {
  it("grants and reports session approvals per category", () => {
    const grants = new ApprovalGrantStore();
    expect(grants.has("s1", "service")).toBe(false);
    grants.grant("s1", "service");
    expect(grants.has("s1", "service")).toBe(true);
    expect(grants.has("s1", "package")).toBe(false);
    expect(grants.has("s2", "service")).toBe(false);
  });

  it("expires grants", async () => {
    const grants = new ApprovalGrantStore();
    grants.grant("s1", "package", 1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(grants.has("s1", "package")).toBe(false);
  });

  it("revokes per session", () => {
    const grants = new ApprovalGrantStore();
    grants.grant("s1", "service");
    grants.grant("s1", "package");
    grants.grant("s2", "service");
    grants.revokeAll("s1");
    expect(grants.has("s1", "service")).toBe(false);
    expect(grants.has("s1", "package")).toBe(false);
    expect(grants.has("s2", "service")).toBe(true);
  });
});
