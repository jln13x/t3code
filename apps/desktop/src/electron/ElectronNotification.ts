import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Electron from "electron";

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
        Effect.sync(() => {
          if (platform !== "darwin" || !Electron.Notification.isSupported()) {
            return false;
          }

          try {
            const notification = new Electron.Notification({
              title: input.title,
              body: input.body,
              silent: true,
            });
            const release = () => activeNotifications.delete(notification);
            notification.once("click", () => {
              input.onClick();
              release();
            });
            notification.once("close", release);
            notification.once("failed", release);
            activeNotifications.add(notification);
            notification.show();
            return true;
          } catch {
            return false;
          }
        }),
    });
  }),
);
