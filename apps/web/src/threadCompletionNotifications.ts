import type {
  EnvironmentId,
  OrchestrationEvent,
  OrchestrationShellSnapshot,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";

const STORAGE_KEY_PREFIX = "t3code:thread-completion-notifications:v1:";
const STATE_VERSION = 1;
const MAX_PENDING_NOTIFICATIONS = 100;

export interface PendingThreadCompletionNotification {
  readonly id: string;
  readonly threadId: ThreadId;
  readonly threadTitle: string;
}

export interface ThreadCompletionNotificationState {
  readonly version: typeof STATE_VERSION;
  readonly cursor: number;
  readonly activeTurnByThread: Readonly<Record<string, TurnId>>;
  readonly pending: ReadonlyArray<PendingThreadCompletionNotification>;
}

export interface ThreadCompletionNotificationDeliveryResult {
  readonly state: ThreadCompletionNotificationState;
  readonly failed: boolean;
  readonly cause?: unknown;
}

function storageKey(environmentId: EnvironmentId): string {
  return `${STORAGE_KEY_PREFIX}${environmentId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseThreadCompletionNotificationState(
  raw: string,
): ThreadCompletionNotificationState | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !isRecord(value) ||
      value.version !== STATE_VERSION ||
      typeof value.cursor !== "number" ||
      !Number.isSafeInteger(value.cursor) ||
      value.cursor < 0 ||
      !isRecord(value.activeTurnByThread) ||
      !Array.isArray(value.pending)
    ) {
      return null;
    }

    const activeTurnByThread: Record<string, TurnId> = {};
    for (const [threadId, turnId] of Object.entries(value.activeTurnByThread)) {
      if (typeof turnId !== "string") return null;
      activeTurnByThread[threadId] = turnId as TurnId;
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
      cursor: value.cursor,
      activeTurnByThread,
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
  snapshot: OrchestrationShellSnapshot,
): ThreadCompletionNotificationState {
  const activeTurnByThread: Record<string, TurnId> = {};
  for (const thread of snapshot.threads) {
    if (thread.session?.status === "running" && thread.session.activeTurnId !== null) {
      activeTurnByThread[thread.id] = thread.session.activeTurnId;
    }
  }

  return {
    version: STATE_VERSION,
    cursor: snapshot.snapshotSequence,
    activeTurnByThread,
    pending: [],
  };
}

export function clearPendingThreadCompletionNotifications(
  state: ThreadCompletionNotificationState,
): ThreadCompletionNotificationState {
  return state.pending.length === 0 ? state : { ...state, pending: [] };
}

export function reduceThreadCompletionNotificationEvents(input: {
  readonly state: ThreadCompletionNotificationState;
  readonly events: ReadonlyArray<OrchestrationEvent>;
  readonly snapshot: OrchestrationShellSnapshot;
  readonly notificationsEnabled: boolean;
}): ThreadCompletionNotificationState {
  let cursor = input.state.cursor;
  const activeTurnByThread: Record<string, TurnId> = {
    ...input.state.activeTurnByThread,
  };
  const pending = [...input.state.pending];
  const pendingIds = new Set(pending.map((notification) => notification.id));
  const titleByThread = new Map(
    input.snapshot.threads.map((thread) => [thread.id as string, thread.title]),
  );

  const events = [...input.events].sort((left, right) => left.sequence - right.sequence);
  for (const event of events) {
    if (event.sequence <= cursor) continue;
    cursor = event.sequence;

    if (event.type === "thread.created") {
      titleByThread.set(event.payload.threadId, event.payload.title);
      continue;
    }
    if (event.type === "thread.meta-updated" && event.payload.title !== undefined) {
      titleByThread.set(event.payload.threadId, event.payload.title);
      continue;
    }
    if (event.type === "thread.deleted") {
      delete activeTurnByThread[event.payload.threadId];
      continue;
    }
    if (event.type !== "thread.session-set") continue;

    const { session, threadId } = event.payload;
    if (session.status === "starting") {
      continue;
    }
    if (session.status === "running") {
      if (session.activeTurnId !== null) {
        activeTurnByThread[threadId] = session.activeTurnId;
      }
      continue;
    }

    const activeTurnId = activeTurnByThread[threadId];
    delete activeTurnByThread[threadId];
    if (
      activeTurnId === undefined ||
      !input.notificationsEnabled ||
      (session.status !== "idle" && session.status !== "ready")
    ) {
      continue;
    }

    const id = `${threadId}:${activeTurnId}`;
    if (pendingIds.has(id)) continue;
    pendingIds.add(id);
    pending.push({
      id,
      threadId,
      threadTitle: titleByThread.get(threadId) ?? "Thread",
    });
  }

  return {
    version: STATE_VERSION,
    cursor,
    activeTurnByThread,
    pending: pending.slice(-MAX_PENDING_NOTIFICATIONS),
  };
}

export async function deliverPendingThreadCompletionNotifications(input: {
  readonly state: ThreadCompletionNotificationState;
  readonly environmentId: EnvironmentId;
  readonly show: (input: {
    readonly threadRef: { readonly environmentId: EnvironmentId; readonly threadId: ThreadId };
    readonly threadTitle: string;
  }) => Promise<boolean>;
  readonly onProgress: (state: ThreadCompletionNotificationState) => void | Promise<void>;
}): Promise<ThreadCompletionNotificationDeliveryResult> {
  let state = input.state;
  while (state.pending.length > 0) {
    const notification = state.pending[0]!;
    let shown: boolean;
    try {
      shown = await input.show({
        threadRef: {
          environmentId: input.environmentId,
          threadId: notification.threadId,
        },
        threadTitle: notification.threadTitle,
      });
    } catch (cause) {
      return { state, failed: true, cause };
    }
    if (!shown) {
      return { state, failed: true };
    }
    state = {
      version: state.version,
      cursor: state.cursor,
      activeTurnByThread: state.activeTurnByThread,
      pending: state.pending.slice(1),
    };
    await input.onProgress(state);
  }
  return { state, failed: false };
}
