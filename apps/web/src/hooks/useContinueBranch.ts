import { RegistryContext } from "@effect/atom-react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { TerminalBufferState } from "@t3tools/client-runtime/state/terminal";
import { normalizeProjectPathForComparison } from "@t3tools/shared/path";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback, useContext } from "react";

import type { ContinueBranchTarget } from "../continueBranch";
import {
  continueBranchFetchCommand,
  continueBranchPushCommand,
  continueBranchTerminalCommand,
  resolveContinueBranchPushPlan,
  resolveContinueBranchRef,
} from "../continueBranch";
import { randomUUID } from "../lib/utils";
import { terminalEnvironment } from "../state/terminal";
import { vcsEnvironment } from "../state/vcs";
import { useEnvironments } from "../state/environments";
import { useAtomCommand } from "../state/use-atom-command";
import { useAtomQueryRunner } from "../state/use-atom-query-runner";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { useNewThreadHandler } from "./useHandleNewThread";

interface ContinueBranchInput {
  readonly sourceEnvironmentId: EnvironmentId;
  readonly sourceThreadId: ThreadId;
  readonly sourceCwd: string;
  readonly branch: string;
  readonly target: ContinueBranchTarget;
}

type TerminalCommandResult =
  | { readonly status: "success" }
  | { readonly status: "interrupted" }
  | { readonly status: "failure"; readonly message: string };

function failureMessage<A, E>(result: AsyncResult.Failure<A, E>): string {
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : "An error occurred.";
}

/**
 * Carries a branch between environments using only RPCs available on an
 * unmodified upstream server. Conversation state is intentionally not moved.
 */
export function useContinueBranch() {
  const atomRegistry = useContext(RegistryContext);
  const refreshStatus = useAtomCommand(vcsEnvironment.refreshStatus, { reportFailure: false });
  const listRefs = useAtomQueryRunner(vcsEnvironment.listRefs, { reportFailure: false });
  const createWorktree = useAtomCommand(vcsEnvironment.createWorktree, {
    reportFailure: false,
  });
  const openTerminal = useAtomCommand(terminalEnvironment.open, { reportFailure: false });
  const writeTerminal = useAtomCommand(terminalEnvironment.write, { reportFailure: false });
  const closeTerminal = useAtomCommand(terminalEnvironment.close, { reportFailure: false });
  const handleNewThread = useNewThreadHandler();
  const { environments } = useEnvironments();

  const runTerminalCommand = useCallback(
    async (input: {
      readonly environmentId: EnvironmentId;
      readonly threadId: ThreadId;
      readonly cwd: string;
      readonly command: string;
    }): Promise<TerminalCommandResult> => {
      const operationId = randomUUID().replaceAll("-", "");
      const terminalId = `branch-handoff-${operationId}`;
      const marker = `__T3_BRANCH_HANDOFF_${operationId}__:`;
      const openResult = await openTerminal({
        environmentId: input.environmentId,
        input: {
          threadId: input.threadId,
          terminalId,
          cwd: input.cwd,
          env: { GIT_TERMINAL_PROMPT: "0" },
        },
      });
      if (openResult._tag === "Failure") {
        return isAtomCommandInterrupted(openResult)
          ? { status: "interrupted" }
          : { status: "failure", message: failureMessage(openResult) };
      }

      const attachAtom = terminalEnvironment.attach({
        environmentId: input.environmentId,
        input: {
          threadId: input.threadId,
          terminalId,
          cwd: input.cwd,
        },
      });
      let unsubscribe = () => {};
      const unmount = atomRegistry.mount(attachAtom);
      let finishWait: (result: {
        readonly exitCode: number | null;
        readonly error: string | null;
      }) => void = () => {};
      const markerResult = new Promise<{
        readonly exitCode: number | null;
        readonly error: string | null;
      }>((resolve) => {
        let settled = false;
        let timeoutId: number | null = null;
        const finish = (result: {
          readonly exitCode: number | null;
          readonly error: string | null;
        }) => {
          if (settled) return;
          settled = true;
          if (timeoutId !== null) window.clearTimeout(timeoutId);
          unsubscribe();
          unmount();
          resolve(result);
        };
        finishWait = finish;
        const inspect = (result: AsyncResult.AsyncResult<TerminalBufferState, unknown>) => {
          if (result._tag === "Failure") {
            finish({ exitCode: null, error: failureMessage(result) });
            return;
          }
          if (result._tag !== "Success") return;
          if (result.value.error) {
            finish({ exitCode: null, error: result.value.error });
            return;
          }
          const markerOffset = result.value.buffer.lastIndexOf(marker);
          if (markerOffset < 0) return;
          const exitCode = Number.parseInt(
            result.value.buffer.slice(markerOffset + marker.length),
            10,
          );
          if (Number.isSafeInteger(exitCode)) finish({ exitCode, error: null });
        };
        timeoutId = window.setTimeout(
          () => finish({ exitCode: null, error: "The Git command timed out." }),
          120_000,
        );
        unsubscribe = atomRegistry.subscribe(attachAtom, inspect);
        inspect(atomRegistry.get(attachAtom));
      });

      const platform =
        environments.find((environment) => environment.environmentId === input.environmentId)
          ?.serverConfig?.environment.platform.os ?? "unknown";
      const command = continueBranchTerminalCommand({ command: input.command, marker, platform });
      const writeResult = await writeTerminal({
        environmentId: input.environmentId,
        input: {
          threadId: input.threadId,
          terminalId,
          data: `${command}\r`,
        },
      });
      if (writeResult._tag === "Failure") {
        finishWait({ exitCode: null, error: failureMessage(writeResult) });
      }
      const completed = await markerResult;
      await closeTerminal({
        environmentId: input.environmentId,
        input: { threadId: input.threadId, terminalId, deleteHistory: true },
      });
      if (completed.error !== null || completed.exitCode !== 0) {
        return {
          status: "failure",
          message:
            completed.error ?? `Git command exited with status ${completed.exitCode ?? "unknown"}.`,
        };
      }
      return { status: "success" };
    },
    [atomRegistry, closeTerminal, environments, openTerminal, writeTerminal],
  );

  return useCallback(
    async (input: ContinueBranchInput): Promise<void> => {
      const progressToastId = toastManager.add({
        type: "loading",
        title: "Preparing branch handoff...",
        description: input.branch,
        timeout: 0,
      });
      const fail = (title: string, description: string) => {
        toastManager.update(
          progressToastId,
          stackedThreadToast({ type: "error", title, description }),
        );
      };

      const sourceStatus = await refreshStatus({
        environmentId: input.sourceEnvironmentId,
        input: { cwd: input.sourceCwd },
      });
      if (sourceStatus._tag === "Failure") {
        if (isAtomCommandInterrupted(sourceStatus)) toastManager.close(progressToastId);
        else fail("Could not inspect source branch", failureMessage(sourceStatus));
        return;
      }

      const pushPlan = resolveContinueBranchPushPlan({
        branch: input.branch,
        status: sourceStatus.value,
      });
      if (pushPlan.kind === "error") {
        fail("Could not continue branch", pushPlan.message);
        return;
      }
      if (pushPlan.kind === "push") {
        toastManager.update(progressToastId, {
          type: "loading",
          title: "Pushing branch...",
          description: input.branch,
          timeout: 0,
        });
        const pushed = await runTerminalCommand({
          environmentId: input.sourceEnvironmentId,
          threadId: input.sourceThreadId,
          cwd: input.sourceCwd,
          command: continueBranchPushCommand(input.branch),
        });
        if (pushed.status === "interrupted") {
          toastManager.close(progressToastId);
          return;
        }
        if (pushed.status === "failure") {
          fail("Could not push branch", pushed.message);
          return;
        }
      }

      toastManager.update(progressToastId, {
        type: "loading",
        title: "Fetching branch on destination...",
        description: input.branch,
        timeout: 0,
      });
      const fetched = await runTerminalCommand({
        environmentId: input.target.projectRef.environmentId,
        threadId: input.sourceThreadId,
        cwd: input.target.workspaceRoot,
        command: continueBranchFetchCommand(input.branch),
      });
      if (fetched.status === "interrupted") {
        toastManager.close(progressToastId);
        return;
      }
      if (fetched.status === "failure") {
        fail("Could not fetch branch on destination", fetched.message);
        return;
      }

      toastManager.update(progressToastId, {
        type: "loading",
        title: "Preparing destination checkout...",
        description: input.branch,
        timeout: 0,
      });

      const refsResult = await listRefs({
        environmentId: input.target.projectRef.environmentId,
        input: {
          cwd: input.target.workspaceRoot,
          query: input.branch,
          includeMatchingRemoteRefs: true,
          refresh: true,
          limit: 100,
        },
      });
      if (refsResult._tag === "Failure") {
        if (isAtomCommandInterrupted(refsResult)) toastManager.close(progressToastId);
        else fail("Could not inspect destination branches", failureMessage(refsResult));
        return;
      }

      const destinationRef = resolveContinueBranchRef(refsResult.value.refs, input.branch);
      if (!destinationRef) {
        fail(
          "Branch is not visible on destination",
          `The push succeeded, but origin/${input.branch} is not visible there. Fetch origin on the destination, then retry.`,
        );
        return;
      }

      let checkoutPath = destinationRef.worktreePath;
      if (checkoutPath === null) {
        const createResult = await createWorktree({
          environmentId: input.target.projectRef.environmentId,
          input: {
            cwd: input.target.workspaceRoot,
            refName: destinationRef.name,
            ...(destinationRef.isRemote === true ? { newRefName: input.branch } : {}),
            path: null,
          },
        });
        if (createResult._tag === "Failure") {
          if (isAtomCommandInterrupted(createResult)) toastManager.close(progressToastId);
          else fail("Could not create destination worktree", failureMessage(createResult));
          return;
        }
        checkoutPath = createResult.value.worktree.path;
      }

      const usesProjectCheckout =
        normalizeProjectPathForComparison(checkoutPath) ===
        normalizeProjectPathForComparison(input.target.workspaceRoot);
      const openResult = await settlePromise(() =>
        handleNewThread(input.target.projectRef, {
          branch: input.branch,
          worktreePath: usesProjectCheckout ? null : checkoutPath,
          envMode: usesProjectCheckout ? "local" : "worktree",
          startFromOrigin: false,
        }),
      );
      if (openResult._tag === "Failure") {
        if (isAtomCommandInterrupted(openResult)) toastManager.close(progressToastId);
        else fail("Could not open branch on destination", failureMessage(openResult));
        return;
      }
      toastManager.close(progressToastId);
    },
    [createWorktree, handleNewThread, listRefs, refreshStatus, runTerminalCommand],
  );
}
