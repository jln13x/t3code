import { RegistryContext } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { normalizeProjectPathForComparison } from "@t3tools/shared/path";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback, useContext } from "react";

import type { ContinueBranchTarget } from "../continueBranch";
import {
  continueBranchPushCommand,
  resolveContinueBranchPushPlan,
  resolveContinueBranchRef,
} from "../continueBranch";
import { randomUUID } from "../lib/utils";
import { vcsActionManager, vcsEnvironment } from "../state/vcs";
import { useAtomCommand } from "../state/use-atom-command";
import { useAtomQueryRunner } from "../state/use-atom-query-runner";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { useNewThreadHandler } from "./useHandleNewThread";

interface ContinueBranchInput {
  readonly sourceEnvironmentId: EnvironmentId;
  readonly sourceCwd: string;
  readonly branch: string;
  readonly target: ContinueBranchTarget;
}

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
  const handleNewThread = useNewThreadHandler();

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
      if (pushPlan.kind === "manual") {
        fail(
          "Push this branch once, then retry",
          `The server cannot safely identify this branch's upstream. Run: ${pushPlan.command}`,
        );
        return;
      }
      if (pushPlan.kind === "push") {
        toastManager.update(progressToastId, {
          type: "loading",
          title: "Pushing branch...",
          description: input.branch,
          timeout: 0,
        });
        const pushResult = await runAtomCommand(
          atomRegistry,
          vcsActionManager.runStackedAction({
            environmentId: input.sourceEnvironmentId,
            cwd: input.sourceCwd,
          }),
          { actionId: randomUUID(), action: "push" },
          { reportFailure: false },
        );
        if (pushResult._tag === "Failure") {
          if (isAtomCommandInterrupted(pushResult)) toastManager.close(progressToastId);
          else fail("Could not push branch", failureMessage(pushResult));
          return;
        }
      }

      toastManager.update(progressToastId, {
        type: "loading",
        title: "Fetching branch on destination...",
        description: input.branch,
        timeout: 0,
      });
      const refreshResult = await refreshStatus({
        environmentId: input.target.projectRef.environmentId,
        input: { cwd: input.target.workspaceRoot },
      });
      if (refreshResult._tag === "Failure") {
        if (isAtomCommandInterrupted(refreshResult)) toastManager.close(progressToastId);
        else fail("Could not refresh destination", failureMessage(refreshResult));
        return;
      }

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
          `Push with ${continueBranchPushCommand(input.branch)}, fetch origin on the destination, then retry.`,
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
    [atomRegistry, createWorktree, handleNewThread, listRefs, refreshStatus],
  );
}
