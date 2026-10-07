/**
 * Simulated Gentoo system model.
 *
 * Provides the numbers the device runtime reports over the protocol: metrics
 * snapshots, the process table, OpenRC services and log output. Values follow a
 * bounded random walk so the dashboard moves like a real machine (thermal
 * throttling, memory pressure, disk bursts) instead of teleporting at random.
 */

import { clamp } from "../core/format";
import type { ProcessInfo, ServiceInfo, SystemSnapshot } from "../core/types";

const CORE_COUNT = 16;
const MEM_TOTAL_MB = 64 * 1024;
const SWAP_TOTAL_MB = 8 * 1024;

const PROCESS_SEEDS: Omit<ProcessInfo, "cpu" | "mem">[] = [
  { pid: 1, user: "root", command: "/sbin/init" },
  { pid: 412, user: "root", command: "/usr/lib/systemd/.../systemd-udevd" },
  { pid: 733, user: "root", command: "elogind-daemon" },
  { pid: 1204, user: "blue", command: "Hyprland --config ~/.config/hypr/hyprland.conf" },
  { pid: 1436, user: "blue", command: "pipewire --config /etc/pipewire/pipewire.conf" },
  { pid: 1440, user: "blue", command: "wireplumber" },
  { pid: 1582, user: "blue", command: "waybar" },
  { pid: 1903, user: "blue", command: "firefox-bin" },
  { pid: 2244, user: "blue", command: "nvim /home/blue/projects/gentoo-agent-control-center/README.md" },
  { pid: 2401, user: "blue", command: "alacritty --config-file ~/.config/alacritty/alacritty.toml" },
  { pid: 2610, user: "blue", command: "python3 /opt/gentoo-agent/agent.py --config /etc/gentoo-agent/config.toml" },
  { pid: 2789, user: "blue", command: "tmux new-session -A -s gentoo" },
  { pid: 3120, user: "root", command: "tailscaled --state=/var/lib/tailscale/tailscaled.state" },
  { pid: 3355, user: "blue", command: "colord" },
  { pid: 3488, user: "blue", command: "score-server" },
  { pid: 4012, user: "blue", command: "emerge --ask dev-lang/rust" },
];

export class SimulatedSystem {
  private perCore = Array.from({ length: CORE_COUNT }, () => 4 + Math.random() * 10);
  private memUsed = 21_400;
  private cached = 18_900;
  private swapUsed = 120;
  private rx = 820;
  private tx = 260;
  private readKbs = 1_400;
  private writeKbs = 640;
  private cpuTemp = 46;
  private nvmeTemp = 38;
  private workingSet = new Map<number, { cpu: number; mem: number }>();

  constructor() {
    for (const seed of PROCESS_SEEDS) {
      this.workingSet.set(seed.pid, {
        cpu: seed.command.includes("emerge") ? 180 : Math.random() * 4,
        mem: seed.command.includes("firefox") ? 1_900 : 40 + Math.random() * 380,
      });
    }
  }

  private drift(value: number, step: number, min: number, max: number): number {
    const next = value + (Math.random() - 0.5) * step;
    return clamp(next, min, max);
  }

  tick(): void {
    const busy = this.perCore.some((c) => c > 60);
    for (let i = 0; i < this.perCore.length; i += 1) {
      this.perCore[i] = this.drift(this.perCore[i], busy ? 14 : 8, 0.4, 99);
    }
    // Occasional build burst keeps the charts from looking flat.
    if (Math.random() < 0.06) {
      const core = Math.floor(Math.random() * this.perCore.length);
      this.perCore[core] = clamp(this.perCore[core] + 25, 0, 100);
    }

    const totalLoad = this.perCore.reduce((a, b) => a + b, 0) / this.perCore.length;
    this.memUsed = this.drift(this.memUsed, 260, 12_000, 55_000);
    this.cached = this.drift(this.cached, 300, 4_000, 30_000);
    this.swapUsed = this.drift(this.swapUsed, 30, 0, 2_400);
    this.rx = this.drift(this.rx, 500, 4, 24_000);
    this.tx = this.drift(this.tx, 220, 2, 12_000);
    this.readKbs = this.drift(this.readKbs, 900, 0, 90_000);
    this.writeKbs = this.drift(this.writeKbs, 400, 0, 40_000);
    this.cpuTemp = this.drift(this.cpuTemp, 3, 38, 92 - totalLoad * 0.15);
    this.nvmeTemp = this.drift(this.nvmeTemp, 1.5, 30, 64);

    for (const [pid, usage] of this.workingSet) {
      const seed = PROCESS_SEEDS.find((p) => p.pid === pid);
      const isEmerge = seed?.command.includes("emerge") ?? false;
      usage.cpu = this.drift(usage.cpu, isEmerge ? 40 : 6, 0, isEmerge ? 640 : 90);
      usage.mem = this.drift(usage.mem, seed?.command.includes("firefox") ? 90 : 12, 8, 4_000);
    }
  }

  snapshot(): SystemSnapshot {
    const perCore = this.perCore.map((c) => Math.round(c * 10) / 10);
    const total = Math.round((perCore.reduce((a, b) => a + b, 0) / perCore.length) * 10) / 10;
    const load1 = Math.round((total / 100) * CORE_COUNT * 10) / 10;
    return {
      timestamp: Date.now(),
      cpu: {
        total,
        perCore,
        frequencyMhz: Math.round(3600 + total * 22),
        load: [load1, Math.round(load1 * 0.92 * 10) / 10, Math.round(load1 * 0.88 * 10) / 10],
      },
      memory: {
        totalMb: MEM_TOTAL_MB,
        usedMb: Math.round(this.memUsed),
        availableMb: Math.round(MEM_TOTAL_MB - this.memUsed - this.cached),
        cachedMb: Math.round(this.cached),
        swapTotalMb: SWAP_TOTAL_MB,
        swapUsedMb: Math.round(this.swapUsed),
      },
      disk: [
        { mount: "/", usedGb: 412.6, totalGb: 1788.4, readKbs: Math.round(this.readKbs), writeKbs: Math.round(this.writeKbs) },
        { mount: "/boot", usedGb: 0.6, totalGb: 1.0, readKbs: 0, writeKbs: 0 },
        { mount: "/home", usedGb: 1044.2, totalGb: 1788.4, readKbs: Math.round(this.readKbs * 0.8), writeKbs: Math.round(this.writeKbs * 0.9) },
      ],
      network: [
        { iface: "tailscale0", rxKbs: Math.round(this.rx), txKbs: Math.round(this.tx), ipv4: "100.101.42.7" },
        { iface: "enp7s0", rxKbs: Math.round(this.rx * 0.3), txKbs: Math.round(this.tx * 0.25), ipv4: "192.168.1.42" },
        { iface: "wlan0", rxKbs: 0, txKbs: 0, ipv4: "192.168.1.77" },
      ],
      temps: [
        { label: "CPU", celsius: Math.round(this.cpuTemp * 10) / 10 },
        { label: "NVMe", celsius: Math.round(this.nvmeTemp * 10) / 10 },
        { label: "GPU", celsius: Math.round((this.cpuTemp - 6) * 10) / 10 },
      ],
      processes: this.processes("cpu"),
    };
  }

  processes(sort: "cpu" | "mem" = "cpu"): ProcessInfo[] {
    const rows = PROCESS_SEEDS.map((seed) => {
      const usage = this.workingSet.get(seed.pid) ?? { cpu: 0, mem: 0 };
      return {
        ...seed,
        cpu: Math.round(usage.cpu * 10) / 10,
        mem: Math.round(usage.mem * 10) / 10,
      };
    });
    rows.sort((a, b) => (sort === "mem" ? b.mem - a.mem : b.cpu - a.cpu));
    return rows;
  }

  services(): ServiceInfo[] {
    return [
      { name: "networkmanager", description: "NetworkManager daemon", state: "started", boot: "enabled" },
      { name: "dbus", description: "System message bus", state: "started", boot: "enabled" },
      { name: "elogind", description: "Login session manager", state: "started", boot: "enabled" },
      { name: "pipewire", description: "Multimedia server", state: "crashed", boot: "enabled" },
      { name: "sshd", description: "OpenSSH daemon", state: "started", boot: "enabled" },
      { name: "tailscaled", description: "Tailscale mesh daemon", state: "started", boot: "enabled" },
      { name: "chronyd", description: "NTP client", state: "started", boot: "enabled" },
      { name: "gentoo-agent", description: "Gentoo Agent Control Center runtime", state: "started", boot: "enabled" },
      { name: "docker", description: "Container runtime", state: "stopped", boot: "disabled" },
    ];
  }

  restartService(name: string): { ok: boolean; output: string } {
    const known = this.services().find((s) => s.name === name);
    if (!known) {
      return { ok: false, output: `rc-service: service \`${name}' does not exist` };
    }
    return {
      ok: true,
      output: [
        ` * Caching service dependencies ...                                   [ ok ]`,
        ` * Stopping ${name} ...`,
        ` * Starting ${name} ...`,
        ` * Waiting for ${name} to be ready ...                               [ ok ]`,
      ].join("\n"),
    };
  }

  installPackage(atom: string): string {
    return [
      `Calculating dependencies  ... done!`,
      `[ebuild  N     ] ${atom}`,
      `>>> Emerging (1 of 1) ${atom}`,
      `>>> Installing (1 of 1) ${atom}`,
      `>>> Recording ${atom} in "world" favorites file...`,
      `>>> Jobs: 1 of 1 complete                           Load avg: ${(2 + Math.random()).toFixed(2)}`,
    ].join("\n");
  }

  searchPackage(query: string): string {
    const catalog: Record<string, string[]> = {
      screenshot: [
        "x11-misc/grim [0.5.0]",
        "x11-misc/slurp [1.4.0]",
        "media-gfx/flameshot [12.1.0]",
        "x11-misc/swappy [1.5.0]",
      ],
      neovim: ["app-editors/neovim [0.10.1]"],
      rust: ["dev-lang/rust [1.82.0]", "dev-lang/rust-bin [1.82.0]"],
    };
    const key = Object.keys(catalog).find((k) => query.toLowerCase().includes(k));
    if (key) return catalog[key].join("\n");
    return `equery: no packages matching '${query}' in the local Portage tree snapshot`;
  }

  logs(unit: string, lines: number): string {
    const base = [
      "gentoo agent[2610]: connected to control center (tailscale 100.101.42.7)",
      "kernel: nvme0n1: I/O 0004 QID 12 timeout, reset controller",
      "pipewire[1436]: pw.core: error: no node available for device alsa_output",
      "pipewire[1436]: mod.client-node: 0x55f1: client-node ratelimit",
      "wireplumber[1440]: W: [pipewire] device not found, retrying in 5s",
      "gentoo agent[2610]: metrics sample flush ok (interval 1000ms)",
      "elogind[733]: Removed session c1 for user blue",
      "sshd[5521]: Accepted publickey for blue from 100.101.42.9 port 51244",
      "kernel: TCP: request_sock_TCP: Possible SYN flooding on port 8080",
      "chronyd[1102]: Selected source 162.159.200.1",
    ];
    const unitLine = unit === "pipewire" ? base.filter((l) => l.includes("pipewire") || l.includes("wireplumber")) : base;
    const chosen = unitLine.length ? unitLine : base;
    const out: string[] = [];
    for (let i = 0; i < Math.min(lines, 60); i += 1) {
      const line = chosen[i % chosen.length];
      const stamp = new Date(Date.now() - (chosen.length - i) * 61_000);
      out.push(`${stamp.toISOString().replace("T", " ").slice(0, 19)} gentoo ${line}`);
    }
    return out.join("\n");
  }
}
