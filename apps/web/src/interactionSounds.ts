import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";

export type InteractionSoundCue = "bloom" | "success";
export const COMPLETION_SOUND_VOLUME = 1.1;

export interface ThreadFeedbackEvent {
  readonly cue: InteractionSoundCue;
  readonly thread: EnvironmentThreadShell;
}

interface ThreadSoundState {
  readonly completedTurn: string | null;
  readonly hasPendingUserAction: boolean;
}

export type ThreadSoundStateByKey = ReadonlyMap<string, ThreadSoundState>;

function threadKey(thread: EnvironmentThreadShell): string {
  return `${thread.environmentId}:${thread.id}`;
}

function completedTurn(thread: EnvironmentThreadShell): string | null {
  const latestTurn = thread.latestTurn;
  if (latestTurn?.state !== "completed" || latestTurn.completedAt === null) {
    return null;
  }
  return `${latestTurn.turnId}:${latestTurn.completedAt}`;
}

export function captureThreadSoundState(
  threads: ReadonlyArray<EnvironmentThreadShell>,
): ThreadSoundStateByKey {
  return new Map(
    threads.map((thread) => [
      threadKey(thread),
      {
        completedTurn: completedTurn(thread),
        hasPendingUserAction: thread.hasPendingUserInput || thread.hasPendingApprovals,
      },
    ]),
  );
}

export function deriveThreadFeedbackEvents(
  previous: ThreadSoundStateByKey,
  threads: ReadonlyArray<EnvironmentThreadShell>,
): ThreadFeedbackEvent[] {
  const events: ThreadFeedbackEvent[] = [];

  for (const thread of threads) {
    const prior = previous.get(threadKey(thread));
    const nextCompletedTurn = completedTurn(thread);

    if (prior && nextCompletedTurn !== null && prior.completedTurn !== nextCompletedTurn) {
      events.push({ cue: "success", thread });
    }
    const hasPendingUserAction = thread.hasPendingUserInput || thread.hasPendingApprovals;
    if (prior && hasPendingUserAction && !prior.hasPendingUserAction) {
      events.push({ cue: "bloom", thread });
    }
  }

  return events;
}

export function deriveInteractionSoundCues(
  previous: ThreadSoundStateByKey,
  threads: ReadonlyArray<EnvironmentThreadShell>,
): InteractionSoundCue[] {
  return deriveThreadFeedbackEvents(previous, threads).map((event) => event.cue);
}
