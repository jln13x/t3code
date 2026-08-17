import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, MessageId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";

import { type ClientQueuedTurn, useClientTurnQueueStore } from "./clientTurnQueueStore";

const firstThread = scopeThreadRef(EnvironmentId.make("environment-1"), ThreadId.make("thread-1"));
const secondThread = scopeThreadRef(EnvironmentId.make("environment-1"), ThreadId.make("thread-2"));

function queuedTurn(id: string): ClientQueuedTurn {
  return {
    id: MessageId.make(id),
    text: id,
    attachments: [],
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    createdAt: "2026-08-17T10:00:00.000Z",
  };
}

describe("clientTurnQueueStore", () => {
  it("keeps FIFO queues isolated per thread", () => {
    useClientTurnQueueStore.setState({ queuesByThreadKey: {} });
    const store = useClientTurnQueueStore.getState();

    store.enqueue(firstThread, queuedTurn("first"));
    store.enqueue(firstThread, queuedTurn("second"));
    store.enqueue(secondThread, queuedTurn("other-thread"));

    expect(store.take(firstThread, MessageId.make("first"))?.text).toBe("first");
    expect(store.take(firstThread, MessageId.make("second"))?.text).toBe("second");
    expect(store.take(secondThread, MessageId.make("other-thread"))?.text).toBe("other-thread");
  });

  it("can delete an item and restore a failed dispatch to the front", () => {
    useClientTurnQueueStore.setState({ queuesByThreadKey: {} });
    const store = useClientTurnQueueStore.getState();
    const first = queuedTurn("first");

    store.enqueue(firstThread, first);
    store.enqueue(firstThread, queuedTurn("second"));
    store.remove(firstThread, MessageId.make("second"));
    store.requeueFront(firstThread, first);

    expect(store.take(firstThread, MessageId.make("first"))).toEqual(first);
    expect(store.take(firstThread, MessageId.make("second"))).toBeNull();
  });
});
