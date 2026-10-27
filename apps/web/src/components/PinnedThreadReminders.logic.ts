import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";

import { resolveSidebarThreadStatus } from "./Sidebar.logic";

export const PINNED_REMINDER_INTERVAL_MS = 150_000;

// Pinned threads act as high priority; viewing one restarts its idle clock.
export function collectDuePinnedReminders(input: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly idleSince: ReadonlyMap<string, number>;
  readonly viewingKey: string | null;
  readonly now: number;
}): { readonly due: EnvironmentThreadShell[]; readonly idleSince: Map<string, number> } {
  const { threads, viewingKey, now } = input;
  const nowIso = new Date(now).toISOString();
  const due: EnvironmentThreadShell[] = [];
  const idleSince = new Map<string, number>();
  for (const thread of threads) {
    if (thread.pinnedAt == null || thread.archivedAt !== null || thread.deletedAt !== null) {
      continue;
    }
    if (effectiveSnoozed(thread, { now: nowIso })) continue;
    const status = resolveSidebarThreadStatus(thread);
    if (status === "working" || status === "waiting") continue;
    const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
    const since = key === viewingKey ? now : (input.idleSince.get(key) ?? now);
    if (now - since < PINNED_REMINDER_INTERVAL_MS) {
      idleSince.set(key, since);
      continue;
    }
    due.push(thread);
    idleSince.set(key, now);
  }
  return { due, idleSince };
}
