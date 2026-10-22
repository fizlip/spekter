"use client";

import { useEffect, useState } from "react";
import { Box, ChevronRight, File, Folder, FolderOpen, FolderTree, Package, Triangle } from "lucide-react";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import type { WorkspaceNode, WorkspaceTrees } from "@/core/workspace/tree";

const POLL_MS = 10_000;

// One set tracks every node whose open state differs from its default (live workspaces default
// open, everything else closed), so expansion survives polls without copying the tree.
function useExpansion() {
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set());
  return {
    isOpen: (key: string, defaultOpen: boolean) => flipped.has(key) !== defaultOpen,
    toggle: (key: string) =>
      setFlipped((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }),
  };
}

function RecentDot() {
  return <span title="Modified recently" className="ml-auto size-1.5 shrink-0 rounded-full bg-blue-500" />;
}

function TreeNode({
  node,
  prefix,
  depth,
  isOpen,
  toggle,
}: {
  node: WorkspaceNode;
  prefix: string;
  depth: number;
  isOpen: (key: string, defaultOpen: boolean) => boolean;
  toggle: (key: string) => void;
}) {
  const key = `${prefix}/${node.name}`;
  const open = node.kind === "dir" && !node.unlisted && isOpen(key, false);
  const rowClass =
    "flex h-6 w-full items-center gap-1.5 rounded-md pr-2 text-left text-xs text-gray-600 truncate";

  if (node.kind === "file") {
    return (
      <div className={rowClass} style={{ paddingLeft: 8 + depth * 14 }}>
        <File size={12} className="shrink-0 text-gray-400" />
        <span className="truncate">{node.name}</span>
        {node.recent && <RecentDot />}
      </div>
    );
  }

  const Icon = node.unlisted ? Package : open ? FolderOpen : Folder;
  return (
    <>
      <button
        type="button"
        onClick={() => !node.unlisted && toggle(key)}
        className={`${rowClass} ${node.unlisted ? "cursor-default text-gray-400" : "hover:bg-[#e1e1e2] cursor-pointer"}`}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        <Icon size={12} className="shrink-0 text-gray-400" />
        <span className="truncate">{node.name}</span>
        <ChevronRight
          size={10}
          className={`shrink-0 text-gray-400 transition-transform ${open ? "rotate-90" : ""} ${node.unlisted ? "invisible" : ""}`}
        />
        {node.recent && <RecentDot />}
      </button>
      {open &&
        node.children?.map((child) => (
          <TreeNode key={child.name} node={child} prefix={key} depth={depth + 1} isOpen={isOpen} toggle={toggle} />
        ))}
    </>
  );
}

function WorkspaceRow({
  workspace,
  isOpen,
  toggle,
}: {
  workspace: WorkspaceTrees["workspaces"][number];
  isOpen: (key: string, defaultOpen: boolean) => boolean;
  toggle: (key: string) => void;
}) {
  const open = isOpen(workspace.id, workspace.live);
  return (
    <>
      <button
        type="button"
        onClick={() => toggle(workspace.id)}
        className="flex h-6 w-full cursor-pointer items-center gap-1.5 rounded-md pr-2 text-left text-xs font-medium text-gray-700 hover:bg-[#e1e1e2]"
        style={{ paddingLeft: 8 }}
      >
        <Box size={12} className="shrink-0 text-gray-400" />
        <span className="truncate font-mono">{workspace.id}</span>
        <ChevronRight size={10} className={`shrink-0 text-gray-400 transition-transform ${open ? "rotate-90" : ""}`} />
        {workspace.live ? (
          <span
            title={workspace.state === "ready" ? "Live box" : `Box ${workspace.state}`}
            className="ml-auto size-1.5 shrink-0 animate-pulse rounded-full bg-emerald-700 animate-pulse"
          />
        ) : (
          <span title="Workspace kept after its box was destroyed" className="ml-auto size-1.5 shrink-0 rounded-full bg-transparent" />
        )}
      </button>
      {open && (
        workspace.nodes.length === 0 ? (
          <div className="pr-2 text-xs text-gray-400" style={{ paddingLeft: 8 + 14 }}>
            empty
          </div>
        ) : (
          workspace.nodes.map((node) => (
            <TreeNode key={node.name} node={node} prefix={workspace.id} depth={1} isOpen={isOpen} toggle={toggle} />
          ))
        )
      )}
      {open && workspace.truncated && (
        <div className="pr-2 text-xs text-gray-400" style={{ paddingLeft: 8 + 14 }}>
          … listing truncated
        </div>
      )}
    </>
  );
}

export function WorkspaceTree() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<WorkspaceTrees | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { isOpen, toggle } = useExpansion();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/workspace/tree", { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const next = (await response.json()) as WorkspaceTrees;
        if (!cancelled) {
          setData(next);
          setError(null);
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      }
    }
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [open]);

  return (
    <SidebarGroup>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            onClick={() => setOpen((value) => !value)}
            className="flex m-auto font-semibold font-inter hover:bg-[#e1e1e2] cursor-pointer text-xs hover:text-black text-gray-500"
          >
            <p className="">Workspace</p>
            <Triangle
              fill="currentColor"
              className={`size-2! text-gray-500 transition-transform ${open ? "rotate-180" : "rotate-90"}`}
            />
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      {open && (
        <div className="mt-1 flex flex-col gap-0.5">
          {error && <p className="px-2 text-xs text-red-600">Couldn&apos;t load workspaces</p>}
          {!error && !data && <p className="px-2 text-xs text-gray-400">Loading…</p>}
          {data?.workspaces.map((workspace) => (
            <WorkspaceRow key={workspace.id} workspace={workspace} isOpen={isOpen} toggle={toggle} />
          ))}
          {data && data.workspaces.length === 0 && (
            <p className="px-2 text-xs text-gray-400">No workspaces yet</p>
          )}
          {data?.daemon === "unreachable" && (
            <p className="px-2 pt-1 text-[10px] text-gray-400">sandboxd unreachable — live status unknown</p>
          )}
          {data?.daemon === "unconfigured" && (
            <p className="px-2 pt-1 text-[10px] text-gray-400">SANDBOX_TOKEN not set — live status unknown</p>
          )}
        </div>
      )}
    </SidebarGroup>
  );
}
