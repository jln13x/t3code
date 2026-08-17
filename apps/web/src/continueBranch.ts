import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, ScopedProjectRef } from "@t3tools/contracts";

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
