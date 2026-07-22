import { describe, expect, it } from "vite-plus/test";

import {
  resolveWorktreeCompatibilityNotice,
  resolveWorktreeDiffSource,
} from "./WorktreeSourceControl.logic";

describe("resolveWorktreeCompatibilityNotice", () => {
  it("does not warn when the environment supports source-control mutations", () => {
    expect(
      resolveWorktreeCompatibilityNotice({
        supportsMutations: true,
        serverVersion: "1.2.3",
        versionMismatch: {
          clientVersion: "1.2.4",
          serverVersion: "1.2.3",
        },
      }),
    ).toBeNull();
  });

  it("identifies version drift when a mixed-version environment lacks the capability", () => {
    expect(
      resolveWorktreeCompatibilityNotice({
        supportsMutations: false,
        serverVersion: "1.2.3",
        versionMismatch: {
          clientVersion: "1.2.4",
          serverVersion: "1.2.3",
        },
      }),
    ).toEqual({
      kind: "version-mismatch",
      label: "Version mismatch",
      detail:
        "Client 1.2.4 · environment 1.2.3. Diffs remain available in read-only compatibility mode; update the environment to restore stage and discard actions.",
    });
  });

  it("reports a missing capability even when version strings match", () => {
    expect(
      resolveWorktreeCompatibilityNotice({
        supportsMutations: false,
        serverVersion: "1.2.3",
        versionMismatch: null,
      }),
    ).toEqual({
      kind: "limited-capability",
      label: "Limited compatibility",
      detail:
        "Environment 1.2.3 does not advertise source-control mutations. Update or restart it to restore stage and discard actions.",
    });
  });
});

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
