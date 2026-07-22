import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { SourceControlProviderKind, VcsStatusResult } from "@t3tools/contracts";
import {
  resolveThreadChangeRequestProviderKind,
  resolveThreadChangeRequestStatus,
  shouldQueryThreadVcsStatus,
} from "@t3tools/shared/sourceControl";
import { useMemo } from "react";

import { useEnvironmentServerConfig, useProject } from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { vcsEnvironment } from "../state/vcs";
import type { SidebarThreadSummary } from "../types";

export interface ThreadChangeRequestStatus {
  readonly pr: VcsStatusResult["pr"];
  readonly providerKind: SourceControlProviderKind | null;
}

/**
 * Resolve the durable or inferred change request for a thread row.
 *
 * Visible rows own their subscriptions, so list virtualization naturally
 * limits polling. Explicit identities may be rendered without a branch or
 * repository; inferred identities remain bound to the checked-out branch.
 */
export function useThreadChangeRequestStatus(
  thread: SidebarThreadSummary,
  fallbackProjectCwd: string | null = null,
): ThreadChangeRequestStatus {
  const threadProject = useProject(
    useMemo(
      () =>
        thread.projectId === null ? null : scopeProjectRef(thread.environmentId, thread.projectId),
      [thread.environmentId, thread.projectId],
    ),
  );
  const cwd = thread.worktreePath ?? threadProject?.workspaceRoot ?? fallbackProjectCwd;
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
  const resolutionInput = {
    ...(changeRequest ? { changeRequest } : {}),
    gitStatus: gitStatus.data,
    durableChangeRequestStatusEnabled,
  };

  return {
    pr: resolveThreadChangeRequestStatus({
      threadBranch: thread.branch,
      ...resolutionInput,
    }),
    providerKind: resolveThreadChangeRequestProviderKind(resolutionInput),
  };
}
