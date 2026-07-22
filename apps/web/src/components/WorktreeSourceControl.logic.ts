import type { ReviewDiffPreviewSourceKind } from "@t3tools/contracts";

export type WorktreeChangeScope = "staged" | "unstaged";

export interface WorktreeCompatibilityNotice {
  readonly kind: "version-mismatch" | "limited-capability";
  readonly label: string;
  readonly detail: string;
}

export function resolveWorktreeCompatibilityNotice(input: {
  readonly supportsMutations: boolean;
  readonly serverVersion: string;
  readonly versionMismatch: {
    readonly clientVersion: string;
    readonly serverVersion: string;
  } | null;
}): WorktreeCompatibilityNotice | null {
  if (input.supportsMutations) return null;

  if (input.versionMismatch) {
    return {
      kind: "version-mismatch",
      label: "Version mismatch",
      detail: `Client ${input.versionMismatch.clientVersion} · environment ${input.versionMismatch.serverVersion}. Diffs remain available in read-only compatibility mode; update the environment to restore stage and discard actions.`,
    };
  }

  return {
    kind: "limited-capability",
    label: "Limited compatibility",
    detail: `Environment ${input.serverVersion} does not advertise source-control mutations. Update or restart it to restore stage and discard actions.`,
  };
}

/**
 * Older environments only return the combined `working-tree` review source.
 * Treat it as the unstaged source when no index-aware sources are present so
 * mixed-version remote environments retain a useful read-only diff.
 */
export function resolveWorktreeDiffSource<T extends { readonly kind: ReviewDiffPreviewSourceKind }>(
  sources: readonly T[],
  selectedScope: WorktreeChangeScope,
): T | undefined {
  const exactSource = sources.find((source) => source.kind === selectedScope);
  if (exactSource || selectedScope !== "unstaged") return exactSource;

  const hasIndexAwareSources = sources.some(
    (source) => source.kind === "staged" || source.kind === "unstaged",
  );
  return hasIndexAwareSources
    ? undefined
    : sources.find((source) => source.kind === "working-tree");
}
