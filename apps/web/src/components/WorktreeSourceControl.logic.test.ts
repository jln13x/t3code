import { describe, expect, it } from "vite-plus/test";

import { resolveWorktreeDiffSource } from "./WorktreeSourceControl.logic";

describe("resolveWorktreeDiffSource", () => {
  it("uses the exact index-aware source when available", () => {
    const sources = [
      { id: "legacy", kind: "working-tree" as const },
      { id: "staged", kind: "staged" as const },
      { id: "unstaged", kind: "unstaged" as const },
    ];

    expect(resolveWorktreeDiffSource(sources, "unstaged")?.id).toBe("unstaged");
    expect(resolveWorktreeDiffSource(sources, "staged")?.id).toBe("staged");
  });

  it("falls back to the legacy working-tree source for unstaged changes", () => {
    const sources = [
      { id: "legacy", kind: "working-tree" as const },
      { id: "branch", kind: "branch-range" as const },
    ];

    expect(resolveWorktreeDiffSource(sources, "unstaged")?.id).toBe("legacy");
  });

  it("does not present a combined legacy diff as staged-only changes", () => {
    const sources = [{ id: "legacy", kind: "working-tree" as const }];

    expect(resolveWorktreeDiffSource(sources, "staged")).toBeUndefined();
  });

  it("does not mask a missing source in an index-aware response", () => {
    const sources = [
      { id: "legacy", kind: "working-tree" as const },
      { id: "staged", kind: "staged" as const },
    ];

    expect(resolveWorktreeDiffSource(sources, "unstaged")).toBeUndefined();
  });
});
