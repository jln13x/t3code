import { assert, describe, it } from "@effect/vitest";
import { isCommandAvailable } from "@t3tools/shared/shell";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { beforeEach, vi } from "vite-plus/test";

import type * as Electron from "electron";

const { focusedWebContents, ownerWindow } = vi.hoisted(() => ({
  focusedWebContents: vi.fn(),
  ownerWindow: vi.fn(),
}));
vi.mock("electron", () => ({
  webContents: { getFocusedWebContents: focusedWebContents },
  BrowserWindow: { fromWebContents: ownerWindow },
}));

import * as DesktopBackendManager from "../../backend/DesktopBackendManager.ts";
import * as DesktopBackendPool from "../../backend/DesktopBackendPool.ts";
import * as ElectronDialog from "../../electron/ElectronDialog.ts";
import * as ElectronNotification from "../../electron/ElectronNotification.ts";
import * as ElectronShell from "../../electron/ElectronShell.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import { THREAD_COMPLETION_NOTIFICATION_CLICK_CHANNEL } from "../channels.ts";
import * as DesktopAppSettings from "../../settings/DesktopAppSettings.ts";
import type { DesktopSettings } from "../../settings/DesktopAppSettings.ts";
import {
  getLocalEnvironmentBootstraps,
  getWindowFullscreenState,
  pasteAsText,
  pickProjectFavicon,
  probeRemoteEditors,
  showThreadCompletionNotification,
} from "./window.ts";

vi.mock("@t3tools/shared/shell", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@t3tools/shared/shell")>()),
  isCommandAvailable: vi.fn(),
}));

describe("probeRemoteEditors", () => {
  beforeEach(() => {
    vi.mocked(isCommandAvailable).mockReset();
    vi.mocked(isCommandAvailable).mockReturnValue(Effect.succeed(false));
  });

  const shellLayer = (registeredSchemes: ReadonlyArray<string>) =>
    Layer.mergeAll(
      Layer.succeed(ElectronShell.ElectronShell, {
        hasProtocolHandler: (scheme) => Effect.succeed(registeredSchemes.includes(scheme)),
        openExternal: () => Effect.succeed(true),
        openSystemSettings: () => Effect.succeed(true),
        copyText: () => Effect.void,
      }),
      FileSystem.layerNoop({}),
      Path.layer,
    );

  it.effect("finds Zed through its registered handler when no editor CLI is on PATH", () =>
    Effect.gen(function* () {
      assert.deepEqual(yield* probeRemoteEditors.handler(undefined), ["zed"]);
    }).pipe(Effect.provide(shellLayer(["zed"]))),
  );

  it.effect("keeps CLI discovery and does not duplicate editors with a handler", () =>
    Effect.gen(function* () {
      vi.mocked(isCommandAvailable).mockImplementation((command) =>
        Effect.succeed(command === "cursor" || command === "zed"),
      );
      assert.deepEqual(yield* probeRemoteEditors.handler(undefined), ["cursor", "zed"]);
    }).pipe(Effect.provide(shellLayer(["zed"]))),
  );

  it.effect("supports the zeditor CLI alias when protocol detection is unavailable", () =>
    Effect.gen(function* () {
      vi.mocked(isCommandAvailable).mockImplementation((command) =>
        Effect.succeed(command === "zeditor"),
      );
      assert.deepEqual(yield* probeRemoteEditors.handler(undefined), ["zed"]);
    }).pipe(Effect.provide(shellLayer([]))),
  );
});

const readyWslConfig: DesktopBackendManager.DesktopBackendStartConfig = {
  executablePath: "wsl.exe",
  args: ["-d", "Ubuntu", "--", "node", "/app/bin.mjs"],
  entryPath: "/app/bin.mjs",
  cwd: "/app",
  env: {},
  extendEnv: false,
  bootstrap: {
    mode: "desktop",
    noBrowser: true,
    port: 3774,
    host: "0.0.0.0",
    desktopBootstrapToken: "bootstrap-token",
    tailscaleServeEnabled: false,
    tailscaleServePort: 443,
  },
  bootstrapDelivery: "stdin",
  httpBaseUrl: new URL("http://127.0.0.1:3774"),
  captureOutput: true,
  preflightFailure: Option.none(),
  runningDistro: "Ubuntu",
};

const defaultWslInstance: DesktopBackendManager.DesktopBackendInstance = {
  id: DesktopBackendManager.BackendInstanceId("wsl:default"),
  label: Effect.succeed("WSL (default distro)"),
  start: Effect.void,
  stop: () => Effect.void,
  currentConfig: Effect.succeed(Option.some(readyWslConfig)),
  snapshot: Effect.succeed({
    desiredRunning: true,
    ready: true,
    activePid: Option.some(123),
    restartAttempt: 0,
    restartScheduled: false,
  }),
  waitForReady: () => Effect.succeed(true),
};

describe("getLocalEnvironmentBootstraps", () => {
  it.effect("publishes the concrete running distro without replacing the stable instance id", () =>
    Effect.gen(function* () {
      const result = yield* getLocalEnvironmentBootstraps.handler();

      assert.deepEqual(result, [
        {
          id: "wsl:default",
          label: "WSL (Ubuntu)",
          runningDistro: "Ubuntu",
          httpBaseUrl: "http://127.0.0.1:3774/",
          wsBaseUrl: "ws://127.0.0.1:3774/",
          bootstrapToken: "bootstrap-token",
        },
      ]);
    }).pipe(Effect.provide(DesktopBackendPool.layerTest([defaultWslInstance]))),
  );

  it.effect("publishes a pending bootstrap only while a transient retry is scheduled", () => {
    const retryingConfig: DesktopBackendManager.DesktopBackendStartConfig = {
      ...readyWslConfig,
      preflightFailure: Option.some({
        reason: "WSL probe timed out",
        fatal: false,
        retryLimit: 12,
      }),
    };
    const retryingInstance: DesktopBackendManager.DesktopBackendInstance = {
      ...defaultWslInstance,
      currentConfig: Effect.succeed(Option.some(retryingConfig)),
      snapshot: Effect.succeed({
        desiredRunning: true,
        ready: false,
        activePid: Option.none(),
        restartAttempt: 2,
        restartScheduled: true,
      }),
    };

    return Effect.gen(function* () {
      const result = yield* getLocalEnvironmentBootstraps.handler();
      assert.deepEqual(result, [
        {
          id: "wsl:default",
          label: "WSL (default distro)",
          runningDistro: null,
          httpBaseUrl: null,
          wsBaseUrl: null,
        },
      ]);
    }).pipe(Effect.provide(DesktopBackendPool.layerTest([retryingInstance])));
  });

  it.effect("omits a bounded transient bootstrap after retries stop", () => {
    const stoppedInstance: DesktopBackendManager.DesktopBackendInstance = {
      ...defaultWslInstance,
      currentConfig: Effect.succeed(
        Option.some({
          ...readyWslConfig,
          preflightFailure: Option.some({
            reason: "WSL probe timed out",
            fatal: false,
            retryLimit: 12,
          }),
        }),
      ),
      snapshot: Effect.succeed({
        desiredRunning: false,
        ready: false,
        activePid: Option.none(),
        restartAttempt: 12,
        restartScheduled: false,
      }),
    };

    return Effect.gen(function* () {
      const result = yield* getLocalEnvironmentBootstraps.handler();
      assert.deepEqual(result, []);
    }).pipe(Effect.provide(DesktopBackendPool.layerTest([stoppedInstance])));
  });
});

describe("getWindowFullscreenState", () => {
  it.effect("reads the current native window state", () => {
    const window = { isFullScreen: () => true } as Electron.BrowserWindow;

    return Effect.gen(function* () {
      assert.isTrue(yield* getWindowFullscreenState.handler());
    }).pipe(
      Effect.provide(
        Layer.mock(ElectronWindow.ElectronWindow)({
          currentMainOrFirst: Effect.succeed(Option.some(window)),
        }),
      ),
    );
  });
});

describe("showThreadCompletionNotification", () => {
  it.effect(
    "reveals the app and forwards the scoped thread when the notification is clicked",
    () => {
      const send = vi.fn();
      const reveal = vi.fn(() => Effect.void);
      const window = {
        webContents: { send },
      } as unknown as Electron.BrowserWindow;

      return Effect.gen(function* () {
        assert.isTrue(
          yield* showThreadCompletionNotification.handler({
            threadRef: {
              environmentId: "environment-1",
              threadId: "thread-1",
            },
            threadTitle: "Refactor notifications",
          }),
        );
        yield* Effect.promise(() =>
          vi.waitFor(() => {
            assert.equal(reveal.mock.calls.length, 1);
            assert.deepEqual(send.mock.calls, [
              [
                THREAD_COMPLETION_NOTIFICATION_CLICK_CHANNEL,
                { environmentId: "environment-1", threadId: "thread-1" },
              ],
            ]);
          }),
        );
      }).pipe(
        Effect.provide(
          Layer.merge(
            Layer.mock(ElectronNotification.ElectronNotification)({
              show: (input) =>
                Effect.sync(() => {
                  assert.equal(input.title, "Thread finished");
                  assert.equal(input.body, "Refactor notifications");
                  input.onClick();
                  return true;
                }),
            }),
            Layer.mock(ElectronWindow.ElectronWindow)({
              currentMainOrFirst: Effect.succeed(Option.some(window)),
              reveal,
            }),
          ),
        ),
      );
    },
  );
});

describe("pasteAsText", () => {
  it.effect(
    "pastes into the focused guest only after the main renderer acknowledges the menu action",
    () => {
      const paste = vi.fn();
      const mainPaste = vi.fn();
      const window = {
        webContents: { id: 42, paste: mainPaste },
        isDestroyed: () => false,
      } as unknown as Electron.BrowserWindow;
      focusedWebContents.mockReturnValue({ paste, isDestroyed: () => false });
      ownerWindow.mockReturnValue(window);

      return Effect.gen(function* () {
        yield* pasteAsText.handler(undefined, { sender: { id: 42 } });
        assert.equal(paste.mock.calls.length, 1);
        assert.equal(mainPaste.mock.calls.length, 0);

        yield* pasteAsText.handler(undefined, { sender: { id: 99 } });
        assert.equal(paste.mock.calls.length, 1);
        ownerWindow.mockReturnValue({}); // A focused PiP/other BrowserWindow.
        yield* pasteAsText.handler(undefined, { sender: { id: 42 } });
        assert.equal(paste.mock.calls.length, 1);
        ownerWindow.mockReturnValue(null); // Detached contents.
        yield* pasteAsText.handler(undefined, { sender: { id: 42 } });
        assert.equal(paste.mock.calls.length, 1);
        ownerWindow.mockReturnValue(window);
        focusedWebContents.mockReturnValue({ paste, isDestroyed: () => true });
        yield* pasteAsText.handler(undefined, { sender: { id: 42 } });
        assert.equal(paste.mock.calls.length, 1);
        focusedWebContents.mockReturnValue(null);
        yield* pasteAsText.handler(undefined, { sender: { id: 42 } });
        assert.equal(paste.mock.calls.length, 1);
      }).pipe(
        Effect.provide(
          Layer.mock(ElectronWindow.ElectronWindow)({
            main: Effect.succeed(Option.some(window)),
          }),
        ),
      );
    },
  );
});

describe("pickProjectFavicon", () => {
  const pickerLayer = (pickFiles: () => Effect.Effect<Array<string>>, settings?: DesktopSettings) =>
    Layer.mergeAll(
      Layer.mock(ElectronDialog.ElectronDialog)({ pickFiles }),
      Layer.mock(ElectronWindow.ElectronWindow)({
        focusedMainOrFirst: Effect.succeed(Option.none()),
      }),
      DesktopAppSettings.layerTest(settings),
    );

  it.effect("opens a single-image picker from the project directory", () =>
    Effect.gen(function* () {
      const pickFiles = vi.fn(() => Effect.succeed(["/pictures/icon.png"]));
      const result = yield* pickProjectFavicon
        .handler("/project")
        .pipe(Effect.provide(pickerLayer(pickFiles)));

      assert.strictEqual(result, "/pictures/icon.png");
      assert.deepEqual(pickFiles.mock.calls, [
        [
          {
            owner: Option.none(),
            defaultPath: Option.some("/project"),
            multiple: false,
            filters: [
              {
                name: "Images",
                extensions: ["avif", "gif", "ico", "jpeg", "jpg", "png", "svg", "webp"],
              },
            ],
          },
        ],
      ]);
    }),
  );

  it.effect("does not open a picker while the local environment is off", () =>
    Effect.gen(function* () {
      const pickFiles = vi.fn(() => Effect.succeed(["/pictures/icon.png"]));
      const result = yield* pickProjectFavicon.handler("/project").pipe(
        Effect.provide(
          pickerLayer(pickFiles, {
            ...DesktopAppSettings.DEFAULT_DESKTOP_SETTINGS,
            localEnvironmentEnabled: false,
          }),
        ),
      );

      assert.strictEqual(result, null);
      assert.strictEqual(pickFiles.mock.calls.length, 0);
    }),
  );
});
