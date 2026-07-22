import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SynchronizedRef from "effect/SynchronizedRef";
import type {
  GitManagerServiceError,
  VcsStatusInput,
  VcsStatusLocalResult,
  VcsStatusRemoteResult,
  VcsStatusResult,
  VcsStatusStreamEvent,
} from "@t3tools/contracts";
import { mergeGitStatusParts } from "@t3tools/shared/git";

import * as GitWorkflowService from "../git/GitWorkflowService.ts";

const DEFAULT_VCS_STATUS_REFRESH_INTERVAL = Duration.seconds(30);
const VCS_STATUS_REFRESH_FAILURE_BASE_DELAY = Duration.seconds(30);
const VCS_STATUS_REFRESH_FAILURE_MAX_DELAY = Duration.minutes(15);
const MAX_FAILURE_DIAGNOSTIC_VALUES = 8;
const MAX_FAILURE_DIAGNOSTIC_VALUE_LENGTH = 128;

function boundedDiagnosticValue(value: string): string {
  return value.slice(0, MAX_FAILURE_DIAGNOSTIC_VALUE_LENGTH);
}

function diagnosticValueTag(value: unknown): string {
  try {
    if (
      typeof value === "object" &&
      value !== null &&
      "_tag" in value &&
      typeof value._tag === "string"
    ) {
      return boundedDiagnosticValue(value._tag);
    }
    if (value instanceof Error) {
      return boundedDiagnosticValue(value.name);
    }
    return typeof value;
  } catch {
    return "Uninspectable";
  }
}

function diagnosticFailureOperation(value: unknown): string | undefined {
  try {
    if (
      typeof value === "object" &&
      value !== null &&
      "operation" in value &&
      typeof value.operation === "string"
    ) {
      return boundedDiagnosticValue(value.operation);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function addUniqueDiagnosticValue(values: Array<string>, value: string | undefined): void {
  if (
    value !== undefined &&
    values.length < MAX_FAILURE_DIAGNOSTIC_VALUES &&
    !values.includes(value)
  ) {
    values.push(value);
  }
}

export function remoteRefreshFailureDiagnostics(cause: Cause.Cause<unknown>) {
  const failureTags: Array<string> = [];
  const failureOperations: Array<string> = [];
  const defectTags: Array<string> = [];
  let failureCount = 0;
  let defectCount = 0;
  let interruptionCount = 0;

  for (const reason of cause.reasons) {
    if (Cause.isFailReason(reason)) {
      failureCount += 1;
      addUniqueDiagnosticValue(failureTags, diagnosticValueTag(reason.error));
      addUniqueDiagnosticValue(failureOperations, diagnosticFailureOperation(reason.error));
      continue;
    }
    if (Cause.isDieReason(reason)) {
      defectCount += 1;
      addUniqueDiagnosticValue(defectTags, diagnosticValueTag(reason.defect));
      continue;
    }
    interruptionCount += 1;
  }

  return {
    reasonCount: cause.reasons.length,
    failureCount,
    failureTags,
    failureOperations,
    defectCount,
    defectTags,
    interruptionCount,
  };
}

interface VcsStatusChange {
  readonly cwd: string;
  readonly statusKey: string | null;
  readonly event: VcsStatusStreamEvent;
}

interface CachedValue<T> {
  readonly fingerprint: string;
  readonly value: T;
}

interface CachedVcsStatus {
  readonly input: VcsStatusInput;
  readonly local: VcsStatusLocalResult | null;
  readonly remote: CachedValue<VcsStatusRemoteResult | null> | null;
  readonly localGeneration: number;
}

interface ActiveRemotePoller {
  readonly fiber: Fiber.Fiber<void, never>;
  readonly subscriberCount: number;
}

interface StreamStatusOptions {
  readonly automaticRemoteRefreshInterval?: Effect.Effect<Duration.Duration, never>;
}

export function remoteRefreshFailureDelay(
  consecutiveFailures: number,
  configuredInterval: Duration.Duration,
) {
  const exponent = Math.max(0, consecutiveFailures - 1);
  const backoffMs =
    Duration.toMillis(VCS_STATUS_REFRESH_FAILURE_BASE_DELAY) * Math.pow(2, exponent);
  const cappedBackoff = Duration.min(
    Duration.millis(backoffMs),
    VCS_STATUS_REFRESH_FAILURE_MAX_DELAY,
  );
  return Duration.max(configuredInterval, cappedBackoff);
}

export class VcsStatusBroadcaster extends Context.Service<
  VcsStatusBroadcaster,
  {
    readonly getStatus: (
      input: VcsStatusInput,
    ) => Effect.Effect<VcsStatusResult, GitManagerServiceError>;
    readonly refreshLocalStatus: (
      cwd: string,
    ) => Effect.Effect<VcsStatusLocalResult, GitManagerServiceError>;
    readonly refreshStatus: (
      cwd: string,
      changeRequest?: VcsStatusInput["changeRequest"],
    ) => Effect.Effect<VcsStatusResult, GitManagerServiceError>;
    readonly streamStatus: (
      input: VcsStatusInput,
      options?: StreamStatusOptions,
    ) => Stream.Stream<VcsStatusStreamEvent, GitManagerServiceError>;
  }
>()("t3/vcs/VcsStatusBroadcaster") {}

function fingerprintStatusPart(status: unknown): string {
  return JSON.stringify(status);
}

function statusInputKey(input: VcsStatusInput): string {
  return JSON.stringify({
    cwd: input.cwd,
    ...(input.changeRequest
      ? {
          changeRequest: {
            provider: input.changeRequest.provider,
            number: input.changeRequest.number,
            url: input.changeRequest.url,
          },
        }
      : {}),
  });
}

const normalizeCwd = (cwd: string) =>
  Effect.service(FileSystem.FileSystem).pipe(
    Effect.flatMap((fs) => fs.realPath(cwd)),
    Effect.orElseSucceed(() => cwd),
  );

export const make = Effect.gen(function* () {
  const workflow = yield* GitWorkflowService.GitWorkflowService;
  const fs = yield* FileSystem.FileSystem;
  const changesPubSub = yield* Effect.acquireRelease(
    PubSub.unbounded<VcsStatusChange>(),
    (pubsub) => PubSub.shutdown(pubsub),
  );
  const broadcasterScope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
    Scope.close(scope, Exit.void),
  );
  const cacheRef = yield* Ref.make(new Map<string, CachedVcsStatus>());
  const pollersRef = yield* SynchronizedRef.make(new Map<string, ActiveRemotePoller>());

  const getCachedStatus = Effect.fn("VcsStatusBroadcaster.getCachedStatus")(function* (
    input: VcsStatusInput,
  ) {
    return yield* Ref.get(cacheRef).pipe(
      Effect.map((cache) => cache.get(statusInputKey(input)) ?? null),
    );
  });

  const updateCachedLocalStatus = Effect.fn("VcsStatusBroadcaster.updateCachedLocalStatus")(
    function* (
      input: VcsStatusInput,
      local: VcsStatusLocalResult,
      options?: { publish?: boolean },
    ) {
      const statusKey = statusInputKey(input);
      const localGeneration = yield* Ref.modify(cacheRef, (cache) => {
        const nextCache = new Map(cache);
        if (!nextCache.has(statusKey)) {
          nextCache.set(statusKey, {
            input,
            local: null,
            remote: null,
            localGeneration: 0,
          });
        }

        let nextLocalGeneration = 0;
        for (const [key, previous] of nextCache) {
          if (previous.input.cwd !== input.cwd) continue;
          const generation = previous.localGeneration + 1;
          nextCache.set(key, { ...previous, local, localGeneration: generation });
          if (key === statusKey) nextLocalGeneration = generation;
        }
        return [nextLocalGeneration, nextCache] as const;
      });

      if (options?.publish) {
        yield* PubSub.publish(changesPubSub, {
          cwd: input.cwd,
          statusKey: null,
          event: {
            _tag: "localUpdated",
            local,
            localGeneration,
          },
        });
      }

      return local;
    },
  );

  const updateCachedRemoteStatus = Effect.fn("VcsStatusBroadcaster.updateCachedRemoteStatus")(
    function* (
      input: VcsStatusInput,
      remote: VcsStatusRemoteResult | null,
      options?: { publish?: boolean },
    ) {
      const statusKey = statusInputKey(input);
      const update = yield* Ref.modify(cacheRef, (cache) => {
        const previous = cache.get(statusKey) ?? {
          input,
          local: null,
          remote: null,
          localGeneration: 0,
        };
        const previousPr = previous.remote?.value?.pr;
        const nextPr = remote?.pr;
        const effectiveRemote =
          remote && nextPr?.stale && previousPr && previousPr.number === nextPr.number
            ? { ...remote, pr: { ...previousPr, stale: true } }
            : remote;
        const nextRemote = {
          fingerprint: fingerprintStatusPart(effectiveRemote),
          value: effectiveRemote,
        } satisfies CachedValue<VcsStatusRemoteResult | null>;
        const nextCache = new Map(cache);
        nextCache.set(statusKey, {
          ...previous,
          remote: nextRemote,
        });
        return [
          {
            shouldPublish: previous.remote?.fingerprint !== nextRemote.fingerprint,
            remote: effectiveRemote,
          },
          nextCache,
        ] as const;
      });

      if (options?.publish && update.shouldPublish) {
        yield* PubSub.publish(changesPubSub, {
          cwd: input.cwd,
          statusKey,
          event: {
            _tag: "remoteUpdated",
            remote: update.remote,
          },
        });
      }

      return update.remote;
    },
  );

  const updateCachedStatus = Effect.fn("VcsStatusBroadcaster.updateCachedStatus")(function* (
    input: VcsStatusInput,
    local: VcsStatusLocalResult,
    remote: VcsStatusRemoteResult | null,
    options?: { publish?: boolean },
  ) {
    const statusKey = statusInputKey(input);
    const nextRemote = {
      fingerprint: fingerprintStatusPart(remote),
      value: remote,
    } satisfies CachedValue<VcsStatusRemoteResult | null>;
    const localGeneration = yield* Ref.modify(cacheRef, (cache) => {
      const previous = cache.get(statusKey) ?? {
        input,
        local: null,
        remote: null,
        localGeneration: 0,
      };
      const nextLocalGeneration = previous.localGeneration + 1;
      const nextCache = new Map(cache);
      nextCache.set(statusKey, {
        input,
        local,
        remote: nextRemote,
        localGeneration: nextLocalGeneration,
      });
      return [nextLocalGeneration, nextCache] as const;
    });

    if (options?.publish) {
      yield* PubSub.publish(changesPubSub, {
        cwd: input.cwd,
        statusKey,
        event: {
          _tag: "snapshot",
          local,
          remote,
          localGeneration,
        },
      });
    }

    return mergeGitStatusParts(local, remote);
  });

  const loadLocalStatus = Effect.fn("VcsStatusBroadcaster.loadLocalStatus")(function* (
    input: VcsStatusInput,
  ) {
    const local = yield* workflow.localStatus({ cwd: input.cwd });
    return yield* updateCachedLocalStatus(input, local);
  });

  const getOrLoadLocalStatus = Effect.fn("VcsStatusBroadcaster.getOrLoadLocalStatus")(function* (
    input: VcsStatusInput,
  ) {
    const cached = yield* getCachedStatus(input);
    if (cached?.local) {
      return cached.local;
    }
    return yield* loadLocalStatus(input);
  });

  const withFileSystem = Effect.provideService(FileSystem.FileSystem, fs);

  const getStatus: VcsStatusBroadcaster["Service"]["getStatus"] = Effect.fn(
    "VcsStatusBroadcaster.getStatus",
  )(function* (input) {
    const cwd = yield* withFileSystem(normalizeCwd(input.cwd));
    const normalizedInput = { ...input, cwd };
    const cached = yield* getCachedStatus(normalizedInput);
    if (cached?.local && cached.remote) {
      return mergeGitStatusParts(cached.local, cached.remote.value);
    }
    const [local, remote] = yield* Effect.all(
      [
        cached?.local ? Effect.succeed(cached.local) : workflow.localStatus({ cwd }),
        cached?.remote
          ? Effect.succeed(cached.remote.value)
          : workflow.remoteStatus(normalizedInput),
      ],
      { concurrency: "unbounded" },
    );
    return yield* updateCachedStatus(normalizedInput, local, remote);
  });

  const refreshLocalStatusCore = Effect.fn("VcsStatusBroadcaster.refreshLocalStatusCore")(
    function* (cwd: string) {
      yield* workflow.invalidateLocalStatus(cwd);
      const local = yield* workflow.localStatus({ cwd });
      return yield* updateCachedLocalStatus({ cwd }, local, { publish: true });
    },
  );

  const refreshLocalStatus: VcsStatusBroadcaster["Service"]["refreshLocalStatus"] = Effect.fn(
    "VcsStatusBroadcaster.refreshLocalStatus",
  )(function* (rawCwd) {
    const cwd = yield* withFileSystem(normalizeCwd(rawCwd));
    return yield* refreshLocalStatusCore(cwd);
  });

  const refreshRemoteStatus = Effect.fn("VcsStatusBroadcaster.refreshRemoteStatus")(function* (
    input: VcsStatusInput,
    options?: { readonly refreshUpstream?: boolean },
  ) {
    if (options?.refreshUpstream !== false) {
      yield* workflow.invalidateRemoteStatus(input.cwd);
    }
    const remote = yield* workflow.remoteStatus(input, options);
    return yield* updateCachedRemoteStatus(input, remote, { publish: true });
  });

  const refreshStatus: VcsStatusBroadcaster["Service"]["refreshStatus"] = Effect.fn(
    "VcsStatusBroadcaster.refreshStatus",
  )(function* (rawCwd, changeRequest) {
    const cwd = yield* withFileSystem(normalizeCwd(rawCwd));
    const input = { cwd, ...(changeRequest ? { changeRequest } : {}) };
    yield* Effect.all([workflow.invalidateLocalStatus(cwd), workflow.invalidateRemoteStatus(cwd)], {
      concurrency: "unbounded",
      discard: true,
    });
    const [local, remote] = yield* Effect.all(
      [workflow.localStatus({ cwd }), workflow.remoteStatus(input)],
      { concurrency: "unbounded" },
    );
    return yield* updateCachedStatus(input, local, remote, { publish: true });
  });

  const makeRemoteRefreshLoop = (
    input: VcsStatusInput,
    automaticRemoteRefreshInterval: Effect.Effect<Duration.Duration, never>,
    refreshImmediately: boolean,
  ) => {
    return Effect.gen(function* () {
      const consecutiveFailuresRef = yield* Ref.make(0);
      const needsInitialRefreshRef = yield* Ref.make(refreshImmediately);
      const refreshRemoteStatusIfEnabled = Effect.gen(function* () {
        const configuredInterval = yield* automaticRemoteRefreshInterval;
        const activeInterval = Duration.isZero(configuredInterval)
          ? DEFAULT_VCS_STATUS_REFRESH_INTERVAL
          : configuredInterval;
        const needsInitialRefresh = yield* Ref.get(needsInitialRefreshRef);
        if (Duration.isZero(configuredInterval) && !needsInitialRefresh) {
          return activeInterval;
        }

        const exit = yield* refreshRemoteStatus(input, {
          refreshUpstream: !Duration.isZero(configuredInterval),
        }).pipe(Effect.exit);
        if (Exit.isSuccess(exit)) {
          yield* Ref.set(needsInitialRefreshRef, false);
          yield* Ref.set(consecutiveFailuresRef, 0);
          return activeInterval;
        }

        const interruptionReasons = exit.cause.reasons.filter(Cause.isInterruptReason);
        if (interruptionReasons.length > 0) {
          return yield* Effect.failCause(Cause.fromReasons<never>(interruptionReasons));
        }

        const consecutiveFailures = yield* Ref.updateAndGet(
          consecutiveFailuresRef,
          (count) => count + 1,
        );
        const nextDelay = remoteRefreshFailureDelay(consecutiveFailures, activeInterval);
        yield* Effect.logWarning("VCS remote status refresh failed", {
          cwdLength: input.cwd.length,
          hasExplicitChangeRequest: input.changeRequest !== undefined,
          ...remoteRefreshFailureDiagnostics(exit.cause),
          consecutiveFailures,
          nextDelayMs: Duration.toMillis(nextDelay),
        });
        return nextDelay;
      });

      if (!refreshImmediately) {
        const configuredInterval = yield* automaticRemoteRefreshInterval;
        yield* Effect.sleep(
          Duration.isZero(configuredInterval)
            ? DEFAULT_VCS_STATUS_REFRESH_INTERVAL
            : configuredInterval,
        );
      }

      return yield* refreshRemoteStatusIfEnabled.pipe(
        Effect.repeat(
          Schedule.identity<Duration.Duration>().pipe(
            Schedule.addDelay((delay) => Effect.succeed(delay)),
          ),
        ),
        Effect.asVoid,
      );
    });
  };

  const retainRemotePoller = Effect.fn("VcsStatusBroadcaster.retainRemotePoller")(function* (
    input: VcsStatusInput,
    automaticRemoteRefreshInterval: Effect.Effect<Duration.Duration, never>,
    refreshImmediately: boolean,
  ) {
    const statusKey = statusInputKey(input);
    yield* SynchronizedRef.modifyEffect(pollersRef, (activePollers) => {
      const existing = activePollers.get(statusKey);
      if (existing) {
        const nextPollers = new Map(activePollers);
        nextPollers.set(statusKey, {
          ...existing,
          subscriberCount: existing.subscriberCount + 1,
        });
        return Effect.succeed([undefined, nextPollers] as const);
      }

      return makeRemoteRefreshLoop(input, automaticRemoteRefreshInterval, refreshImmediately).pipe(
        Effect.forkIn(broadcasterScope),
        Effect.map((fiber) => {
          const nextPollers = new Map(activePollers);
          nextPollers.set(statusKey, {
            fiber,
            subscriberCount: 1,
          });
          return [undefined, nextPollers] as const;
        }),
      );
    });
  });

  const releaseRemotePoller = Effect.fn("VcsStatusBroadcaster.releaseRemotePoller")(function* (
    input: VcsStatusInput,
  ) {
    const statusKey = statusInputKey(input);
    const pollerToInterrupt = yield* SynchronizedRef.modifyEffect(pollersRef, (activePollers) => {
      const existing = activePollers.get(statusKey);
      if (!existing) {
        return Effect.succeed([null, activePollers] as const);
      }

      if (existing.subscriberCount > 1) {
        const nextPollers = new Map(activePollers);
        nextPollers.set(statusKey, {
          ...existing,
          subscriberCount: existing.subscriberCount - 1,
        });
        return Effect.succeed([null, nextPollers] as const);
      }

      const nextPollers = new Map(activePollers);
      nextPollers.delete(statusKey);
      // Drop the cached status for this subscription key in the same critical section that
      // removes the poller, so a concurrent retainRemotePoller (which reloads
      // the cache and installs a fresh poller) cannot have its new entry wiped
      // by this release. Otherwise the cache grows one entry per cwd for the
      // broadcaster's lifetime; a future subscriber re-loads and re-seeds it.
      return Ref.update(cacheRef, (cache) => {
        if (!cache.has(statusKey)) {
          return cache;
        }
        const nextCache = new Map(cache);
        nextCache.delete(statusKey);
        return nextCache;
      }).pipe(Effect.as([existing.fiber, nextPollers] as const));
    });

    if (pollerToInterrupt) {
      yield* Fiber.interrupt(pollerToInterrupt).pipe(Effect.ignore);
    }
  });

  const streamStatus: VcsStatusBroadcaster["Service"]["streamStatus"] = (input, options) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const cwd = yield* withFileSystem(normalizeCwd(input.cwd));
        const normalizedInput = { ...input, cwd };
        const statusKey = statusInputKey(normalizedInput);
        const subscription = yield* PubSub.subscribe(changesPubSub);
        const initialLocal = yield* getOrLoadLocalStatus(normalizedInput);
        const cachedStatus = yield* getCachedStatus(normalizedInput);
        const initialRemote = cachedStatus?.remote?.value ?? null;
        yield* retainRemotePoller(
          normalizedInput,
          options?.automaticRemoteRefreshInterval ??
            Effect.succeed(DEFAULT_VCS_STATUS_REFRESH_INTERVAL),
          cachedStatus?.remote === null || cachedStatus?.remote === undefined,
        );

        const release = releaseRemotePoller(normalizedInput).pipe(Effect.ignore, Effect.asVoid);

        return Stream.concat(
          Stream.make({
            _tag: "snapshot" as const,
            local: initialLocal,
            remote: initialRemote,
            localGeneration: cachedStatus?.localGeneration,
          }),
          Stream.fromSubscription(subscription).pipe(
            Stream.filter(
              (event) =>
                event.cwd === cwd && (event.statusKey === null || event.statusKey === statusKey),
            ),
            Stream.map((event) => event.event),
          ),
        ).pipe(Stream.ensuring(release));
      }),
    );

  return VcsStatusBroadcaster.of({
    getStatus,
    refreshLocalStatus,
    refreshStatus,
    streamStatus,
  });
});

export const layer = Layer.effect(VcsStatusBroadcaster, make);
