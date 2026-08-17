import { EnvironmentId, ProjectId, type VcsRef } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  continueBranchPushCommand,
  continueBranchTargetIndex,
  resolveContinueBranchPushPlan,
  resolveContinueBranchRef,
  resolveContinueBranchTargets,
} from "./continueBranch";

function project(environmentId: string, id: string, root: string, canonicalKey: string) {
  return {
    environmentId: EnvironmentId.make(environmentId),
    id: ProjectId.make(id),
    title: "T3 Code",
    workspaceRoot: root,
    repositoryIdentity: {
      canonicalKey,
      locator: {
        source: "git-remote" as const,
        remoteName: "origin",
        remoteUrl: `https://${canonicalKey}`,
      },
      rootPath: root,
      name: "t3code",
      displayName: "T3 Code",
    },
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function ref(input: Partial<VcsRef> & Pick<VcsRef, "name">): VcsRef {
  return {
    current: false,
    isDefault: false,
    worktreePath: null,
    ...input,
  };
}

describe("resolveContinueBranchTargets", () => {
  it("offers connected copies of the same project on other environments", () => {
    const projects = [
      project("vps", "vps-project", "/srv/t3code", "github.com:t3tools/t3code"),
      project("local", "local-project", "/Users/me/t3code", "github.com:t3tools/t3code"),
      project("other", "other-project", "/tmp/other", "github.com:t3tools/other"),
    ];

    expect(
      resolveContinueBranchTargets({
        sourceProjectRef: {
          environmentId: EnvironmentId.make("vps"),
          projectId: ProjectId.make("vps-project"),
        },
        projects,
        environments: [
          {
            environmentId: EnvironmentId.make("vps"),
            label: "VPS",
            connection: { phase: "connected" },
          },
          {
            environmentId: EnvironmentId.make("local"),
            label: "My Mac",
            connection: { phase: "connected" },
          },
          {
            environmentId: EnvironmentId.make("other"),
            label: "Other",
            connection: { phase: "connected" },
          },
        ],
      }),
    ).toEqual([
      {
        label: "My Mac",
        projectRef: {
          environmentId: EnvironmentId.make("local"),
          projectId: ProjectId.make("local-project"),
        },
        workspaceRoot: "/Users/me/t3code",
      },
    ]);
  });

  it("does not offer disconnected or identity-less projects", () => {
    const source = project("vps", "vps-project", "/srv/t3code", "repo");
    expect(
      resolveContinueBranchTargets({
        sourceProjectRef: {
          environmentId: EnvironmentId.make("vps"),
          projectId: ProjectId.make("vps-project"),
        },
        projects: [source, project("local", "local-project", "/code/t3", "repo")],
        environments: [
          {
            environmentId: EnvironmentId.make("local"),
            label: "Local",
            connection: { phase: "offline" },
          },
        ],
      }),
    ).toEqual([]);

    expect(
      resolveContinueBranchTargets({
        sourceProjectRef: {
          environmentId: EnvironmentId.make("vps"),
          projectId: ProjectId.make("vps-project"),
        },
        projects: [{ ...source, repositoryIdentity: null }],
        environments: [],
      }),
    ).toEqual([]);
  });
});

describe("resolveContinueBranchPushPlan", () => {
  const baseStatus = {
    isRepo: true,
    hasPrimaryRemote: true,
    refName: "feat/catalog",
    hasUpstream: true,
    aheadCount: 0,
  };

  it("pushes an unpublished branch and skips a fully published branch", () => {
    expect(
      resolveContinueBranchPushPlan({
        branch: "feat/catalog",
        status: { ...baseStatus, hasUpstream: false },
      }),
    ).toEqual({ kind: "push" });
    expect(resolveContinueBranchPushPlan({ branch: "feat/catalog", status: baseStatus })).toEqual({
      kind: "skip",
    });
  });

  it("requires an exact manual push when an opaque upstream has unpublished commits", () => {
    expect(
      resolveContinueBranchPushPlan({
        branch: "feat/catalog",
        status: { ...baseStatus, aheadCount: 19 },
      }),
    ).toEqual({
      kind: "manual",
      command: "git push -u origin 'HEAD:refs/heads/feat/catalog'",
    });
  });

  it("rejects a stale thread branch instead of pushing another checkout", () => {
    expect(
      resolveContinueBranchPushPlan({
        branch: "feat/catalog",
        status: { ...baseStatus, refName: "main" },
      }),
    ).toEqual({
      kind: "error",
      message: "The source checkout is on main, not feat/catalog.",
    });
  });

  it("quotes the refspec for shell-safe manual instructions", () => {
    expect(continueBranchPushCommand("feat/$catalog")).toBe(
      "git push -u origin 'HEAD:refs/heads/feat/$catalog'",
    );
  });
});

describe("resolveContinueBranchRef", () => {
  it("reuses an exact local checkout before a remote ref", () => {
    expect(
      resolveContinueBranchRef(
        [
          ref({ name: "origin/feat/catalog", isRemote: true, remoteName: "origin" }),
          ref({ name: "feat/catalog", worktreePath: "/worktrees/catalog" }),
        ],
        "feat/catalog",
      ),
    ).toMatchObject({ name: "feat/catalog", worktreePath: "/worktrees/catalog" });
  });

  it("prefers origin when several remotes have the exact branch", () => {
    expect(
      resolveContinueBranchRef(
        [
          ref({ name: "upstream/feat/catalog", isRemote: true, remoteName: "upstream" }),
          ref({ name: "origin/feat/catalog", isRemote: true, remoteName: "origin" }),
        ],
        "feat/catalog",
      )?.name,
    ).toBe("origin/feat/catalog");
  });

  it("does not confuse a suffix match with the exact branch", () => {
    expect(
      resolveContinueBranchRef(
        [ref({ name: "origin/team/feat/catalog", isRemote: true, remoteName: "origin" })],
        "feat/catalog",
      ),
    ).toBeNull();
  });
});

describe("continueBranchTargetIndex", () => {
  it("only parses destination action ids", () => {
    expect(continueBranchTargetIndex("continue-branch-on:2")).toBe(2);
    expect(continueBranchTargetIndex("continue-branch-on:nope")).toBeNull();
    expect(continueBranchTargetIndex("snooze:2")).toBeNull();
  });
});
