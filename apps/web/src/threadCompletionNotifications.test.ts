import type { OrchestrationThreadShell } from "@t3tools/contracts";
import { TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  initializeThreadCompletionNotificationState,
  parseThreadCompletionNotificationState,
  reduceThreadCompletionNotificationState,
  removeDeliveredThreadCompletionNotification,
} from "./threadCompletionNotifications";

function makeThread(overrides: Partial<OrchestrationThreadShell> = {}): OrchestrationThreadShell {
  return {
    id: "thread-1",
    projectId: "project-1",
    title: "Remote thread",
    modelSelection: null,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-08-22T12:00:00.000Z",
    updatedAt: "2026-08-22T12:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  } as OrchestrationThreadShell;
}

function runningThread(): OrchestrationThreadShell {
  return makeThread({
    latestTurn: {
      turnId: TurnId.make("turn-1"),
      state: "running",
      requestedAt: "2026-08-22T12:00:01.000Z",
      startedAt: "2026-08-22T12:00:02.000Z",
      completedAt: null,
      assistantMessageId: null,
    },
  });
}

function completedThread(): OrchestrationThreadShell {
  const running = runningThread();
  return makeThread({
    latestTurn: {
      ...running.latestTurn!,
      state: "completed",
      completedAt: "2026-08-22T12:01:00.000Z",
    },
  });
}

describe("thread completion notification state", () => {
  it("silently baselines completions that existed before notification tracking starts", () => {
    const state = initializeThreadCompletionNotificationState([completedThread()]);

    expect(state.pending).toEqual([]);
    expect(state.completedTurnByThread["thread-1"]).toBe("turn-1:2026-08-22T12:01:00.000Z");
  });

  it("queues a live completion once", () => {
    const initial = initializeThreadCompletionNotificationState([runningThread()]);
    const completed = reduceThreadCompletionNotificationState(initial, [completedThread()]);
    const unchanged = reduceThreadCompletionNotificationState(completed, [completedThread()]);

    expect(completed.pending).toEqual([
      {
        id: "thread-1:turn-1:2026-08-22T12:01:00.000Z",
        threadId: "thread-1",
        threadTitle: "Remote thread",
      },
    ]);
    expect(unchanged.pending).toEqual(completed.pending);
  });

  it("queues a thread that completed while a remote environment was disconnected", () => {
    const persisted = initializeThreadCompletionNotificationState([]);
    const reconnected = reduceThreadCompletionNotificationState(persisted, [completedThread()]);

    expect(reconnected.pending).toHaveLength(1);
    expect(reconnected.pending[0]?.threadId).toBe("thread-1");
  });

  it("keeps pending delivery across serialization and removes it after acknowledgement", () => {
    const pending = reduceThreadCompletionNotificationState(
      initializeThreadCompletionNotificationState([runningThread()]),
      [completedThread()],
    );
    const restored = parseThreadCompletionNotificationState(JSON.stringify(pending));

    expect(restored).toEqual(pending);
    expect(
      removeDeliveredThreadCompletionNotification(restored!, pending.pending[0]!.id).pending,
    ).toEqual([]);
  });

  it("rejects malformed persisted state", () => {
    expect(parseThreadCompletionNotificationState('{"version":1,"pending":[]}')).toBeNull();
  });
});
