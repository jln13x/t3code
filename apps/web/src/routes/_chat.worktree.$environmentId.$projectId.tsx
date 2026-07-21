import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";

import type { WorktreeChangeScope } from "~/components/WorktreeSourceControl";
import { type DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { SidebarInset } from "~/components/ui/sidebar";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { usePrimarySettings } from "~/hooks/useSettings";
import { newDraftId } from "~/lib/utils";
import { mergeReviewComments } from "~/reviewCommentContext";
import { useProject } from "~/state/entities";

const WorktreeSourceControl = lazy(() =>
  import("~/components/WorktreeSourceControl").then((module) => ({
    default: module.WorktreeSourceControl,
  })),
);

export interface WorktreeSourceControlSearch {
  readonly cwd: string;
  readonly branch?: string;
  readonly scope: WorktreeChangeScope;
  readonly file?: string;
}

function validateWorktreeSearch(search: Record<string, unknown>): WorktreeSourceControlSearch {
  const cwd = typeof search.cwd === "string" ? search.cwd.trim() : "";
  const branch = typeof search.branch === "string" ? search.branch.trim() : "";
  const scope = search.scope === "staged" ? "staged" : "unstaged";
  const file = typeof search.file === "string" ? search.file.trim() : "";
  return {
    cwd,
    ...(branch ? { branch } : {}),
    scope,
    ...(file ? { file } : {}),
  };
}

function worktreeDisplayName(cwd: string): string {
  const normalized = cwd.replaceAll("\\", "/").replace(/\/+$/, "");
  return normalized.split("/").at(-1) || cwd;
}

interface WorktreeSourceControlSessionProps {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly projectName: string;
  readonly projectWorkspaceRoot: string;
  readonly cwd: string;
  readonly initialBranch: string | null;
  readonly selectedScope: WorktreeChangeScope;
  readonly selectedPath: string | null;
  readonly onSelectionChange: (scope: WorktreeChangeScope, file: string | null) => void;
}

function WorktreeSourceControlSession({
  environmentId,
  projectId,
  projectName,
  projectWorkspaceRoot,
  cwd,
  initialBranch,
  selectedScope,
  selectedPath,
  onSelectionChange,
}: WorktreeSourceControlSessionProps) {
  const navigate = useNavigate();
  const prepareDraft = useNewThreadHandler();
  const [reviewDraftTarget] = useState(newDraftId);
  const continuingRef = useRef(false);

  useEffect(
    () => () => {
      useComposerDraftStore.getState().clearDraftThread(reviewDraftTarget);
    },
    [reviewDraftTarget],
  );

  const handleContinueInChat = useCallback(
    async (resolvedBranch: string | null) => {
      if (continuingRef.current) return;
      continuingRef.current = true;
      try {
        let chatDraftTarget: DraftId | null = null;
        await prepareDraft(scopeProjectRef(environmentId, projectId), {
          branch: resolvedBranch ?? initialBranch,
          worktreePath: cwd,
          envMode: cwd === projectWorkspaceRoot ? "local" : "worktree",
          startFromOrigin: false,
          navigate: false,
          onDraftReady: (draftId) => {
            chatDraftTarget = draftId;
          },
        });
        if (chatDraftTarget === null) return;
        const draftStore = useComposerDraftStore.getState();
        const reviewComments = draftStore.getComposerDraft(reviewDraftTarget)?.reviewComments ?? [];
        const existingComments = draftStore.getComposerDraft(chatDraftTarget)?.reviewComments ?? [];
        draftStore.setReviewComments(
          chatDraftTarget,
          mergeReviewComments(existingComments, reviewComments),
        );
        draftStore.clearDraftThread(reviewDraftTarget);
        await navigate({
          to: "/draft/$draftId",
          params: { draftId: chatDraftTarget },
        });
      } finally {
        continuingRef.current = false;
      }
    },
    [
      cwd,
      environmentId,
      initialBranch,
      navigate,
      prepareDraft,
      projectId,
      projectWorkspaceRoot,
      reviewDraftTarget,
    ],
  );

  return (
    <WorktreeSourceControl
      environmentId={environmentId}
      cwd={cwd}
      projectName={projectName}
      worktreeName={worktreeDisplayName(cwd)}
      selectedScope={selectedScope}
      selectedPath={selectedPath}
      onSelectionChange={onSelectionChange}
      composerDraftTarget={reviewDraftTarget}
      onContinueInChat={(branch) => void handleContinueInChat(branch)}
    />
  );
}

function WorktreeSourceControlRouteView() {
  const navigate = useNavigate();
  const { environmentId: rawEnvironmentId, projectId: rawProjectId } = Route.useParams();
  const search = Route.useSearch();
  const environmentId = rawEnvironmentId as EnvironmentId;
  const projectId = rawProjectId as ProjectId;
  const project = useProject(scopeProjectRef(environmentId, projectId));
  const enabled = usePrimarySettings((settings) => settings.enableWorktreeSourceControl);

  useEffect(() => {
    if (enabled && search.cwd) return;
    void navigate({ to: "/", replace: true });
  }, [enabled, navigate, search.cwd]);

  const handleSelectionChange = useCallback(
    (scope: WorktreeChangeScope, file: string | null) => {
      void navigate({
        to: "/worktree/$environmentId/$projectId",
        params: { environmentId: rawEnvironmentId, projectId: rawProjectId },
        search: {
          cwd: search.cwd,
          ...(search.branch ? { branch: search.branch } : {}),
          scope,
          ...(file ? { file } : {}),
        },
        replace: true,
      });
    },
    [navigate, rawEnvironmentId, rawProjectId, search.branch, search.cwd],
  );

  if (!enabled || !search.cwd || !project) return null;

  const reviewScopeKey = `${environmentId}:${projectId}:${search.cwd}:${search.branch ?? ""}`;

  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
      <Suspense fallback={null}>
        <WorktreeSourceControlSession
          key={reviewScopeKey}
          environmentId={environmentId}
          projectId={projectId}
          cwd={search.cwd}
          projectName={project.title}
          projectWorkspaceRoot={project.workspaceRoot}
          initialBranch={search.branch ?? null}
          selectedScope={search.scope}
          selectedPath={search.file ?? null}
          onSelectionChange={handleSelectionChange}
        />
      </Suspense>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/worktree/$environmentId/$projectId")({
  validateSearch: validateWorktreeSearch,
  component: WorktreeSourceControlRouteView,
});
