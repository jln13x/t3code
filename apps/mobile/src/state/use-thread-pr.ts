import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  resolveThreadChangeRequestProviderKind,
  resolveThreadChangeRequestStatus,
  shouldQueryThreadVcsStatus,
} from "@t3tools/shared/sourceControl";

import { useEnvironmentServerConfig } from "./entities";
import { useEnvironmentQuery } from "./query";
import { presentThreadPr, type ThreadPrPresentation } from "./thread-pr-presentation";
import { vcsEnvironment } from "./vcs";

export {
  presentThreadPr,
  type ThreadPr,
  type ThreadPrPresentation,
} from "./thread-pr-presentation";

/**
 * Live PR status for a thread's branch. Known PR identities remain distinct;
 * otherwise subscriptions are deduplicated per (environmentId, cwd). List
 * virtualization means only visible rows subscribe.
 */
export function useThreadPr(
  thread: EnvironmentThreadShell,
  projectCwd: string | null,
): ThreadPrPresentation | null {
  const cwd = thread.worktreePath ?? projectCwd;
  const durableChangeRequestStatusEnabled =
    useEnvironmentServerConfig(thread.environmentId)?.settings.enableDurableChangeRequestStatus ??
    false;
  const changeRequest = durableChangeRequestStatusEnabled ? thread.changeRequest : undefined;
  const gitStatus = useEnvironmentQuery(
    cwd !== null &&
      shouldQueryThreadVcsStatus({
        threadBranch: thread.branch,
        ...(changeRequest ? { changeRequest } : {}),
        durableChangeRequestStatusEnabled,
      })
      ? vcsEnvironment.status({
          environmentId: thread.environmentId,
          input: {
            cwd,
            ...(changeRequest ? { changeRequest } : {}),
          },
        })
      : null,
  );

  const status = gitStatus.data;
  const pr = resolveThreadChangeRequestStatus({
    threadBranch: thread.branch,
    ...(changeRequest ? { changeRequest } : {}),
    gitStatus: status,
    durableChangeRequestStatusEnabled,
  });
  if (!pr) {
    return null;
  }
  const providerKind = resolveThreadChangeRequestProviderKind({
    ...(changeRequest ? { changeRequest } : {}),
    gitStatus: status,
    durableChangeRequestStatusEnabled,
  });
  return presentThreadPr(pr, providerKind);
}
