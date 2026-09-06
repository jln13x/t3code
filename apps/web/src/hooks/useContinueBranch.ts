import { RegistryContext } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import {
  CommandId,
  type ChatAttachment,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import {
  terminalOutputText,
  type TerminalBufferState,
} from "@t3tools/client-runtime/state/terminal";
import { normalizeProjectPathForComparison } from "@t3tools/shared/path";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback, useContext } from "react";
import { useRouter } from "@tanstack/react-router";

import type { ContinueBranchTarget } from "../continueBranch";
import {
  CONTINUE_BRANCH_GIT_ENV,
  continueBranchApplySnapshotCommand,
  continueBranchCleanupCommand,
  continueBranchPrepareHistoryStorageCommand,
  continueBranchSnapshotPushCommand,
  continueBranchTerminalFailureMessage,
  continueBranchTerminalCommand,
  continueBranchTransferFetchCommand,
  continueBranchTransferRefs,
  continueBranchVerifySourceCommand,
  resolveContinueBranchPushPlan,
  resolveContinueBranchRef,
} from "../continueBranch";
import { randomUUID } from "../lib/utils";
import { terminalEnvironment } from "../state/terminal";
import { listVcsRefsOnce, vcsEnvironment } from "../state/vcs";
import { useEnvironments } from "../state/environments";
import { useAtomCommand } from "../state/use-atom-command";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { createAssetUrlOnce } from "../state/assets";
import { loadFullThreadSnapshot, threadEnvironment } from "../state/threads";
import { projectEnvironment, readProjectFileOnce } from "../state/projects";
import { readPreparedConnection } from "../state/session";
import { buildThreadRouteParams } from "../threadRoutes";
import {
  blobToDataUrl,
  cacheTransferredThreadArchive,
  fingerprintTransferredThread,
  isTransferredThreadId,
  loadTransferredThreadArchive,
  makeTransferredThreadId,
  persistTransferredThreadArchive,
  prepareTransferredThreadArchive,
  resolveTransferredModelSelection,
} from "../threadTransfer";

interface ContinueBranchInput {
  readonly sourceEnvironmentId: EnvironmentId;
  readonly sourceThreadId: ThreadId;
  readonly sourceCwd: string;
  readonly branch: string;
  readonly target: ContinueBranchTarget;
}

const activeThreadTransfers = new Set<string>();

type TerminalCommandResult =
  | { readonly status: "success" }
  | { readonly status: "interrupted" }
  | { readonly status: "failure"; readonly message: string };

function failureMessage<A, E>(result: AsyncResult.Failure<A, E>): string {
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : "An error occurred.";
}

/** Moves a complete, idle chat and its exact non-ignored Git state between environments. */
export function useContinueBranch() {
  const atomRegistry = useContext(RegistryContext);
  const refreshStatus = useAtomCommand(vcsEnvironment.refreshStatus, { reportFailure: false });
  const listRefs = useAtomCommand(listVcsRefsOnce, { reportFailure: false });
  const createWorktree = useAtomCommand(vcsEnvironment.createWorktree, {
    reportFailure: false,
  });
  const openTerminal = useAtomCommand(terminalEnvironment.open, { reportFailure: false });
  const writeTerminal = useAtomCommand(terminalEnvironment.write, { reportFailure: false });
  const closeTerminal = useAtomCommand(terminalEnvironment.close, { reportFailure: false });
  const loadSnapshot = useAtomCommand(loadFullThreadSnapshot, { reportFailure: false });
  const createAssetUrl = useAtomCommand(createAssetUrlOnce, { reportFailure: false });
  const createThread = useAtomCommand(threadEnvironment.create, { reportFailure: false });
  const archiveThread = useAtomCommand(threadEnvironment.archive, { reportFailure: false });
  const unarchiveThread = useAtomCommand(threadEnvironment.unarchive, { reportFailure: false });
  const writeProjectFile = useAtomCommand(projectEnvironment.writeFile, { reportFailure: false });
  const readProjectFile = useAtomCommand(readProjectFileOnce, { reportFailure: false });
  const { environments } = useEnvironments();
  const router = useRouter();

  const platformFor = useCallback(
    (environmentId: EnvironmentId) =>
      environments.find((environment) => environment.environmentId === environmentId)?.serverConfig
        ?.environment.platform.os ?? "unknown",
    [environments],
  );

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
          env: CONTINUE_BRANCH_GIT_ENV,
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
        readonly output: string;
      }) => void = () => {};
      const markerResult = new Promise<{
        readonly exitCode: number | null;
        readonly error: string | null;
        readonly output: string;
      }>((resolve) => {
        let settled = false;
        let timeoutId: number | null = null;
        let latestBuffer = "";
        const finish = (result: {
          readonly exitCode: number | null;
          readonly error: string | null;
          readonly output: string;
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
            finish({ exitCode: null, error: failureMessage(result), output: latestBuffer });
            return;
          }
          if (result._tag !== "Success") return;
          latestBuffer = terminalOutputText(result.value.output);
          if (result.value.error) {
            finish({ exitCode: null, error: result.value.error, output: latestBuffer });
            return;
          }
          const markerOffset = latestBuffer.lastIndexOf(marker);
          if (markerOffset < 0) return;
          const exitCode = Number.parseInt(latestBuffer.slice(markerOffset + marker.length), 10);
          if (Number.isSafeInteger(exitCode)) {
            finish({ exitCode, error: null, output: latestBuffer });
          }
        };
        timeoutId = window.setTimeout(
          () =>
            finish({
              exitCode: null,
              error: "The Git command timed out.",
              output: latestBuffer,
            }),
          120_000,
        );
        unsubscribe = atomRegistry.subscribe(attachAtom, inspect);
        inspect(atomRegistry.get(attachAtom));
      });

      const platform = platformFor(input.environmentId);
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
        finishWait({ exitCode: null, error: failureMessage(writeResult), output: "" });
      }
      const completed = await markerResult;
      await closeTerminal({
        environmentId: input.environmentId,
        input: { threadId: input.threadId, terminalId, deleteHistory: true },
      });
      if (completed.error !== null || completed.exitCode !== 0) {
        const fallback =
          completed.error ?? `Git command exited with status ${completed.exitCode ?? "unknown"}.`;
        return {
          status: "failure",
          message: continueBranchTerminalFailureMessage({
            buffer: completed.output,
            marker,
            fallback,
          }),
        };
      }
      return { status: "success" };
    },
    [atomRegistry, closeTerminal, openTerminal, platformFor, writeTerminal],
  );

  return useCallback(
    async (input: ContinueBranchInput): Promise<void> => {
      const transferKey = input.sourceEnvironmentId + ":" + input.sourceThreadId;
      if (activeThreadTransfers.has(transferKey)) {
        toastManager.add({
          type: "info",
          title: "Chat move already in progress",
          description: input.branch,
        });
        return;
      }
      activeThreadTransfers.add(transferKey);
      try {
        const progressToastId = toastManager.add({
          type: "loading",
          title: "Preparing chat move...",
          description: input.branch,
          timeout: 0,
        });
        const fail = (title: string, description: string) => {
          toastManager.update(
            progressToastId,
            stackedThreadToast({ type: "error", title, description }),
          );
        };
        const sourceEnvironment = environments.find(
          (environment) => environment.environmentId === input.sourceEnvironmentId,
        );
        const targetEnvironment = environments.find(
          (environment) => environment.environmentId === input.target.projectRef.environmentId,
        );
        const sourcePrepared = readPreparedConnection(input.sourceEnvironmentId);
        if (
          sourcePrepared === null ||
          sourceEnvironment?.connection.phase !== "connected" ||
          sourceEnvironment.serverConfig === null ||
          sourceEnvironment.serverConfig === undefined
        ) {
          fail("Could not load source chat", "The source environment is no longer connected.");
          return;
        }
        if (
          targetEnvironment?.connection.phase !== "connected" ||
          targetEnvironment.serverConfig === null ||
          targetEnvironment.serverConfig === undefined
        ) {
          fail("Could not move chat", "The destination environment is no longer connected.");
          return;
        }

        const sourceSupportsPagination =
          sourceEnvironment.serverConfig.threadSnapshotPagination === true;
        const loadSourceSnapshot = () =>
          loadSnapshot({
            prepared: sourcePrepared,
            threadId: input.sourceThreadId,
            supportsPagination: sourceSupportsPagination,
          });
        const snapshotResult = await loadSourceSnapshot();
        if (snapshotResult._tag === "Failure") {
          if (isAtomCommandInterrupted(snapshotResult)) toastManager.close(progressToastId);
          else fail("Could not load source chat", failureMessage(snapshotResult));
          return;
        }
        const sourceThread = snapshotResult.value.thread;
        if (sourceThread.branch !== input.branch) {
          fail("Could not move chat", "The chat branch changed while the move was starting.");
          return;
        }
        if (
          sourceThread.session?.status === "running" &&
          sourceThread.session.activeTurnId !== null
        ) {
          fail("Could not move active chat", "Wait for the current turn to finish, then retry.");
          return;
        }

        const modelSelection = resolveTransferredModelSelection({
          source: sourceThread.modelSelection,
          targetDefault: input.target.defaultModelSelection,
          targetProviders: targetEnvironment.serverConfig.providers,
        });
        if (modelSelection === null) {
          fail("Could not move chat", "The destination does not have an available agent model.");
          return;
        }

        const archiveResult = await settlePromise(async () => {
          const previousArchive = isTransferredThreadId(sourceThread.id)
            ? await loadTransferredThreadArchive({
                destinationThreadId: sourceThread.id,
                readFile: async (relativePath) => {
                  const result = await readProjectFile({
                    environmentId: input.sourceEnvironmentId,
                    input: { cwd: input.sourceCwd, relativePath },
                  });
                  if (result._tag === "Failure") throw new Error(failureMessage(result));
                  return result.value;
                },
              })
            : null;
          return prepareTransferredThreadArchive({
            sourceEnvironmentId: input.sourceEnvironmentId,
            thread: sourceThread,
            modelSelection,
            previousArchive,
            loadAttachment: async (attachment: ChatAttachment) => {
              const urlResult = await createAssetUrl({
                environmentId: input.sourceEnvironmentId,
                input: {
                  resource: { _tag: "attachment", attachmentId: attachment.id },
                },
              });
              if (urlResult._tag === "Failure") throw new Error(failureMessage(urlResult));
              const url = resolveAssetUrl(sourcePrepared.httpBaseUrl, urlResult.value.relativeUrl);
              if (url === null) {
                throw new Error("Could not resolve attachment '" + attachment.name + "'.");
              }
              const response = await fetch(url);
              if (!response.ok) {
                throw new Error("Could not download attachment '" + attachment.name + "'.");
              }
              const bytes = await response.arrayBuffer();
              if (bytes.byteLength !== attachment.sizeBytes) {
                throw new Error(
                  "Attachment '" + attachment.name + "' changed while it was being copied.",
                );
              }
              return blobToDataUrl(new Blob([bytes], { type: attachment.mimeType }));
            },
          });
        });
        if (archiveResult._tag === "Failure") {
          fail("Could not copy chat history", failureMessage(archiveResult));
          return;
        }
        const archive = archiveResult.value;
        const destinationThreadId = makeTransferredThreadId(randomUUID());

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
          fail("Could not move chat", pushPlan.message);
          return;
        }

        const operationId = randomUUID().replaceAll("-", "");
        const transferRefs = continueBranchTransferRefs(
          operationId,
          archive.thread.checkpoints.map((checkpoint) => checkpoint.checkpointRef),
        );
        let destinationCleanupCwd = input.target.workspaceRoot;
        const cleanupTransfer = async () => {
          await Promise.all([
            runTerminalCommand({
              environmentId: input.sourceEnvironmentId,
              threadId: input.sourceThreadId,
              cwd: input.sourceCwd,
              command: continueBranchCleanupCommand({
                refs: transferRefs,
                includeRemote: true,
                platform: platformFor(input.sourceEnvironmentId),
              }),
            }),
            runTerminalCommand({
              environmentId: input.target.projectRef.environmentId,
              threadId: destinationThreadId,
              cwd: destinationCleanupCwd,
              command: continueBranchCleanupCommand({
                refs: transferRefs,
                includeRemote: false,
                platform: platformFor(input.target.projectRef.environmentId),
              }),
            }),
          ]);
        };

        toastManager.update(progressToastId, {
          type: "loading",
          title: "Copying branch and local changes...",
          description: input.branch,
          timeout: 0,
        });
        const pushed = await runTerminalCommand({
          environmentId: input.sourceEnvironmentId,
          threadId: input.sourceThreadId,
          cwd: input.sourceCwd,
          command: continueBranchSnapshotPushCommand({
            branch: input.branch,
            refs: transferRefs,
            platform: platformFor(input.sourceEnvironmentId),
          }),
        });
        if (pushed.status !== "success") {
          await cleanupTransfer();
          if (pushed.status === "interrupted") toastManager.close(progressToastId);
          else fail("Could not copy source work", pushed.message);
          return;
        }

        toastManager.update(progressToastId, {
          type: "loading",
          title: "Fetching branch on destination...",
          description: input.branch,
          timeout: 0,
        });
        const fetched = await runTerminalCommand({
          environmentId: input.target.projectRef.environmentId,
          threadId: destinationThreadId,
          cwd: input.target.workspaceRoot,
          command: continueBranchTransferFetchCommand({
            branch: input.branch,
            refs: transferRefs,
          }),
        });
        if (fetched.status !== "success") {
          await cleanupTransfer();
          if (fetched.status === "interrupted") toastManager.close(progressToastId);
          else fail("Could not fetch branch on destination", fetched.message);
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
          await cleanupTransfer();
          if (isAtomCommandInterrupted(refsResult)) toastManager.close(progressToastId);
          else fail("Could not inspect destination branches", failureMessage(refsResult));
          return;
        }
        const destinationRef = resolveContinueBranchRef(refsResult.value.refs, input.branch);
        if (destinationRef === null) {
          await cleanupTransfer();
          fail(
            "Branch is not visible on destination",
            "The push succeeded, but origin/" + input.branch + " is not visible there.",
          );
          return;
        }

        let checkoutPath = destinationRef.worktreePath;
        if (checkoutPath === null) {
          toastManager.update(progressToastId, {
            type: "loading",
            title: "Creating destination worktree...",
            description: input.branch,
            timeout: 0,
          });
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
            await cleanupTransfer();
            if (isAtomCommandInterrupted(createResult)) toastManager.close(progressToastId);
            else fail("Could not create destination worktree", failureMessage(createResult));
            return;
          }
          checkoutPath = createResult.value.worktree.path;
        }
        destinationCleanupCwd = checkoutPath;
        const usesProjectCheckout =
          normalizeProjectPathForComparison(checkoutPath) ===
          normalizeProjectPathForComparison(input.target.workspaceRoot);
        const destinationWorktreePath = usesProjectCheckout ? null : checkoutPath;

        const applied = await runTerminalCommand({
          environmentId: input.target.projectRef.environmentId,
          threadId: destinationThreadId,
          cwd: checkoutPath,
          command: continueBranchApplySnapshotCommand({
            branch: input.branch,
            refs: transferRefs,
            platform: platformFor(input.target.projectRef.environmentId),
          }),
        });
        if (applied.status !== "success") {
          await cleanupTransfer();
          if (applied.status === "interrupted") toastManager.close(progressToastId);
          else fail("Could not restore work on destination", applied.message);
          return;
        }

        const verifyGit = (environmentId: EnvironmentId, threadId: ThreadId, cwd: string) =>
          runTerminalCommand({
            environmentId,
            threadId,
            cwd,
            command: continueBranchVerifySourceCommand({
              branch: input.branch,
              refs: transferRefs,
              platform: platformFor(environmentId),
            }),
          });
        const verifiedSource = await verifyGit(
          input.sourceEnvironmentId,
          input.sourceThreadId,
          input.sourceCwd,
        );
        if (verifiedSource.status !== "success") {
          await cleanupTransfer();
          if (verifiedSource.status === "interrupted") toastManager.close(progressToastId);
          else fail("Source work changed during move", "The source chat was kept. Retry the move.");
          return;
        }

        toastManager.update(progressToastId, {
          type: "loading",
          title: "Saving complete chat history...",
          description: input.branch,
          timeout: 0,
        });
        const storagePrepared = await runTerminalCommand({
          environmentId: input.target.projectRef.environmentId,
          threadId: destinationThreadId,
          cwd: checkoutPath,
          command: continueBranchPrepareHistoryStorageCommand(
            platformFor(input.target.projectRef.environmentId),
            destinationThreadId,
          ),
        });
        if (storagePrepared.status !== "success") {
          await cleanupTransfer();
          if (storagePrepared.status === "interrupted") toastManager.close(progressToastId);
          else fail("Could not prepare destination history", storagePrepared.message);
          return;
        }

        const readArchiveFile = async (relativePath: string) => {
          const result = await readProjectFile({
            environmentId: input.target.projectRef.environmentId,
            input: { cwd: checkoutPath, relativePath },
          });
          if (result._tag === "Failure") throw new Error(failureMessage(result));
          return result.value;
        };
        const persisted = await settlePromise(() =>
          persistTransferredThreadArchive({
            destinationThreadId,
            archive,
            writeFile: async (relativePath, contents) => {
              const result = await writeProjectFile({
                environmentId: input.target.projectRef.environmentId,
                input: { cwd: checkoutPath, relativePath, contents },
              });
              if (result._tag === "Failure") throw new Error(failureMessage(result));
            },
            readFile: readArchiveFile,
          }),
        );
        if (persisted._tag === "Failure") {
          await cleanupTransfer();
          fail("Could not save chat history", failureMessage(persisted));
          return;
        }

        const verifiedDestination = await verifyGit(
          input.target.projectRef.environmentId,
          destinationThreadId,
          checkoutPath,
        );
        if (verifiedDestination.status !== "success") {
          await cleanupTransfer();
          fail(
            "Destination worktree changed during move",
            "The source chat was kept, and the destination checkout was not overwritten.",
          );
          return;
        }

        const createCommandId = CommandId.make(randomUUID());
        const createInput = {
          threadId: destinationThreadId,
          projectId: input.target.projectRef.projectId,
          title: sourceThread.title,
          modelSelection,
          runtimeMode: sourceThread.runtimeMode,
          interactionMode: sourceThread.interactionMode,
          branch: input.branch,
          worktreePath: destinationWorktreePath,
          createdAt: sourceThread.createdAt,
          commandId: createCommandId,
        } as const;
        let createResult = await createThread({
          environmentId: input.target.projectRef.environmentId,
          input: createInput,
        });
        if (createResult._tag === "Failure" && !isAtomCommandInterrupted(createResult)) {
          createResult = await createThread({
            environmentId: input.target.projectRef.environmentId,
            input: createInput,
          });
        }
        if (createResult._tag === "Failure") {
          await cleanupTransfer();
          if (isAtomCommandInterrupted(createResult)) toastManager.close(progressToastId);
          else fail("Could not create destination chat", failureMessage(createResult));
          return;
        }

        const archiveDestinationCopy = async () => {
          const result = await archiveThread({
            environmentId: input.target.projectRef.environmentId,
            input: { threadId: destinationThreadId },
          });
          return result._tag === "Success";
        };
        const sourceBeforeArchive = await loadSourceSnapshot();
        if (sourceBeforeArchive._tag === "Failure") {
          const destinationArchived = await archiveDestinationCopy();
          await cleanupTransfer();
          fail(
            "Source chat changed during move",
            destinationArchived
              ? "The destination copy was archived; the source was kept."
              : "Both copies were kept so no work was lost.",
          );
          return;
        }
        const sourceFingerprintResult = await settlePromise(() =>
          fingerprintTransferredThread(sourceBeforeArchive.value.thread),
        );
        if (
          sourceFingerprintResult._tag === "Failure" ||
          sourceFingerprintResult.value !== archive.sourceFingerprint
        ) {
          const destinationArchived = await archiveDestinationCopy();
          await cleanupTransfer();
          fail(
            "Source chat changed during move",
            destinationArchived
              ? "The destination copy was archived, and the source was kept so no work was lost."
              : "Both copies were kept so no work was lost.",
          );
          return;
        }
        const sourceGitBeforeArchive = await verifyGit(
          input.sourceEnvironmentId,
          input.sourceThreadId,
          input.sourceCwd,
        );
        if (sourceGitBeforeArchive.status !== "success") {
          const destinationArchived = await archiveDestinationCopy();
          await cleanupTransfer();
          fail(
            "Source work changed during move",
            destinationArchived
              ? "The destination copy was archived, and the source was kept so no work was lost."
              : "Both copies were kept so no work was lost.",
          );
          return;
        }

        const archiveCommandId = CommandId.make(randomUUID());
        const archiveInput = {
          threadId: input.sourceThreadId,
          commandId: archiveCommandId,
        } as const;
        let archiveSourceResult = await archiveThread({
          environmentId: input.sourceEnvironmentId,
          input: archiveInput,
        });
        if (
          archiveSourceResult._tag === "Failure" &&
          !isAtomCommandInterrupted(archiveSourceResult)
        ) {
          archiveSourceResult = await archiveThread({
            environmentId: input.sourceEnvironmentId,
            input: archiveInput,
          });
        }
        if (archiveSourceResult._tag === "Failure") {
          const destinationArchived = await archiveDestinationCopy();
          await cleanupTransfer();
          if (isAtomCommandInterrupted(archiveSourceResult)) toastManager.close(progressToastId);
          else {
            fail(
              "Could not archive source chat",
              destinationArchived
                ? "The destination copy was archived; the source remains available."
                : "Both copies remain available, so no work was lost.",
            );
          }
          return;
        }

        const sourceAfterArchive = await loadSourceSnapshot();
        const afterFingerprint =
          sourceAfterArchive._tag === "Success"
            ? await settlePromise(() =>
                fingerprintTransferredThread(sourceAfterArchive.value.thread),
              )
            : sourceAfterArchive;
        if (
          afterFingerprint._tag === "Failure" ||
          afterFingerprint.value !== archive.sourceFingerprint
        ) {
          const sourceRestoreResult = await unarchiveThread({
            environmentId: input.sourceEnvironmentId,
            input: { threadId: input.sourceThreadId },
          });
          const destinationArchived = await archiveDestinationCopy();
          await cleanupTransfer();
          fail(
            "Source chat changed during move",
            sourceRestoreResult._tag === "Success" && destinationArchived
              ? "The source was restored and the destination copy was archived so no work was lost."
              : "Both copies remain available; one may be under Archive. No work was lost.",
          );
          return;
        }

        cacheTransferredThreadArchive(
          input.target.projectRef.environmentId,
          destinationThreadId,
          archive,
        );
        await cleanupTransfer();

        const navigationResult = await settlePromise(() =>
          router.navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(
              scopeThreadRef(input.target.projectRef.environmentId, destinationThreadId),
            ),
          }),
        );
        if (navigationResult._tag === "Failure") {
          fail("Chat moved, but could not open it", failureMessage(navigationResult));
          return;
        }
        toastManager.update(progressToastId, {
          type: "success",
          title: "Chat moved",
          description: input.target.label + " · source retained in Archive",
        });
      } finally {
        activeThreadTransfers.delete(transferKey);
      }
    },
    [
      archiveThread,
      createAssetUrl,
      createThread,
      createWorktree,
      environments,
      listRefs,
      loadSnapshot,
      platformFor,
      readProjectFile,
      refreshStatus,
      router,
      runTerminalCommand,
      unarchiveThread,
      writeProjectFile,
    ],
  );
}
