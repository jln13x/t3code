import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, VcsStatusResult } from "@t3tools/contracts";
import {
  ArrowRightIcon,
  Columns2Icon,
  FileIcon,
  GitBranchIcon,
  MessageCircleIcon,
  MinusIcon,
  PilcrowIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  Rows3Icon,
  TextWrapIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";

import { type DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { ensureLocalApi } from "~/localApi";
import {
  buildFileDiffRenderKey,
  canRenderFileDiff,
  getRenderablePatch,
  resolveDiffThemeName,
  resolveFileDiffPath,
} from "~/lib/diffRendering";
import { cn } from "~/lib/utils";
import { reviewEnvironment } from "~/state/review";
import { useEnvironmentQuery } from "~/state/query";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import { vcsEnvironment } from "~/state/vcs";
import { resolveServerConfigVersionMismatch } from "~/versionSkew";

import { useClientSettings } from "../hooks/useSettings";
import { useTheme } from "../hooks/useTheme";
import type { ReviewCommentContext } from "../reviewCommentContext";
import { ComposerPendingReviewComments } from "./chat/ComposerPendingReviewComments";
import { AnnotatableCodeView } from "./diffs/AnnotatableCodeView";
import { DIFF_VIEW_UNSAFE_CSS } from "./diffs/diffViewStyles";
import { Toggle, ToggleGroup } from "./ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { stackedThreadToast, toastManager } from "./ui/toast";
import {
  resolveWorktreeCompatibilityNotice,
  resolveWorktreeDiffSource,
  type WorktreeChangeScope,
} from "./WorktreeSourceControl.logic";

export type { WorktreeChangeScope } from "./WorktreeSourceControl.logic";

type WorktreeFile = VcsStatusResult["workingTree"]["files"][number];
type MutationKind = "stage" | "unstage" | "discard" | "refresh";

interface WorktreeSourceControlProps {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly projectName: string;
  readonly worktreeName: string;
  readonly selectedScope: WorktreeChangeScope;
  readonly selectedPath: string | null;
  readonly onSelectionChange: (scope: WorktreeChangeScope, path: string | null) => void;
  readonly composerDraftTarget: DraftId;
  readonly onContinueInChat: (branch: string | null) => void;
}

const EMPTY_REVIEW_COMMENTS: ReadonlyArray<ReviewCommentContext> = [];

function isStaged(file: WorktreeFile): boolean {
  return file.indexStatus !== undefined && file.indexStatus !== ".";
}

function isUnstaged(file: WorktreeFile): boolean {
  return file.worktreeStatus === undefined || file.worktreeStatus !== ".";
}

function fileStatus(file: WorktreeFile, scope: WorktreeChangeScope): string {
  return scope === "staged"
    ? (file.indexStatus ?? "M")
    : file.worktreeStatus === "?"
      ? "U"
      : (file.worktreeStatus ?? "M");
}

function statusClassName(status: string): string {
  if (status === "A" || status === "U" || status === "?") return "text-emerald-500";
  if (status === "D") return "text-rose-500";
  if (status === "R" || status === "C") return "text-sky-500";
  return "text-amber-500";
}

function splitFilePath(filePath: string): { readonly name: string; readonly parent: string } {
  const normalized = filePath.replaceAll("\\", "/");
  const separator = normalized.lastIndexOf("/");
  return separator < 0
    ? { name: normalized, parent: "" }
    : { name: normalized.slice(separator + 1), parent: normalized.slice(0, separator) };
}

interface ChangeSectionProps {
  readonly title: string;
  readonly scope: WorktreeChangeScope;
  readonly files: readonly WorktreeFile[];
  readonly selectedScope: WorktreeChangeScope;
  readonly selectedPath: string | null;
  readonly pending: { readonly kind: MutationKind; readonly path: string | null } | null;
  readonly canMutate: boolean;
  readonly onSelect: (scope: WorktreeChangeScope, path: string | null) => void;
  readonly onStage: (paths: readonly string[]) => void;
  readonly onUnstage: (paths: readonly string[]) => void;
  readonly onDiscard: (path: string) => void;
}

const ChangeSection = memo(function ChangeSection({
  title,
  scope,
  files,
  selectedScope,
  selectedPath,
  pending,
  canMutate,
  onSelect,
  onStage,
  onUnstage,
  onDiscard,
}: ChangeSectionProps) {
  const paths = useMemo(() => files.map((file) => file.path), [files]);
  if (files.length === 0) return null;

  const sectionSelected = selectedScope === scope && selectedPath === null;
  return (
    <section aria-label={`${title}, ${files.length} files`}>
      <div
        className={cn(
          "group/section flex h-8 items-center border-y border-border/55 px-2",
          sectionSelected ? "bg-accent/65" : "bg-muted/25",
        )}
      >
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left text-[11px] font-semibold tracking-wide text-foreground/78 uppercase focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
          onClick={() => onSelect(scope, null)}
        >
          {title}
          <span className="ml-1.5 font-mono text-[10px] font-normal text-muted-foreground/55">
            {files.length}
          </span>
        </button>
        {canMutate ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={scope === "staged" ? `Unstage all ${title}` : `Stage all ${title}`}
                  className="inline-flex size-6 items-center justify-center rounded text-muted-foreground opacity-70 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring group-hover/section:opacity-100"
                  disabled={pending !== null}
                  onClick={() => (scope === "staged" ? onUnstage(paths) : onStage(paths))}
                />
              }
            >
              {scope === "staged" ? (
                <MinusIcon className="size-3.5" />
              ) : (
                <PlusIcon className="size-3.5" />
              )}
            </TooltipTrigger>
            <TooltipPopup side="right">
              {scope === "staged" ? "Unstage All" : "Stage All"}
            </TooltipPopup>
          </Tooltip>
        ) : null}
      </div>
      <ul className="py-1">
        {files.map((file) => {
          const pathParts = splitFilePath(file.path);
          const status = fileStatus(file, scope);
          const selected = selectedScope === scope && selectedPath === file.path;
          const isPending = pending?.path === file.path;
          return (
            <li key={`${scope}:${file.path}`} className="group/file relative px-1">
              <button
                type="button"
                className={cn(
                  "flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left transition-colors focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
                  canMutate ? "pr-[4.25rem]" : "pr-2",
                  selected
                    ? "bg-accent text-accent-foreground"
                    : "text-foreground/80 hover:bg-accent/55 hover:text-foreground",
                )}
                onClick={() => onSelect(scope, file.path)}
              >
                <span
                  className={cn(
                    "w-3 shrink-0 text-center font-mono text-[11px] font-semibold",
                    statusClassName(status),
                  )}
                >
                  {status}
                </span>
                <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                  <span className="truncate text-xs">{pathParts.name}</span>
                  {pathParts.parent ? (
                    <span className="truncate text-[10px] text-muted-foreground/50">
                      {pathParts.parent}
                    </span>
                  ) : null}
                </span>
              </button>
              {canMutate ? (
                <div
                  className={cn(
                    "absolute top-1 right-2 flex items-center gap-0.5 rounded bg-background/92 opacity-0 shadow-sm transition-opacity group-hover/file:opacity-100 group-focus-within/file:opacity-100",
                    isPending ? "opacity-100" : "",
                  )}
                >
                  {scope === "unstaged" ? (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            aria-label={`Discard changes in ${file.path}`}
                            className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/12 hover:text-destructive focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                            disabled={pending !== null}
                            onClick={() => onDiscard(file.path)}
                          />
                        }
                      >
                        <RotateCcwIcon className="size-3.5" />
                      </TooltipTrigger>
                      <TooltipPopup side="right">Discard Changes…</TooltipPopup>
                    </Tooltip>
                  ) : null}
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          aria-label={
                            scope === "staged" ? `Unstage ${file.path}` : `Stage ${file.path}`
                          }
                          className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                          disabled={pending !== null}
                          onClick={() =>
                            scope === "staged" ? onUnstage([file.path]) : onStage([file.path])
                          }
                        />
                      }
                    >
                      {scope === "staged" ? (
                        <MinusIcon className="size-3.5" />
                      ) : (
                        <PlusIcon className="size-3.5" />
                      )}
                    </TooltipTrigger>
                    <TooltipPopup side="right">
                      {scope === "staged" ? "Unstage Changes" : "Stage Changes"}
                    </TooltipPopup>
                  </Tooltip>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
});

function formatMutationError(error: unknown): string {
  return error instanceof Error ? error.message : "The source control action failed.";
}

export function WorktreeSourceControl({
  environmentId,
  cwd,
  projectName,
  worktreeName,
  selectedScope,
  selectedPath,
  onSelectionChange,
  composerDraftTarget,
  onContinueInChat,
}: WorktreeSourceControlProps) {
  const { resolvedTheme } = useTheme();
  const settings = useClientSettings();
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const [diffRenderMode, setDiffRenderMode] = useState<"stacked" | "split">("stacked");
  const [wordWrap, setWordWrap] = useState(settings.wordWrap);
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(settings.diffIgnoreWhitespace);
  const [pending, setPending] = useState<{
    readonly kind: MutationKind;
    readonly path: string | null;
  } | null>(null);

  const status = useEnvironmentQuery(vcsEnvironment.status({ environmentId, input: { cwd } }));
  const preview = useEnvironmentQuery(
    reviewEnvironment.diffPreview({
      environmentId,
      cacheKey: JSON.stringify({
        generation: status.data?.localGeneration ?? null,
        ignoreWhitespace,
      }),
      input: { cwd, ignoreWhitespace, includeIndexSections: true },
    }),
  );
  const stagePaths = useAtomCommand(vcsEnvironment.stagePaths, { reportFailure: false });
  const unstagePaths = useAtomCommand(vcsEnvironment.unstagePaths, { reportFailure: false });
  const discardPaths = useAtomCommand(vcsEnvironment.discardPaths, { reportFailure: false });
  const refreshStatus = useAtomCommand(vcsEnvironment.refreshStatus, { reportFailure: false });
  const reviewComments = useComposerDraftStore(
    (store) => store.getComposerDraft(composerDraftTarget)?.reviewComments ?? EMPTY_REVIEW_COMMENTS,
  );
  const removeReviewComment = useComposerDraftStore((store) => store.removeReviewComment);

  const files = status.data?.workingTree.files ?? [];
  const stagedFiles = useMemo(() => files.filter(isStaged), [files]);
  const unstagedFiles = useMemo(() => files.filter(isUnstaged), [files]);
  const canMutate = serverConfig?.environment.capabilities.worktreeSourceControl === true;
  const compatibilityNotice = serverConfig
    ? resolveWorktreeCompatibilityNotice({
        supportsMutations: canMutate,
        serverVersion: serverConfig.environment.serverVersion,
        versionMismatch: resolveServerConfigVersionMismatch(serverConfig),
      })
    : null;
  const selectedSource = resolveWorktreeDiffSource(preview.data?.sources ?? [], selectedScope);
  const renderablePatch = useMemo(
    () =>
      getRenderablePatch(selectedSource?.diff, `worktree-source-control:${selectedScope}`, {
        compactPartialHunkOffsets: true,
      }),
    [selectedScope, selectedSource?.diff],
  );
  const visibleDiffs = useMemo(() => {
    if (!renderablePatch || renderablePatch.kind !== "files") return [];
    const sorted = renderablePatch.files.toSorted((left, right) =>
      resolveFileDiffPath(left).localeCompare(resolveFileDiffPath(right), undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
    return selectedPath
      ? sorted.filter((fileDiff) => resolveFileDiffPath(fileDiff) === selectedPath)
      : sorted;
  }, [renderablePatch, selectedPath]);
  const codeViewFiles = useMemo(
    () =>
      visibleDiffs.map((fileDiff) => {
        const canRender = canRenderFileDiff(fileDiff);
        return {
          canRender,
          fileDiff,
          filePath: resolveFileDiffPath(fileDiff),
          fileKey: buildFileDiffRenderKey(fileDiff),
          collapsed: !canRender,
        };
      }),
    [visibleDiffs],
  );
  const reviewSectionId = `worktree:${cwd}:${selectedScope}`;
  const reviewSectionTitle =
    selectedScope === "staged" ? "Staged worktree changes" : "Unstaged worktree changes";

  const runMutation = useCallback(
    async (kind: Exclude<MutationKind, "refresh">, paths: readonly string[]) => {
      if (paths.length === 0 || pending !== null) return false;
      const path = paths.length === 1 ? paths[0]! : null;
      setPending({ kind, path });
      const command =
        kind === "stage" ? stagePaths : kind === "unstage" ? unstagePaths : discardPaths;
      const result = await command({ environmentId, input: { cwd, paths: [...paths] } });
      setPending(null);
      if (result._tag === "Success") return true;
      if (!isAtomCommandInterrupted(result)) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title:
              kind === "stage"
                ? "Couldn’t stage changes"
                : kind === "unstage"
                  ? "Couldn’t unstage changes"
                  : "Couldn’t discard changes",
            description: formatMutationError(squashAtomCommandFailure(result)),
          }),
        );
      }
      return false;
    },
    [cwd, discardPaths, environmentId, pending, stagePaths, unstagePaths],
  );

  const handleStage = useCallback(
    (paths: readonly string[]) => {
      void runMutation("stage", paths).then((succeeded) => {
        if (succeeded) onSelectionChange("staged", paths.length === 1 ? paths[0]! : null);
      });
    },
    [onSelectionChange, runMutation],
  );
  const handleUnstage = useCallback(
    (paths: readonly string[]) => {
      void runMutation("unstage", paths).then((succeeded) => {
        if (succeeded) onSelectionChange("unstaged", paths.length === 1 ? paths[0]! : null);
      });
    },
    [onSelectionChange, runMutation],
  );
  const handleDiscard = useCallback(
    (filePath: string) => {
      void (async () => {
        const file = files.find((candidate) => candidate.path === filePath);
        const isUntracked = file?.worktreeStatus === "?";
        const confirmed = await ensureLocalApi().dialogs.confirm(
          [
            isUntracked
              ? `Delete untracked file “${filePath}”?`
              : `Discard changes in “${filePath}”?`,
            isUntracked
              ? "This file is not tracked by Git and cannot be restored."
              : "This will restore the worktree copy to its staged or committed version.",
          ].join("\n\n"),
        );
        if (!confirmed) return;
        const succeeded = await runMutation("discard", [filePath]);
        if (succeeded) onSelectionChange("unstaged", null);
      })();
    },
    [files, onSelectionChange, runMutation],
  );
  const handleRefresh = useCallback(() => {
    if (pending !== null) return;
    setPending({ kind: "refresh", path: null });
    status.refresh();
    void refreshStatus({ environmentId, input: { cwd } }).then((result) => {
      setPending(null);
      preview.refresh();
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Couldn’t refresh source control",
            description: formatMutationError(squashAtomCommandFailure(result)),
          }),
        );
      }
    });
  }, [cwd, environmentId, pending, preview, refreshStatus, status]);

  const activeFiles = selectedScope === "staged" ? stagedFiles : unstagedFiles;
  const selectionLabel =
    selectedPath ?? `${selectedScope === "staged" ? "Staged" : "Changes"} · ${activeFiles.length}`;
  const isLoading = status.isPending || preview.isPending;
  const noChanges = status.data !== null && files.length === 0;
  const statusErrorWithoutData = status.error !== null && status.data === null;
  const previewErrorWithoutData = preview.error !== null && preview.data === null;
  const hasStaleStatus = status.error !== null && status.data !== null;
  const hasStalePreview = preview.error !== null && preview.data !== null;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background">
      <header className="drag-region flex h-[52px] shrink-0 items-center gap-3 border-b border-border px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2.5 [-webkit-app-region:no-drag]">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/70 bg-muted/45">
            <GitBranchIcon aria-hidden="true" className="size-3.5 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5 text-xs">
              <span className="truncate font-medium text-foreground">{worktreeName}</span>
              {status.data?.refName ? (
                <span className="truncate font-mono text-[10px] text-muted-foreground/65">
                  {status.data.refName}
                </span>
              ) : null}
            </div>
            <p className="truncate text-[10px] text-muted-foreground/55">{projectName}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 [-webkit-app-region:no-drag]">
          {compatibilityNotice ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    tabIndex={0}
                    aria-label={`${compatibilityNotice.label}. ${compatibilityNotice.detail}`}
                    className="inline-flex h-6 items-center gap-1 rounded border border-amber-500/20 bg-amber-500/8 px-1.5 text-[10px] font-medium text-amber-700 dark:text-amber-300/80"
                  />
                }
              >
                <TriangleAlertIcon aria-hidden="true" className="size-3" />
                <span className="hidden sm:inline">{compatibilityNotice.label}</span>
              </TooltipTrigger>
              <TooltipPopup className="max-w-80" side="bottom">
                {compatibilityNotice.detail}
              </TooltipPopup>
            </Tooltip>
          ) : null}
          <span className="hidden font-mono text-[10px] tabular-nums text-muted-foreground/55 sm:inline">
            {stagedFiles.length} staged · {unstagedFiles.length} changed
          </span>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label="Refresh source control"
                  className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                  disabled={pending !== null}
                  onClick={handleRefresh}
                />
              }
            >
              <RefreshCwIcon
                className={cn("size-3.5", pending?.kind === "refresh" ? "animate-spin" : "")}
              />
            </TooltipTrigger>
            <TooltipPopup side="bottom">Refresh</TooltipPopup>
          </Tooltip>
        </div>
      </header>

      <div className="flex min-h-0 min-w-0 flex-1 max-md:flex-col">
        <aside className="flex w-[clamp(15rem,25vw,20rem)] shrink-0 flex-col border-r border-border bg-card/20 max-md:h-[42%] max-md:w-full max-md:border-r-0 max-md:border-b">
          <div className="flex h-9 shrink-0 items-center border-b border-border/60 px-3">
            <span className="text-xs font-medium text-foreground/82">Changes</span>
            <span className="ml-auto font-mono text-[10px] tabular-nums text-muted-foreground/55">
              {files.length}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
            {hasStaleStatus ? (
              <p
                role="status"
                title={status.error ?? undefined}
                className="border-b border-amber-500/15 bg-amber-500/6 px-3 py-2 text-[10px] text-amber-700 dark:text-amber-300/75"
              >
                Showing the last known changes. Refresh to retry live updates.
              </p>
            ) : null}
            {statusErrorWithoutData ? (
              <p className="px-3 py-3 text-xs text-destructive">{status.error}</p>
            ) : noChanges ? (
              <div className="flex h-full min-h-28 flex-col items-center justify-center px-5 text-center">
                <div className="mb-2 flex size-8 items-center justify-center rounded-full border border-border/60 bg-muted/35">
                  <FileIcon aria-hidden="true" className="size-3.5 text-muted-foreground/55" />
                </div>
                <p className="text-xs font-medium text-foreground/70">Working tree clean</p>
                <p className="mt-1 text-[10px] text-muted-foreground/55">No local changes</p>
              </div>
            ) : (
              <>
                {compatibilityNotice ? (
                  <div
                    role="status"
                    className="border-b border-amber-500/15 bg-amber-500/6 px-3 py-2 text-[10px] text-amber-800 dark:text-amber-200/75"
                  >
                    <p className="font-medium">{compatibilityNotice.label}</p>
                    <p className="mt-0.5 text-amber-700/80 dark:text-amber-300/65">
                      {compatibilityNotice.detail}
                    </p>
                  </div>
                ) : null}
                <ChangeSection
                  title="Staged Changes"
                  scope="staged"
                  files={stagedFiles}
                  selectedScope={selectedScope}
                  selectedPath={selectedPath}
                  pending={pending}
                  canMutate={canMutate}
                  onSelect={onSelectionChange}
                  onStage={handleStage}
                  onUnstage={handleUnstage}
                  onDiscard={handleDiscard}
                />
                <ChangeSection
                  title="Changes"
                  scope="unstaged"
                  files={unstagedFiles}
                  selectedScope={selectedScope}
                  selectedPath={selectedPath}
                  pending={pending}
                  canMutate={canMutate}
                  onSelect={onSelectionChange}
                  onStage={handleStage}
                  onUnstage={handleUnstage}
                  onDiscard={handleDiscard}
                />
              </>
            )}
          </div>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
          <div className="surface-subheader flex shrink-0 items-center gap-2 px-3">
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/72">
              {selectionLabel}
            </span>
            {hasStalePreview ? (
              <span
                title={preview.error ?? undefined}
                className="shrink-0 text-[10px] text-amber-700 dark:text-amber-300/75"
              >
                Last known diff
              </span>
            ) : null}
            <span className="hidden items-center gap-1 text-[10px] text-muted-foreground/55 lg:flex">
              <MessageCircleIcon aria-hidden="true" className="size-3" />
              Select lines to comment
            </span>
            <ToggleGroup
              className="shrink-0"
              variant="outline"
              size="xs"
              value={[diffRenderMode]}
              onValueChange={(value) => {
                const next = value[0];
                if (next === "stacked" || next === "split") setDiffRenderMode(next);
              }}
            >
              <Toggle aria-label="Stacked diff view" value="stacked">
                <Rows3Icon className="size-3" />
              </Toggle>
              <Toggle aria-label="Split diff view" value="split">
                <Columns2Icon className="size-3" />
              </Toggle>
            </ToggleGroup>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Toggle
                    aria-label={
                      wordWrap ? "Disable diff line wrapping" : "Enable diff line wrapping"
                    }
                    variant="outline"
                    size="xs"
                    pressed={wordWrap}
                    onPressedChange={(pressed) => setWordWrap(Boolean(pressed))}
                  />
                }
              >
                <TextWrapIcon className="size-3" />
              </TooltipTrigger>
              <TooltipPopup side="bottom">{wordWrap ? "Disable Wrap" : "Enable Wrap"}</TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Toggle
                    aria-label={
                      ignoreWhitespace ? "Show whitespace changes" : "Hide whitespace changes"
                    }
                    variant="outline"
                    size="xs"
                    pressed={ignoreWhitespace}
                    onPressedChange={(pressed) => setIgnoreWhitespace(Boolean(pressed))}
                  />
                }
              >
                <PilcrowIcon className="size-3" />
              </TooltipTrigger>
              <TooltipPopup side="bottom">
                {ignoreWhitespace ? "Show Whitespace" : "Hide Whitespace"}
              </TooltipPopup>
            </Tooltip>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">
            {previewErrorWithoutData ? (
              <div className="flex h-full items-center justify-center px-6 text-center text-xs text-destructive">
                {preview.error}
              </div>
            ) : isLoading && codeViewFiles.length === 0 ? (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground/60">
                Loading changes…
              </div>
            ) : codeViewFiles.length > 0 ? (
              <AnnotatableCodeView
                className="diff-render-surface h-full min-h-0 overflow-auto"
                files={codeViewFiles}
                sectionId={reviewSectionId}
                sectionTitle={reviewSectionTitle}
                composerDraftTarget={composerDraftTarget}
                renderHeaderPrefix={() => null}
                options={{
                  diffStyle: diffRenderMode === "split" ? "split" : "unified",
                  lineDiffType: "none",
                  overflow: wordWrap ? "wrap" : "scroll",
                  theme: resolveDiffThemeName(resolvedTheme),
                  themeType: resolvedTheme,
                  unsafeCSS: DIFF_VIEW_UNSAFE_CSS,
                  stickyHeaders: true,
                  layout: { paddingTop: 8, paddingBottom: 8, gap: 8 },
                }}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                <div className="mb-2 h-px w-12 bg-border" />
                <p className="text-xs font-medium text-foreground/65">
                  {activeFiles.length === 0
                    ? "No changes in this section"
                    : "Select a changed file"}
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground/50">
                  {activeFiles.length === 0
                    ? "Choose the other section to continue reviewing."
                    : "Choose a file or the section heading to inspect its diff."}
                </p>
              </div>
            )}
          </div>
          {reviewComments.length > 0 ? (
            <div className="flex shrink-0 items-center gap-3 border-t border-border bg-card/35 px-3 py-2">
              <ComposerPendingReviewComments
                className="min-w-0 flex-1 flex-nowrap overflow-x-auto py-0.5"
                comments={reviewComments}
                onRemove={(commentId) => removeReviewComment(composerDraftTarget, commentId)}
              />
              <button
                type="button"
                className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-foreground px-2.5 text-[11px] font-medium text-background transition-opacity hover:opacity-85 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                onClick={() => onContinueInChat(status.data?.refName ?? null)}
              >
                Continue in chat
                <ArrowRightIcon aria-hidden="true" className="size-3" />
              </button>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
