import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Electron from "electron";

const NOTIFICATION_ACKNOWLEDGEMENT_TIMEOUT_MS = 5_000;

export interface ElectronNotificationInput {
  readonly title: string;
  readonly body: string;
  readonly onClick: () => void;
}

export class ElectronNotification extends Context.Service<
  ElectronNotification,
  {
    readonly show: (input: ElectronNotificationInput) => Effect.Effect<boolean>;
  }
>()("@t3tools/desktop/electron/ElectronNotification") {}

export const layer = Layer.effect(
  ElectronNotification,
  Effect.gen(function* () {
    const platform = yield* HostProcessPlatform;
    const activeNotifications = new Set<Electron.Notification>();

    return ElectronNotification.of({
      show: (input) =>
        platform !== "darwin" || !Electron.Notification.isSupported()
          ? Effect.succeed(false)
          : Effect.callback<boolean>((resume) => {
              let notification: Electron.Notification;
              try {
                notification = new Electron.Notification({
                  title: input.title,
                  body: input.body,
                  silent: true,
                });
              } catch {
                resume(Effect.succeed(false));
                return;
              }

              let acknowledged = false;
              const acknowledge = (shown: boolean) => {
                if (acknowledged) return;
                acknowledged = true;
                resume(Effect.succeed(shown));
              };
              const release = () => activeNotifications.delete(notification);
              notification.once("show", () => acknowledge(true));
              notification.once("click", () => {
                acknowledge(true);
                input.onClick();
                release();
              });
              notification.once("close", () => {
                acknowledge(false);
                release();
              });
              notification.once("failed", () => {
                acknowledge(false);
                release();
              });
              activeNotifications.add(notification);
              try {
                notification.show();
              } catch {
                release();
                acknowledge(false);
              }
              return Effect.sync(release);
            }).pipe(
              Effect.timeoutOrElse({
                duration: NOTIFICATION_ACKNOWLEDGEMENT_TIMEOUT_MS,
                orElse: () => Effect.succeed(false),
              }),
            ),
    });
  }),
);
