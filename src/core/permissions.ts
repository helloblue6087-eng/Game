/**
 * Permission profiles.
 *
 * A profile decides, per tool category, whether an agent may run an action
 * freely, must ask the user first, or is denied outright. Combined with the
 * risk classifier this forms the single chokepoint that the agent loop and the
 * remote-control panels both go through.
 */

import { classifyCommand } from "./risk";
import type {
  PermissionProfile,
  PermissionVerdict,
  RiskLevel,
  ToolCategory,
} from "./types";

type CategoryPolicy = "allow" | "confirm" | "deny";

export interface ProfilePolicy {
  id: PermissionProfile;
  label: string;
  summary: string;
  categories: Record<ToolCategory, CategoryPolicy>;
  /** Risk levels that always require explicit approval for this profile. */
  confirmAtOrAbove: RiskLevel;
}

const ALL_CATEGORIES: ToolCategory[] = [
  "read",
  "filesystem_write",
  "process",
  "service",
  "package",
  "network",
  "power",
  "shell",
  "admin",
];

const RISK_ORDER: RiskLevel[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

function policy(
  overrides: Partial<Record<ToolCategory, CategoryPolicy>>,
  fallback: CategoryPolicy = "deny",
): Record<ToolCategory, CategoryPolicy> {
  const result = {} as Record<ToolCategory, CategoryPolicy>;
  for (const category of ALL_CATEGORIES) {
    result[category] = overrides[category] ?? fallback;
  }
  return result;
}

export const PROFILES: Record<PermissionProfile, ProfilePolicy> = {
  READ_ONLY: {
    id: "READ_ONLY",
    label: "Read only",
    summary:
      "Inspection only. No writes, no package operations, no service or power changes.",
    categories: policy({ read: "allow", network: "allow" }, "deny"),
    confirmAtOrAbove: "HIGH",
  },
  STANDARD: {
    id: "STANDARD",
    label: "Standard",
    summary:
      "Read, project file writes and controlled commands. Installs and service changes ask first.",
    categories: policy(
      {
        read: "allow",
        network: "allow",
        filesystem_write: "allow",
        process: "confirm",
        shell: "confirm",
        service: "confirm",
        package: "confirm",
      },
      "deny",
    ),
    // Ordinary project file writes are permitted without a prompt; anything the
    // classifier escalates to HIGH still asks.
    confirmAtOrAbove: "HIGH",
  },
  ADMIN: {
    id: "ADMIN",
    label: "Admin",
    summary:
      "Broad control including packages and services, but every risky action still needs approval.",
    categories: policy(
      {
        read: "allow",
        network: "allow",
        filesystem_write: "allow",
        process: "confirm",
        shell: "confirm",
        service: "confirm",
        package: "confirm",
        power: "confirm",
      },
      "deny",
    ),
    confirmAtOrAbove: "HIGH",
  },
  DANGEROUS: {
    id: "DANGEROUS",
    label: "Dangerous",
    summary:
      "Never auto-executes. Every mutating category requires explicit, single-use approval.",
    categories: policy(
      {
        read: "allow",
        network: "allow",
        filesystem_write: "confirm",
        process: "confirm",
        shell: "confirm",
        service: "confirm",
        package: "confirm",
        power: "confirm",
        admin: "confirm",
      },
      "confirm",
    ),
    // Inspection stays frictionless; every mutating category above is an
    // explicit `confirm`, so nothing an agent does here runs unattended.
    confirmAtOrAbove: "HIGH",
  },
};

export interface PermissionDecision {
  verdict: PermissionVerdict;
  risk: RiskLevel;
  reason: string;
  /** CRITICAL operations can only be approved once and never for a session. */
  allowSessionApproval: boolean;
}

export function evaluatePermission(
  profile: PermissionProfile,
  category: ToolCategory,
  rawCommand: string,
): PermissionDecision {
  const policyForProfile = PROFILES[profile];
  const classification = classifyCommand(rawCommand);
  const base = policyForProfile.categories[category];

  if (base === "deny") {
    return {
      verdict: "deny",
      risk: classification.level,
      reason: `Profile ${policyForProfile.label} does not permit ${category.replace("_", " ")} actions.`,
      allowSessionApproval: false,
    };
  }

  const riskAtOrAbove =
    RISK_ORDER.indexOf(classification.level) >=
    RISK_ORDER.indexOf(policyForProfile.confirmAtOrAbove);

  if (classification.level === "CRITICAL") {
    return {
      verdict: "confirm",
      risk: classification.level,
      reason:
        classification.reasons.join(". ") ||
        "Irreversible operation requires approval.",
      allowSessionApproval: false,
    };
  }

  if (base === "confirm" || riskAtOrAbove) {
    // CRITICAL already returned above, so anything reaching here may be
    // granted for the rest of the session.
    return {
      verdict: "confirm",
      risk: classification.level,
      reason:
        classification.reasons.join(". ") ||
        `${category.replace("_", " ")} actions require confirmation for this profile.`,
      allowSessionApproval: true,
    };
  }

  return {
    verdict: "allow",
    risk: classification.level,
    reason: "Permitted by profile.",
    allowSessionApproval: true,
  };
}

/** Session-scoped approvals granted by the user (category -> expiry). */
export class ApprovalGrantStore {
  private grants = new Map<string, number>();

  private key(sessionId: string, category: ToolCategory): string {
    return `${sessionId}::${category}`;
  }

  grant(sessionId: string, category: ToolCategory, ttlMs = 30 * 60 * 1000): void {
    this.grants.set(this.key(sessionId, category), Date.now() + ttlMs);
  }

  has(sessionId: string, category: ToolCategory): boolean {
    const expiry = this.grants.get(this.key(sessionId, category));
    if (!expiry) return false;
    if (expiry < Date.now()) {
      this.grants.delete(this.key(sessionId, category));
      return false;
    }
    return true;
  }

  revoke(sessionId: string, category: ToolCategory): void {
    this.grants.delete(this.key(sessionId, category));
  }

  revokeAll(sessionId: string): void {
    for (const key of [...this.grants.keys()]) {
      if (key.startsWith(`${sessionId}::`)) this.grants.delete(key);
    }
  }
}
