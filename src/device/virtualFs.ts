/**
 * In-memory filesystem for the simulated Gentoo device.
 *
 * Mirrors the shape of a real Gentoo install closely enough that the file
 * manager, the `read_file` / `list_directory` agent tools and the risk
 * classifier's path rules all behave the same way they will against a real
 * machine. All mutations go through this class so audit logging is complete.
 */

import { safeResolve } from "../core/risk";
import type { FileEntry } from "../core/types";

interface Node {
  type: "file" | "dir" | "symlink";
  owner: string;
  group: string;
  mode: string;
  modified: number;
  content?: string;
  target?: string;
}

const DAY = 86_400_000;

function dir(owner = "root", group = "root", mode = "drwxr-xr-x"): Node {
  return { type: "dir", owner, group, mode, modified: Date.now() - 3 * DAY };
}

function file(content: string, owner = "root", group = "root", mode = "-rw-r--r--"): Node {
  return { type: "file", owner, group, mode, modified: Date.now() - DAY, content };
}

export class VirtualFileSystem {
  private nodes = new Map<string, Node>();

  constructor(private readonly allowedRoots: string[] = ["/"]) {
    this.seed();
  }

  private seed(): void {
    const put = (path: string, node: Node) => this.nodes.set(path, node);

    put("/", dir());
    for (const top of [
      "etc",
      "boot",
      "usr",
      "var",
      "home",
      "root",
      "dev",
      "proc",
      "sys",
      "opt",
      "srv",
      "tmp",
    ]) {
      put(`/${top}`, dir());
    }

    put("/home/blue", dir("blue", "blue", "drwxr-xr-x"));
    put("/home/blue/.bashrc", file("# ~/.bashrc\nexport EDITOR=nvim\n", "blue", "blue"));
    put("/home/blue/.config", dir("blue", "blue"));
    put("/home/blue/projects", dir("blue", "blue"));
    put(
      "/home/blue/projects/gentoo-agent-control-center",
      dir("blue", "blue"),
    );
    put(
      "/home/blue/projects/gentoo-agent-control-center/README.md",
      file("# Gentoo Agent Control Center\nRemote AI agent + PC control.\n", "blue", "blue"),
    );
    put("/home/blue/notes.md", file("# Notes\n\n- pipewire config TODO\n- check nvim LSP\n", "blue", "blue"));

    put("/etc/portage", dir());
    put("/etc/portage/make.conf", file('COMMON_FLAGS="-O2 -pipe -march=native"\nMAKEOPTS="-j16"\n'));
    put("/etc/hosts", file("127.0.0.1 localhost\ngentoo\n"));
    put("/etc/fstab", file("# <fs>\t<mount>\t<type>\t<opts>\n/dev/nvme0n1p2\t/\text4\tdefaults,noatime\n"));
    put("/etc/passwd", file("root:x:0:0:root:/root:/bin/bash\nblue:x:1000:1000:blue:/home/blue:/bin/bash\n"));

    put("/var/log", dir());
    put("/var/log/messages", file("Oct  7 09:12:01 gentoo kernel: nvme0n1: 1.8 TB\n"));
    put("/var/log/emerge.log", file(">>> emerge (1 of 1) app-editors/neovim-0.10.1\n"));

    put("/usr/share", dir());
    put("/usr/src", dir());
    put("/usr/src/linux", dir());

    put("/boot/grub", dir());
    put("/opt/local", dir());
    put("/tmp/build.log", file("make[1]: Entering directory\n", "blue", "blue"));

    put(
      "/proc/cpuinfo",
      file("processor\t: 0\nmodel name\t: AMD Ryzen 9 7950X 16-Core Processor\ncpu MHz\t\t: 4700.000\n"),
    );
    put("/proc/meminfo", file("MemTotal:       65536000 kB\nMemAvailable:   41943040 kB\n"));
  }

  private parentOf(path: string): string {
    if (path === "/") return "/";
    const idx = path.lastIndexOf("/");
    return idx <= 0 ? "/" : path.slice(0, idx);
  }

  private toEntry(path: string, node: Node): FileEntry {
    const name = path === "/" ? "/" : path.slice(path.lastIndexOf("/") + 1);
    return {
      name,
      path,
      type: node.type,
      size: node.content ? new TextEncoder().encode(node.content).length : node.type === "dir" ? 4096 : 0,
      owner: node.owner,
      group: node.group,
      mode: node.mode,
      modified: node.modified,
      hidden: name.startsWith(".") && name !== "." && name !== "..",
    };
  }

  list(path: string, showHidden = false): FileEntry[] {
    const resolved = path === "/" ? "/" : path.replace(/\/+$/, "");
    const prefix = resolved === "/" ? "/" : `${resolved}/`;
    const entries: FileEntry[] = [];
    for (const [nodePath, node] of this.nodes) {
      if (nodePath === "/" || nodePath === resolved) continue;
      if (!nodePath.startsWith(prefix)) continue;
      const rest = nodePath.slice(prefix.length);
      if (rest.includes("/")) continue; // only direct children
      const entry = this.toEntry(nodePath, node);
      if (entry.hidden && !showHidden) continue;
      entries.push(entry);
    }
    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return entries;
  }

  stat(path: string): FileEntry | null {
    const node = this.nodes.get(path);
    return node ? this.toEntry(path, node) : null;
  }

  read(path: string): string {
    const node = this.nodes.get(path);
    if (!node) throw new Error(`No such file: ${path}`);
    if (node.type === "dir") throw new Error(`Is a directory: ${path}`);
    return node.content ?? "";
  }

  write(path: string, content: string): void {
    const guard = safeResolve(path, this.allowedRoots);
    if (!guard.ok) throw new Error(guard.reason);
    const existing = this.nodes.get(guard.resolved);
    if (existing && existing.type === "dir") throw new Error(`Is a directory: ${guard.resolved}`);
    const parent = this.parentOf(guard.resolved);
    if (!this.nodes.has(parent)) throw new Error(`Parent directory does not exist: ${parent}`);
    this.nodes.set(guard.resolved, {
      type: "file",
      owner: existing?.owner ?? "blue",
      group: existing?.group ?? "blue",
      mode: existing?.mode ?? "-rw-r--r--",
      modified: Date.now(),
      content,
    });
  }

  mkdir(path: string): void {
    const guard = safeResolve(path, this.allowedRoots);
    if (!guard.ok) throw new Error(guard.reason);
    if (this.nodes.has(guard.resolved)) throw new Error("Already exists");
    const parent = this.parentOf(guard.resolved);
    if (!this.nodes.has(parent)) throw new Error(`Parent directory does not exist: ${parent}`);
    this.nodes.set(guard.resolved, { ...dir("blue", "blue"), modified: Date.now() });
  }

  rename(from: string, to: string): void {
    const guard = safeResolve(to, this.allowedRoots);
    if (!guard.ok) throw new Error(guard.reason);
    const node = this.nodes.get(from);
    if (!node) throw new Error(`No such file: ${from}`);
    this.nodes.delete(from);
    this.nodes.set(guard.resolved, { ...node, modified: Date.now() });
  }

  delete(path: string): void {
    if (!this.nodes.has(path)) throw new Error(`No such file: ${path}`);
    const prefix = `${path}/`;
    for (const key of [...this.nodes.keys()]) {
      if (key === path || key.startsWith(prefix)) this.nodes.delete(key);
    }
  }

  /** Flat search used by the `search_files` tool. */
  search(query: string, root = "/", limit = 50): FileEntry[] {
    const needle = query.toLowerCase();
    const results: FileEntry[] = [];
    for (const [path, node] of this.nodes) {
      if (path === "/") continue;
      if (!path.startsWith(root)) continue;
      const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
      if (name.includes(needle) || (node.content ?? "").toLowerCase().includes(needle)) {
        results.push(this.toEntry(path, node));
        if (results.length >= limit) break;
      }
    }
    return results;
  }
}
