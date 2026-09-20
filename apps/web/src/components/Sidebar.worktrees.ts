import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";

import type { SidebarListItem } from "./Sidebar.logic";

type CheckoutThread = Pick<EnvironmentThreadShell, "environmentId" | "projectId" | "worktreePath">;

/** Main-checkout conversations share a group even if their recorded branches differ. */
export function sidebarWorktreeKey(thread: CheckoutThread): string {
  return JSON.stringify([thread.environmentId, thread.projectId, thread.worktreePath || null]);
}

function groupInOrder<T>(items: readonly T[], keyOf: (item: T) => string): T[][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.values()];
}

/** Keep upstream order within each checkout; the first member anchors its group. */
export function orderSidebarThreadsByWorktree<T extends CheckoutThread>(
  threads: readonly T[],
): T[] {
  return groupInOrder(threads, sidebarWorktreeKey).flat();
}

/** Headers are measured with the rows, but never become thread commands or drag sources. */
export function groupSidebarListItems(
  items: readonly SidebarListItem[],
  worktreeKeys: ReadonlyMap<string, string>,
): SidebarListItem[] {
  const result: SidebarListItem[] = [];
  let pending: Extract<SidebarListItem, { kind: "thread" }>[] = [];
  const flush = () => {
    for (const group of groupInOrder(pending, (item) => worktreeKeys.get(item.key) ?? item.key)) {
      const first = group[0]!;
      result.push({
        kind: "worktree",
        key: `sidebar-worktree:${first.section}:${worktreeKeys.get(first.key) ?? first.key}`,
        threadKey: first.key,
        section: first.section,
      });
      result.push(...group);
    }
    pending = [];
  };
  for (const item of items) {
    if (item.kind === "worktree") continue;
    if (item.kind === "thread" && item.section !== "pinned") {
      if (pending[0] && pending[0].section !== item.section) flush();
      pending.push(item);
    } else {
      flush();
      result.push(item);
    }
  }
  flush();
  return result;
}
