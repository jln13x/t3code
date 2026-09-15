import { describe, expect, it } from "vite-plus/test";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";

import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE } from "../types";
import {
  buildSidebarWorktreeGroups,
  activeWorktreeMemberKeys,
  planSidebarWorktreeDrop,
  sidebarWorktreeDragThread,
  pickWorktreeGroupRepresentative,
  resolveWorktreeThreadIndicator,
  sidebarThreadKey,
  type SidebarThreadClassification,
  visibleWorktreeGroupMemberIndexes,
} from "./SidebarV2.logic";

const environmentId = EnvironmentId.make("environment-local");

function makeShell(overrides: Partial<EnvironmentThreadShell> = {}): EnvironmentThreadShell {
  return {
    id: ThreadId.make("thread-1"),
    environmentId,
    projectId: ProjectId.make("project-1"),
    title: "Thread",
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
    },
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-03-09T10:00:00.000Z",
    updatedAt: "2026-03-09T10:00:00.000Z",
    archivedAt: null,
    pinnedAt: null,
    pinOrderKey: null,
    activeOrderKey: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  } as EnvironmentThreadShell;
}

function classifyAll(
  threads: EnvironmentThreadShell[],
  classification: SidebarThreadClassification = "active",
) {
  return threads.map((thread) => ({ thread, classification }));
}

describe("buildSidebarWorktreeGroups", () => {
  it("groups threads sharing a worktree path into one card, oldest member first", () => {
    const older = makeShell({
      id: ThreadId.make("thread-older"),
      worktreePath: "/wt/feature",
      createdAt: "2026-03-09T10:00:00.000Z",
    });
    const newer = makeShell({
      id: ThreadId.make("thread-newer"),
      worktreePath: "/wt/feature",
      createdAt: "2026-03-09T11:00:00.000Z",
    });
    const { activeGroups } = buildSidebarWorktreeGroups(classifyAll([newer, older]));
    expect(activeGroups).toHaveLength(1);
    expect(activeGroups[0]!.threads.map((thread) => thread.id)).toEqual([older.id, newer.id]);
    expect(activeGroups[0]!.memberKeys).toEqual([sidebarThreadKey(older), sidebarThreadKey(newer)]);
  });

  it("groups local-checkout threads (null worktreePath) per project, not per thread", () => {
    const localA = makeShell({ id: ThreadId.make("thread-a") });
    const localB = makeShell({ id: ThreadId.make("thread-b") });
    const otherProject = makeShell({
      id: ThreadId.make("thread-c"),
      projectId: ProjectId.make("project-2"),
    });
    const { activeGroups } = buildSidebarWorktreeGroups(
      classifyAll([localA, localB, otherProject]),
    );
    expect(activeGroups).toHaveLength(2);
    const sizes = activeGroups.map((group) => group.threads.length).toSorted();
    expect(sizes).toEqual([1, 2]);
  });

  it("keeps distinct worktrees as distinct cards", () => {
    const first = makeShell({ id: ThreadId.make("thread-a"), worktreePath: "/wt/one" });
    const second = makeShell({ id: ThreadId.make("thread-b"), worktreePath: "/wt/two" });
    const { activeGroups } = buildSidebarWorktreeGroups(classifyAll([first, second]));
    expect(activeGroups).toHaveLength(2);
  });

  it("classifies the group by its most-alive member: any active member keeps the card active", () => {
    const settled = makeShell({ id: ThreadId.make("thread-settled"), worktreePath: "/wt/x" });
    const active = makeShell({ id: ThreadId.make("thread-active"), worktreePath: "/wt/x" });
    const { activeGroups, settledGroups } = buildSidebarWorktreeGroups([
      { thread: settled, classification: "settled" },
      { thread: active, classification: "active" },
    ]);
    expect(activeGroups).toHaveLength(1);
    expect(settledGroups).toHaveLength(0);
    expect(activeGroups[0]!.threads).toHaveLength(2);
  });

  it("shelves a group as snoozed when members are snoozed and none active", () => {
    const snoozed = makeShell({
      id: ThreadId.make("thread-snoozed"),
      worktreePath: "/wt/x",
      snoozedUntil: "2026-03-10T10:00:00.000Z",
    });
    const settled = makeShell({ id: ThreadId.make("thread-settled"), worktreePath: "/wt/x" });
    const { activeGroups, snoozedGroups, settledGroups } = buildSidebarWorktreeGroups([
      { thread: snoozed, classification: "snoozed" },
      { thread: settled, classification: "settled" },
    ]);
    expect(activeGroups).toHaveLength(0);
    expect(snoozedGroups).toHaveLength(1);
    expect(settledGroups).toHaveLength(0);
  });

  it("shelves a group as settled only when every member settled", () => {
    const first = makeShell({
      id: ThreadId.make("thread-a"),
      worktreePath: "/wt/x",
      settledAt: "2026-03-09T12:00:00.000Z",
    });
    const second = makeShell({
      id: ThreadId.make("thread-b"),
      worktreePath: "/wt/x",
      settledAt: "2026-03-09T13:00:00.000Z",
    });
    const { settledGroups } = buildSidebarWorktreeGroups(classifyAll([first, second], "settled"));
    expect(settledGroups).toHaveLength(1);
    expect(settledGroups[0]!.threads).toHaveLength(2);
  });

  it("orders cards statically by their newest member, newest worktree on top", () => {
    const oldWorktree = makeShell({
      id: ThreadId.make("thread-old"),
      worktreePath: "/wt/old",
      createdAt: "2026-03-09T09:00:00.000Z",
    });
    const busyWorktreeOldMember = makeShell({
      id: ThreadId.make("thread-busy-old"),
      worktreePath: "/wt/busy",
      createdAt: "2026-03-09T08:00:00.000Z",
    });
    const busyWorktreeNewMember = makeShell({
      id: ThreadId.make("thread-busy-new"),
      worktreePath: "/wt/busy",
      createdAt: "2026-03-09T12:00:00.000Z",
    });
    const { activeGroups } = buildSidebarWorktreeGroups(
      classifyAll([oldWorktree, busyWorktreeOldMember, busyWorktreeNewMember]),
    );
    expect(activeGroups.map((group) => group.threads[0]!.worktreePath)).toEqual([
      "/wt/busy",
      "/wt/old",
    ]);
  });

  it("surfaces the checkout card for an un-settled thread via its re-entry stamp", () => {
    const oldUnsettled = makeShell({
      id: ThreadId.make("thread-old-unsettled"),
      worktreePath: "/wt/old",
      createdAt: "2026-03-09T08:00:00.000Z",
      unsettledAt: "2026-03-09T13:00:00.000Z",
    });
    const newer = makeShell({
      id: ThreadId.make("thread-newer"),
      worktreePath: "/wt/newer",
      createdAt: "2026-03-09T12:00:00.000Z",
    });

    const { activeGroups } = buildSidebarWorktreeGroups(classifyAll([oldUnsettled, newer]));

    expect(activeGroups.map((group) => group.threads[0]!.worktreePath)).toEqual([
      "/wt/old",
      "/wt/newer",
    ]);
  });
});

describe("pickWorktreeGroupRepresentative", () => {
  it("prefers the route thread when it is a member", () => {
    const first = makeShell({ id: ThreadId.make("thread-a"), worktreePath: "/wt/x" });
    const second = makeShell({ id: ThreadId.make("thread-b"), worktreePath: "/wt/x" });
    const { activeGroups } = buildSidebarWorktreeGroups(classifyAll([first, second]));
    const representative = pickWorktreeGroupRepresentative(
      activeGroups[0]!,
      sidebarThreadKey(first),
    );
    expect(representative.id).toBe(first.id);
  });

  it("uses the most recently settled member for settled groups", () => {
    const earlier = makeShell({
      id: ThreadId.make("thread-a"),
      worktreePath: "/wt/x",
      settledAt: "2026-03-09T12:00:00.000Z",
    });
    const later = makeShell({
      id: ThreadId.make("thread-b"),
      worktreePath: "/wt/x",
      settledAt: "2026-03-09T15:00:00.000Z",
    });
    const { settledGroups } = buildSidebarWorktreeGroups(classifyAll([earlier, later], "settled"));
    expect(pickWorktreeGroupRepresentative(settledGroups[0]!, null).id).toBe(later.id);
  });

  it("uses the soonest-waking snoozed member for snoozed groups", () => {
    const wakesLater = makeShell({
      id: ThreadId.make("thread-a"),
      worktreePath: "/wt/x",
      snoozedUntil: "2026-03-11T10:00:00.000Z",
    });
    const wakesSooner = makeShell({
      id: ThreadId.make("thread-b"),
      worktreePath: "/wt/x",
      snoozedUntil: "2026-03-10T10:00:00.000Z",
    });
    const { snoozedGroups } = buildSidebarWorktreeGroups(
      classifyAll([wakesLater, wakesSooner], "snoozed"),
    );
    expect(pickWorktreeGroupRepresentative(snoozedGroups[0]!, null).id).toBe(wakesSooner.id);
  });
});

describe("visibleWorktreeGroupMemberIndexes", () => {
  it("hides settled siblings from an active checkout card", () => {
    const settled = makeShell({ id: ThreadId.make("thread-settled"), worktreePath: "/wt/x" });
    const active = makeShell({ id: ThreadId.make("thread-active"), worktreePath: "/wt/x" });
    const snoozed = makeShell({ id: ThreadId.make("thread-snoozed"), worktreePath: "/wt/x" });
    const { activeGroups } = buildSidebarWorktreeGroups([
      { thread: settled, classification: "settled" },
      { thread: active, classification: "active" },
      { thread: snoozed, classification: "snoozed" },
    ]);

    const group = activeGroups[0]!;
    expect(
      visibleWorktreeGroupMemberIndexes(group).map((index) => group.threads[index]!.id),
    ).toEqual([active.id, snoozed.id]);
  });

  it("keeps every member in collapsed shelf groups", () => {
    const first = makeShell({ id: ThreadId.make("thread-a"), worktreePath: "/wt/x" });
    const second = makeShell({ id: ThreadId.make("thread-b"), worktreePath: "/wt/x" });
    const { settledGroups } = buildSidebarWorktreeGroups(classifyAll([first, second], "settled"));

    expect(visibleWorktreeGroupMemberIndexes(settledGroups[0]!)).toEqual([0, 1]);
  });
});

describe("checkout drag ordering", () => {
  const a = makeShell({ id: ThreadId.make("a"), worktreePath: "/wt/a", activeOrderKey: "d" });
  const b = makeShell({ id: ThreadId.make("b"), worktreePath: "/wt/a", activeOrderKey: "f" });
  const c = makeShell({ id: ThreadId.make("c"), worktreePath: "/wt/c", activeOrderKey: "m" });
  const parked = makeShell({
    id: ThreadId.make("parked"),
    worktreePath: "/wt/a",
    settledOverride: "settled",
    activeOrderKey: null,
  });
  const keys = [a, b, c, parked].map(sidebarThreadKey);
  function input() {
    const groups = buildSidebarWorktreeGroups([
      ...classifyAll([a, b, c]),
      { thread: parked, classification: "settled" },
    ]).activeGroups;
    return {
      activeKey: keys[0]!,
      pickedThreadKey: keys[1]!,
      activeSection: "active" as const,
      supportsSettlement: true,
      target: { section: "active" as const, activeOrder: [keys[2]!, keys[0]!], pinnedOrder: [] },
      activeOrder: groups.flatMap(activeWorktreeMemberKeys),
      activeKeysById: new Map(
        [a, b, c, parked].map((thread) => [sidebarThreadKey(thread), thread.activeOrderKey]),
      ),
      pinnedOrder: [],
      pinnedKeysById: new Map<string, string | null>(),
      reorderableKeys: new Set(keys),
      activeReorderableKeys: new Set(keys),
      groupsByThreadKey: new Map(
        groups.flatMap((group) => group.memberKeys.map((key) => [key, group] as const)),
      ),
      threadsByKey: new Map([a, b, c, parked].map((thread) => [sidebarThreadKey(thread), thread])),
    };
  }

  it("moves every active sibling as a block without waking a settled sibling", () => {
    const plan = planSidebarWorktreeDrop(input());
    expect(plan.kind).toBe("move-active");
    if (plan.kind !== "move-active") throw new Error("Expected active move");
    expect(plan.order).toEqual([keys[2], keys[0], keys[1]]);
    expect(plan.memberKeys).toEqual([keys[0], keys[1]]);
    expect(plan.assignments.map(({ id }) => id)).toEqual([keys[0], keys[1]]);
    const assignments = new Map(plan.assignments.map(({ id, orderKey }) => [id, orderKey]));
    const moved = [a, b, c].map((thread) => ({
      ...thread,
      activeOrderKey: assignments.get(sidebarThreadKey(thread)) ?? thread.activeOrderKey,
    }));
    const groups = buildSidebarWorktreeGroups(classifyAll(moved)).activeGroups;
    expect(groups.map((group) => group.threads[0]!.worktreePath)).toEqual(["/wt/c", "/wt/a"]);
    expect(groups[1]!.memberKeys).toEqual([keys[0], keys[1]]);
    expect(plan.unsettle).toBe(false);
  });

  it("pins the picked conversation rather than the card's measured representative", () => {
    const base = input();
    const plan = planSidebarWorktreeDrop({
      ...base,
      target: { ...base.target, section: "pinned", pinnedOrder: [keys[0]!] },
    });
    expect(plan.kind).toBe("pin");
    expect(plan.memberKeys).toEqual([keys[1]]);
    expect(plan.movedKey).toBe(keys[1]);
    if (plan.kind !== "pin") throw new Error("Expected pin");
    expect(plan.order).toEqual([keys[1]]);
  });

  it("settles the checkout including its hidden siblings", () => {
    const base = input();
    const plan = planSidebarWorktreeDrop({
      ...base,
      target: { ...base.target, section: "settled" },
    });
    expect(plan.kind).toBe("settle");
    expect(new Set(plan.memberKeys)).toEqual(new Set([keys[0], keys[1], keys[3]]));
  });

  it("rejects a block move if a required sibling cannot save active order", () => {
    const base = input();
    base.activeReorderableKeys.delete(keys[1]!);
    expect(planSidebarWorktreeDrop(base).kind).toBe("none");
  });

  it("can settle a snoozed checkout when its open representative is already settled", () => {
    const base = input();
    const snoozed = { ...b, snoozedUntil: "2030-01-01T00:00:00Z" };
    const group = buildSidebarWorktreeGroups([
      { thread: parked, classification: "settled" },
      { thread: snoozed, classification: "snoozed" },
    ]).snoozedGroups[0]!;
    const plan = planSidebarWorktreeDrop({
      ...base,
      activeKey: keys[3]!,
      activeSection: "snoozed",
      activeSettled: true,
      groupsByThreadKey: new Map(group.memberKeys.map((key) => [key, group])),
      target: { ...base.target, section: "settled" },
    });
    expect(plan.kind).toBe("settle");
    expect(new Set(plan.memberKeys)).toEqual(new Set([keys[1], keys[3]]));
  });

  it("never uses a hidden settled sibling as an active drag identity", () => {
    const groups = buildSidebarWorktreeGroups([
      { thread: { ...parked, createdAt: "2020-01-01T00:00:00Z" }, classification: "settled" },
      ...classifyAll([a, b]),
    ]).activeGroups;
    expect(sidebarWorktreeDragThread(groups[0]!).id).toBe(a.id);
  });

  it("keeps new keyless checkouts ahead of arranged checkouts", () => {
    const fresh = makeShell({
      id: ThreadId.make("fresh"),
      worktreePath: "/wt/fresh",
      activeOrderKey: null,
    });
    const groups = buildSidebarWorktreeGroups(classifyAll([a, b, fresh])).activeGroups;
    expect(groups[0]!.threads[0]!.id).toBe(fresh.id);
  });
});

describe("resolveWorktreeThreadIndicator", () => {
  it("uses the working indicator while a thread is running", () => {
    expect(
      resolveWorktreeThreadIndicator({ status: "working", isUnread: false, isSnoozed: false }),
    ).toBe("working");
  });

  it("uses an unread marker after a thread finishes", () => {
    expect(
      resolveWorktreeThreadIndicator({ status: "ready", isUnread: true, isSnoozed: false }),
    ).toBe("unread");
  });

  it("uses a clock for a thread that is still snoozed", () => {
    expect(
      resolveWorktreeThreadIndicator({ status: "ready", isUnread: false, isSnoozed: true }),
    ).toBe("snoozed");
  });

  it("shows no persistent marker for a read thread at rest", () => {
    expect(
      resolveWorktreeThreadIndicator({ status: "ready", isUnread: false, isSnoozed: false }),
    ).toBeNull();
  });
});
