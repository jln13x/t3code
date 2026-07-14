import type { ProjectId, ThreadContext } from "@t3tools/contracts";

export interface ThreadContextCarrier {
  readonly projectId: ProjectId | null;
  readonly context?: ThreadContext | undefined;
}

/** Resolve legacy project-only threads and new context-aware threads uniformly. */
export function resolveThreadContext(thread: ThreadContextCarrier): ThreadContext {
  if (thread.context !== undefined) {
    return thread.context;
  }
  return thread.projectId === null
    ? { kind: "standalone" }
    : { kind: "project", projectId: thread.projectId };
}

export function getThreadProjectId(thread: ThreadContextCarrier): ProjectId | null {
  const context = resolveThreadContext(thread);
  return context.kind === "project" ? context.projectId : null;
}

export function isStandaloneThread(thread: ThreadContextCarrier): boolean {
  return resolveThreadContext(thread).kind === "standalone";
}
