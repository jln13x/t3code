import type { EnvironmentId, OrchestrationThreadShell, ThreadId } from "@t3tools/contracts";

const STORAGE_KEY_PREFIX = "t3code:thread-completion-notifications:v2:";
const STATE_VERSION = 1;
const MAX_PENDING_NOTIFICATIONS = 100;

export interface PendingThreadCompletionNotification {
  readonly id: string;
  readonly threadId: ThreadId;
  readonly threadTitle: string;
}

export interface ThreadCompletionNotificationState {
  readonly version: typeof STATE_VERSION;
  readonly completedTurnByThread: Readonly<Record<string, string | null>>;
  readonly pending: ReadonlyArray<PendingThreadCompletionNotification>;
}

function storageKey(environmentId: EnvironmentId): string {
  return `${STORAGE_KEY_PREFIX}${environmentId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function completedTurn(thread: OrchestrationThreadShell): string | null {
  const latestTurn = thread.latestTurn;
  if (latestTurn?.state !== "completed" || latestTurn.completedAt === null) {
    return null;
  }
  return `${latestTurn.turnId}:${latestTurn.completedAt}`;
}

export function parseThreadCompletionNotificationState(
  raw: string,
): ThreadCompletionNotificationState | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !isRecord(value) ||
      value.version !== STATE_VERSION ||
      !isRecord(value.completedTurnByThread) ||
      !Array.isArray(value.pending)
    ) {
      return null;
    }

    const completedTurnByThread: Record<string, string | null> = {};
    for (const [threadId, turn] of Object.entries(value.completedTurnByThread)) {
      if (turn !== null && typeof turn !== "string") return null;
      completedTurnByThread[threadId] = turn;
    }

    const pending: PendingThreadCompletionNotification[] = [];
    for (const candidate of value.pending) {
      if (
        !isRecord(candidate) ||
        typeof candidate.id !== "string" ||
        typeof candidate.threadId !== "string" ||
        typeof candidate.threadTitle !== "string"
      ) {
        return null;
      }
      pending.push({
        id: candidate.id,
        threadId: candidate.threadId as ThreadId,
        threadTitle: candidate.threadTitle,
      });
    }

    return {
      version: STATE_VERSION,
      completedTurnByThread,
      pending: pending.slice(-MAX_PENDING_NOTIFICATIONS),
    };
  } catch {
    return null;
  }
}

export function readThreadCompletionNotificationState(
  storage: Storage,
  environmentId: EnvironmentId,
): ThreadCompletionNotificationState | null {
  const raw = storage.getItem(storageKey(environmentId));
  return raw === null ? null : parseThreadCompletionNotificationState(raw);
}

export function writeThreadCompletionNotificationState(
  storage: Storage,
  environmentId: EnvironmentId,
  state: ThreadCompletionNotificationState,
): void {
  storage.setItem(storageKey(environmentId), JSON.stringify(state));
}

export function initializeThreadCompletionNotificationState(
  threads: ReadonlyArray<OrchestrationThreadShell>,
): ThreadCompletionNotificationState {
  return {
    version: STATE_VERSION,
    completedTurnByThread: Object.fromEntries(
      threads.map((thread) => [thread.id, completedTurn(thread)]),
    ),
    pending: [],
  };
}

export function reduceThreadCompletionNotificationState(
  state: ThreadCompletionNotificationState,
  threads: ReadonlyArray<OrchestrationThreadShell>,
): ThreadCompletionNotificationState {
  const completedTurnByThread = { ...state.completedTurnByThread };
  const pending = [...state.pending];
  const pendingIds = new Set(pending.map((notification) => notification.id));

  for (const thread of threads) {
    const nextCompletedTurn = completedTurn(thread);
    const hadThread = Object.hasOwn(completedTurnByThread, thread.id);
    const previousCompletedTurn = completedTurnByThread[thread.id];

    if (nextCompletedTurn !== null && (!hadThread || previousCompletedTurn !== nextCompletedTurn)) {
      const id = `${thread.id}:${nextCompletedTurn}`;
      if (!pendingIds.has(id)) {
        pendingIds.add(id);
        pending.push({ id, threadId: thread.id, threadTitle: thread.title });
      }
    }
    completedTurnByThread[thread.id] = nextCompletedTurn;
  }

  return {
    version: STATE_VERSION,
    completedTurnByThread,
    pending: pending.slice(-MAX_PENDING_NOTIFICATIONS),
  };
}

export function removeDeliveredThreadCompletionNotification(
  state: ThreadCompletionNotificationState,
  notificationId: string,
): ThreadCompletionNotificationState {
  return {
    ...state,
    pending: state.pending.filter((notification) => notification.id !== notificationId),
  };
}
