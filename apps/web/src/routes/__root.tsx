import { type EnvironmentId, type ServerLifecycleWelcomePayload } from "@t3tools/contracts";
import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  Outlet,
  createRootRoute,
  type ErrorComponentProps,
  useLocation,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { play } from "cuelume";

import { APP_BASE_NAME, APP_DISPLAY_NAME, APP_STAGE_LABEL } from "../branding";
import { resolveServerBackedAppDisplayName } from "../branding.logic";
import { AppSidebarLayout } from "../components/AppSidebarLayout";
import { CommandPalette } from "../components/CommandPalette";
import { ConnectOnboardingDialog } from "../components/cloud/ConnectOnboardingDialog";
import { RelayClientInstallDialog } from "../components/cloud/RelayClientInstallDialog";
import { SshPasswordPromptDialog } from "../components/desktop/SshPasswordPromptDialog";
import { ProviderUpdateLaunchNotification } from "../components/ProviderUpdateLaunchNotification";
import { SlowRpcRequestToastCoordinator } from "../components/SlowRpcRequestToastCoordinator";
import { Button } from "../components/ui/button";
import {
  AnchoredToastProvider,
  stackedThreadToast,
  ToastProvider,
  toastManager,
} from "../components/ui/toast";
import { resolveAndPersistPreferredEditor } from "../editorPreferences";
import {
  useClientSettings,
  useClientSettingsHydrated,
  usePrimarySettings,
} from "../hooks/useSettings";
import {
  deriveLogicalProjectKeyFromSettings,
  derivePhysicalProjectKeyFromPath,
  selectProjectGroupingSettings,
} from "../logicalProject";
import { useUiStateStore } from "../uiStateStore";
import { syncBrowserChromeTheme } from "../hooks/useTheme";
import { configureClientTracing } from "../observability/clientTracing";
import { resolveInitialServerAuthGateState } from "../environments/primary";
import { hasHostedPairingRequest, isHostedStaticApp } from "../hostedPairing";
import { environmentShell, environmentSnapshotAtom, shellEnvironment } from "../state/shell";
import { useAtomValue } from "@effect/atom-react";
import { useAtomCommand } from "../state/use-atom-command";
import { useEnvironments, usePrimaryEnvironment } from "../state/environments";
import {
  primaryServerConfigAtom,
  primaryServerConfigEventAtom,
  primaryServerWelcomeAtom,
} from "../state/server";
import {
  readProject,
  setActiveEnvironmentId,
  useActiveEnvironmentId,
  useThreadShells,
} from "../state/entities";
import {
  captureThreadSoundState,
  captureThreadSoundStateWhileSettingsHydrating,
  COMPLETION_SOUND_VOLUME,
  deriveThreadFeedbackEvents,
  type ThreadSoundStateByKey,
} from "../interactionSounds";
import {
  clearPendingThreadCompletionNotifications,
  deliverPendingThreadCompletionNotifications,
  initializeThreadCompletionNotificationState,
  readThreadCompletionNotificationState,
  reduceThreadCompletionNotificationEvents,
  writeThreadCompletionNotificationState,
  type ThreadCompletionNotificationState,
} from "../threadCompletionNotifications";
import { orchestrationEnvironment } from "../state/orchestration";
import {
  createKeybindingsUpdateToastController,
  type KeybindingsUpdateToastController,
} from "../components/KeybindingsUpdateToast.logic";

export const Route = createRootRoute({
  beforeLoad: async ({ location }) => {
    if (location.pathname === "/pair" && hasHostedPairingRequest(new URL(window.location.href))) {
      return {
        authGateState: {
          status: "hosted-pairing",
        } as const,
      };
    }

    if (isHostedStaticApp(new URL(window.location.href))) {
      return {
        authGateState: {
          status: "hosted-static",
        } as const,
      };
    }

    const authGateState = await resolveInitialServerAuthGateState();
    return {
      authGateState,
    };
  },
  component: RootRouteView,
  errorComponent: RootRouteErrorView,
  head: () => ({
    meta: [{ name: "title", content: APP_DISPLAY_NAME }],
  }),
});

function RootRouteView() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const { authGateState } = Route.useRouteContext();
  const primaryEnvironmentAuthenticated = authGateState.status === "authenticated";

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      syncBrowserChromeTheme();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [pathname]);

  if (pathname === "/pair" || pathname === "/connect" || pathname.startsWith("/connect/")) {
    return (
      <>
        <DocumentTitleSync />
        <Outlet />
      </>
    );
  }

  if (authGateState.status !== "authenticated" && authGateState.status !== "hosted-static") {
    return (
      <>
        <DocumentTitleSync />
        <Outlet />
      </>
    );
  }

  const appShell = (
    <CommandPalette>
      <AppSidebarLayout>
        <Outlet />
      </AppSidebarLayout>
    </CommandPalette>
  );

  return (
    <ToastProvider>
      <AnchoredToastProvider>
        <DocumentTitleSync />
        <GlassAppearanceSync />
        {primaryEnvironmentAuthenticated ? <AuthenticatedTracingBootstrap /> : null}
        <RelayClientInstallDialog />
        <ConnectOnboardingDialog />
        <SshPasswordPromptDialog />
        <SlowRpcRequestToastCoordinator />
        <HostedStaticEnvironmentBootstrap />
        {primaryEnvironmentAuthenticated ? <EventRouter /> : null}
        <ThreadCompletionFeedbackCoordinator />
        {primaryEnvironmentAuthenticated ? <ProviderUpdateLaunchNotification /> : null}
        {appShell}
      </AnchoredToastProvider>
    </ToastProvider>
  );
}

function ThreadCompletionFeedbackCoordinator() {
  const threads = useThreadShells();
  const navigate = useNavigate();
  const { environments } = useEnvironments();
  const completionSoundEnabled = useClientSettings((settings) => settings.enableCompletionSounds);
  const completionNotificationsEnabled = usePrimarySettings(
    (settings) => settings.enableMacosCompletionNotifications,
  );
  const settingsHydrated = useClientSettingsHydrated();
  const previousStateRef = useRef<ThreadSoundStateByKey | null>(null);

  useEffect(() => {
    const subscribe = window.desktopBridge?.onThreadCompletionNotificationClick;
    if (typeof subscribe !== "function") return;

    return subscribe((threadRef) => {
      void navigate({
        to: "/$environmentId/$threadId",
        params: {
          environmentId: threadRef.environmentId,
          threadId: threadRef.threadId,
        },
      });
    });
  }, [navigate]);

  useEffect(() => {
    if (!settingsHydrated) {
      previousStateRef.current = captureThreadSoundStateWhileSettingsHydrating(
        previousStateRef.current,
        threads,
      );
      return;
    }

    const previous = previousStateRef.current;
    if (previous !== null) {
      for (const event of deriveThreadFeedbackEvents(previous, threads)) {
        if (completionSoundEnabled) {
          play(event.cue, event.cue === "success" ? COMPLETION_SOUND_VOLUME : 1);
        }
      }
    }
    previousStateRef.current = captureThreadSoundState(threads);
  }, [completionSoundEnabled, settingsHydrated, threads]);

  if (typeof window.desktopBridge?.showThreadCompletionNotification !== "function") {
    return null;
  }

  return environments.map((environment) => (
    <EnvironmentThreadCompletionNotificationCoordinator
      key={environment.environmentId}
      environmentId={environment.environmentId}
      enabled={completionNotificationsEnabled}
      settingsHydrated={settingsHydrated}
    />
  ));
}

function EnvironmentThreadCompletionNotificationCoordinator({
  environmentId,
  enabled,
  settingsHydrated,
}: {
  readonly environmentId: EnvironmentId;
  readonly enabled: boolean;
  readonly settingsHydrated: boolean;
}) {
  const snapshot = useAtomValue(environmentSnapshotAtom(environmentId));
  const shellState = useAtomValue(environmentShell.stateValueAtom(environmentId));
  const replayEvents = useAtomCommand(orchestrationEnvironment.replayEvents, {
    label: "thread-completion-notifications:replay-events",
    reportFailure: false,
    reportDefect: false,
  });
  const syncChainRef = useRef<Promise<void>>(Promise.resolve());
  const memoryStateRef = useRef<ThreadCompletionNotificationState | null>(null);
  const retryAttemptRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const [retryGeneration, setRetryGeneration] = useState(0);

  useEffect(
    () => () => {
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const show = window.desktopBridge?.showThreadCompletionNotification;
    if (
      !settingsHydrated ||
      snapshot === null ||
      shellState.status !== "live" ||
      typeof show !== "function"
    ) {
      return;
    }

    const synchronize = async () => {
      const readState = (): ThreadCompletionNotificationState | null => {
        try {
          return readThreadCompletionNotificationState(window.localStorage, environmentId);
        } catch (cause) {
          console.warn("Could not read the thread completion notification cursor.", {
            environmentId,
            cause,
          });
          return memoryStateRef.current;
        }
      };
      const persistState = (state: ThreadCompletionNotificationState) => {
        memoryStateRef.current = state;
        try {
          writeThreadCompletionNotificationState(window.localStorage, environmentId, state);
        } catch (cause) {
          console.warn("Could not persist the thread completion notification cursor.", {
            environmentId,
            cause,
          });
        }
      };

      let state = readState();
      if (state === null || snapshot.snapshotSequence < state.cursor) {
        state = initializeThreadCompletionNotificationState(snapshot);
        persistState(state);
        return;
      }

      if (!enabled) {
        state = clearPendingThreadCompletionNotifications(state);
        retryAttemptRef.current = 0;
      }

      const replayResult = await replayEvents({
        environmentId,
        input: { fromSequenceExclusive: state.cursor },
      });
      if (replayResult._tag === "Failure") {
        console.warn("Could not replay events for thread completion notifications.", {
          environmentId,
          cause: squashAtomCommandFailure(replayResult),
        });
        persistState(state);
        return;
      }

      state = reduceThreadCompletionNotificationEvents({
        state,
        events: replayResult.value,
        snapshot,
        notificationsEnabled: enabled,
      });
      persistState(state);

      if (!enabled || state.pending.length === 0) return;
      const delivery = await deliverPendingThreadCompletionNotifications({
        state,
        environmentId,
        show,
        onProgress: persistState,
      });
      memoryStateRef.current = delivery.state;
      if (delivery.failed) {
        console.warn("Could not show a thread completion notification; it remains pending.", {
          environmentId,
          ...(delivery.cause === undefined ? {} : { cause: delivery.cause }),
        });
        const retryDelaysMs = [1_000, 5_000, 15_000] as const;
        const retryDelayMs = retryDelaysMs[retryAttemptRef.current];
        if (retryDelayMs !== undefined && retryTimerRef.current === null) {
          retryAttemptRef.current += 1;
          retryTimerRef.current = window.setTimeout(() => {
            retryTimerRef.current = null;
            setRetryGeneration((generation) => generation + 1);
          }, retryDelayMs);
        }
      } else {
        retryAttemptRef.current = 0;
        if (retryTimerRef.current !== null) {
          window.clearTimeout(retryTimerRef.current);
          retryTimerRef.current = null;
        }
      }
    };

    syncChainRef.current = syncChainRef.current.then(synchronize, synchronize);
  }, [
    enabled,
    environmentId,
    replayEvents,
    retryGeneration,
    settingsHydrated,
    shellState.status,
    snapshot,
  ]);
  return null;
}

function GlassAppearanceSync() {
  const glassOpacity = useClientSettings((settings) => settings.glassOpacity);

  useEffect(() => {
    document.documentElement.style.setProperty("--glass-opacity", `${glassOpacity}%`);
  }, [glassOpacity]);

  return null;
}

function DocumentTitleSync() {
  const primaryServerVersion =
    useAtomValue(primaryServerConfigAtom)?.environment.serverVersion ?? null;
  const title = resolveServerBackedAppDisplayName({
    baseName: APP_BASE_NAME,
    fallbackDisplayName: APP_DISPLAY_NAME,
    fallbackStageLabel: APP_STAGE_LABEL,
    primaryServerVersion,
  });

  useEffect(() => {
    document.title = title;
  }, [title]);

  return null;
}

function HostedStaticEnvironmentBootstrap() {
  const { environments } = useEnvironments();
  const activeEnvironmentId = useActiveEnvironmentId();

  useEffect(() => {
    if (
      environments.some(
        (environment) => environment.entry.target._tag === "PrimaryConnectionTarget",
      )
    ) {
      return;
    }

    if (activeEnvironmentId) {
      return;
    }

    const firstSavedEnvironment = environments[0];
    if (!firstSavedEnvironment) {
      return;
    }

    setActiveEnvironmentId(firstSavedEnvironment.environmentId);
  }, [activeEnvironmentId, environments]);

  return null;
}

function RootRouteErrorView({ error, reset }: ErrorComponentProps) {
  const message = errorMessage(error);
  const details = errorDetails(error);
  const router = useRouter();
  const retryingRef = useRef(false);

  // A failed root beforeLoad probe leaves this boundary mounted even after the
  // backend recovers. Retry only on recovery signals while this view is active.
  useEffect(() => {
    const retry = () => {
      if (retryingRef.current) return;
      retryingRef.current = true;
      void router.invalidate().finally(() => {
        retryingRef.current = false;
      });
    };
    const retryIfVisible = () => {
      if (document.visibilityState === "visible") retry();
    };

    document.addEventListener("visibilitychange", retryIfVisible);
    window.addEventListener("focus", retry);
    window.addEventListener("online", retry);
    return () => {
      document.removeEventListener("visibilitychange", retryIfVisible);
      window.removeEventListener("focus", retry);
      window.removeEventListener("online", retry);
    };
  }, [router]);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10 text-foreground sm:px-6">
      <div className="pointer-events-none absolute inset-0 opacity-80">
        <div className="absolute inset-x-0 top-0 h-44 bg-[radial-gradient(44rem_16rem_at_top,color-mix(in_srgb,var(--color-red-500)_16%,transparent),transparent)]" />
        <div className="absolute inset-0 bg-[linear-gradient(145deg,color-mix(in_srgb,var(--background)_90%,var(--color-black))_0%,var(--background)_55%)]" />
      </div>

      <section className="relative w-full max-w-xl rounded-2xl border border-border/80 bg-card/90 p-6 shadow-2xl shadow-black/20 backdrop-blur-md sm:p-8">
        <p className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
          {APP_DISPLAY_NAME}
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
          Something went wrong.
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{message}</p>

        <div className="mt-5 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => reset()}>
            Try again
          </Button>
          <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
            Reload app
          </Button>
        </div>

        <details className="group mt-5 overflow-hidden rounded-lg border border-border/70 bg-background/55">
          <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-muted-foreground">
            <span className="group-open:hidden">Show error details</span>
            <span className="hidden group-open:inline">Hide error details</span>
          </summary>
          <pre className="max-h-56 overflow-auto border-t border-border/70 bg-background/80 px-3 py-2 text-xs text-foreground/85">
            {details}
          </pre>
        </details>
      </section>
    </div>
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return "An unexpected router error occurred.";
}

function errorDetails(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return "No additional error details are available.";
  }
}

function AuthenticatedTracingBootstrap() {
  useEffect(() => {
    void configureClientTracing();
  }, []);

  return null;
}

function EventRouter() {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (loc) => loc.pathname });
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const primaryEnvironment = usePrimaryEnvironment();
  const openInEditor = useAtomCommand(shellEnvironment.openInEditor, {
    reportFailure: false,
  });
  const serverConfig = useAtomValue(primaryServerConfigAtom);
  const serverConfigEvent = useAtomValue(primaryServerConfigEventAtom);
  const serverWelcome = useAtomValue(primaryServerWelcomeAtom);
  const readPathname = useEffectEvent(() => pathname);
  const handledBootstrapThreadIdRef = useRef<string | null>(null);
  const handledConfigEventRef = useRef(serverConfigEvent);
  const [keybindingsToastController] = useState<KeybindingsUpdateToastController>(() =>
    createKeybindingsUpdateToastController({}),
  );

  const handleWelcome = useEffectEvent((payload: ServerLifecycleWelcomePayload | null) => {
    if (!payload) return;

    setActiveEnvironmentId(payload.environment.environmentId);
    void (async () => {
      if (!payload.bootstrapProjectId || !payload.bootstrapThreadId) {
        return;
      }
      const bootstrapProject = readProject(
        scopeProjectRef(payload.environment.environmentId, payload.bootstrapProjectId),
      );
      const bootstrapProjectKey =
        (bootstrapProject
          ? deriveLogicalProjectKeyFromSettings(bootstrapProject, projectGroupingSettings)
          : null) ??
        (serverConfig?.cwd
          ? derivePhysicalProjectKeyFromPath(payload.environment.environmentId, serverConfig.cwd)
          : null) ??
        scopedProjectKey(
          scopeProjectRef(payload.environment.environmentId, payload.bootstrapProjectId),
        );
      useUiStateStore.getState().setProjectExpanded(bootstrapProjectKey, true);

      if (readPathname() !== "/") {
        return;
      }
      if (handledBootstrapThreadIdRef.current === payload.bootstrapThreadId) {
        return;
      }
      await navigate({
        to: "/$environmentId/$threadId",
        params: {
          environmentId: payload.environment.environmentId,
          threadId: payload.bootstrapThreadId,
        },
        replace: true,
      });
      handledBootstrapThreadIdRef.current = payload.bootstrapThreadId;
    })().catch(() => undefined);
  });

  const handleServerConfigUpdated = useEffectEvent(() => {
    const decision = keybindingsToastController.handle(serverConfigEvent);
    if (!decision) {
      return;
    }

    if (decision._tag === "Success") {
      toastManager.add({
        type: "success",
        title: "Keybindings updated",
        description: "Keybindings configuration reloaded successfully.",
      });
      return;
    }

    toastManager.add(
      stackedThreadToast({
        type: "warning",
        title: "Invalid keybindings configuration",
        description: decision.message,
        actionVariant: "outline",
        actionProps: {
          children: "Open keybindings.json",
          onClick: () => {
            if (!serverConfig || !primaryEnvironment) {
              return;
            }

            const editor = resolveAndPersistPreferredEditor(serverConfig.availableEditors);
            if (!editor) {
              return;
            }
            void (async () => {
              const result = await openInEditor({
                environmentId: primaryEnvironment.environmentId,
                input: {
                  cwd: serverConfig.keybindingsConfigPath,
                  editor,
                },
              });
              if (result._tag === "Success") {
                return;
              }
              const error = squashAtomCommandFailure(result);
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Unable to open keybindings file",
                  description:
                    error instanceof Error ? error.message : "Unknown error opening file.",
                }),
              );
            })();
          },
        },
      }),
    );
  });

  useEffect(() => {
    if (!serverConfig) {
      return;
    }

    setActiveEnvironmentId(serverConfig.environment.environmentId);
  }, [serverConfig]);

  useEffect(() => {
    handleWelcome(serverWelcome);
  }, [serverWelcome]);

  useEffect(() => {
    if (serverConfigEvent === null || handledConfigEventRef.current === serverConfigEvent) {
      return;
    }
    handledConfigEventRef.current = serverConfigEvent;
    handleServerConfigUpdated();
  }, [serverConfigEvent]);

  return null;
}
