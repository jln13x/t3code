import type { VcsRef } from "@t3tools/contracts";

export function resolveNewTaskWorkspaceControl(input: {
  readonly checkoutAwareThreadCreationEnabled: boolean;
  readonly hasProject: boolean;
}): "checkout-picker" | "legacy-menu" {
  return input.checkoutAwareThreadCreationEnabled && input.hasProject
    ? "checkout-picker"
    : "legacy-menu";
}

export function resolveBranchCheckoutMode(branch: VcsRef): "local" | "worktree" {
  return branch.current || branch.worktreePath !== null ? "local" : "worktree";
}
