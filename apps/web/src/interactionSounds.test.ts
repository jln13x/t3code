import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  captureThreadSoundState,
  captureThreadSoundStateWhileSettingsHydrating,
  COMPLETION_SOUND_VOLUME,
  deriveInteractionSoundCues,
  deriveThreadFeedbackEvents,
} from "./interactionSounds";

function makeThread(overrides: Partial<EnvironmentThreadShell> = {}): EnvironmentThreadShell {
  return {
    environmentId: "environment-1",
    id: "thread-1",
    projectId: "project-1",
    title: "Thread",
    modelSelection: null,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-07-11T12:00:00.000Z",
    updatedAt: "2026-07-11T12:00:00.000Z",
    archivedAt: null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  } as EnvironmentThreadShell;
}

describe("interaction sounds", () => {
  it("plays success when a turn becomes completed", () => {
    const running = makeThread({
      latestTurn: {
        turnId: TurnId.make("turn-1"),
        state: "running",
        requestedAt: "2026-07-11T12:00:00.000Z",
        startedAt: "2026-07-11T12:00:01.000Z",
        completedAt: null,
        assistantMessageId: null,
      },
    });
    const completed = makeThread({
      latestTurn: {
        ...running.latestTurn!,
        state: "completed",
        completedAt: "2026-07-11T12:00:05.000Z",
      },
    });

    expect(deriveInteractionSoundCues(captureThreadSoundState([running]), [completed])).toEqual([
      "success",
    ]);
    expect(deriveThreadFeedbackEvents(captureThreadSoundState([running]), [completed])).toEqual([
      { cue: "success", thread: completed },
    ]);
  });

  it("plays completion feedback for standalone chats", () => {
    const running = makeThread({
      projectId: null,
      title: "Standalone chat",
      latestTurn: {
        turnId: TurnId.make("turn-chat"),
        state: "running",
        requestedAt: "2026-07-11T12:00:00.000Z",
        startedAt: "2026-07-11T12:00:01.000Z",
        completedAt: null,
        assistantMessageId: null,
      },
    });
    const completed = makeThread({
      ...running,
      latestTurn: {
        ...running.latestTurn!,
        state: "completed",
        completedAt: "2026-07-11T12:00:05.000Z",
      },
    });

    expect(deriveThreadFeedbackEvents(captureThreadSoundState([running]), [completed])).toEqual([
      { cue: "success", thread: completed },
    ]);
  });

  it("plays the completion cue at 110% of its original gain", () => {
    expect(COMPLETION_SOUND_VOLUME).toBe(1.1);
  });

  it("plays bloom when a thread starts requesting user input", () => {
    const thread = makeThread();

    expect(
      deriveInteractionSoundCues(captureThreadSoundState([thread]), [
        makeThread({ hasPendingUserInput: true }),
      ]),
    ).toEqual(["bloom"]);
  });

  it("plays bloom when a thread starts requesting approval", () => {
    const thread = makeThread();

    expect(
      deriveInteractionSoundCues(captureThreadSoundState([thread]), [
        makeThread({ hasPendingApprovals: true }),
      ]),
    ).toEqual(["bloom"]);
  });

  it("does not replay cues for unchanged state", () => {
    const thread = makeThread({
      hasPendingUserInput: true,
      hasPendingApprovals: true,
      latestTurn: {
        turnId: TurnId.make("turn-1"),
        state: "completed",
        requestedAt: "2026-07-11T12:00:00.000Z",
        startedAt: "2026-07-11T12:00:01.000Z",
        completedAt: "2026-07-11T12:00:05.000Z",
        assistantMessageId: null,
      },
    });

    expect(deriveInteractionSoundCues(captureThreadSoundState([thread]), [thread])).toEqual([]);
  });

  it("does not play cues while existing threads are first hydrated", () => {
    const thread = makeThread({
      hasPendingUserInput: true,
      latestTurn: {
        turnId: TurnId.make("turn-1"),
        state: "completed",
        requestedAt: "2026-07-11T12:00:00.000Z",
        startedAt: "2026-07-11T12:00:01.000Z",
        completedAt: "2026-07-11T12:00:05.000Z",
        assistantMessageId: null,
      },
    });

    expect(deriveInteractionSoundCues(new Map(), [thread])).toEqual([]);
  });

  it("preserves pre-hydration thread state so cues can play after settings hydrate", () => {
    const running = makeThread({
      latestTurn: {
        turnId: TurnId.make("turn-1"),
        state: "running",
        requestedAt: "2026-07-11T12:00:00.000Z",
        startedAt: "2026-07-11T12:00:01.000Z",
        completedAt: null,
        assistantMessageId: null,
      },
    });
    const completed = makeThread({
      latestTurn: {
        ...running.latestTurn!,
        state: "completed",
        completedAt: "2026-07-11T12:00:05.000Z",
      },
    });

    const seeded = captureThreadSoundStateWhileSettingsHydrating(null, [running]);
    const frozen = captureThreadSoundStateWhileSettingsHydrating(seeded, [completed]);

    expect(deriveInteractionSoundCues(frozen, [completed])).toEqual(["success"]);
  });

  it("admits newly seen threads while settings are hydrating", () => {
    const seeded = captureThreadSoundStateWhileSettingsHydrating(null, []);
    const withThread = captureThreadSoundStateWhileSettingsHydrating(seeded, [
      makeThread({ hasPendingUserInput: true }),
    ]);

    expect(
      deriveInteractionSoundCues(withThread, [makeThread({ hasPendingUserInput: true })]),
    ).toEqual([]);
  });
});
