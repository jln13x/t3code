import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import type {
  EnvironmentId,
  ExecutionEnvironmentPlatformOs,
  ScopedProjectRef,
  VcsRef,
} from "@t3tools/contracts";

import { deriveLogicalProjectKey } from "./logicalProject";

interface ContinueBranchEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly connection: {
    readonly phase: string;
  };
}

export interface ContinueBranchTarget {
  readonly label: string;
  readonly projectRef: ScopedProjectRef;
  readonly workspaceRoot: string;
}

/**
 * Finds connected copies of the same repository project on other environments.
 * Project grouping is intentional here even when the sidebar is configured to
 * show environments separately: that display preference must not hide a valid
 * handoff destination.
 */
export function resolveContinueBranchTargets(input: {
  readonly sourceProjectRef: ScopedProjectRef;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly environments: ReadonlyArray<ContinueBranchEnvironment>;
}): ReadonlyArray<ContinueBranchTarget> {
  const sourceProject = input.projects.find(
    (project) =>
      project.environmentId === input.sourceProjectRef.environmentId &&
      project.id === input.sourceProjectRef.projectId,
  );
  if (!sourceProject?.repositoryIdentity?.canonicalKey) return [];

  const sourceLogicalKey = deriveLogicalProjectKey(sourceProject, {
    groupingMode: "repository_path",
  });
  const connectedEnvironmentLabels = new Map(
    input.environments
      .filter((environment) => environment.connection.phase === "connected")
      .map((environment) => [environment.environmentId, environment.label] as const),
  );
  const candidates = input.projects.filter(
    (project) =>
      project.environmentId !== sourceProject.environmentId &&
      connectedEnvironmentLabels.has(project.environmentId) &&
      deriveLogicalProjectKey(project, { groupingMode: "repository_path" }) === sourceLogicalKey,
  );
  const countByEnvironment = new Map<EnvironmentId, number>();
  for (const candidate of candidates) {
    countByEnvironment.set(
      candidate.environmentId,
      (countByEnvironment.get(candidate.environmentId) ?? 0) + 1,
    );
  }

  return candidates
    .map((project) => {
      const environmentLabel = connectedEnvironmentLabels.get(project.environmentId)!;
      return {
        label:
          countByEnvironment.get(project.environmentId) === 1
            ? environmentLabel
            : `${environmentLabel} — ${project.workspaceRoot}`,
        projectRef: scopeProjectRef(project.environmentId, project.id),
        workspaceRoot: project.workspaceRoot,
      };
    })
    .toSorted((left, right) => left.label.localeCompare(right.label));
}

export function continueBranchTargetIndex(action: string): number | null {
  const match = /^continue-branch-on:(\d+)$/.exec(action);
  if (!match) return null;
  const index = Number(match[1]);
  return Number.isSafeInteger(index) ? index : null;
}

export type ContinueBranchPushPlan =
  | { readonly kind: "push" }
  | { readonly kind: "error"; readonly message: string };

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function continueBranchPushCommand(branch: string): string {
  return `git push -u origin ${shellQuote(`HEAD:refs/heads/${branch}`)}`;
}

export function continueBranchFetchCommand(branch: string): string {
  return `git fetch origin ${shellQuote(`refs/heads/${branch}:refs/remotes/origin/${branch}`)}`;
}

export function continueBranchTerminalCommand(input: {
  readonly command: string;
  readonly marker: string;
  readonly platform: ExecutionEnvironmentPlatformOs;
}): string {
  return input.platform === "windows"
    ? `${input.command}; Write-Output "${input.marker}$LASTEXITCODE"`
    : `${input.command}; printf '\\n${input.marker}%s\\n' "$?"`;
}

/**
 * The thread's local branch name is authoritative for a handoff. Its configured
 * upstream is deliberately irrelevant: a feature branch may still track the
 * base branch it was created from.
 */
export function resolveContinueBranchPushPlan(input: {
  readonly branch: string;
  readonly status: {
    readonly isRepo: boolean;
    readonly hasPrimaryRemote: boolean;
    readonly refName: string | null;
  };
}): ContinueBranchPushPlan {
  if (!input.status.isRepo) {
    return { kind: "error", message: "The source checkout is not a Git repository." };
  }
  if (input.status.refName !== input.branch) {
    return {
      kind: "error",
      message: `The source checkout is on ${input.status.refName ?? "a detached HEAD"}, not ${input.branch}.`,
    };
  }
  if (!input.status.hasPrimaryRemote) {
    return { kind: "error", message: "The source repository does not have a Git remote." };
  }
  return { kind: "push" };
}

export function resolveContinueBranchRef(
  refs: ReadonlyArray<VcsRef>,
  branch: string,
): VcsRef | null {
  const local = refs.find((ref) => ref.isRemote !== true && ref.name === branch);
  if (local) return local;

  const remotes = refs.filter((ref) => {
    if (ref.isRemote !== true) return false;
    if (ref.remoteName) return ref.name === `${ref.remoteName}/${branch}`;
    const separator = ref.name.indexOf("/");
    return separator > 0 && ref.name.slice(separator + 1) === branch;
  });
  return (
    remotes.find((ref) => ref.remoteName === "origin" || ref.name.startsWith("origin/")) ??
    remotes[0] ??
    null
  );
}
