import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentThreadShell,
  ThreadRuntimeSummary,
} from "@t3tools/client-runtime/state/models";
import { describe, expect, it } from "vite-plus/test";

import {
  collectDuePinnedReminders,
  PINNED_REMINDER_INTERVAL_MS,
} from "./PinnedThreadReminders.logic";

const thread0 = { environmentId: "env", id: "thread" } as unknown as EnvironmentThreadShell;
const KEY = scopedThreadKey(scopeThreadRef(thread0.environmentId, thread0.id));
const start = Date.parse("2026-10-14T12:00:00Z");

function shell(overrides: Partial<EnvironmentThreadShell> = {}): EnvironmentThreadShell {
  return {
    environmentId: thread0.environmentId,
    id: thread0.id,
    pinnedAt: "2026-10-14T11:00:00Z",
    archivedAt: null,
    deletedAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    runtime: null,
    latestRun: null,
    ...overrides,
  } as unknown as EnvironmentThreadShell;
}

function check(
  thread: EnvironmentThreadShell,
  idleSince: ReadonlyMap<string, number>,
  now: number,
  viewingKey: string | null = null,
) {
  return collectDuePinnedReminders({ threads: [thread], idleSince, viewingKey, now });
}

describe("collectDuePinnedReminders", () => {
  it("reminds once per interval while a pinned thread stays idle", () => {
    const first = check(shell(), new Map(), start);
    expect(first.due).toEqual([]);
    expect(first.idleSince.get(KEY)).toBe(start);

    const early = check(shell(), first.idleSince, start + PINNED_REMINDER_INTERVAL_MS - 1);
    expect(early.due).toEqual([]);

    const dueAt = start + PINNED_REMINDER_INTERVAL_MS;
    const due = check(shell(), early.idleSince, dueAt);
    expect(due.due).toHaveLength(1);
    expect(due.idleSince.get(KEY)).toBe(dueAt);
  });

  it("restarts the clock after the agent runs", () => {
    const idle = new Map([[KEY, start]]);
    const running = check(
      shell({ runtime: { status: "running" } as ThreadRuntimeSummary }),
      idle,
      start + PINNED_REMINDER_INTERVAL_MS,
    );
    expect(running.due).toEqual([]);
    expect(running.idleSince.has(KEY)).toBe(false);
  });

  it("still reminds while the agent waits for approval", () => {
    const due = check(
      shell({ hasPendingApprovals: true, runtime: { status: "running" } as ThreadRuntimeSummary }),
      new Map([[KEY, start]]),
      start + PINNED_REMINDER_INTERVAL_MS,
    );
    expect(due.due).toHaveLength(1);
  });

  it("restarts the clock while the user is viewing the thread", () => {
    const now = start + PINNED_REMINDER_INTERVAL_MS;
    const viewing = check(shell(), new Map([[KEY, start]]), now, KEY);
    expect(viewing.due).toEqual([]);
    expect(viewing.idleSince.get(KEY)).toBe(now);
  });

  it.each([
    ["unpinned", { pinnedAt: null }],
    ["archived", { archivedAt: "2026-10-14T11:30:00Z" }],
    ["snoozed", { snoozedUntil: "2026-10-15T12:00:00Z", snoozedAt: "2026-10-14T11:30:00Z" }],
  ])("ignores %s threads", (_label, overrides) => {
    const result = check(
      shell(overrides),
      new Map([[KEY, start]]),
      start + PINNED_REMINDER_INTERVAL_MS,
    );
    expect(result.due).toEqual([]);
    expect(result.idleSince.size).toBe(0);
  });
});
