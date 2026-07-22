import type { ChangeRequestAssociation, VcsStatusResult } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  detectSourceControlProviderFromRemoteUrl,
  getChangeRequestTerminologyForKind,
  resolveChangeRequestPresentation,
  resolveThreadChangeRequestProviderKind,
  resolveThreadChangeRequestStatus,
  shouldQueryThreadVcsStatus,
} from "./sourceControl.ts";

const changeRequest: ChangeRequestAssociation = {
  provider: "github",
  number: 42,
  title: "Durable pull request",
  url: "https://github.com/acme/repo/pull/42",
  baseRefName: "main",
  headRefName: "feature/original",
  state: "open",
};

function status(overrides: Partial<VcsStatusResult> = {}): VcsStatusResult {
  return {
    isRepo: true,
    sourceControlProvider: {
      kind: "github",
      name: "GitHub",
      baseUrl: "https://github.com",
    },
    hasPrimaryRemote: true,
    isDefaultRef: false,
    refName: "feature/current",
    hasWorkingTreeChanges: false,
    workingTree: { files: [], insertions: 0, deletions: 0 },
    hasUpstream: true,
    aheadCount: 0,
    behindCount: 0,
    aheadOfDefaultCount: 1,
    pr: null,
    ...overrides,
  };
}

describe("source control presentation", () => {
  it("uses merge request terminology for GitLab", () => {
    expect(getChangeRequestTerminologyForKind("gitlab")).toEqual({
      shortLabel: "MR",
      singular: "merge request",
    });
  });

  it("uses pull request terminology for GitHub-compatible providers", () => {
    expect(getChangeRequestTerminologyForKind("github")).toEqual({
      shortLabel: "PR",
      singular: "pull request",
    });
    expect(getChangeRequestTerminologyForKind("azure-devops")).toEqual({
      shortLabel: "PR",
      singular: "pull request",
    });
    expect(getChangeRequestTerminologyForKind("bitbucket")).toEqual({
      shortLabel: "PR",
      singular: "pull request",
    });
  });

  it("falls back to generic change request copy for unknown providers", () => {
    expect(
      resolveChangeRequestPresentation({ kind: "unknown", name: "forge", baseUrl: "" }),
    ).toEqual(
      expect.objectContaining({
        shortName: "change request",
        longName: "change request",
      }),
    );
  });

  it("accepts a persisted provider kind without live provider metadata", () => {
    expect(resolveChangeRequestPresentation("gitlab")).toEqual(
      expect.objectContaining({ shortName: "MR", longName: "merge request" }),
    );
  });
});

describe("thread change request status", () => {
  it("queries branchless threads only when they have an enabled durable association", () => {
    expect(
      shouldQueryThreadVcsStatus({
        threadBranch: null,
        changeRequest,
        durableChangeRequestStatusEnabled: true,
      }),
    ).toBe(true);
    expect(
      shouldQueryThreadVcsStatus({
        threadBranch: null,
        changeRequest,
        durableChangeRequestStatusEnabled: false,
      }),
    ).toBe(false);
    expect(
      shouldQueryThreadVcsStatus({
        threadBranch: null,
        durableChangeRequestStatusEnabled: true,
      }),
    ).toBe(false);
  });

  it("uses matching live status for a branchless durable association", () => {
    const livePr = {
      number: 42,
      title: "Updated title",
      url: "https://github.com/acme/repo/pull/42/",
      baseRef: "main",
      headRef: "feature/original",
      state: "merged" as const,
    };
    expect(
      resolveThreadChangeRequestStatus({
        threadBranch: null,
        changeRequest,
        gitStatus: status({ refName: null, pr: livePr }),
        durableChangeRequestStatusEnabled: true,
      }),
    ).toEqual(livePr);
  });

  it("uses the stored snapshot as stale without repository status", () => {
    expect(
      resolveThreadChangeRequestStatus({
        threadBranch: null,
        changeRequest,
        gitStatus: null,
        durableChangeRequestStatusEnabled: true,
      }),
    ).toEqual({
      number: 42,
      title: "Durable pull request",
      url: "https://github.com/acme/repo/pull/42",
      baseRef: "main",
      headRef: "feature/original",
      state: "open",
      stale: true,
    });
  });

  it("does not replace a durable association with status from another repository", () => {
    expect(
      resolveThreadChangeRequestStatus({
        threadBranch: null,
        changeRequest,
        gitStatus: status({
          refName: null,
          pr: {
            number: 42,
            title: "Unrelated pull request",
            url: "https://github.com/other/repo/pull/42/",
            baseRef: "main",
            headRef: "feature/unrelated",
            state: "closed",
          },
        }),
        durableChangeRequestStatusEnabled: true,
      }),
    ).toMatchObject({ title: "Durable pull request", state: "open", stale: true });
  });

  it("preserves branch-bound inference and flag-off behavior", () => {
    const inferredPr = {
      number: 7,
      title: "Inferred pull request",
      url: "https://github.com/acme/repo/pull/7",
      baseRef: "main",
      headRef: "feature/current",
      state: "open" as const,
    };
    const gitStatus = status({ pr: inferredPr });

    expect(
      resolveThreadChangeRequestStatus({
        threadBranch: "feature/current",
        changeRequest,
        gitStatus,
        durableChangeRequestStatusEnabled: false,
      }),
    ).toEqual(inferredPr);
    expect(
      resolveThreadChangeRequestStatus({
        threadBranch: null,
        changeRequest,
        gitStatus,
        durableChangeRequestStatusEnabled: false,
      }),
    ).toBeNull();
    expect(
      resolveThreadChangeRequestStatus({
        threadBranch: "feature/other",
        gitStatus,
        durableChangeRequestStatusEnabled: true,
      }),
    ).toBeNull();
  });

  it("uses the persisted provider when live repository metadata is unavailable", () => {
    expect(
      resolveThreadChangeRequestProviderKind({
        changeRequest: { ...changeRequest, provider: "gitlab" },
        gitStatus: null,
        durableChangeRequestStatusEnabled: true,
      }),
    ).toBe("gitlab");
    expect(
      resolveThreadChangeRequestProviderKind({
        changeRequest: { ...changeRequest, provider: "gitlab" },
        gitStatus: null,
        durableChangeRequestStatusEnabled: false,
      }),
    ).toBeNull();
  });

  it("keeps the persisted provider when unrelated live metadata is present", () => {
    expect(
      resolveThreadChangeRequestProviderKind({
        changeRequest: { ...changeRequest, provider: "gitlab" },
        gitStatus: status(),
        durableChangeRequestStatusEnabled: true,
      }),
    ).toBe("gitlab");
  });
});

describe("detectSourceControlProviderFromRemoteUrl", () => {
  it("detects common source control hosts", () => {
    expect(detectSourceControlProviderFromRemoteUrl("git@github.com:owner/repo.git")?.kind).toBe(
      "github",
    );
    expect(
      detectSourceControlProviderFromRemoteUrl("https://gitlab.com/group/repo.git")?.kind,
    ).toBe("gitlab");
    expect(
      detectSourceControlProviderFromRemoteUrl("https://dev.azure.com/org/project/_git/repo")?.kind,
    ).toBe("azure-devops");
    expect(
      detectSourceControlProviderFromRemoteUrl("git@bitbucket.org:workspace/repo.git")?.kind,
    ).toBe("bitbucket");
  });

  it("preserves ports while classifying by hostname", () => {
    expect(
      detectSourceControlProviderFromRemoteUrl("https://gitlab.com:8443/group/repo.git"),
    ).toEqual({
      kind: "gitlab",
      name: "GitLab",
      baseUrl: "https://gitlab.com:8443",
    });
    expect(
      detectSourceControlProviderFromRemoteUrl(
        "https://self-hosted.example.test:8443/group/repo.git",
      ),
    ).toEqual({
      kind: "unknown",
      name: "self-hosted.example.test:8443",
      baseUrl: "https://self-hosted.example.test:8443",
    });
  });
});
