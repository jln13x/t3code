import type {
  MessageId,
  ModelSelection,
  ProviderInteractionMode,
  RuntimeMode,
  ScopedThreadRef,
  UploadChatAttachment,
} from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { create } from "zustand";

export interface ClientQueuedTurn {
  readonly id: MessageId;
  readonly text: string;
  readonly attachments: ReadonlyArray<UploadChatAttachment>;
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly createdAt: string;
}

interface ClientTurnQueueStoreState {
  readonly queuesByThreadKey: Readonly<Record<string, ReadonlyArray<ClientQueuedTurn>>>;
  enqueue: (threadRef: ScopedThreadRef, turn: ClientQueuedTurn) => void;
  take: (threadRef: ScopedThreadRef, messageId: MessageId) => ClientQueuedTurn | null;
  remove: (threadRef: ScopedThreadRef, messageId: MessageId) => void;
  requeueFront: (threadRef: ScopedThreadRef, turn: ClientQueuedTurn) => void;
}

function withoutEmptyQueue(
  queuesByThreadKey: ClientTurnQueueStoreState["queuesByThreadKey"],
  threadKey: string,
  nextQueue: ReadonlyArray<ClientQueuedTurn>,
): ClientTurnQueueStoreState["queuesByThreadKey"] {
  if (nextQueue.length > 0) {
    return { ...queuesByThreadKey, [threadKey]: nextQueue };
  }
  const { [threadKey]: _removed, ...remainingQueues } = queuesByThreadKey;
  return remainingQueues;
}

export const useClientTurnQueueStore = create<ClientTurnQueueStoreState>()((set, get) => ({
  queuesByThreadKey: {},
  enqueue: (threadRef, turn) => {
    const threadKey = scopedThreadKey(threadRef);
    set((state) => ({
      queuesByThreadKey: {
        ...state.queuesByThreadKey,
        [threadKey]: [...(state.queuesByThreadKey[threadKey] ?? []), turn],
      },
    }));
  },
  take: (threadRef, messageId) => {
    const threadKey = scopedThreadKey(threadRef);
    const state = get();
    const queue = state.queuesByThreadKey[threadKey] ?? [];
    const turn = queue.find((candidate) => candidate.id === messageId) ?? null;
    if (!turn) return null;
    set({
      queuesByThreadKey: withoutEmptyQueue(
        state.queuesByThreadKey,
        threadKey,
        queue.filter((candidate) => candidate.id !== messageId),
      ),
    });
    return turn;
  },
  remove: (threadRef, messageId) => {
    const threadKey = scopedThreadKey(threadRef);
    set((state) => {
      const queue = state.queuesByThreadKey[threadKey];
      if (!queue?.some((candidate) => candidate.id === messageId)) return state;
      return {
        queuesByThreadKey: withoutEmptyQueue(
          state.queuesByThreadKey,
          threadKey,
          queue.filter((candidate) => candidate.id !== messageId),
        ),
      };
    });
  },
  requeueFront: (threadRef, turn) => {
    const threadKey = scopedThreadKey(threadRef);
    set((state) => ({
      queuesByThreadKey: {
        ...state.queuesByThreadKey,
        [threadKey]: [
          turn,
          ...(state.queuesByThreadKey[threadKey] ?? []).filter(
            (candidate) => candidate.id !== turn.id,
          ),
        ],
      },
    }));
  },
}));
