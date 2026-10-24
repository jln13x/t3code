import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useNavigate, useParams } from "@tanstack/react-router";
import { PinIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { getClientSettings } from "../hooks/useSettings";
import { readThreadShells } from "../state/entities";
import { useConnectedEnvironmentIds } from "../state/environments";
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
export function PinnedThreadReminders({
  onNotification,
}: {
  onNotification: (environmentId: EnvironmentId, notification: Notification) => void;
}) {
  const navigate = useNavigate();
  const connectedEnvironmentIds = useConnectedEnvironmentIds();
  const { environmentId, threadId } = useParams({ strict: false });
  const viewedKey =
    environmentId && threadId
      ? scopedThreadKey(scopeThreadRef(environmentId as EnvironmentId, threadId as ThreadId))
      : null;
  const activeKey = useRef(viewedKey);
  useEffect(() => {
    activeKey.current = viewedKey;
  }, [viewedKey]);
  const idleSince = useRef(new Map<string, number>());

  useEffect(() => {
    const connectedIds = new Set(connectedEnvironmentIds);
    const open = (environmentId: EnvironmentId, threadId: ThreadId) =>
      void navigate({ to: "/$environmentId/$threadId", params: { environmentId, threadId } });

    const check = () => {
      const focused = document.visibilityState === "visible" && document.hasFocus();
      const result = collectDuePinnedReminders({
        threads: readThreadShells().filter((thread) => connectedIds.has(thread.environmentId)),
        idleSince: idleSince.current,
        viewingKey: focused ? activeKey.current : null,
        now: Date.now(),
      });
      idleSince.current = result.idleSince;
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

    check();
    const interval = window.setInterval(check, CHECK_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [connectedEnvironmentIds, navigate, onNotification]);

  return null;
}
