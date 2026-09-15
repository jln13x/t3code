import { useState } from "react";

import {
  hasDesktopNotifications,
  hasNativeCompletionNotifications,
} from "../../threadNotifications";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

export function NotificationSettings() {
  const mode = useScopedSettings((settings) => settings.notificationMode);
  const selectedMode = hasDesktopNotifications(mode) ? "notifications" : "off";
  const labels = { off: "Off", notifications: "Notifications" };
  const updateSettings = useUpdateScopedSettings();
  const [permissionMessage, setPermissionMessage] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  return (
    <SettingsRow
      {...searchableSetting("thread-notifications")}
      description={
        permissionMessage ??
        (hasNativeCompletionNotifications()
          ? "Additional system alerts for failures and requests for input or approval. Completion notifications and completion/attention sounds are always on; macOS controls notification permission."
          : "System alerts when a thread finishes, fails, or needs input or approval. Completion and attention sounds are always on.")
      }
      control={
        <Select
          value={selectedMode}
          disabled={requesting}
          onValueChange={async (value) => {
            if (value !== "off" && value !== "notifications") return;
            setPermissionMessage(null);

            if (hasDesktopNotifications(value)) {
              if (typeof Notification === "undefined" || !window.isSecureContext) {
                setPermissionMessage(
                  "Notifications need a supported browser over HTTPS, or the desktop app. Completion and attention sounds remain on.",
                );
                return;
              }
              setRequesting(true);
              try {
                const permission = await Notification.requestPermission();
                if (permission !== "granted") {
                  setPermissionMessage(
                    "Allow notifications in your browser or system settings, then choose this option again. Completion and attention sounds remain on.",
                  );
                  return;
                }
              } catch {
                setPermissionMessage(
                  "Notifications are unavailable in this browser. Completion and attention sounds remain on.",
                );
                return;
              } finally {
                setRequesting(false);
              }
            }
            updateSettings({ notificationMode: value });
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-56" aria-label="Thread notifications">
            <SelectValue>{labels[selectedMode]}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {Object.entries(labels).map(([value, label]) => (
              <SelectItem key={value} hideIndicator value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}
