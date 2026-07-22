import type {
  EnvironmentId,
  OrchestrationEvent,
  OrchestrationSessionStatus,
  OrchestrationShellSnapshot,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  deliverPendingThreadCompletionNotifications,
  initializeThreadCompletionNotificationState,
  parseThreadCompletionNotificationState,
  reduceThreadCompletionNotificationEvents,
} from "./threadCompletionNotifications";

const ENVIRONMENT_ID = "environment-1" as EnvironmentId;
const PROJECT_THREAD_ID = "project-thread" as ThreadId;
const STANDALONE_THREAD_ID = "standalone-thread" as ThreadId;
const TURN_ID = "turn-1" as TurnId;

function snapshot(input: {
  readonly sequence: number;
  readonly sessions?: ReadonlyArray<{
    readonly threadId: ThreadId;
    readonly title: string;
    readonly status: OrchestrationSessionStatus;
    readonly turnId: TurnId | null;
  }>;
}): OrchestrationShellSnapshot {
  return {
    snapshotSequence: input.sequence,
    projects: [],
    threads: (input.sessions ?? []).map((entry) => ({
      id: entry.threadId,
      title: entry.title,
      session: {
        threadId: entry.threadId,
        status: entry.status,
        activeTurnId: entry.turnId,
      },
    })),
    updatedAt: "2026-07-21T12:00:00.000Z",
  } as unknown as OrchestrationShellSnapshot;
}

function sessionEvent(input: {
  readonly sequence: number;
  readonly threadId: ThreadId;
  readonly status: OrchestrationSessionStatus;
  readonly turnId: TurnId | null;
}): OrchestrationEvent {
  return {
    sequence: input.sequence,
    eventId: `event-${input.sequence}`,
    aggregateKind: "thread",
    aggregateId: input.threadId,
    occurredAt: "2026-07-21T12:00:00.000Z",
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type: "thread.session-set",
    payload: {
      threadId: input.threadId,
      session: {
        threadId: input.threadId,
        status: input.status,
        providerName: "codex",
        runtimeMode: "full-access",
        activeTurnId: input.turnId,
        lastError: null,
        updatedAt: "2026-07-21T12:00:00.000Z",
      },
    },
  } as OrchestrationEvent;
}

describe("thread completion notification event tracking", () => {
  it("seeds a live running turn without notifying for earlier completions", () => {
    const state = initializeThreadCompletionNotificationState(
      snapshot({
        sequence: 10,
        sessions: [
          {
            threadId: PROJECT_THREAD_ID,
            title: "Project chat",
            status: "running",
            turnId: TURN_ID,
          },
        ],
      }),
    );

    expect(state.cursor).toBe(10);
    expect(state.activeTurnByThread[PROJECT_THREAD_ID]).toBe(TURN_ID);
    expect(state.pending).toEqual([]);
  });

  it("recovers a completion from a collapsed remote reconnect event batch", () => {
    const currentSnapshot = snapshot({
      sequence: 3,
      sessions: [
        {
          threadId: PROJECT_THREAD_ID,
          title: "Remote project chat",
          status: "ready",
          turnId: null,
        },
        {
          threadId: STANDALONE_THREAD_ID,
          title: "Remote standalone chat",
          status: "ready",
          turnId: null,
        },
      ],
    });
    const initial = initializeThreadCompletionNotificationState(snapshot({ sequence: 1 }));
    const state = reduceThreadCompletionNotificationEvents({
      state: initial,
      snapshot: currentSnapshot,
      notificationsEnabled: true,
      events: [
        sessionEvent({
          sequence: 2,
          threadId: PROJECT_THREAD_ID,
          status: "running",
          turnId: TURN_ID,
        }),
        sessionEvent({
          sequence: 3,
          threadId: PROJECT_THREAD_ID,
          status: "ready",
          turnId: null,
        }),
      ],
    });

    expect(state.cursor).toBe(3);
    expect(state.pending).toEqual([
      {
        id: `${PROJECT_THREAD_ID}:${TURN_ID}`,
        threadId: PROJECT_THREAD_ID,
        threadTitle: "Remote project chat",
      },
    ]);
  });

  it("survives reload between turn start and completion and does not duplicate replayed events", () => {
    const initial = initializeThreadCompletionNotificationState(snapshot({ sequence: 1 }));
    const running = reduceThreadCompletionNotificationEvents({
      state: initial,
      snapshot: snapshot({ sequence: 2 }),
      notificationsEnabled: true,
      events: [
        sessionEvent({
          sequence: 2,
          threadId: STANDALONE_THREAD_ID,
          status: "running",
          turnId: TURN_ID,
        }),
      ],
    });
    const reloaded = parseThreadCompletionNotificationState(JSON.stringify(running));
    expect(reloaded).not.toBeNull();

    const completed = reduceThreadCompletionNotificationEvents({
      state: reloaded!,
      snapshot: snapshot({
        sequence: 3,
        sessions: [
          {
            threadId: STANDALONE_THREAD_ID,
            title: "Standalone chat",
            status: "idle",
            turnId: null,
          },
        ],
      }),
      notificationsEnabled: true,
      events: [
        sessionEvent({
          sequence: 3,
          threadId: STANDALONE_THREAD_ID,
          status: "idle",
          turnId: null,
        }),
      ],
    });
    const replayed = reduceThreadCompletionNotificationEvents({
      state: completed,
      snapshot: snapshot({ sequence: 3 }),
      notificationsEnabled: true,
      events: [
        sessionEvent({
          sequence: 2,
          threadId: STANDALONE_THREAD_ID,
          status: "running",
          turnId: TURN_ID,
        }),
        sessionEvent({
          sequence: 3,
          threadId: STANDALONE_THREAD_ID,
          status: "idle",
          turnId: null,
        }),
      ],
    });

    expect(replayed.pending).toHaveLength(1);
    expect(replayed.pending[0]?.threadTitle).toBe("Standalone chat");
  });

  it("advances the cursor without queuing success notifications while disabled", () => {
    const state = reduceThreadCompletionNotificationEvents({
      state: initializeThreadCompletionNotificationState(snapshot({ sequence: 1 })),
      snapshot: snapshot({ sequence: 3 }),
      notificationsEnabled: false,
      events: [
        sessionEvent({
          sequence: 2,
          threadId: PROJECT_THREAD_ID,
          status: "running",
          turnId: TURN_ID,
        }),
        sessionEvent({
          sequence: 3,
          threadId: PROJECT_THREAD_ID,
          status: "ready",
          turnId: null,
        }),
      ],
    });

    expect(state.cursor).toBe(3);
    expect(state.pending).toEqual([]);
  });

  it("keeps the active turn across a transient starting session", () => {
    const state = reduceThreadCompletionNotificationEvents({
      state: initializeThreadCompletionNotificationState(snapshot({ sequence: 1 })),
      snapshot: snapshot({
        sequence: 4,
        sessions: [
          {
            threadId: PROJECT_THREAD_ID,
            title: "Restarted provider",
            status: "ready",
            turnId: null,
          },
        ],
      }),
      notificationsEnabled: true,
      events: [
        sessionEvent({
          sequence: 2,
          threadId: PROJECT_THREAD_ID,
          status: "running",
          turnId: TURN_ID,
        }),
        sessionEvent({
          sequence: 3,
          threadId: PROJECT_THREAD_ID,
          status: "starting",
          turnId: null,
        }),
        sessionEvent({
          sequence: 4,
          threadId: PROJECT_THREAD_ID,
          status: "ready",
          turnId: null,
        }),
      ],
    });

    expect(state.pending).toHaveLength(1);
  });

  it.each(["error", "interrupted", "stopped"] as const)(
    "does not notify when a running turn ends as %s",
    (status) => {
      const state = reduceThreadCompletionNotificationEvents({
        state: initializeThreadCompletionNotificationState(snapshot({ sequence: 1 })),
        snapshot: snapshot({ sequence: 3 }),
        notificationsEnabled: true,
        events: [
          sessionEvent({
            sequence: 2,
            threadId: PROJECT_THREAD_ID,
            status: "running",
            turnId: TURN_ID,
          }),
          sessionEvent({
            sequence: 3,
            threadId: PROJECT_THREAD_ID,
            status,
            turnId: null,
          }),
        ],
      });

      expect(state.pending).toEqual([]);
    },
  );
});

describe("thread completion notification delivery", () => {
  const pendingState = reduceThreadCompletionNotificationEvents({
    state: initializeThreadCompletionNotificationState(snapshot({ sequence: 1 })),
    snapshot: snapshot({
      sequence: 3,
      sessions: [
        {
          threadId: PROJECT_THREAD_ID,
          title: "Retry me",
          status: "ready",
          turnId: null,
        },
      ],
    }),
    notificationsEnabled: true,
    events: [
      sessionEvent({
        sequence: 2,
        threadId: PROJECT_THREAD_ID,
        status: "running",
        turnId: TURN_ID,
      }),
      sessionEvent({
        sequence: 3,
        threadId: PROJECT_THREAD_ID,
        status: "ready",
        turnId: null,
      }),
    ],
  });

  it("keeps a failed native delivery pending for a later retry", async () => {
    const progress = vi.fn();
    const first = await deliverPendingThreadCompletionNotifications({
      state: pendingState,
      environmentId: ENVIRONMENT_ID,
      show: vi.fn().mockResolvedValue(false),
      onProgress: progress,
    });

    expect(first.failed).toBe(true);
    expect(first.state.pending).toHaveLength(1);
    expect(progress).not.toHaveBeenCalled();

    const show = vi.fn().mockResolvedValue(true);
    const second = await deliverPendingThreadCompletionNotifications({
      state: first.state,
      environmentId: ENVIRONMENT_ID,
      show,
      onProgress: progress,
    });

    expect(second.failed).toBe(false);
    expect(second.state.pending).toEqual([]);
    expect(show).toHaveBeenCalledWith({
      threadRef: { environmentId: ENVIRONMENT_ID, threadId: PROJECT_THREAD_ID },
      threadTitle: "Retry me",
    });
    expect(progress).toHaveBeenCalledWith(second.state);
  });

  it("keeps a rejected IPC delivery pending and exposes the cause", async () => {
    const cause = new Error("renderer disconnected");
    const result = await deliverPendingThreadCompletionNotifications({
      state: pendingState,
      environmentId: ENVIRONMENT_ID,
      show: vi.fn().mockRejectedValue(cause),
      onProgress: vi.fn(),
    });

    expect(result.failed).toBe(true);
    expect(result.cause).toBe(cause);
    expect(result.state.pending).toHaveLength(1);
  });
});
