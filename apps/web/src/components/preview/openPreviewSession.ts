import type {
  EnvironmentId,
  PreviewOpenInput,
  PreviewSessionSnapshot,
  PreviewViewportSetting,
  ScopedThreadRef,
} from "@t3tools/contracts";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";

import { browserDefaultOpenViewport, resolveBrowserDefaults } from "~/browser/browserDefaults";
import { applyPreviewServerSnapshot, rememberPreviewUrl } from "~/previewStateStore";
import { resolveWorktreeCanonicalThreadRef } from "~/worktreeScope";

interface OpenPreviewSessionInput<E> {
  openPreview: (input: {
    readonly environmentId: EnvironmentId;
    readonly input: PreviewOpenInput;
  }) => Promise<AtomCommandResult<PreviewSessionSnapshot, E>>;
  threadRef: ScopedThreadRef;
  url?: string;
  /** Overrides the configured default; automation passes an explicit size. */
  viewport?: PreviewViewportSetting;
}

export async function openPreviewSession<E>(
  input: OpenPreviewSessionInput<E>,
): Promise<AtomCommandResult<PreviewSessionSnapshot, E>> {
  // Preview sessions are worktree-scoped: the wire call uses the worktree's
  // canonical thread id so sibling threads share one set of tabs.
  const canonicalRef = resolveWorktreeCanonicalThreadRef(input.threadRef);
  const result = await input.openPreview({
    environmentId: canonicalRef.environmentId,
    input: {
      threadId: canonicalRef.threadId,
      ...(input.url === undefined ? {} : { url: input.url }),
      viewport: input.viewport ?? browserDefaultOpenViewport(await resolveBrowserDefaults()),
    },
  });
  if (result._tag === "Failure") {
    return result;
  }
  const snapshot = result.value;
  applyPreviewServerSnapshot(input.threadRef, snapshot);
  if (input.url !== undefined) {
    rememberPreviewUrl(
      input.threadRef,
      snapshot.navStatus._tag === "Idle" ? input.url : snapshot.navStatus.url,
    );
  }
  return result;
}
