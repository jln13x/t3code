import type { ReviewDiffPreviewSourceKind } from "@t3tools/contracts";

export type WorktreeChangeScope = "staged" | "unstaged";

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
