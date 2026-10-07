/**
 * Risk classification engine.
 *
 * Every command an agent wants to run passes through this module before it can
 * reach the execution layer. The classifier is deliberately conservative: an
 * unknown command is never treated as safe, and destructive patterns always
 * win over the profile's default verdict.
 *
 * The classifier operates on a parsed command, never on raw string
 * concatenation, which also lets us flag injection attempts in arguments that
 * are supposed to be plain values.
 */

import type { RiskLevel } from "./types";

export interface Classification {
  level: RiskLevel;
  reasons: string[];
  /** Commands that must never be auto-approved, regardless of profile. */
  irreversible: boolean;
}

interface Rule {
  level: RiskLevel;
  reason: string;
  irreversible?: boolean;
  test: RegExp;
}

/** Ordered from most destructive to least. First match wins per rule list. */
const RULES: Rule[] = [
  {
    level: "CRITICAL",
    irreversible: true,
    reason: "Recursive delete of a filesystem root or wildcard target",
    test: /\brm\s+(-[a-z]*\s+)*(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b/,
  },
  {
    level: "CRITICAL",
    irreversible: true,
    reason: "Filesystem creation or partition table modification",
    test: /\b(mkfs(\.[a-z0-9]+)?|mke2fs|fdisk|sfdisk|parted|gdisk)\b/,
  },
  {
    level: "CRITICAL",
    irreversible: true,
    reason: "Raw block-device write",
    test: /\bdd\b[^\n]*\bof=\/dev\/(sd|nvme|vd|hd|mmcblk)/,
  },
  {
    level: "CRITICAL",
    irreversible: true,
    reason: "Overwriting a disk image or device with redirection",
    test: />\s*\/dev\/(sd|nvme|vd|hd|mmcblk)/,
  },
  {
    level: "CRITICAL",
    irreversible: true,
    reason: "Bootloader or kernel image modification",
    test: /\b(grub-install|grub-mkconfig|efibootmgr|update-grub|refind-install)\b/,
  },
  {
    level: "CRITICAL",
    irreversible: true,
    reason: "Writes to account or credential databases",
    test: /(\/etc\/(passwd|shadow|sudoers)\b)|\b(passwd|chpasswd|visudo)\b/,
  },
  {
    level: "CRITICAL",
    irreversible: true,
    reason: "Flushing or rewriting firewall rules",
    test: /\b(iptables|nft|ip6tables)\b[^\n]*(\s-F\b|\s--flush\b|\sflush\b)/,
  },
  {
    level: "CRITICAL",
    irreversible: true,
    reason: "Recursive permission change on a system path",
    test: /\bchmod\b[^\n]*(\s-R\b|\s--recursive\b)[^\n]*\s(\/|~)/,
  },
  {
    level: "CRITICAL",
    reason: "Machine power state change",
    test: /\b(reboot|shutdown|poweroff|halt|systemctl\s+(reboot|poweroff|halt|suspend))\b/,
  },
  {
    level: "HIGH",
    reason: "Privilege escalation to root",
    test: /(^|\s)(sudo|doas|su)\s/,
  },
  {
    level: "HIGH",
    reason: "Package removal or slot change",
    test: /\b(emerge|emaint|portage)\b[^\n]*\b(--depclean|--unmerge|-C\b|--newuse|--changed-use)\b/,
  },
  {
    level: "HIGH",
    reason: "Installing or building packages",
    test: /\b(emerge|ebuild|pkg-config\s+--install|pip\s+install|npm\s+install\s+-g)\b/,
  },
  {
    level: "HIGH",
    reason: "Service lifecycle change",
    test: /\b(rc-service|rc-update|systemctl|service)\b[^\n]*\b(start|stop|restart|reload|enable|disable|mask)\b/,
  },
  {
    level: "HIGH",
    reason: "Forced process termination",
    test: /\b(kill|pkill|killall)\b[^\n]*\s(-9|-KILL)/,
  },
  {
    level: "HIGH",
    reason: "Mount or unmount operation",
    test: /\b(mount|umount|swapon|swapoff)\b/,
  },
  {
    level: "HIGH",
    reason: "User or group account modification",
    test: /\b(useradd|usermod|userdel|groupadd|groupdel|gpasswd)\b/,
  },
  {
    level: "MEDIUM",
    reason: "Writes to files or directories",
    test: /\b(mv|cp\s+-[a-z]*r|rm|truncate|tee|chmod|chown|ln\s+-s)\b|>>?/,
  },
  {
    level: "MEDIUM",
    reason: "Network configuration change",
    test: /\b(ip\s+(addr|link|route)\s+(add|del|set)|nmcli|tailscale\s+(up|down|set))\b/,
  },
  {
    level: "MEDIUM",
    reason: "Process termination",
    test: /\b(kill|pkill|killall)\b/,
  },
  {
    level: "LOW",
    reason: "Read-only inspection command",
    test: /^(ls|cat|less|head|tail|grep|rg|find|stat|file|ps|top|htop|free|df|du|uptime|whoami|id|uname|hostname|date|echo|env|printenv|ip\s+(addr|link|route)\s+show|lspci|lsusb|lsblk|sensors|loginctl|journalctl|rc-status|crontab\s+-l|equery\s+(list|uses|depends)|which|type|wc|sort|uniq|awk|sed|cut|tr|dirname|basename|realpath|readlink)\b/,
  },
];

const SHELL_METACHARACTERS = /[;&|`$(){}<>\\]/;

/** Split a command line into pipeline segments for per-segment classification. */
export function splitPipeline(command: string): string[] {
  return command
    .split(/\|\||&&|[|;\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function classifyCommand(command: string): Classification {
  const trimmed = command.trim();
  if (!trimmed) {
    return { level: "LOW", reasons: [], irreversible: false };
  }

  const reasons: string[] = [];
  let level: RiskLevel = "LOW";
  let irreversible = false;
  const order: RiskLevel[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

  const segments = splitPipeline(trimmed);

  for (const segment of segments) {
    // Deny-by-default: shell metacharacters that survive segmentation mean the
    // command composes behaviour we cannot fully reason about.
    const composed = SHELL_METACHARACTERS.test(segment) || segments.length > 1;
    for (const rule of RULES) {
      if (rule.test.test(segment)) {
        if (order.indexOf(rule.level) > order.indexOf(level)) level = rule.level;
        if (rule.irreversible) irreversible = true;
        if (!reasons.includes(rule.reason)) reasons.push(rule.reason);
        break;
      }
    }
    if (composed && order.indexOf(level) < order.indexOf("MEDIUM")) {
      level = "MEDIUM";
      if (!reasons.includes("Compound or piped command")) {
        reasons.push("Compound or piped command");
      }
    }
  }

  // Unknown commands default to MEDIUM rather than LOW: "unknown" is not "safe".
  const matchedAny = reasons.some((r) => r !== "Compound or piped command");
  if (!matchedAny && level === "LOW") {
    const before = level;
    for (const segment of segments) {
      const known = RULES.some((rule) => rule.test.test(segment));
      if (!known) {
        level = order.indexOf("MEDIUM") > order.indexOf(before) ? "MEDIUM" : before;
        reasons.push("Unrecognised command — treated as write-capable");
        break;
      }
    }
  }

  if (irreversible) level = "CRITICAL";
  return { level, reasons, irreversible };
}

export interface InjectionFinding {
  detected: boolean;
  detail: string;
}

/**
 * Detect injection into arguments that are meant to be literal values (paths,
 * service names, package names). Used by every non-shell tool.
 */
export function detectInjection(value: string): InjectionFinding {
  if (SHELL_METACHARACTERS.test(value)) {
    return {
      detected: true,
      detail: `Value contains shell metacharacters: ${JSON.stringify(value)}`,
    };
  }
  if (value.includes("\n") || value.includes("\0")) {
    return { detected: true, detail: "Value contains control characters" };
  }
  return { detected: false, detail: "" };
}

/** Resolve `..` segments and reject traversal outside the allowed roots. */
export function safeResolve(path: string, allowedRoots: string[]): {
  ok: boolean;
  resolved: string;
  reason?: string;
} {
  if (detectInjection(path).detected) {
    return { ok: false, resolved: path, reason: "Path contains shell metacharacters" };
  }
  const absolute = path.startsWith("/") ? path : `/${path}`;
  const segments = absolute.split("/");
  const stack: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (stack.length === 0) {
        return { ok: false, resolved: path, reason: "Path escapes the filesystem root" };
      }
      stack.pop();
      continue;
    }
    stack.push(segment);
  }
  const resolved = "/" + stack.join("/");
  const within = allowedRoots.some(
    (root) => resolved === root || resolved.startsWith(root.endsWith("/") ? root : `${root}/`),
  );
  if (!within) {
    return {
      ok: false,
      resolved,
      reason: `Path is outside the allowed roots (${allowedRoots.join(", ")})`,
    };
  }
  return { ok: true, resolved };
}

/** Locations that always deserve an explicit warning in the file manager. */
export const SENSITIVE_PATHS = [
  "/etc",
  "/boot",
  "/usr",
  "/var",
  "/home",
  "/root",
  "/dev",
  "/proc",
  "/sys",
];

export function isSensitivePath(path: string): boolean {
  return SENSITIVE_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}
