import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { continueBranchTargetIndex, resolveContinueBranchTargets } from "./continueBranch";

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

describe("continueBranchTargetIndex", () => {
  it("only parses destination action ids", () => {
    expect(continueBranchTargetIndex("continue-branch-on:2")).toBe(2);
    expect(continueBranchTargetIndex("continue-branch-on:nope")).toBeNull();
    expect(continueBranchTargetIndex("snooze:2")).toBeNull();
  });
});
