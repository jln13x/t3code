import type { ClientSettings } from "@t3tools/contracts/settings";
import type { AnyRouter } from "@tanstack/react-router";
import { Atom, AtomRegistry } from "effect/reactivity";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  RuntimeRequestId,
  ThreadId,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import { describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  settingsListeners: new Set<() => void>(),
  routeListeners: new Set<() => void>(),
  mode: "off" as ClientSettings["notificationMode"],
  inApp: true,
  active: { environmentId: "env-1", threadId: "other-thread" },
  focused: true,
  visible: "visible",
  live: true,
  pinned: false,
  completedAt: null as string | null,
  archivedAt: null as string | null,
  input: false,
  approval: false,
  sessionError: false,
  turnError: false,
  limited: false,
  subagent: false,
  background: [] as Array<{ taskId: string; kind: "command" | "monitor" }>,
  delegatedChild: null as "running" | "approval" | null,
  add: vi.fn(
    (_toast: { title: string; description: string; actionProps: { onClick: () => void } }) =>
      "toast-1",
  ),
  close: vi.fn(),
  navigate: vi.fn(),
  sound: vi.fn(),
  notification: vi.fn(function (_title: string, options: NotificationOptions) {
    return Object.assign(new EventTarget(), { tag: options.tag, close: vi.fn() });
  }),
}));

const SHELL_NOW = DateTime.makeUnsafe("2026-09-13T09:00:00.000Z");

function mockThreadShell() {
  return {
    id: ThreadId.make("thread-1"),
    projectId: ProjectId.make("project-1"),
    title: "Fix the login form",
    providerInstanceId: ProviderInstanceId.make("codex"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: {
      rootThreadId: ThreadId.make("thread-1"),
      parentThreadId: state.subagent ? ThreadId.make("parent") : null,
      relationshipToParent: state.subagent ? "subagent" : null,
    },
    forkedFrom: null,
    createdBy: "user",
    creationSource: "web",
    latestRunId: RunId.make("run-1"),
    activeRunId: null,
    status: state.completedAt
      ? "completed"
      : state.sessionError || state.turnError || state.limited
        ? "failed"
        : "running",
    lastErrorClass: state.limited ? "usage_limit" : null,
    pendingRuntimeRequest: state.input
      ? { id: RuntimeRequestId.make("request-1"), kind: "user_input", createdAt: SHELL_NOW }
      : state.approval
        ? { id: RuntimeRequestId.make("request-1"), kind: "command", createdAt: SHELL_NOW }
        : null,
    latestVisibleMessage: null,
    latestUserMessageAt: null,
    hasActionableProposedPlan: false,
    pendingBackgroundTasks: state.background,
    itemCount: 0,
    visibleItemCount: 0,
    createdAt: SHELL_NOW,
    updatedAt: SHELL_NOW,
    latestRunRequestedAt: SHELL_NOW,
    latestRunStartedAt: SHELL_NOW,
    latestRunCompletedAt: state.completedAt ? DateTime.makeUnsafe(state.completedAt) : undefined,
    archivedAt: state.archivedAt ? DateTime.makeUnsafe(state.archivedAt) : null,
    pinnedAt: state.pinned ? SHELL_NOW : null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
  } satisfies OrchestrationV2ThreadShell;
}

let stableParent: ReturnType<typeof mockThreadShell> | null = null;
function mockThreads() {
  if (state.delegatedChild === null) return [mockThreadShell()];
  stableParent ??= mockThreadShell();
  const child = {
    ...mockThreadShell(),
    id: "child-1",
    title: "Review the login form",
    creationSource: "mcp",
    lineage: {
      rootThreadId: "thread-1",
      parentThreadId: "thread-1",
      relationshipToParent: "subagent",
    },
    pendingRuntimeRequest:
      state.delegatedChild === "approval"
        ? { id: "request-2", kind: "command", createdAt: SHELL_NOW }
        : null,
  };
  return [stableParent, child];
}

const shellAtom = Atom.make<unknown>(null);
const environmentIdsAtom = Atom.make([EnvironmentId.make("env-1")]);
const requestsAtom = Atom.make<ReadonlyMap<ThreadId, "approval" | "user_input">>(new Map());
const delegatedAtom = Atom.make<ReadonlySet<string>>(new Set<string>());
vi.mock("../state/threads", () => ({
  environmentThreadShells: {
    pendingSubagentRequestsAtom: () => requestsAtom,
    get delegatedUnderParentAtom() {
      return delegatedAtom;
    },
  },
}));
vi.mock("../state/shell", () => ({
  environmentShell: { stateValueAtom: () => shellAtom },
}));
vi.mock("../state/presentation", () => ({
  environmentSummaries: {
    get environmentIdsAtom() {
      return environmentIdsAtom;
    },
  },
}));
vi.mock("../hooks/useSettings", () => ({
  subscribeClientSettings: (listener: () => void) => {
    state.settingsListeners.add(listener);
    return () => state.settingsListeners.delete(listener);
  },
  getClientSettings: () => ({
    notificationMode: state.mode,
    inAppNotificationsEnabled: state.inApp,
  }),
}));
vi.mock(import("../threadNotifications"), async (original) => ({
  ...(await original()),
  playNotificationSound: state.sound,
  setNotificationBadge: vi.fn(),
}));
vi.mock("./ui/toast", () => ({ toastManager: { add: state.add, close: state.close } }));

import { startThreadNotifications } from "./ThreadNotificationCoordinator";
import { threadNotificationTag } from "../threadNotifications";
import { PINNED_REMINDER_INTERVAL_MS } from "./PinnedThreadReminders.logic";

function setup() {
  vi.clearAllMocks();
  const stack = new AsyncDisposableStack();
  vi.useFakeTimers();
  stack.defer(() => {
    vi.useRealTimers();
  });
  vi.stubGlobal(
    "window",
    Object.assign(new EventTarget(), {
      setInterval,
      clearInterval,
      focus: vi.fn(),
    }),
  );
  vi.stubGlobal(
    "document",
    Object.assign(new EventTarget(), {
      visibilityState: "visible",
      hasFocus: () => true,
    }),
  );
  vi.stubGlobal("Notification", Object.assign(state.notification, { permission: "granted" }));
  stack.defer(() => {
    vi.unstubAllGlobals();
  });
  vi.setSystemTime(DateTime.toEpochMillis(SHELL_NOW));
  Object.assign(state, {
    mode: "off",
    inApp: true,
    active: { environmentId: "env-1", threadId: "other-thread" },
    focused: true,
    visible: "visible",
    live: true,
    pinned: true,
    completedAt: "2026-09-13T08:00:00.000Z",
    archivedAt: null,
    input: false,
    approval: false,
    sessionError: false,
    turnError: false,
    limited: false,
    subagent: false,
    background: [],
    delegatedChild: null,
  });
  stableParent = null;
  state.settingsListeners.clear();
  state.routeListeners.clear();
  stack.use(
    vi
      .spyOn(document, "visibilityState", "get")
      .mockImplementation(() => state.visible as DocumentVisibilityState),
  );
  stack.use(vi.spyOn(document, "hasFocus").mockImplementation(() => state.focused));
  stack.use(vi.spyOn(window, "focus").mockImplementation(() => undefined));
  const registry = AtomRegistry.make();
  stack.defer(() => registry.dispose());
  const router = {
    get state() {
      return { matches: [{ params: state.active }] };
    },
    navigate: state.navigate,
    subscribe: (_event: string, listener: () => void) => {
      state.routeListeners.add(listener);
      return () => state.routeListeners.delete(listener);
    },
  } as unknown as AnyRouter;
  let started = false;
  return {
    requestApproval: () =>
      registry.set(requestsAtom, new Map([[ThreadId.make("thread-1"), "approval"]])),
    async render() {
      registry.set(shellAtom, {
        status: state.live ? "live" : "disconnected",
        snapshot: Option.some({ threads: mockThreads() }),
      });
      if (!started) {
        stack.defer(startThreadNotifications(registry, router));
        started = true;
      } else {
        for (const listener of state.settingsListeners) listener();
        for (const listener of state.routeListeners) listener();
      }
    },
    [Symbol.asyncDispose]: () => stack.disposeAsync(),
  };
}

describe("pinned thread reminders", () => {
  it("repeats focused idle reminders and opens the thread from the toast", async () => {
    await using app = setup();
    await app.render();
    vi.advanceTimersByTime(PINNED_REMINDER_INTERVAL_MS - 1);
    expect(state.add).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(state.add).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        title: "Pinned thread is idle",
        description: "Fix the login form",
      }),
    );
    vi.advanceTimersByTime(PINNED_REMINDER_INTERVAL_MS);
    expect(state.add).toHaveBeenCalledTimes(2);
    state.add.mock.calls[0]?.[0].actionProps.onClick();
    expect(state.navigate).toHaveBeenCalledWith({
      to: "/$environmentId/$threadId",
      params: { environmentId: "env-1", threadId: "thread-1" },
    });
    expect(state.sound).not.toHaveBeenCalled();
    expect(state.notification).not.toHaveBeenCalled();
  });

  it("starts a full interval after leaving the viewed thread", async () => {
    await using app = setup();
    state.active.threadId = "thread-1";
    await app.render();
    vi.advanceTimersByTime(PINNED_REMINDER_INTERVAL_MS * 2);
    expect(state.add).not.toHaveBeenCalled();
    state.active.threadId = "other-thread";
    await app.render();
    vi.advanceTimersByTime(PINNED_REMINDER_INTERVAL_MS - 1);
    expect(state.add).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(state.add).toHaveBeenCalledOnce();
  });

  it("uses sound and replaces background system reminders for the same thread", async () => {
    await using app = setup();
    state.mode = "notifications-and-sound";
    state.focused = false;
    await app.render();
    vi.advanceTimersByTime(PINNED_REMINDER_INTERVAL_MS);
    expect(state.sound).toHaveBeenCalledWith("input", expect.any(Function));
    expect(state.notification).toHaveBeenCalledExactlyOnceWith("Pinned thread is idle", {
      body: "Fix the login form",
      tag: threadNotificationTag(EnvironmentId.make("env-1"), ThreadId.make("thread-1")),
      silent: true,
    });
    const first = state.notification.mock.results[0]?.value;
    vi.advanceTimersByTime(PINNED_REMINDER_INTERVAL_MS);
    expect(state.notification).toHaveBeenCalledTimes(2);
    expect(first.close).toHaveBeenCalledOnce();
    expect(state.add).not.toHaveBeenCalled();
  });

  it("stops reminders when all alerts are disabled", async () => {
    await using app = setup();
    await app.render();
    vi.advanceTimersByTime(PINNED_REMINDER_INTERVAL_MS);
    expect(state.add).toHaveBeenCalledOnce();
    state.inApp = false;
    await app.render();
    vi.advanceTimersByTime(PINNED_REMINDER_INTERVAL_MS * 2);
    expect(state.add).toHaveBeenCalledOnce();
  });

  it("ignores cached idle threads while disconnected and restarts after reconnecting", async () => {
    await using app = setup();
    await app.render();
    vi.advanceTimersByTime(PINNED_REMINDER_INTERVAL_MS - 15_000);
    state.live = false;
    await app.render();
    vi.advanceTimersByTime(PINNED_REMINDER_INTERVAL_MS * 2);
    expect(state.add).not.toHaveBeenCalled();
    state.live = true;
    await app.render();
    vi.advanceTimersByTime(PINNED_REMINDER_INTERVAL_MS - 1);
    expect(state.add).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(state.add).toHaveBeenCalledOnce();
  });
  it("reminds when a linked task's approval blocks a pinned running parent", async () => {
    await using app = setup();
    state.completedAt = null;
    await app.render();
    vi.advanceTimersByTime(PINNED_REMINDER_INTERVAL_MS);
    expect(state.add).not.toHaveBeenCalled();

    app.requestApproval();
    vi.advanceTimersByTime(15_000);
    vi.advanceTimersByTime(PINNED_REMINDER_INTERVAL_MS);
    expect(
      state.add.mock.calls.filter(([toast]) => toast.title === "Pinned thread is idle"),
    ).toHaveLength(1);
  });
});
