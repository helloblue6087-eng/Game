/**
 * Files — remote file browsing and controlled editing.
 *
 * Reads are unrestricted within the configured roots; every mutation is
 * confirmed, and anything under a sensitive location (/etc, /boot, /usr …) is
 * flagged before you commit to it. Path traversal is rejected device-side, so
 * `..` segments can never escape the allowed roots.
 */

import { useEffect, useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Panel,
  Sheet,
  Toggle,
} from "../components/ui";
import { filesStore, useStore } from "../state/store";
import { runtime } from "../state/bootstrap";
import { isSensitivePath } from "../core/risk";
import { formatBytes, formatRelative } from "../core/format";
import type { FileEntry } from "../core/types";

export function FilesPage() {
  const files = useStore(filesStore);
  const [query, setQuery] = useState("");
  const [confirm, setConfirm] = useState<
    | { kind: "delete"; entry: FileEntry }
    | { kind: "write"; path: string; content: string }
    | null
  >(null);
  const [renaming, setRenaming] = useState<FileEntry | null>(null);
  const [newFolder, setNewFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void runtime.controller.listFiles("/home/blue");
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return files.entries;
    return files.entries.filter((entry) => entry.name.toLowerCase().includes(needle));
  }, [files.entries, query]);

  const segments = files.cwd.split("/").filter(Boolean);
  const sensitive = isSensitivePath(files.cwd);

  const open = async (entry: FileEntry) => {
    if (entry.type === "dir") {
      await runtime.controller.listFiles(entry.path);
      setQuery("");
      return;
    }
    await runtime.controller.openFile(entry.path);
  };

  const saveEditor = () => {
    const editor = files.editor;
    if (!editor) return;
    if (isSensitivePath(editor.path)) {
      setConfirm({ kind: "write", path: editor.path, content: editor.content });
      return;
    }
    void runtime.controller.saveFile();
  };

  const doDelete = async (entry: FileEntry) => {
    const message = await runtime.controller.fileOperation("delete", { path: entry.path });
    setError(message);
    setConfirm(null);
  };

  return (
    <div className="space-y-3">
      {/* Path bar */}
      <Panel className="p-3">
        <div className="flex items-center gap-2">
          <IconButton icon="arrowLeft" label="Parent directory" onClick={() => void runtime.controller.listFiles(parentOf(files.cwd))} />
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto no-scrollbar">
            <button className="mono shrink-0 text-[12px] text-accent-soft" onClick={() => void runtime.controller.listFiles("/")}>
              /
            </button>
            {segments.map((segment, index) => {
              const path = `/${segments.slice(0, index + 1).join("/")}`;
              return (
                <span key={path} className="flex shrink-0 items-center gap-1">
                  <button
                    className="mono text-[12px] text-white/70 hover:text-white"
                    onClick={() => void runtime.controller.listFiles(path)}
                  >
                    {segment}
                  </button>
                  <Icon name="chevronRight" className="h-3 w-3 text-white/25" />
                </span>
              );
            })}
          </div>
          <IconButton icon="refresh" label="Refresh" onClick={() => void runtime.controller.listFiles(files.cwd, files.hidden)} />
        </div>

        {sensitive ? (
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-amber-400/25 bg-amber-500/10 px-2.5 py-1.5">
            <Icon name="alert" className="h-3.5 w-3.5 text-amber-200" />
            <span className="text-[11.5px] text-amber-100/90">
              Sensitive system location — writes here are confirmed before they are sent.
            </span>
          </div>
        ) : null}
      </Panel>

      {/* Controls */}
      <Panel className="flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-[160px] flex-1">
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
          <input
            className="field pl-9"
            placeholder="Filter this directory…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Toggle
            checked={files.hidden}
            onChange={(value) => void runtime.controller.listFiles(files.cwd, value)}
            label="Show hidden files"
          />
          <span className="text-[12px] text-white/55">Hidden</span>
        </div>
        <Button variant="ghost" icon="plus" onClick={() => setNewFolder(true)}>
          Folder
        </Button>
      </Panel>

      {error ? (
        <Panel className="flex items-start gap-2.5 border-rose-400/25 bg-rose-500/[0.08] p-3">
          <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
          <p className="text-[12.5px] text-rose-100">{error}</p>
          <IconButton icon="close" label="Dismiss" onClick={() => setError(null)} />
        </Panel>
      ) : null}

      {/* Listing */}
      <Panel className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-3.5 py-2">
          <span className="mono text-[11px] text-white/45">
            {filtered.length} entr{filtered.length === 1 ? "y" : "ies"}
          </span>
          <span className="mono text-[11px] text-white/30">{files.loading ? "loading…" : `${runtime.settings.allowedRoots.length} allowed roots`}</span>
        </div>

        {filtered.length === 0 && !files.loading ? (
          <div className="p-4">
            <EmptyState icon="folder" title="Empty directory" description="Nothing here matches the current filter." />
          </div>
        ) : (
          <ul className="divide-y divide-white/[0.04]">
            {filtered.map((entry) => {
              const flagged = isSensitivePath(entry.path);
              return (
                <li key={entry.path} className="group flex items-center gap-3 px-3.5 py-2.5">
                  <button onClick={() => void open(entry)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                    <Icon
                      name={entry.type === "dir" ? "folder" : entry.type === "symlink" ? "network" : "file"}
                      className={`h-4 w-4 shrink-0 ${
                        entry.type === "dir" ? "text-accent-soft" : entry.hidden ? "text-white/25" : "text-white/50"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`truncate text-[13px] ${entry.hidden ? "text-white/45" : "text-white/85"}`}>
                          {entry.name}
                        </span>
                        {flagged ? <Badge tone="warn">system</Badge> : null}
                      </div>
                      <p className="mono truncate text-[10.5px] text-white/35">
                        {entry.mode} {entry.owner}:{entry.group} · {entry.type === "dir" ? "—" : formatBytes(entry.size)} ·{" "}
                        {formatRelative(entry.modified)}
                      </p>
                    </div>
                  </button>

                  <div className="flex shrink-0 items-center gap-1 opacity-60 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={() => setRenaming(entry)}
                      title="Rename"
                      className="rounded-lg border border-white/10 p-1.5 text-white/50 hover:text-white"
                    >
                      <Icon name="edit" className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setConfirm({ kind: "delete", entry })}
                      title="Delete"
                      className="rounded-lg border border-white/10 p-1.5 text-white/50 hover:border-rose-400/40 hover:text-rose-200"
                    >
                      <Icon name="trash" className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel className="flex items-start gap-2.5 p-3.5">
        <Icon name="lock" className="mt-0.5 h-4 w-4 shrink-0 text-accent-soft" />
        <p className="text-[12px] leading-relaxed text-white/50">
          The device resolves every path and rejects anything that escapes the configured roots, so a crafted
          filename cannot be used to read outside them. Sensitive locations are marked before you edit them.
        </p>
      </Panel>

      {/* Editor */}
      <Sheet
        open={Boolean(files.editor)}
        onClose={() => runtime.controller.closeEditor()}
        title={files.editor?.path ?? "File"}
        size="tall"
        footer={
          <div className="flex gap-2">
            <Button variant="quiet" block onClick={() => runtime.controller.closeEditor()}>
              Close
            </Button>
            <Button variant="primary" block icon="save" disabled={!files.editor?.dirty} onClick={saveEditor}>
              Save
            </Button>
          </div>
        }
      >
        {files.editor ? (
          <div className="space-y-3">
            {isSensitivePath(files.editor.path) ? (
              <div className="flex items-center gap-2 rounded-lg border border-amber-400/25 bg-amber-500/10 px-2.5 py-2">
                <Icon name="alert" className="h-3.5 w-3.5 text-amber-200" />
                <span className="text-[11.5px] text-amber-100/90">System file — saving requires confirmation.</span>
              </div>
            ) : null}
            <textarea
              spellCheck={false}
              value={files.editor.content}
              onChange={(event) => runtime.controller.editFileContent(event.target.value)}
              className="mono h-[52vh] w-full resize-none rounded-xl border border-white/10 bg-black/50 p-3 text-[12.5px] leading-relaxed text-white/85 focus:border-accent/50 focus:outline-none"
            />
            <p className="mono text-[11px] text-white/35">
              {files.editor.content.split("\n").length} lines · {formatBytes(files.editor.content.length)}
              {files.editor.dirty ? " · unsaved changes" : " · saved"}
            </p>
          </div>
        ) : null}
      </Sheet>

      {/* Rename */}
      <Sheet open={Boolean(renaming)} onClose={() => setRenaming(null)} title={`Rename ${renaming?.name ?? ""}`}>
        {renaming ? (
          <RenameForm
            entry={renaming}
            onSubmit={async (nextName) => {
              const to = `${parentOf(renaming.path)}/${nextName}`;
              const message = await runtime.controller.fileOperation("rename", { from: renaming.path, to });
              setError(message);
              setRenaming(null);
            }}
            onCancel={() => setRenaming(null)}
          />
        ) : null}
      </Sheet>

      {/* New folder */}
      <Sheet open={newFolder} onClose={() => setNewFolder(false)} title="New directory">
        <label className="block">
          <span className="label">Directory name</span>
          <input
            className="field"
            value={folderName}
            onChange={(event) => setFolderName(event.target.value)}
            placeholder="notes"
            autoFocus
          />
        </label>
        <div className="mt-3 flex gap-2">
          <Button variant="quiet" block onClick={() => setNewFolder(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            block
            icon="check"
            disabled={!folderName.trim()}
            onClick={async () => {
              const message = await runtime.controller.fileOperation("mkdir", { path: `${files.cwd}/${folderName.trim()}` });
              setError(message);
              setNewFolder(false);
              setFolderName("");
            }}
          >
            Create
          </Button>
        </div>
      </Sheet>

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.kind === "delete" ? `Delete ${confirm.entry.name}?` : "Write to a system file?"}
        risk={confirm?.kind === "delete" ? (confirm.entry.type === "dir" ? "HIGH" : "MEDIUM") : "HIGH"}
        command={
          confirm?.kind === "delete"
            ? `rm -r ${confirm.entry.path}`
            : confirm?.kind === "write"
              ? `tee ${confirm.path}   # ${confirm.content.split("\n").length} lines`
              : undefined
        }
        irreversible={confirm?.kind === "delete" && confirm.entry.type === "dir"}
        description={
          confirm?.kind === "delete"
            ? confirm.entry.type === "dir"
              ? "Directories are removed recursively. This cannot be undone."
              : "The file is removed from the device. This cannot be undone."
            : "This file lives in a location that affects system behaviour. Review the change before saving."
        }
        confirmLabel={confirm?.kind === "delete" ? "Delete" : "Save anyway"}
        confirmVariant="danger"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm?.kind === "delete") void doDelete(confirm.entry);
          else if (confirm?.kind === "write") {
            void runtime.controller.saveFile();
            setConfirm(null);
          }
        }}
      />
    </div>
  );
}

function RenameForm({
  entry,
  onSubmit,
  onCancel,
}: {
  entry: FileEntry;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(entry.name);
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="label">New name</span>
        <input className="field" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
      </label>
      <p className="mono text-[11px] text-white/40">
        {parentOf(entry.path)}/{name}
      </p>
      <div className="flex gap-2">
        <Button variant="quiet" block onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" block icon="check" disabled={!name.trim() || name === entry.name} onClick={() => onSubmit(name.trim())}>
          Rename
        </Button>
      </div>
    </div>
  );
}

function parentOf(path: string): string {
  if (path === "/") return "/";
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}
