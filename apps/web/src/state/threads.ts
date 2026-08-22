import { useAtomValue } from "@effect/atom-react";
import {
  createEnvironmentThreadDetailAtoms,
  createEnvironmentThreadShellAtoms,
  createEnvironmentThreadStateAtoms,
  EMPTY_ENVIRONMENT_THREAD_STATE,
  type EnvironmentThreadState,
  ThreadSnapshotLoader,
  createThreadEnvironmentAtoms,
} from "@t3tools/client-runtime/state/threads";
import type {
  EnvironmentId,
  OrchestrationThreadDetailSnapshot,
  ThreadId,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { createRuntimeCommand } from "@t3tools/client-runtime/state/runtime";
import type { PreparedConnection } from "@t3tools/client-runtime/connection";

import { environmentCatalog } from "../connection/catalog";
import { connectionAtomRuntime } from "../connection/runtime";
import { environmentSnapshotAtom } from "./shell";
import { mergeTransferredThreadSnapshotPage } from "../threadTransfer";

export const threadEnvironment = createThreadEnvironmentAtoms(connectionAtomRuntime);
export const environmentThreads = createEnvironmentThreadStateAtoms(connectionAtomRuntime);
export const environmentThreadDetails = createEnvironmentThreadDetailAtoms(
  environmentThreads.stateAtom,
);
export const environmentThreadShells = createEnvironmentThreadShellAtoms({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  snapshotAtom: environmentSnapshotAtom,
});

class ThreadTransferSnapshotNotFoundError extends Schema.TaggedErrorClass<ThreadTransferSnapshotNotFoundError>()(
  "ThreadTransferSnapshotNotFoundError",
  {},
) {
  override get message(): string {
    return "The source chat could not be loaded.";
  }
}

export const loadFullThreadSnapshot = createRuntimeCommand(connectionAtomRuntime, {
  label: "web:thread-transfer:load-full-snapshot",
  execute: (input: {
    readonly prepared: PreparedConnection;
    readonly threadId: ThreadId;
    readonly supportsPagination: boolean;
  }) =>
    Effect.gen(function* () {
      const loader = yield* ThreadSnapshotLoader;
      if (!input.supportsPagination) {
        const snapshot = yield* loader.load(input.prepared, input.threadId);
        if (Option.isNone(snapshot)) return yield* new ThreadTransferSnapshotNotFoundError();
        return snapshot.value;
      }

      let loaded: OrchestrationThreadDetailSnapshot | null = null;
      let beforeCursor: string | undefined;
      const seenCursors = new Set<string>();
      while (true) {
        const page = yield* loader.load(input.prepared, input.threadId, {
          turnLimit: 10,
          ...(beforeCursor === undefined ? {} : { beforeCursor }),
        });
        if (Option.isNone(page)) return yield* new ThreadTransferSnapshotNotFoundError();
        loaded =
          loaded === null ? page.value : mergeTransferredThreadSnapshotPage(loaded, page.value);
        const nextCursor = page.value.page?.beforeCursor ?? null;
        if (page.value.page?.hasMore !== true || nextCursor === null) break;
        if (seenCursors.has(nextCursor)) {
          return yield* new ThreadTransferSnapshotNotFoundError();
        }
        seenCursors.add(nextCursor);
        beforeCursor = nextCursor;
      }
      if (loaded === null) return yield* new ThreadTransferSnapshotNotFoundError();
      const { page: _page, ...complete } = loaded;
      return complete;
    }),
});

const EMPTY_THREAD_STATE_ATOM = Atom.make(AsyncResult.success(EMPTY_ENVIRONMENT_THREAD_STATE)).pipe(
  Atom.withLabel("web-environment-thread:empty"),
);

export function useEnvironmentThread(
  environmentId: EnvironmentId | null,
  threadId: ThreadId | null,
): EnvironmentThreadState {
  const result = useAtomValue(
    environmentId !== null && threadId !== null
      ? environmentThreads.stateAtom(environmentId, threadId)
      : EMPTY_THREAD_STATE_ATOM,
  );
  return Option.getOrElse(
    AsyncResult.value(result),
    () => EMPTY_ENVIRONMENT_THREAD_STATE,
  ) as EnvironmentThreadState;
}
