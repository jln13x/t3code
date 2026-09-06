// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { EnvironmentId, ProjectId, type VcsRef } from "@t3tools/contracts";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  CONTINUE_BRANCH_GIT_ENV,
  continueBranchFetchCommand,
  continueBranchApplySnapshotCommand,
  continueBranchCleanupCommand,
  continueBranchPrepareHistoryStorageCommand,
  continueBranchSnapshotPushCommand,
  continueBranchPushCommand,
  continueBranchTerminalFailureMessage,
  continueBranchTerminalCommand,
  continueBranchTargetIndex,
  continueBranchTransferFetchCommand,
  continueBranchTransferRefs,
  continueBranchVerifySourceCommand,
  resolveContinueBranchPushPlan,
  resolveContinueBranchRef,
  resolveContinueBranchTargets,
} from "./continueBranch";

const { execFileSync } = NodeChildProcess;
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = NodeFS;
const { tmpdir } = NodeOS;
const { join } = NodePath;

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

function environment(environmentId: string, label: string, phase = "connected") {
  return {
    environmentId: EnvironmentId.make(environmentId),
    label,
    connection: { phase },
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
          environment("vps", "VPS"),
          environment("local", "My Mac"),
          environment("other", "Other"),
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
        defaultModelSelection: null,
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
        environments: [environment("vps", "VPS"), environment("local", "Local", "offline")],
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
  };

  it("always pushes the local branch under its own name", () => {
    expect(resolveContinueBranchPushPlan({ branch: "feat/catalog", status: baseStatus })).toEqual({
      kind: "push",
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

  it("fetches only the exact handoff branch into its origin tracking ref", () => {
    expect(continueBranchFetchCommand("feat/catalog")).toBe(
      "git fetch origin 'refs/heads/feat/catalog:refs/remotes/origin/feat/catalog'",
    );
  });

  it("reports a command's exit code in the source platform's shell", () => {
    expect(
      continueBranchTerminalCommand({
        command: "git push origin branch",
        marker: "__DONE__:",
        platform: "linux",
      }),
    ).toBe("git push origin branch; printf '\\n__DONE__:%s\\n' \"$?\"");
    expect(
      continueBranchTerminalCommand({
        command: "git fetch origin branch",
        marker: "__DONE__:",
        platform: "windows",
      }),
    ).toBe(
      `& { $global:LASTEXITCODE = 0; try { git fetch origin branch; $t3Status = $LASTEXITCODE } catch { Write-Error $_; $t3Status = 1 }; Write-Output "__DONE__:$t3Status" }`,
    );
  });

  it("disables every prompt used by stock-server background Git commands", () => {
    expect(CONTINUE_BRANCH_GIT_ENV).toEqual({
      GCM_INTERACTIVE: "never",
      GIT_ASKPASS: "",
      GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o ConnectTimeout=20 -o ConnectionAttempts=1",
      GIT_TERMINAL_PROMPT: "0",
      SSH_ASKPASS: "",
      SSH_ASKPASS_REQUIRE: "never",
    });
  });

  it("surfaces the useful terminal failure instead of the hidden command or exit code", () => {
    const escape = String.fromCharCode(27);
    expect(
      continueBranchTerminalFailureMessage({
        buffer: [
          `git fetch origin branch; printf '__DONE__:%s' "$?"`,
          `${escape}[31mfatal: Authentication failed for remote${escape}[0m`,
          "__DONE__:128",
        ].join("\r\n"),
        marker: "__DONE__:",
        fallback: "Git command exited with status 128.",
      }),
    ).toBe("fatal: Authentication failed for remote");
    expect(
      continueBranchTerminalFailureMessage({
        buffer: "shell prompt without a Git error",
        marker: "__DONE__:",
        fallback: "The Git command timed out.",
      }),
    ).toBe("The Git command timed out.");
  });

  it("includes conflicting destination paths in the transfer error", () => {
    expect(
      continueBranchTerminalFailureMessage({
        buffer:
          "error: The following untracked working tree files would be overwritten by checkout:\n\tlocal data.txt\nPlease move or remove them before you switch branches.\nAborting\n__DONE__:1\n",
        marker: "__DONE__:",
        fallback: "Git command failed",
      }),
    ).toContain("local data.txt");
  });
});

describe("complete Git transfer", () => {
  const temporaryRoots = new Set<string>();
  afterEach(() => {
    for (const root of temporaryRoots) NodeFS.rmSync(root, { recursive: true, force: true });
    temporaryRoots.clear();
  });
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  const bash = (cwd: string, command: string) =>
    execFileSync("bash", ["-c", command], {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });

  function transferRepositories() {
    const root = mkdtempSync(join(tmpdir(), "t3-chat-transfer-regression-"));
    temporaryRoots.add(root);
    const remote = join(root, "remote.git");
    const source = join(root, "source");
    const destination = join(root, "destination");
    git(root, "init", "--bare", remote);
    git(root, "init", "-b", "feat/move", source);
    git(source, "config", "user.name", "Test");
    git(source, "config", "user.email", "test@example.com");
    writeFileSync(join(source, "tracked.txt"), "base\n");
    writeFileSync(join(source, ".gitignore"), "*.ignored\n");
    git(source, "add", ".");
    git(source, "commit", "-m", "base");
    git(source, "remote", "add", "origin", remote);
    git(source, "push", "-u", "origin", "feat/move");
    git(root, "clone", "--branch", "feat/move", remote, destination);
    git(destination, "config", "user.name", "Test");
    git(destination, "config", "user.email", "test@example.com");
    const refs = continueBranchTransferRefs("regression", []);
    const input = { branch: "feat/move", refs, platform: "linux" as const };
    return { source, destination, remote, input };
  }

  it("restores committed, staged, unstaged, and untracked work without changing the source", () => {
    const root = mkdtempSync(join(tmpdir(), "t3-chat-transfer-"));
    temporaryRoots.add(root);
    const remote = join(root, "remote.git");
    const source = join(root, "source");
    const destination = join(root, "destination");
    execFileSync("git", ["init", "--bare", remote]);
    execFileSync("git", ["init", "-b", "feat/move", source]);
    git(source, "config", "user.name", "Test");
    git(source, "config", "user.email", "test@example.com");
    writeFileSync(join(source, "tracked.txt"), "base\n");
    git(source, "add", "tracked.txt");
    git(source, "commit", "-m", "base");
    git(source, "remote", "add", "origin", remote);
    git(source, "push", "-u", "origin", "feat/move");
    const checkpointRef = "refs/t3/checkpoints/thread-transfer/1";
    git(source, "update-ref", checkpointRef, "HEAD");
    execFileSync("git", ["clone", "--branch", "feat/move", remote, destination]);

    writeFileSync(join(source, "tracked.txt"), "staged\n");
    git(source, "add", "tracked.txt");
    writeFileSync(join(source, "tracked.txt"), "unstaged\n");
    writeFileSync(join(source, "untracked.txt"), "untracked\n");
    const sourceHead = git(source, "rev-parse", "HEAD");
    const sourceCachedDiff = git(source, "diff", "--cached");
    const sourceWorktreeDiff = git(source, "diff");

    const refs = continueBranchTransferRefs("abc123", [checkpointRef]);
    bash(
      source,
      continueBranchSnapshotPushCommand({ branch: "feat/move", refs, platform: "linux" }),
    );
    bash(destination, continueBranchTransferFetchCommand({ branch: "feat/move", refs }));
    bash(
      destination,
      continueBranchApplySnapshotCommand({ branch: "feat/move", refs, platform: "linux" }),
    );

    expect(git(destination, "rev-parse", "HEAD")).toBe(sourceHead);
    expect(git(destination, "diff", "--cached")).toBe(sourceCachedDiff);
    expect(git(destination, "diff")).toBe(sourceWorktreeDiff);
    expect(readFileSync(join(destination, "untracked.txt"), "utf8")).toBe("untracked\n");
    expect(git(destination, "rev-parse", checkpointRef)).toBe(sourceHead);
    bash(destination, continueBranchPrepareHistoryStorageCommand("linux", "destination-thread"));
    mkdirSync(join(destination, ".t3", "chat-transfers", "destination-thread"), {
      recursive: true,
    });
    writeFileSync(
      join(destination, ".t3", "chat-transfers", "destination-thread", "manifest.json"),
      '{"version":1}',
    );
    expect(() =>
      bash(destination, continueBranchPrepareHistoryStorageCommand("linux", "destination-thread")),
    ).toThrow();
    expect(
      readFileSync(
        join(destination, ".t3", "chat-transfers", "destination-thread", "manifest.json"),
        "utf8",
      ),
    ).toBe('{"version":1}');
    expect(git(destination, "status", "--porcelain", "--untracked-files=all")).toBe(
      "MM tracked.txt\n?? untracked.txt",
    );
    expect(() =>
      bash(
        destination,
        continueBranchVerifySourceCommand({ branch: "feat/move", refs, platform: "linux" }),
      ),
    ).not.toThrow();
    expect(() =>
      bash(
        source,
        continueBranchVerifySourceCommand({ branch: "feat/move", refs, platform: "linux" }),
      ),
    ).not.toThrow();
    expect(git(source, "rev-parse", "HEAD")).toBe(sourceHead);
    writeFileSync(join(source, "late-change.txt"), "do not delete\n");
    expect(() =>
      bash(
        source,
        continueBranchVerifySourceCommand({ branch: "feat/move", refs, platform: "linux" }),
      ),
    ).toThrow();
    expect(readFileSync(join(source, "late-change.txt"), "utf8")).toBe("do not delete\n");

    git(destination, "config", "user.name", "Test");
    git(destination, "config", "user.email", "test@example.com");
    const conflictingCheckpoint = git(
      destination,
      "commit-tree",
      `${sourceHead}^{tree}`,
      "-p",
      sourceHead,
      "-m",
      "destination checkpoint",
    );
    git(destination, "update-ref", checkpointRef, conflictingCheckpoint);
    expect(() =>
      bash(
        destination,
        continueBranchApplySnapshotCommand({ branch: "feat/move", refs, platform: "linux" }),
      ),
    ).toThrow();
    expect(git(destination, "rev-parse", checkpointRef)).toBe(conflictingCheckpoint);

    bash(
      destination,
      continueBranchCleanupCommand({ refs, includeRemote: false, platform: "linux" }),
    );
    bash(source, continueBranchCleanupCommand({ refs, includeRemote: true, platform: "linux" }));
    expect(git(source, "rev-parse", checkpointRef)).toBe(sourceHead);
  });

  it("preserves force-added ignored files and their separate staged and unstaged contents", () => {
    const { source, destination, input } = transferRepositories();
    writeFileSync(join(source, "new.ignored"), "staged\n");
    git(source, "add", "-f", "new.ignored");
    writeFileSync(join(source, "new.ignored"), "unstaged\n");
    const index = git(source, "write-tree");
    bash(source, continueBranchSnapshotPushCommand(input));
    bash(destination, continueBranchTransferFetchCommand(input));
    bash(destination, continueBranchApplySnapshotCommand(input));

    expect(readFileSync(join(destination, "new.ignored"), "utf8")).toBe("unstaged\n");
    expect(git(destination, "write-tree")).toBe(index);
    expect(git(destination, "diff")).toBe(git(source, "diff"));
    expect(git(destination, "diff", "--cached")).toBe(git(source, "diff", "--cached"));
    bash(source, continueBranchVerifySourceCommand(input));
    bash(destination, continueBranchVerifySourceCommand(input));
  });

  it.each([
    { incoming: "local data.txt", existing: "local data.txt", ignore: "local data.txt" },
    { incoming: "directory", existing: "directory/private.txt", ignore: "directory/" },
    { incoming: "directory/incoming.txt", existing: "directory", ignore: "directory" },
  ])(
    "rejects an ignored destination collision at $existing before changing files or HEAD",
    ({ incoming, existing, ignore }) => {
      const { source, destination, input } = transferRepositories();
      mkdirSync(NodePath.dirname(join(source, incoming)), { recursive: true });
      mkdirSync(NodePath.dirname(join(destination, existing)), { recursive: true });
      writeFileSync(join(source, incoming), "incoming source content\n");
      writeFileSync(join(destination, ".git", "info", "exclude"), `${ignore}\n`);
      writeFileSync(join(destination, existing), "destination content\n");
      const originalHead = git(destination, "rev-parse", "HEAD");
      const originalIndex = git(destination, "write-tree");
      bash(source, continueBranchSnapshotPushCommand(input));
      bash(destination, continueBranchTransferFetchCommand(input));

      expect(() => bash(destination, continueBranchApplySnapshotCommand(input))).toThrow();
      expect(readFileSync(join(destination, existing), "utf8")).toBe("destination content\n");
      expect(git(destination, "rev-parse", "HEAD")).toBe(originalHead);
      expect(git(destination, "write-tree")).toBe(originalIndex);
      expect(git(destination, "status", "--porcelain")).toBe("");
    },
  );

  it("rejects a destination with newer local commits before restoring incoming work", () => {
    const { source, destination, input } = transferRepositories();
    writeFileSync(join(destination, "tracked.txt"), "newer destination commit\n");
    git(destination, "add", ".");
    git(destination, "commit", "-m", "destination work");
    const originalHead = git(destination, "rev-parse", "HEAD");
    bash(source, continueBranchSnapshotPushCommand(input));
    bash(destination, continueBranchTransferFetchCommand(input));

    expect(() => bash(destination, continueBranchApplySnapshotCommand(input))).toThrow();
    expect(readFileSync(join(destination, "tracked.txt"), "utf8")).toBe(
      "newer destination commit\n",
    );
    expect(git(destination, "rev-parse", "HEAD")).toBe(originalHead);
    expect(git(destination, "status", "--porcelain")).toBe("");
  });

  it("verifies transferred untracked files even when the destination excludes their names", () => {
    const { source, destination, input } = transferRepositories();
    writeFileSync(join(source, "incoming.txt"), "source untracked content\n");
    writeFileSync(join(destination, ".git", "info", "exclude"), "incoming.txt\n");
    bash(source, continueBranchSnapshotPushCommand(input));
    bash(destination, continueBranchTransferFetchCommand(input));
    bash(destination, continueBranchApplySnapshotCommand(input));

    expect(readFileSync(join(destination, "incoming.txt"), "utf8")).toBe(
      "source untracked content\n",
    );
    bash(destination, continueBranchVerifySourceCommand(input));
    writeFileSync(join(destination, "incoming.txt"), "changed after transfer\n");
    expect(() => bash(destination, continueBranchVerifySourceCommand(input))).toThrow();
  });

  it("restores the captured HEAD even if the published branch advances before the fetch", () => {
    const { source, destination, input } = transferRepositories();
    const capturedHead = git(source, "rev-parse", "HEAD");
    writeFileSync(join(source, "tracked.txt"), "source work\n");
    bash(source, continueBranchSnapshotPushCommand(input));
    writeFileSync(join(destination, "tracked.txt"), "later remote work\n");
    git(destination, "add", ".");
    git(destination, "commit", "-m", "later remote commit");
    git(destination, "push", "origin", "feat/move");
    git(destination, "reset", "--hard", capturedHead);
    bash(destination, continueBranchTransferFetchCommand(input));
    bash(destination, continueBranchApplySnapshotCommand(input));

    expect(git(destination, "rev-parse", "HEAD")).toBe(capturedHead);
    expect(readFileSync(join(destination, "tracked.txt"), "utf8")).toBe("source work\n");
    bash(destination, continueBranchVerifySourceCommand(input));
    bash(source, continueBranchCleanupCommand({ ...input, includeRemote: true }));
    bash(destination, continueBranchCleanupCommand({ ...input, includeRemote: false }));
    expect(git(destination, "for-each-ref", "--format=%(refname)", "refs/t3/transfers")).toBe("");
  });

  it("builds guarded PowerShell transfer commands for Windows environments", () => {
    const refs = continueBranchTransferRefs("abc123", ["refs/t3/checkpoints/thread-transfer/1"]);
    const push = continueBranchSnapshotPushCommand({
      branch: "feat/move",
      refs,
      platform: "windows",
    });
    const apply = continueBranchApplySnapshotCommand({
      branch: "feat/move",
      refs,
      platform: "windows",
    });
    const verify = continueBranchVerifySourceCommand({
      branch: "feat/move",
      refs,
      platform: "windows",
    });
    expect(push).toContain("t3-transfer-abc123-checkpoint-0");
    expect(apply).toContain("Destination checkpoint contains unrelated work");
    expect(apply).toContain("Destination checkout is on a different branch");
    expect(verify).toContain("Source checkout changed branch during transfer");
    expect(continueBranchPrepareHistoryStorageCommand("windows", "destination-thread")).toContain(
      "Select-String",
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
