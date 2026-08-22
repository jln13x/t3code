import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect, useState } from "react";

import { readProjectFileOnce } from "../state/projects";
import { useAtomCommand } from "../state/use-atom-command";
import {
  loadTransferredThreadArchive,
  isTransferredThreadId,
  readCachedTransferredThreadArchive,
  transferredThreadManifestPath,
  type TransferredThreadArchive,
  type TransferredThreadFileContents,
} from "../threadTransfer";

interface TransferredThreadArchiveState {
  readonly archive: TransferredThreadArchive | null;
  readonly error: string | null;
  readonly loading: boolean;
}

function failureMessage<A, E>(failure: AsyncResult.Failure<A, E>): string {
  const error = squashAtomCommandFailure(failure);
  return error instanceof Error ? error.message : "Could not read the transferred chat history.";
}

export function useTransferredThreadArchive(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly cwd: string | null;
}): TransferredThreadArchiveState {
  const readFile = useAtomCommand(readProjectFileOnce, { reportFailure: false });
  const currentKey =
    input.cwd === null ? null : `${input.environmentId}:${input.threadId}:${input.cwd}`;
  const [state, setState] = useState<{
    readonly archive: TransferredThreadArchive | null;
    readonly error: string | null;
    readonly resolvedKey: string | null;
  }>(() => ({
    archive: readCachedTransferredThreadArchive(input.environmentId, input.threadId),
    error: null,
    resolvedKey: null,
  }));

  useEffect(() => {
    const cached = readCachedTransferredThreadArchive(input.environmentId, input.threadId);
    if (cached !== null) {
      setState({ archive: cached, error: null, resolvedKey: currentKey });
      return;
    }
    if (input.cwd === null) {
      setState({ archive: null, error: null, resolvedKey: null });
      return;
    }

    let cancelled = false;
    const read = async (relativePath: string): Promise<TransferredThreadFileContents> => {
      const result = await readFile({
        environmentId: input.environmentId,
        input: { cwd: input.cwd!, relativePath },
      });
      if (result._tag === "Failure") throw new Error(failureMessage(result));
      return result.value;
    };

    void (async () => {
      let manifest: TransferredThreadFileContents;
      try {
        manifest = await read(transferredThreadManifestPath(input.threadId));
      } catch {
        if (!cancelled) {
          setState({
            archive: null,
            error: isTransferredThreadId(input.threadId)
              ? "The destination history capsule is missing or cannot be read. The source recovery copy remains under Archive."
              : null,
            resolvedKey: currentKey,
          });
        }
        return;
      }
      try {
        const archive = await loadTransferredThreadArchive({
          destinationThreadId: input.threadId,
          readFile: (relativePath) =>
            relativePath === transferredThreadManifestPath(input.threadId)
              ? Promise.resolve(manifest)
              : read(relativePath),
        });
        if (!cancelled) setState({ archive, error: null, resolvedKey: currentKey });
      } catch (error) {
        if (!cancelled) {
          setState({
            archive: null,
            error: error instanceof Error ? error.message : "The transferred chat is unreadable.",
            resolvedKey: currentKey,
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentKey, input.cwd, input.environmentId, input.threadId, readFile]);

  return {
    archive: state.archive,
    error: state.error,
    loading: currentKey !== null && state.resolvedKey !== currentKey,
  };
}
