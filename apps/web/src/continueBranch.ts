import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import type {
  EnvironmentId,
  ExecutionEnvironmentPlatformOs,
  ModelSelection,
  ScopedProjectRef,
  VcsRef,
} from "@t3tools/contracts";

import { deriveLogicalProjectKey } from "./logicalProject";

interface ContinueBranchEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly connection: {
    readonly phase: string;
  };
}

export interface ContinueBranchTarget {
  readonly label: string;
  readonly projectRef: ScopedProjectRef;
  readonly workspaceRoot: string;
  readonly defaultModelSelection: ModelSelection | null;
}

/** Extends the stock server's background Git settings with PTY-safe SSH limits. */
export const CONTINUE_BRANCH_GIT_ENV = Object.freeze({
  GCM_INTERACTIVE: "never",
  GIT_ASKPASS: "",
  GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o ConnectTimeout=20 -o ConnectionAttempts=1",
  GIT_TERMINAL_PROMPT: "0",
  SSH_ASKPASS: "",
  SSH_ASKPASS_REQUIRE: "never",
});

function stripTerminalControlSequences(value: string): string {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 27) {
      const kind = value.charCodeAt(index + 1);
      if (kind === 91) {
        index += 2;
        while (index < value.length) {
          const sequenceCode = value.charCodeAt(index);
          if (sequenceCode >= 64 && sequenceCode <= 126) break;
          index += 1;
        }
      } else if (kind === 93) {
        index += 2;
        while (index < value.length) {
          if (value.charCodeAt(index) === 7) break;
          if (value.charCodeAt(index) === 27 && value.charCodeAt(index + 1) === 92) {
            index += 1;
            break;
          }
          index += 1;
        }
      }
      continue;
    }
    if (code === 9 || code === 10 || code === 13 || code >= 32) output += value[index];
  }
  return output;
}

export function continueBranchTerminalFailureMessage(input: {
  readonly buffer: string;
  readonly marker: string;
  readonly fallback: string;
}): string {
  const lines = stripTerminalControlSequences(input.buffer)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.includes(input.marker));
  const usefulLineIndex = lines.findLastIndex((line) =>
    /fatal:|error:|permission denied|authentication|passphrase|password|host key|could not (?:read|resolve)|unable to access|repository not found|connection (?:refused|timed out)|timed out/i.test(
      line,
    ),
  );
  const message =
    usefulLineIndex < 0
      ? input.fallback
      : lines.slice(usefulLineIndex, usefulLineIndex + 6).join("\n");
  return message.length > 600 ? `${message.slice(0, 597)}...` : message;
}

/**
 * Finds connected copies of the same repository project on other environments.
 * Project grouping is intentional here even when the sidebar is configured to
 * show environments separately: that display preference must not hide a valid
 * handoff destination.
 */
export function resolveContinueBranchTargets(input: {
  readonly sourceProjectRef: ScopedProjectRef;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly environments: ReadonlyArray<ContinueBranchEnvironment>;
}): ReadonlyArray<ContinueBranchTarget> {
  const sourceProject = input.projects.find(
    (project) =>
      project.environmentId === input.sourceProjectRef.environmentId &&
      project.id === input.sourceProjectRef.projectId,
  );
  if (!sourceProject?.repositoryIdentity?.canonicalKey) return [];
  const sourceLogicalKey = deriveLogicalProjectKey(sourceProject, {
    groupingMode: "repository_path",
  });
  const connectedEnvironmentLabels = new Map(
    input.environments
      .filter((environment) => environment.connection.phase === "connected")
      .map((environment) => [environment.environmentId, environment.label] as const),
  );
  const candidates = input.projects.filter(
    (project) =>
      project.environmentId !== sourceProject.environmentId &&
      connectedEnvironmentLabels.has(project.environmentId) &&
      deriveLogicalProjectKey(project, { groupingMode: "repository_path" }) === sourceLogicalKey,
  );
  const countByEnvironment = new Map<EnvironmentId, number>();
  for (const candidate of candidates) {
    countByEnvironment.set(
      candidate.environmentId,
      (countByEnvironment.get(candidate.environmentId) ?? 0) + 1,
    );
  }

  return candidates
    .map((project) => {
      const environmentLabel = connectedEnvironmentLabels.get(project.environmentId)!;
      return {
        label:
          countByEnvironment.get(project.environmentId) === 1
            ? environmentLabel
            : `${environmentLabel} — ${project.workspaceRoot}`,
        projectRef: scopeProjectRef(project.environmentId, project.id),
        workspaceRoot: project.workspaceRoot,
        defaultModelSelection: project.defaultModelSelection,
      };
    })
    .toSorted((left, right) => left.label.localeCompare(right.label));
}

export function continueBranchPrepareHistoryStorageCommand(
  platform: ExecutionEnvironmentPlatformOs,
  destinationThreadId: string,
): string {
  if (!/^[a-z0-9-]+$/i.test(destinationThreadId)) {
    throw new Error("Invalid destination thread id.");
  }
  const ignoredPath = "/.t3/chat-transfers/";
  const historyPath = `.t3/chat-transfers/${destinationThreadId}`;
  if (platform === "windows") {
    return [
      `$t3Exclude = git rev-parse --git-path info/exclude`,
      `if ($LASTEXITCODE -ne 0) { throw 'Git command failed' }`,
      `$t3ExcludeParent = Split-Path -Parent $t3Exclude`,
      `New-Item -ItemType Directory -Force -Path $t3ExcludeParent | Out-Null`,
      `if (-not (Test-Path $t3Exclude)) { New-Item -ItemType File -Force -Path $t3Exclude | Out-Null }`,
      `$t3IgnorePattern = ${powershellQuote(ignoredPath)}`,
      `if (-not (Select-String -SimpleMatch -Quiet -Path $t3Exclude -Pattern $t3IgnorePattern)) { Add-Content -Path $t3Exclude -Value $t3IgnorePattern }`,
      `$t3HistoryPath = ${powershellQuote(historyPath)}`,
      `$t3TrackedHistory = git ls-files -- $t3HistoryPath`,
      `if ($LASTEXITCODE -ne 0 -or $t3TrackedHistory -or (Test-Path $t3HistoryPath)) { throw 'Destination history path already exists' }`,
      `git check-ignore -q $t3HistoryPath`,
      `if ($LASTEXITCODE -ne 0) { throw 'Destination history path is not ignored' }`,
    ].join("; ");
  }
  return [
    `t3_exclude=$(git rev-parse --git-path info/exclude)`,
    `mkdir -p "$(dirname "$t3_exclude")"`,
    `touch "$t3_exclude"`,
    `(grep -Fqx ${shellQuote(ignoredPath)} "$t3_exclude" || printf '\\n%s\\n' ${shellQuote(ignoredPath)} >> "$t3_exclude")`,
    `test -z "$(git ls-files -- ${shellQuote(historyPath)})"`,
    `test ! -e ${shellQuote(historyPath)}`,
    `git check-ignore -q ${shellQuote(historyPath)}`,
  ].join(" && ");
}

export function continueBranchTargetIndex(action: string): number | null {
  const match = /^continue-branch-on:(\d+)$/.exec(action);
  if (!match) return null;
  const index = Number(match[1]);
  return Number.isSafeInteger(index) ? index : null;
}

export type ContinueBranchPushPlan =
  | { readonly kind: "push" }
  | { readonly kind: "error"; readonly message: string };

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function powershellQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export interface ContinueBranchTransferRefs {
  readonly localHead: string;
  readonly localIndex: string;
  readonly localWorktree: string;
  readonly remoteHead: string;
  readonly remoteIndex: string;
  readonly remoteWorktree: string;
  readonly checkpoints: ReadonlyArray<{
    readonly local: string;
    readonly transferLocal: string;
    readonly remote: string;
  }>;
}

export function continueBranchTransferRefs(
  operationId: string,
  checkpointRefs: ReadonlyArray<string>,
): ContinueBranchTransferRefs {
  if (!/^[a-z0-9]+$/i.test(operationId)) throw new Error("Invalid transfer operation id.");
  const localBase = `refs/t3/transfers/${operationId}`;
  const remoteBase = `refs/heads/t3-transfer-${operationId}`;
  return {
    localHead: `${localBase}/head`,
    localIndex: `${localBase}/index`,
    localWorktree: `${localBase}/worktree`,
    remoteHead: `${remoteBase}-head`,
    remoteIndex: `${remoteBase}-index`,
    remoteWorktree: `${remoteBase}-worktree`,
    checkpoints: checkpointRefs.map((local, index) => ({
      local,
      transferLocal: `${localBase}/checkpoint-${index}`,
      remote: `${remoteBase}-checkpoint-${index}`,
    })),
  };
}

/** Export from the real index; verify against exported paths even if local ignore rules differ. */
function posixWorktreeTreeScript(
  tempVariable: string,
  outputVariable: string,
  trackedTree?: string,
): string {
  const capture = [
    `t3_snapshot_index=$(git write-tree)`,
    `${tempVariable}=$(mktemp)`,
    `trap 'rm -f "$${tempVariable}"' EXIT`,
    `GIT_INDEX_FILE="$${tempVariable}" git read-tree ${trackedTree === undefined ? '"$t3_snapshot_index"' : shellQuote(trackedTree)}`,
    `GIT_INDEX_FILE="$${tempVariable}" git add -A`,
    `GIT_INDEX_FILE="$${tempVariable}" git write-tree`,
  ].join(" && ");
  return `${outputVariable}=$(${capture})`;
}

function powershellGit(command: string): string {
  return `${command}; if ($LASTEXITCODE -ne 0) { throw 'Git command failed' }`;
}

function powershellWorktreeTreeScript(
  tempVariable: string,
  outputVariable: string,
  trackedTree?: string,
): string {
  return [
    powershellGit(`$t3SnapshotIndex = git write-tree`),
    `$${tempVariable} = Join-Path $env:TEMP ('t3-transfer-' + [guid]::NewGuid())`,
    `$t3PreviousIndex = $env:GIT_INDEX_FILE`,
    `try { $env:GIT_INDEX_FILE = $${tempVariable}; ${powershellGit(`git read-tree ${trackedTree === undefined ? "$t3SnapshotIndex" : powershellQuote(trackedTree)}`)}; ${powershellGit("git add -A")}; ${powershellGit(`$${outputVariable} = git write-tree`)} } finally { $env:GIT_INDEX_FILE = $t3PreviousIndex; Remove-Item -Force -ErrorAction SilentlyContinue $${tempVariable} }`,
  ].join("; ");
}

export function continueBranchSnapshotPushCommand(input: {
  readonly branch: string;
  readonly refs: ContinueBranchTransferRefs;
  readonly platform: ExecutionEnvironmentPlatformOs;
}): string {
  const { refs } = input;
  const pushRefspecs = [
    `${refs.localHead}:refs/heads/${input.branch}`,
    `${refs.localHead}:${refs.remoteHead}`,
    `${refs.localIndex}:${refs.remoteIndex}`,
    `${refs.localWorktree}:${refs.remoteWorktree}`,
    ...refs.checkpoints.map((checkpoint) => `${checkpoint.local}:${checkpoint.remote}`),
  ];
  if (input.platform === "windows") {
    return [
      `$t3Head = git rev-parse HEAD`,
      `if ($LASTEXITCODE -ne 0) { throw 'Git command failed' }`,
      `$t3IndexTree = git write-tree`,
      `if ($LASTEXITCODE -ne 0) { throw 'Git command failed' }`,
      `$t3IndexCommit = git -c user.name='T3 Code' -c user.email='noreply@t3.codes' commit-tree $t3IndexTree -p $t3Head -m 'T3 transfer index'`,
      `if ($LASTEXITCODE -ne 0) { throw 'Git command failed' }`,
      powershellWorktreeTreeScript("t3TransferIndex", "t3WorktreeTree"),
      `$t3WorktreeCommit = git -c user.name='T3 Code' -c user.email='noreply@t3.codes' commit-tree $t3WorktreeTree -p $t3Head -m 'T3 transfer worktree'`,
      `if ($LASTEXITCODE -ne 0) { throw 'Git command failed' }`,
      powershellGit(`git update-ref ${powershellQuote(refs.localHead)} $t3Head`),
      powershellGit(`git update-ref ${powershellQuote(refs.localIndex)} $t3IndexCommit`),
      powershellGit(`git update-ref ${powershellQuote(refs.localWorktree)} $t3WorktreeCommit`),
      powershellGit(`git push --atomic origin ${pushRefspecs.map(powershellQuote).join(" ")}`),
    ].join("; ");
  }
  return [
    `t3_head=$(git rev-parse HEAD)`,
    `t3_index_tree=$(git write-tree)`,
    `t3_index_commit=$(git -c user.name='T3 Code' -c user.email='noreply@t3.codes' commit-tree "$t3_index_tree" -p "$t3_head" -m 'T3 transfer index')`,
    posixWorktreeTreeScript("t3_transfer_index", "t3_worktree_tree"),
    `t3_worktree_commit=$(git -c user.name='T3 Code' -c user.email='noreply@t3.codes' commit-tree "$t3_worktree_tree" -p "$t3_head" -m 'T3 transfer worktree')`,
    `git update-ref ${shellQuote(refs.localHead)} "$t3_head"`,
    `git update-ref ${shellQuote(refs.localIndex)} "$t3_index_commit"`,
    `git update-ref ${shellQuote(refs.localWorktree)} "$t3_worktree_commit"`,
    `git push --atomic origin ${pushRefspecs.map(shellQuote).join(" ")}`,
  ].join(" && ");
}

export function continueBranchTransferFetchCommand(input: {
  readonly branch: string;
  readonly refs: ContinueBranchTransferRefs;
}): string {
  const refspecs = [
    `+refs/heads/${input.branch}:refs/remotes/origin/${input.branch}`,
    `+${input.refs.remoteHead}:${input.refs.localHead}`,
    `+${input.refs.remoteIndex}:${input.refs.localIndex}`,
    `+${input.refs.remoteWorktree}:${input.refs.localWorktree}`,
    ...input.refs.checkpoints.map(
      (checkpoint) => `+${checkpoint.remote}:${checkpoint.transferLocal}`,
    ),
  ];
  return `git fetch origin ${refspecs.map(shellQuote).join(" ")}`;
}

export function continueBranchApplySnapshotCommand(input: {
  readonly branch: string;
  readonly refs: ContinueBranchTransferRefs;
  readonly platform: ExecutionEnvironmentPlatformOs;
}): string {
  const expectedIndex = `${input.refs.localIndex}^{tree}`;
  const expectedWorktree = `${input.refs.localWorktree}^{tree}`;
  // Checkout protects ignored files as well as ordinary untracked files. Once
  // it succeeds, restore the captured branch tip and index without touching the
  // restored working files, so staged and unstaged changes remain separate.
  const ancestryError = "error: Destination branch contains commits outside the source snapshot.";
  if (input.platform === "windows") {
    const checkpointChecks = input.refs.checkpoints.flatMap((checkpoint, index) => [
      `git show-ref --verify --quiet ${powershellQuote(checkpoint.local)}`,
      `$t3CheckpointExists${index} = $LASTEXITCODE -eq 0`,
      `if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne 1) { throw 'Git command failed' }`,
      `if ($t3CheckpointExists${index}) { $t3ExistingCheckpoint${index} = git rev-parse ${powershellQuote(checkpoint.local)}; $t3IncomingCheckpoint${index} = git rev-parse ${powershellQuote(checkpoint.transferLocal)}; if ($LASTEXITCODE -ne 0 -or $t3ExistingCheckpoint${index} -ne $t3IncomingCheckpoint${index}) { throw 'Destination checkpoint contains unrelated work' } }`,
    ]);
    const checkpointUpdates = input.refs.checkpoints.map((checkpoint) =>
      powershellGit(
        `git update-ref ${powershellQuote(checkpoint.local)} ${powershellQuote(checkpoint.transferLocal)}`,
      ),
    );
    const exactCheck = [
      `$t3CurrentHead = git rev-parse HEAD`,
      `$t3CurrentIndex = git write-tree`,
      powershellWorktreeTreeScript("t3VerifyIndex", "t3CurrentWorktree", expectedWorktree),
      `$t3ExpectedHead = git rev-parse ${powershellQuote(input.refs.localHead)}`,
      `$t3ExpectedIndex = git rev-parse ${powershellQuote(expectedIndex)}`,
      `$t3ExpectedWorktree = git rev-parse ${powershellQuote(expectedWorktree)}`,
      `if ($t3CurrentHead -ne $t3ExpectedHead -or $t3CurrentIndex -ne $t3ExpectedIndex -or $t3CurrentWorktree -ne $t3ExpectedWorktree) { throw 'Destination checkout contains unrelated changes' }`,
    ].join("; ");
    const restoreCleanCheckout = [
      `git merge-base --is-ancestor HEAD ${powershellQuote(input.refs.localHead)}`,
      `if ($LASTEXITCODE -ne 0) { throw ${powershellQuote(ancestryError)} }`,
      powershellGit(
        `git checkout --no-overwrite-ignore -B ${powershellQuote(input.branch)} ${powershellQuote(input.refs.localWorktree)}`,
      ),
      powershellGit(`git reset --soft ${powershellQuote(input.refs.localHead)}`),
      powershellGit(`git read-tree ${powershellQuote(expectedIndex)}`),
    ].join("; ");
    return [
      ...checkpointChecks,
      `$t3CurrentBranch = git branch --show-current`,
      `if ($LASTEXITCODE -ne 0 -or $t3CurrentBranch -ne ${powershellQuote(input.branch)}) { throw 'Destination checkout is on a different branch' }`,
      `$t3Dirty = git status --porcelain --untracked-files=all`,
      `if ($LASTEXITCODE -ne 0) { throw 'Git command failed' }`,
      `if ($t3Dirty) { ${exactCheck} } else { ${restoreCleanCheckout} }`,
      ...checkpointUpdates,
    ].join("; ");
  }
  const checkpointChecks = input.refs.checkpoints.map(
    (checkpoint) =>
      `if git show-ref --verify --quiet ${shellQuote(checkpoint.local)}; then test "$(git rev-parse ${shellQuote(checkpoint.local)})" = "$(git rev-parse ${shellQuote(checkpoint.transferLocal)})"; else test "$?" = 1; fi`,
  );
  const checkpointUpdates = input.refs.checkpoints.map(
    (checkpoint) =>
      `git update-ref ${shellQuote(checkpoint.local)} ${shellQuote(checkpoint.transferLocal)}`,
  );
  const exactCheck = [
    `test "$(git rev-parse HEAD)" = "$(git rev-parse ${shellQuote(input.refs.localHead)})"`,
    `test "$(git write-tree)" = "$(git rev-parse ${shellQuote(expectedIndex)})"`,
    posixWorktreeTreeScript("t3_verify_index", "t3_current_worktree", expectedWorktree),
    `test "$t3_current_worktree" = "$(git rev-parse ${shellQuote(expectedWorktree)})"`,
  ].join(" && ");
  const restoreCleanCheckout = [
    `(git merge-base --is-ancestor HEAD ${shellQuote(input.refs.localHead)} || { printf '%s\\n' ${shellQuote(ancestryError)} >&2; false; })`,
    `git checkout --no-overwrite-ignore -B ${shellQuote(input.branch)} ${shellQuote(input.refs.localWorktree)}`,
    `git reset --soft ${shellQuote(input.refs.localHead)}`,
    `git read-tree ${shellQuote(expectedIndex)}`,
  ].join(" && ");
  return [
    ...checkpointChecks,
    `test "$(git branch --show-current)" = ${shellQuote(input.branch)}`,
    `t3_dirty=$(git status --porcelain --untracked-files=all)`,
    `if test -n "$t3_dirty"; then ${exactCheck}; else ${restoreCleanCheckout}; fi`,
    ...checkpointUpdates,
  ].join(" && ");
}

export function continueBranchVerifySourceCommand(input: {
  readonly branch: string;
  readonly refs: ContinueBranchTransferRefs;
  readonly platform: ExecutionEnvironmentPlatformOs;
}): string {
  if (input.platform === "windows") {
    return [
      `$t3CurrentBranch = git branch --show-current`,
      `if ($LASTEXITCODE -ne 0 -or $t3CurrentBranch -ne ${powershellQuote(input.branch)}) { throw 'Source checkout changed branch during transfer' }`,
      `$t3CurrentHead = git rev-parse HEAD`,
      `$t3CurrentIndex = git write-tree`,
      powershellWorktreeTreeScript(
        "t3VerifyIndex",
        "t3CurrentWorktree",
        `${input.refs.localWorktree}^{tree}`,
      ),
      `$t3ExpectedHead = git rev-parse ${powershellQuote(input.refs.localHead)}`,
      `$t3ExpectedIndex = git rev-parse ${powershellQuote(`${input.refs.localIndex}^{tree}`)}`,
      `$t3ExpectedWorktree = git rev-parse ${powershellQuote(`${input.refs.localWorktree}^{tree}`)}`,
      `if ($t3CurrentHead -ne $t3ExpectedHead -or $t3CurrentIndex -ne $t3ExpectedIndex -or $t3CurrentWorktree -ne $t3ExpectedWorktree) { throw 'Source checkout changed during transfer' }`,
    ].join("; ");
  }
  return [
    `test "$(git branch --show-current)" = ${shellQuote(input.branch)}`,
    `test "$(git rev-parse HEAD)" = "$(git rev-parse ${shellQuote(input.refs.localHead)})"`,
    `test "$(git write-tree)" = "$(git rev-parse ${shellQuote(`${input.refs.localIndex}^{tree}`)})"`,
    posixWorktreeTreeScript(
      "t3_verify_index",
      "t3_current_worktree",
      `${input.refs.localWorktree}^{tree}`,
    ),
    `test "$t3_current_worktree" = "$(git rev-parse ${shellQuote(`${input.refs.localWorktree}^{tree}`)})"`,
  ].join(" && ");
}

export function continueBranchCleanupCommand(input: {
  readonly refs: ContinueBranchTransferRefs;
  readonly includeRemote: boolean;
  readonly platform: ExecutionEnvironmentPlatformOs;
}): string {
  const quote = input.platform === "windows" ? powershellQuote : shellQuote;
  const separator = input.platform === "windows" ? "; " : "; ";
  const remoteTrackingRefs = [
    input.refs.remoteHead,
    input.refs.remoteIndex,
    input.refs.remoteWorktree,
    ...input.refs.checkpoints.map((checkpoint) => checkpoint.remote),
  ].map((ref) => ref.replace(/^refs\/heads\//, "refs/remotes/origin/"));
  const local = [
    input.refs.localHead,
    input.refs.localIndex,
    input.refs.localWorktree,
    ...input.refs.checkpoints.map((checkpoint) => checkpoint.transferLocal),
    ...remoteTrackingRefs,
  ]
    .map((ref) => `git update-ref -d ${quote(ref)}`)
    .join(separator);
  if (!input.includeRemote) return local;
  const remoteBranches = [
    input.refs.remoteHead,
    input.refs.remoteIndex,
    input.refs.remoteWorktree,
    ...input.refs.checkpoints.map((checkpoint) => checkpoint.remote),
  ].map((ref) => ref.replace(/^refs\/heads\//, ""));
  return `${local}; git push origin --delete ${remoteBranches.map(quote).join(" ")}`;
}

export function continueBranchPushCommand(branch: string): string {
  return `git push -u origin ${shellQuote(`HEAD:refs/heads/${branch}`)}`;
}

export function continueBranchFetchCommand(branch: string): string {
  return `git fetch origin ${shellQuote(`refs/heads/${branch}:refs/remotes/origin/${branch}`)}`;
}

export function continueBranchTerminalCommand(input: {
  readonly command: string;
  readonly marker: string;
  readonly platform: ExecutionEnvironmentPlatformOs;
}): string {
  return input.platform === "windows"
    ? `& { $global:LASTEXITCODE = 0; try { ${input.command}; $t3Status = $LASTEXITCODE } catch { Write-Error $_; $t3Status = 1 }; Write-Output "${input.marker}$t3Status" }`
    : `${input.command}; printf '\\n${input.marker}%s\\n' "$?"`;
}

/**
 * The thread's local branch name is authoritative for a handoff. Its configured
 * upstream is deliberately irrelevant: a feature branch may still track the
 * base branch it was created from.
 */
export function resolveContinueBranchPushPlan(input: {
  readonly branch: string;
  readonly status: {
    readonly isRepo: boolean;
    readonly hasPrimaryRemote: boolean;
    readonly refName: string | null;
  };
}): ContinueBranchPushPlan {
  if (!input.status.isRepo) {
    return { kind: "error", message: "The source checkout is not a Git repository." };
  }
  if (input.status.refName !== input.branch) {
    return {
      kind: "error",
      message: `The source checkout is on ${input.status.refName ?? "a detached HEAD"}, not ${input.branch}.`,
    };
  }
  if (!input.status.hasPrimaryRemote) {
    return { kind: "error", message: "The source repository does not have a Git remote." };
  }
  return { kind: "push" };
}

export function resolveContinueBranchRef(
  refs: ReadonlyArray<VcsRef>,
  branch: string,
): VcsRef | null {
  const local = refs.find((ref) => ref.isRemote !== true && ref.name === branch);
  if (local) return local;

  const remotes = refs.filter((ref) => {
    if (ref.isRemote !== true) return false;
    if (ref.remoteName) return ref.name === `${ref.remoteName}/${branch}`;
    const separator = ref.name.indexOf("/");
    return separator > 0 && ref.name.slice(separator + 1) === branch;
  });
  return (
    remotes.find((ref) => ref.remoteName === "origin" || ref.name.startsWith("origin/")) ??
    remotes[0] ??
    null
  );
}
