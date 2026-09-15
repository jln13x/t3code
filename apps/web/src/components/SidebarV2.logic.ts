import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import {
  sortActiveThreadsByOrderKey,
  resolveSettledThreadTimestamp,
  generateSpreadPinOrderKeys,
  pinOrderKeyBetween,
} from "@t3tools/client-runtime/state/thread-sort";

import { threadWorktreeScopeKey } from "../worktreeScope";
import {
  firstValidTimestampMs,
  parseTimestampMs,
  planSidebarThreadDrop,
  type SidebarThreadStatus,
} from "./Sidebar.logic";

export type SidebarWorktreeSection = "active" | "snoozed" | "settled";

export type SidebarThreadClassification = "active" | "snoozed" | "settled";

/** One sidebar row/card: every visible thread sharing a checkout (git
    worktree, or the project workspace root for local-mode threads). */
export interface SidebarWorktreeGroup {
  readonly key: string;
  readonly section: SidebarWorktreeSection;
  /** Members in creation order (oldest first) — the in-card row order. */
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  /** Member classifications aligned with `threads`. */
  readonly classifications: ReadonlyArray<SidebarThreadClassification>;
  /** Scoped thread keys aligned with `threads` (stable identity for memo props). */
  readonly memberKeys: ReadonlyArray<string>;
}

export function sidebarThreadKey(thread: EnvironmentThreadShell): string {
  return scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
}

/** Active checkout cards only show conversations that still belong in the
    inbox. Settled siblings remain in the group so checkout-scoped resources
    and lifecycle actions continue to account for them. */
export function visibleWorktreeGroupMemberIndexes(group: SidebarWorktreeGroup): number[] {
  if (group.section !== "active") return group.threads.map((_, index) => index);
  return group.classifications.flatMap((classification, index) =>
    classification === "settled" ? [] : [index],
  );
}

function groupSettledTimestampMs(group: SidebarWorktreeGroup): number {
  let latest = 0;
  for (const thread of group.threads) {
    const timestamp = resolveSettledThreadTimestamp(thread);
    if (timestamp !== null) latest = Math.max(latest, parseTimestampMs(timestamp));
  }
  return latest;
}

function groupSoonestWakeMs(group: SidebarWorktreeGroup): number {
  let soonest = Number.POSITIVE_INFINITY;
  for (const [index, thread] of group.threads.entries()) {
    if (group.classifications[index] !== "snoozed") continue;
    soonest = Math.min(soonest, firstValidTimestampMs(thread.snoozedUntil ?? null));
  }
  return soonest;
}

/** Stable drag identity; never use a hidden settled sibling for an active card. */
export function sidebarWorktreeDragThread(group: SidebarWorktreeGroup): EnvironmentThreadShell {
  const activeIndex = group.classifications.indexOf("active");
  return group.threads[activeIndex === -1 ? 0 : activeIndex]!;
}

export function activeWorktreeMemberKeys(group: SidebarWorktreeGroup): string[] {
  return group.memberKeys.filter((_, index) => group.classifications[index] === "active");
}

/** Translate measured checkout cards to upstream per-conversation order writes.
 * Pinning remains per conversation; ordering and lifecycle moves keep checkout
 * siblings together. No new server command or client-local order is needed. */
export function planSidebarWorktreeDrop(input: Parameters<typeof planSidebarThreadDrop>[0] & {
  readonly pickedThreadKey: string;
  readonly groupsByThreadKey: ReadonlyMap<string, SidebarWorktreeGroup>;
  readonly threadsByKey: ReadonlyMap<string, EnvironmentThreadShell>;
}) {
  const group = input.groupsByThreadKey.get(input.activeKey);
  const pickedKey = group?.memberKeys.includes(input.pickedThreadKey)
    ? input.pickedThreadKey
    : input.activeKey;
  if (input.target.section === "pinned") {
    const picked = input.threadsByKey.get(pickedKey);
    return {
      ...planSidebarThreadDrop({
        ...input,
        activeKey: pickedKey,
        activePinned: picked?.pinnedAt != null,
        activeSettled: picked?.settledOverride === "settled",
        target: {
          ...input.target,
          pinnedOrder: input.target.pinnedOrder.map((key) => key === input.activeKey ? pickedKey : key),
        },
      }),
      memberKeys: [pickedKey],
      movedKey: pickedKey,
    };
  }
  const memberKeys = group?.memberKeys ?? [input.activeKey];
  if (input.target.section === "settled") {
    return { ...planSidebarThreadDrop(input), memberKeys, movedKey: input.activeKey };
  }
  const movingThread = input.threadsByKey.get(input.activeKey);
  const movingScope = movingThread ? threadWorktreeScopeKey(movingThread) : null;
  const movingActiveGroup = [...input.groupsByThreadKey.values()].find(
    (candidate) => candidate.section === "active" && candidate.key === movingScope,
  );
  const movingOrder = group
    ? input.activeSection === "active" ? activeWorktreeMemberKeys(group) : [...memberKeys]
    : [...(movingActiveGroup ? activeWorktreeMemberKeys(movingActiveGroup) : []), input.activeKey];
  const order = input.target.activeOrder.flatMap((key) => {
    if (key === input.activeKey) return movingOrder;
    const candidate = input.groupsByThreadKey.get(key);
    if (candidate?.key === movingScope) return [];
    return candidate ? activeWorktreeMemberKeys(candidate) : [key];
  });
  const { activeReorderableKeys, ...threadDropInput } = input;
  const plan = planSidebarThreadDrop({
      ...threadDropInput,
      // An active card may include parked siblings; an in-section reorder
      // must not wake them merely because the measured representative changed.
      activeSettled: input.activeSection === "settled",
      target: { ...input.target, activeOrder: order },
      // The block planner below checks exactly the writes it will perform.

    });
  if (plan.kind === "move-active") {
    const assignments = planWorktreeActiveReorder(order, movingOrder, input.activeKeysById);
    if (activeReorderableKeys && assignments.some(({ id }) => !activeReorderableKeys.has(id))) {
      return { kind: "none" as const, memberKeys, movedKey: input.activeKey };
    }
    return { ...plan, assignments, memberKeys: input.activeSection === "active" ? movingOrder : memberKeys, movedKey: input.activeKey };
  }
  return {
    ...plan,
    memberKeys: input.activeSection === "active" ? movingOrder : memberKeys,
    movedKey: input.activeKey,
  };
}

/** Assign the moved block between its neighbors, reserving hidden keys just as
 * upstream does. Materialize the whole visible order only for keyless/corrupt
 * neighbors; no filtered or archived conversation receives a write. */
function planWorktreeActiveReorder(
  order: readonly string[],
  moving: readonly string[],
  keys: ReadonlyMap<string, string | null | undefined>,
) {
  const first = order.indexOf(moving[0]!);
  const last = first + moving.length - 1;
  const beforeId = order[first - 1];
  const afterId = order[last + 1];
  let before = beforeId === undefined ? null : keys.get(beforeId) ?? null;
  const after = afterId === undefined ? null : keys.get(afterId) ?? null;
  const visible = new Set(order);
  const reserved = new Set([...keys].flatMap(([id, key]) => !visible.has(id) && key != null ? [key] : []));
  const assignments: Array<{ id: string; orderKey: string }> = [];
  if ((beforeId === undefined || before !== null) && (afterId === undefined || after !== null)) {
    for (const id of moving) {
      let key = pinOrderKeyBetween(before, after);
      while (key !== null && reserved.has(key)) key = pinOrderKeyBetween(key, after);
      if (key === null) break;
      assignments.push({ id, orderKey: key });
      before = key;
    }
    if (assignments.length === moving.length) return assignments;
  }
  const spread = generateSpreadPinOrderKeys(order.length + reserved.size).filter((key) => !reserved.has(key));
  return order.flatMap((id, index) => keys.get(id) === spread[index] ? [] : [{ id, orderKey: spread[index]! }]);
}

/**
 * Group per-thread classifications into worktree rows. A worktree with any
 * active member is a full card (settled/snoozed members ride along inside
 * it); with none active it collapses to the snoozed shelf when any member
 * is snoozed, else to the settled tail. Sorting mirrors the per-thread
 * rules: cards follow upstream active order keys (new keyless checkouts stay
 * above arranged ones), snoozed groups order by soonest
 * wake, settled groups by most recent wrap-up.
 */
export function buildSidebarWorktreeGroups(
  classified: ReadonlyArray<{
    readonly thread: EnvironmentThreadShell;
    readonly classification: SidebarThreadClassification;
  }>,
): {
  activeGroups: SidebarWorktreeGroup[];
  snoozedGroups: SidebarWorktreeGroup[];
  settledGroups: SidebarWorktreeGroup[];
} {
  const byKey = new Map<
    string,
    { threads: EnvironmentThreadShell[]; classifications: SidebarThreadClassification[] }
  >();
  for (const { thread, classification } of classified) {
    const key = threadWorktreeScopeKey(thread);
    const entry = byKey.get(key) ?? { threads: [], classifications: [] };
    entry.threads.push(thread);
    entry.classifications.push(classification);
    byKey.set(key, entry);
  }

  const activeGroups: SidebarWorktreeGroup[] = [];
  const snoozedGroups: SidebarWorktreeGroup[] = [];
  const settledGroups: SidebarWorktreeGroup[] = [];
  for (const [key, entry] of byKey) {
    const order = entry.threads
      .map((_, index) => index)
      .toSorted(
        (left, right) =>
          parseTimestampMs(entry.threads[left]!.createdAt) -
            parseTimestampMs(entry.threads[right]!.createdAt) ||
          entry.threads[left]!.id.localeCompare(entry.threads[right]!.id),
      );
    const threads = order.map((index) => entry.threads[index]!);
    const classifications = order.map((index) => entry.classifications[index]!);
    const memberKeys = threads.map(sidebarThreadKey);
    const section: SidebarWorktreeSection = classifications.includes("active")
      ? "active"
      : classifications.includes("snoozed")
        ? "snoozed"
        : "settled";
    const group: SidebarWorktreeGroup = { key, section, threads, classifications, memberKeys };
    if (section === "active") activeGroups.push(group);
    else if (section === "snoozed") snoozedGroups.push(group);
    else settledGroups.push(group);
  }

  // The first active member in upstream order anchors the whole checkout.
  // A group drag writes a contiguous run of ordinary per-thread order keys.
  const ranked = sortActiveThreadsByOrderKey(
    classified.filter((entry) => entry.classification === "active").map((entry) => entry.thread),
  );
  const rankByGroup = new Map<string, number>();
  for (const [rank, thread] of ranked.entries()) {
    const key = threadWorktreeScopeKey(thread);
    if (!rankByGroup.has(key)) rankByGroup.set(key, rank);
  }
  activeGroups.sort((left, right) => rankByGroup.get(left.key)! - rankByGroup.get(right.key)!);
  snoozedGroups.sort(
    (left, right) =>
      groupSoonestWakeMs(left) - groupSoonestWakeMs(right) || left.key.localeCompare(right.key),
  );
  settledGroups.sort(
    (left, right) =>
      groupSettledTimestampMs(right) - groupSettledTimestampMs(left) ||
      left.key.localeCompare(right.key),
  );
  return { activeGroups, snoozedGroups, settledGroups };
}

/**
 * The thread a collapsed (slim) group row stands in for: the route thread
 * when it's a member (so highlight and pull-into-view keep pointing at what
 * the user has open), otherwise the member matching the shelf's own sort
 * story — soonest wake for snoozed groups, most recent wrap-up for settled
 * ones, newest member for cards.
 */
export function pickWorktreeGroupRepresentative(
  group: SidebarWorktreeGroup,
  routeThreadKey: string | null,
): EnvironmentThreadShell {
  if (routeThreadKey !== null) {
    const routeMember = group.threads.find((thread) => sidebarThreadKey(thread) === routeThreadKey);
    if (routeMember !== undefined) return routeMember;
  }
  if (group.section === "snoozed") {
    let best: EnvironmentThreadShell | null = null;
    let bestWake = Number.POSITIVE_INFINITY;
    for (const [index, thread] of group.threads.entries()) {
      if (group.classifications[index] !== "snoozed") continue;
      const wake = firstValidTimestampMs(thread.snoozedUntil ?? null);
      if (wake < bestWake || best === null) {
        best = thread;
        bestWake = wake;
      }
    }
    if (best !== null) return best;
  }
  if (group.section === "settled") {
    let best: EnvironmentThreadShell | null = null;
    let bestMs = Number.NEGATIVE_INFINITY;
    for (const thread of group.threads) {
      const timestamp = resolveSettledThreadTimestamp(thread);
      const ms = timestamp === null ? 0 : parseTimestampMs(timestamp);
      if (ms > bestMs || best === null) {
        best = thread;
        bestMs = ms;
      }
    }
    if (best !== null) return best;
  }
  return group.threads.reduce((newest, thread) =>
    parseTimestampMs(thread.createdAt) >= parseTimestampMs(newest.createdAt) ? thread : newest,
  );
}

export type SidebarWorktreeThreadIndicator =
  | "approval"
  | "input"
  | "working"
  | "monitoring"
  | "failed"
  | "snoozed"
  | "unread";

/** Pick the one compact marker rendered at the right edge of a member row. */
export function resolveWorktreeThreadIndicator(input: {
  status: SidebarThreadStatus;
  isUnread: boolean;
  isSnoozed: boolean;
}): SidebarWorktreeThreadIndicator | null {
  if (input.status !== "ready") return input.status;
  if (input.isSnoozed) return "snoozed";
  if (input.isUnread) return "unread";
  return null;
}
