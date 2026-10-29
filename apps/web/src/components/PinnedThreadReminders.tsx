import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { presentThreadShell } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { AnyRouter } from "@tanstack/react-router";
import * as Option from "effect/Option";
import type { AtomRegistry } from "effect/reactivity";
import { PinIcon } from "lucide-react";

import { getClientSettings } from "../hooks/useSettings";
import { environmentSummaries } from "../state/presentation";
import { environmentShell } from "../state/shell";
import { environmentThreadShells } from "../state/threads";
import {
  hasDesktopNotifications,
  hasNotificationSound,
  playNotificationSound,
  threadNotificationTag,
} from "../threadNotifications";
import { collectDuePinnedReminders } from "./PinnedThreadReminders.logic";
import { toastManager } from "./ui/toast";

const CHECK_INTERVAL_MS = 15_000;
const TITLE = "Pinned thread is idle";

/**
 * Fork-only: repeats a reminder for pinned threads with no running agent,
 * through the same sound, toast, and system-notification settings as
 * ThreadNotificationCoordinator.
 */
export function startPinnedThreadReminders(
  registry: AtomRegistry.AtomRegistry,
  router: AnyRouter,
  onNotification: (environmentId: EnvironmentId, notification: Notification) => void,
): () => void {
  let idleSince = new Map<string, number>();
  const watched = new Map<EnvironmentId, () => void>();
  const open = (environmentId: EnvironmentId, threadId: ThreadId) =>
    void router.navigate({ to: "/$environmentId/$threadId", params: { environmentId, threadId } });

  const check = () => {
    const active = (router.state.matches.at(-1)?.params ?? {}) as {
      environmentId?: string;
      threadId?: string;
    };
    const focused = document.visibilityState === "visible" && document.hasFocus();
    const result = collectDuePinnedReminders({
      threads: registry.get(environmentSummaries.environmentIdsAtom).flatMap((environmentId) => {
        const shell = registry.get(environmentShell.stateValueAtom(environmentId));
        if (shell.status !== "live" || Option.isNone(shell.snapshot)) return [];
        const threads = shell.snapshot.value.threads;
        const requests = registry.get(
          environmentThreadShells.pendingSubagentRequestsAtom(environmentId),
        );
        return threads.map((thread) =>
          presentThreadShell(environmentId, thread, requests.get(thread.id) ?? null),
        );
      }),
      idleSince,
      viewingKey:
        focused && active.environmentId && active.threadId
          ? scopedThreadKey(
              scopeThreadRef(active.environmentId as EnvironmentId, active.threadId as ThreadId),
            )
          : null,
      now: Date.now(),
    });
    idleSince = result.idleSince;
    if (result.due.length === 0) return;

    const { notificationMode: mode, inAppNotificationsEnabled } = getClientSettings();
    if (hasNotificationSound(mode)) {
      void playNotificationSound("input", () =>
        hasNotificationSound(getClientSettings().notificationMode),
      );
    }
    for (const thread of result.due) {
      if (focused) {
        if (!inAppNotificationsEnabled) continue;
        const toastId = toastManager.add({
          type: "warning",
          title: TITLE,
          description: thread.title,
          data: {
            hideCopyButton: true,
            leadingIcon: <PinIcon aria-hidden className="size-4 text-warning-foreground" />,
          },
          actionProps: {
            children: "Open thread",
            onClick: () => {
              toastManager.close(toastId);
              open(thread.environmentId, thread.id);
            },
          },
        });
        continue;
      }
      if (
        !hasDesktopNotifications(mode) ||
        typeof Notification === "undefined" ||
        Notification.permission !== "granted"
      ) {
        continue;
      }
      try {
        const notification = new Notification(TITLE, {
          body: thread.title,
          // Shares the completion notification's tag so reminders replace it.
          tag: threadNotificationTag(thread.environmentId, thread.id),
          silent: true,
        });
        onNotification(thread.environmentId, notification);
        notification.addEventListener("click", () => {
          notification.close();
          window.focus();
          void window.desktopBridge?.revealWindow?.().catch(() => undefined);
          open(thread.environmentId, thread.id);
        });
      } catch {
        // Some browsers expose Notification but reject desktop presentation.
      }
    }
  };

  const syncEnvironments = () => {
    const ids = registry.get(environmentSummaries.environmentIdsAtom);
    for (const [id, stop] of watched) {
      if (ids.includes(id)) continue;
      stop();
      watched.delete(id);
    }
    for (const id of ids) {
      if (!watched.has(id)) {
        watched.set(id, registry.subscribe(environmentShell.stateValueAtom(id), check));
      }
    }
    check();
  };
  const unsubscribeIds = registry.subscribe(
    environmentSummaries.environmentIdsAtom,
    syncEnvironments,
  );
  const unsubscribeRoute = router.subscribe("onResolved", check);
  syncEnvironments();
  const interval = window.setInterval(check, CHECK_INTERVAL_MS);
  return () => {
    window.clearInterval(interval);
    unsubscribeIds();
    unsubscribeRoute();
    for (const stop of watched.values()) stop();
  };
}
