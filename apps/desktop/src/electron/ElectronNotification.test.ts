import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { vi } from "vite-plus/test";

const { notificationInstances, notificationIsSupported, notificationShowOutcome } = vi.hoisted(
  () => ({
    notificationInstances: [] as Array<{
      options: unknown;
      listeners: Map<string, () => void>;
      show: ReturnType<typeof vi.fn>;
    }>,
    notificationIsSupported: vi.fn(() => true),
    notificationShowOutcome: { current: "show" as "show" | "failed" },
  }),
);

vi.mock("electron", () => ({
  Notification: class Notification {
    static isSupported = notificationIsSupported;
    readonly listeners = new Map<string, () => void>();
    readonly show = vi.fn(() => {
      this.listeners.get(notificationShowOutcome.current)?.();
    });
    readonly options: unknown;

    constructor(options: unknown) {
      this.options = options;
      notificationInstances.push(this);
    }

    once(event: string, listener: () => void) {
      this.listeners.set(event, listener);
      return this;
    }
  },
}));

import * as ElectronNotification from "./ElectronNotification.ts";

const notificationLayer = (platform: "darwin" | "linux") =>
  ElectronNotification.layer.pipe(Layer.provide(Layer.succeed(HostProcessPlatform, platform)));

describe("ElectronNotification", () => {
  it.effect("shows a silent native notification on macOS and handles its click", () => {
    const onClick = vi.fn();
    notificationInstances.length = 0;
    notificationShowOutcome.current = "show";

    return Effect.gen(function* () {
      const notifications = yield* ElectronNotification.ElectronNotification;
      assert.isTrue(
        yield* notifications.show({ title: "Thread finished", body: "Refactor", onClick }),
      );
      const instance = notificationInstances[0]!;
      assert.deepEqual(instance.options, {
        title: "Thread finished",
        body: "Refactor",
        silent: true,
      });
      assert.equal(instance.show.mock.calls.length, 1);

      instance.listeners.get("click")?.();
      assert.equal(onClick.mock.calls.length, 1);
    }).pipe(Effect.provide(notificationLayer("darwin")));
  });

  it.effect("does nothing outside macOS", () => {
    notificationInstances.length = 0;
    return Effect.gen(function* () {
      const notifications = yield* ElectronNotification.ElectronNotification;
      assert.isFalse(
        yield* notifications.show({ title: "Thread finished", body: "Refactor", onClick: vi.fn() }),
      );
      assert.equal(notificationInstances.length, 0);
    }).pipe(Effect.provide(notificationLayer("linux")));
  });

  it.effect("reports a native failure instead of acknowledging delivery", () => {
    notificationInstances.length = 0;
    notificationShowOutcome.current = "failed";
    return Effect.gen(function* () {
      const notifications = yield* ElectronNotification.ElectronNotification;
      assert.isFalse(
        yield* notifications.show({ title: "Thread finished", body: "Refactor", onClick: vi.fn() }),
      );
      assert.equal(notificationInstances.length, 1);
    }).pipe(Effect.provide(notificationLayer("darwin")));
  });
});
