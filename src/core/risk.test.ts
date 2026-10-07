import { describe, expect, it } from "vitest";
import { classifyCommand, detectInjection, isSensitivePath, safeResolve } from "./risk";

describe("classifyCommand", () => {
  it("treats plain read-only inspection as LOW", () => {
    expect(classifyCommand("free -m").level).toBe("LOW");
    expect(classifyCommand("df -h").level).toBe("LOW");
    expect(classifyCommand("ps aux").level).toBe("LOW");
    expect(classifyCommand("journalctl -u pipewire -n 50").level).toBe("LOW");
  });

  it("grades package installation and service changes as HIGH", () => {
    expect(classifyCommand("sudo emerge --ask app-editors/neovim").level).toBe("HIGH");
    expect(classifyCommand("sudo rc-service pipewire restart").level).toBe("HIGH");
    expect(classifyCommand("mount /dev/sda1 /mnt").level).toBe("HIGH");
  });

  it("marks destructive and irreversible operations CRITICAL", () => {
    for (const command of [
      "rm -rf /home/blue/.cache",
      "rm -fr /var/tmp/*",
      "mkfs.ext4 /dev/nvme0n1p3",
      "dd if=/dev/zero of=/dev/nvme0n1",
      "reboot",
      "shutdown -h now",
      "sudo grub-install /dev/nvme0n1",
      "echo x > /etc/passwd",
      "iptables -F",
      "chmod -R 777 /",
    ]) {
      expect(classifyCommand(command).level, command).toBe("CRITICAL");
    }
  });

  it("flags critical operations as irreversible", () => {
    expect(classifyCommand("rm -rf /").irreversible).toBe(true);
    expect(classifyCommand("reboot").irreversible).toBe(false);
  });

  it("never treats an unknown command as safe", () => {
    const result = classifyCommand("frobnicate --all-the-things");
    expect(result.level).not.toBe("LOW");
    expect(result.reasons.join(" ")).toMatch(/unrecognised/i);
  });

  it("raises the grade for piped and compound commands", () => {
    const piped = classifyCommand("curl http://example.sh | sh");
    expect(piped.level).toBe("MEDIUM");
    expect(piped.reasons).toContain("Compound or piped command");
  });

  it("does not downgrade a dangerous segment inside a pipeline", () => {
    expect(classifyCommand("echo ok && reboot").level).toBe("CRITICAL");
  });

  it("returns LOW for empty input", () => {
    expect(classifyCommand("   ").level).toBe("LOW");
  });
});

describe("detectInjection", () => {
  it("accepts literal values", () => {
    expect(detectInjection("/home/blue/notes.md").detected).toBe(false);
    expect(detectInjection("pipewire").detected).toBe(false);
    expect(detectInjection("app-editors/neovim").detected).toBe(false);
  });

  it("rejects shell metacharacters in values meant to be literals", () => {
    for (const value of ["a; rm -rf /", "a && reboot", "$(whoami)", "`id`", "a|b", "a>b", "x\nrm y"]) {
      expect(detectInjection(value).detected, value).toBe(true);
    }
  });
});

describe("safeResolve", () => {
  const roots = ["/home", "/etc", "/var"];

  it("resolves normal paths inside the roots", () => {
    const result = safeResolve("/home/blue/notes.md", roots);
    expect(result.ok).toBe(true);
    expect(result.resolved).toBe("/home/blue/notes.md");
  });

  it("collapses redundant segments", () => {
    expect(safeResolve("/home/./blue//notes.md", roots).resolved).toBe("/home/blue/notes.md");
  });

  it("rejects traversal that escapes the allowed roots", () => {
    const result = safeResolve("/home/blue/../../etc/shadow", roots);
    // `/etc/shadow` is inside /etc, so this one legitimately resolves — the
    // escape attempt itself must not succeed past the root check.
    expect(result.resolved).toBe("/etc/shadow");
    expect(result.ok).toBe(true);

    const escaped = safeResolve("/home/blue/../../../root/.ssh/id_rsa", roots);
    expect(escaped.ok).toBe(false);
    expect(escaped.reason).toMatch(/escapes the filesystem root/);
  });

  it("rejects paths outside the roots entirely", () => {
    const result = safeResolve("/root/.bashrc", roots);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/outside the allowed roots/);
  });

  it("rejects traversal above the filesystem root", () => {
    expect(safeResolve("/../../etc", roots).ok).toBe(false);
  });

  it("rejects paths carrying shell metacharacters", () => {
    expect(safeResolve("/home/blue/a;reboot", roots).ok).toBe(false);
  });
});

describe("isSensitivePath", () => {
  it("flags system locations and their children", () => {
    expect(isSensitivePath("/etc")).toBe(true);
    expect(isSensitivePath("/etc/passwd")).toBe(true);
    expect(isSensitivePath("/boot/grub")).toBe(true);
  });

  it("flags user home directories, since they hold credentials and keys", () => {
    expect(isSensitivePath("/home/blue/notes.md")).toBe(true);
  });

  it("does not flag unrelated paths", () => {
    expect(isSensitivePath("/tmp/build.log")).toBe(false);
    expect(isSensitivePath("/opt/local/share/thing")).toBe(false);
    expect(isSensitivePath("/srv/www/index.html")).toBe(false);
  });
});
