import { describe, expect, it } from "vite-plus/test";

import {
  resolveBranchCheckoutMode,
  resolveNewTaskWorkspaceControl,
} from "./newTaskCheckoutSelection";

describe("resolveNewTaskWorkspaceControl", () => {
  it("uses the checkout picker when the fork flag is enabled", () => {
    expect(
      resolveNewTaskWorkspaceControl({
        checkoutAwareThreadCreationEnabled: true,
        hasProject: true,
      }),
    ).toBe("checkout-picker");
  });

  it("preserves the legacy menu when the fork flag is disabled", () => {
    expect(
      resolveNewTaskWorkspaceControl({
        checkoutAwareThreadCreationEnabled: false,
        hasProject: true,
      }),
    ).toBe("legacy-menu");
  });
});

describe("resolveBranchCheckoutMode", () => {
  it("reuses an existing checkout", () => {
    expect(
      resolveBranchCheckoutMode({
        name: "feature/existing",
        current: false,
        isDefault: false,
        worktreePath: "/repo-worktrees/existing",
      }),
    ).toBe("local");
  });

  it("creates a worktree for a branch that is not checked out", () => {
    expect(
      resolveBranchCheckoutMode({
        name: "feature/remote",
        current: false,
        isDefault: false,
        worktreePath: null,
      }),
    ).toBe("worktree");
  });
});
