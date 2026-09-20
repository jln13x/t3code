import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  planSidebarThreadDrop,
  resolveSidebarDropTarget,
  sidebarListItemId,
  type SidebarListItem,
  type SidebarSection,
} from "./Sidebar.logic";
import {
  groupSidebarListItems,
  orderSidebarThreadsByWorktree,
  sidebarWorktreeKey,
} from "./Sidebar.worktrees";

const checkout = {
  environmentId: EnvironmentId.make("local"),
  projectId: ProjectId.make("project"),
  worktreePath: "/repo/worktrees/feature",
};
const row = (key: string, section: SidebarSection): SidebarListItem => ({
  kind: "thread",
  key,
  section,
});
const keys = new Map([
  ["a", "checkout"],
  ["b", "checkout"],
  ["c", "other"],
  ["done", "checkout"],
]);
const items: SidebarListItem[] = [
  { kind: "marker", marker: "pinned-header" },
  row("pin2", "pinned"),
  row("pin1", "pinned"),
  { kind: "marker", marker: "pinned-divider" },
  row("a", "active"),
  row("c", "active"),
  row("b", "active"),
  { kind: "marker", marker: "settled-header" },
  row("done", "settled"),
];

it("keeps checkout identity scoped to both project and environment", () => {
  const key = sidebarWorktreeKey(checkout);
  expect(sidebarWorktreeKey({ ...checkout, environmentId: EnvironmentId.make("remote") })).not.toBe(
    key,
  );
  expect(sidebarWorktreeKey({ ...checkout, projectId: ProjectId.make("other") })).not.toBe(key);
  expect(sidebarWorktreeKey({ ...checkout, worktreePath: "/repo/worktrees/other" })).not.toBe(key);
  expect(sidebarWorktreeKey({ ...checkout, worktreePath: "/repo/worktrees/feature " })).not.toBe(
    key,
  );
});

it("groups main-checkout threads despite different recorded branches", () => {
  const first = { ...checkout, id: "a", worktreePath: null, branch: "old-branch" };
  const second = { ...checkout, id: "b", worktreePath: "", branch: "main" };
  const other = { ...checkout, id: "c", branch: "main" };
  expect(orderSidebarThreadsByWorktree([first, other, second])).toEqual([first, second, other]);
});

it("keeps first-member group order and upstream order within each group", () => {
  const a = { ...checkout, id: "a" };
  const b = { ...checkout, id: "b" };
  const c = { ...checkout, id: "c", worktreePath: "/other" };
  const input = [c, b, a];
  expect(orderSidebarThreadsByWorktree(input)).toEqual([c, b, a]);
  expect(orderSidebarThreadsByWorktree([b, c, a])).toEqual([b, a, c]);
  expect(input).toEqual([c, b, a]);
});

it("keeps settled siblings visible in their own section and pins independently ordered", () => {
  const grouped = groupSidebarListItems(items, keys);
  expect(grouped.filter((item) => item.kind === "thread")).toEqual([
    row("pin2", "pinned"),
    row("pin1", "pinned"),
    row("a", "active"),
    row("b", "active"),
    row("c", "active"),
    row("done", "settled"),
  ]);
  expect(
    grouped
      .filter((item) => item.kind === "worktree")
      .map((item) => [item.section, item.threadKey]),
  ).toEqual([
    ["active", "a"],
    ["active", "c"],
    ["settled", "done"],
  ]);
  expect(new Set(grouped.map(sidebarListItemId)).size).toBe(grouped.length);
  expect(groupSidebarListItems(grouped, keys)).toEqual(grouped);
});

it("does not materialize hidden shelf threads or merge snoozed and active siblings", () => {
  const grouped = groupSidebarListItems(
    [
      row("a", "active"),
      { kind: "marker", marker: "snoozed-header" },
      row("b", "snoozed"),
      { kind: "marker", marker: "settled-header" },
    ],
    keys,
  );
  expect(grouped.filter((item) => item.kind === "thread")).toEqual([
    row("a", "active"),
    row("b", "snoozed"),
  ]);
  expect(grouped.filter((item) => item.kind === "worktree").map((item) => item.section)).toEqual([
    "active",
    "snoozed",
  ]);
});

describe("upstream thread dragging through checkout headers", () => {
  const grouped = groupSidebarListItems(items, keys);
  const header = grouped.find((item) => item.kind === "worktree")!;

  it("does not allow a checkout header to become a drag source", () => {
    expect(resolveSidebarDropTarget(grouped, sidebarListItemId(header), "c")).toBeNull();
  });

  it("never includes checkout headers in persisted thread ordering", () => {
    const target = resolveSidebarDropTarget(grouped, "c", sidebarListItemId(header));
    expect(target).toEqual({
      section: "active",
      pinnedOrder: ["pin2", "pin1"],
      activeOrder: ["c", "a", "b"],
    });
  });

  it("pins only the conversation picked up, leaving its sibling active", () => {
    const target = resolveSidebarDropTarget(grouped, "b", "pin1");
    expect(target).not.toBeNull();
    const plan = planSidebarThreadDrop({
      activeKey: "b",
      activeSection: "active",
      target: target!,
      pinnedOrder: ["pin2", "pin1"],
      pinnedKeysById: new Map([
        ["pin2", "a0"],
        ["pin1", "a1"],
      ]),
      activeOrder: ["a", "b", "c"],
      activeKeysById: new Map([
        ["a", "a0"],
        ["b", "a1"],
        ["c", "a2"],
      ]),
    });
    expect(plan.kind).toBe("pin");
    if (plan.kind !== "pin") throw new Error("Expected a single-thread pin");
    expect(plan.order).toEqual(["pin2", "b", "pin1"]);
    expect(plan.extraAssignments.map((assignment) => assignment.id)).not.toContain("a");
    expect(target?.activeOrder).toEqual(["a", "c"]);
  });
});
