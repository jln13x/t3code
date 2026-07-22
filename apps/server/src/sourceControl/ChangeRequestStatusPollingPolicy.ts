import * as Duration from "effect/Duration";

export const CHANGE_REQUEST_STATUS_REQUEST_LIMIT = 30;
export const CHANGE_REQUEST_STATUS_REQUEST_WINDOW = Duration.minutes(1);
export const CHANGE_REQUEST_STATUS_REQUEST_BURST = 10;
export const CHANGE_REQUEST_STATUS_MAX_CONCURRENCY = 4;
export const CHANGE_REQUEST_STATUS_THROTTLED_MIN_TTL = Duration.seconds(30);
export const CHANGE_REQUEST_STATUS_OPEN_TTL = Duration.minutes(1);
export const CHANGE_REQUEST_STATUS_CLOSED_TTL = Duration.minutes(5);
export const CHANGE_REQUEST_STATUS_MERGED_TTL = Duration.minutes(15);
export const CHANGE_REQUEST_STATUS_INVALID_TTL = Duration.minutes(5);

const CHANGE_REQUEST_STATUS_FAILURE_BASE_DELAY = Duration.minutes(1);
const CHANGE_REQUEST_STATUS_FAILURE_MAX_DELAY = Duration.minutes(15);

export interface ChangeRequestStatusRequestBudgetState {
  readonly availableTokens: number;
  readonly lastRefillAtMs: number;
  readonly consecutiveFailures: number;
  readonly blockedUntilMs: number;
}

export interface ChangeRequestStatusRequestPermit {
  readonly allowed: boolean;
  readonly retryAfterMs: number;
  readonly state: ChangeRequestStatusRequestBudgetState;
}

export function initialChangeRequestStatusRequestBudget(
  nowMs: number,
): ChangeRequestStatusRequestBudgetState {
  return {
    availableTokens: CHANGE_REQUEST_STATUS_REQUEST_BURST,
    lastRefillAtMs: nowMs,
    consecutiveFailures: 0,
    blockedUntilMs: 0,
  };
}

function refillChangeRequestStatusRequestBudget(
  state: ChangeRequestStatusRequestBudgetState,
  nowMs: number,
): ChangeRequestStatusRequestBudgetState {
  const elapsedMs = Math.max(0, nowMs - state.lastRefillAtMs);
  if (elapsedMs === 0) return state;

  const refillPerMs =
    CHANGE_REQUEST_STATUS_REQUEST_LIMIT / Duration.toMillis(CHANGE_REQUEST_STATUS_REQUEST_WINDOW);
  return {
    ...state,
    availableTokens: Math.min(
      CHANGE_REQUEST_STATUS_REQUEST_BURST,
      state.availableTokens + elapsedMs * refillPerMs,
    ),
    lastRefillAtMs: nowMs,
  };
}

/**
 * A non-blocking token bucket for background provider polling. Callers render
 * last-known state when denied instead of queueing an unbounded number of CLI
 * processes behind the limiter.
 */
export function takeChangeRequestStatusRequestPermit(
  currentState: ChangeRequestStatusRequestBudgetState | undefined,
  nowMs: number,
  requestedTokens = 1,
): ChangeRequestStatusRequestPermit {
  const state = refillChangeRequestStatusRequestBudget(
    currentState ?? initialChangeRequestStatusRequestBudget(nowMs),
    nowMs,
  );

  if (state.blockedUntilMs > nowMs) {
    return {
      allowed: false,
      retryAfterMs: state.blockedUntilMs - nowMs,
      state,
    };
  }

  const boundedRequest = Math.max(
    1,
    Math.min(requestedTokens, CHANGE_REQUEST_STATUS_REQUEST_BURST),
  );
  if (state.availableTokens >= boundedRequest) {
    return {
      allowed: true,
      retryAfterMs: 0,
      state: {
        ...state,
        availableTokens: state.availableTokens - boundedRequest,
      },
    };
  }

  const refillPerMs =
    CHANGE_REQUEST_STATUS_REQUEST_LIMIT / Duration.toMillis(CHANGE_REQUEST_STATUS_REQUEST_WINDOW);
  return {
    allowed: false,
    retryAfterMs: Math.ceil((boundedRequest - state.availableTokens) / refillPerMs),
    state,
  };
}

export function changeRequestStatusFailureDelay(consecutiveFailures: number): Duration.Duration {
  const exponent = Math.max(0, consecutiveFailures - 1);
  const delayMs =
    Duration.toMillis(CHANGE_REQUEST_STATUS_FAILURE_BASE_DELAY) * Math.pow(2, exponent);
  return Duration.min(Duration.millis(delayMs), CHANGE_REQUEST_STATUS_FAILURE_MAX_DELAY);
}

export function recordChangeRequestStatusRequestFailure(
  currentState: ChangeRequestStatusRequestBudgetState | undefined,
  nowMs: number,
): {
  readonly retryAfter: Duration.Duration;
  readonly state: ChangeRequestStatusRequestBudgetState;
} {
  const state = refillChangeRequestStatusRequestBudget(
    currentState ?? initialChangeRequestStatusRequestBudget(nowMs),
    nowMs,
  );
  const consecutiveFailures = state.consecutiveFailures + 1;
  const retryAfter = changeRequestStatusFailureDelay(consecutiveFailures);
  return {
    retryAfter,
    state: {
      ...state,
      consecutiveFailures,
      blockedUntilMs: Math.max(state.blockedUntilMs, nowMs + Duration.toMillis(retryAfter)),
    },
  };
}

export function recordChangeRequestStatusRequestSuccess(
  currentState: ChangeRequestStatusRequestBudgetState | undefined,
  nowMs: number,
): ChangeRequestStatusRequestBudgetState {
  const state = refillChangeRequestStatusRequestBudget(
    currentState ?? initialChangeRequestStatusRequestBudget(nowMs),
    nowMs,
  );
  return {
    ...state,
    consecutiveFailures: 0,
    // A success from another request that was already in flight must not undo
    // a live provider-wide cooldown established by a concurrent failure.
    blockedUntilMs: state.blockedUntilMs <= nowMs ? 0 : state.blockedUntilMs,
  };
}

export function throttledChangeRequestStatusTtl(retryAfterMs: number): Duration.Duration {
  return Duration.max(
    CHANGE_REQUEST_STATUS_THROTTLED_MIN_TTL,
    Duration.millis(Math.max(0, retryAfterMs)),
  );
}

export function successfulChangeRequestStatusTtl(
  state: "open" | "closed" | "merged",
): Duration.Duration {
  switch (state) {
    case "open":
      return CHANGE_REQUEST_STATUS_OPEN_TTL;
    case "closed":
      return CHANGE_REQUEST_STATUS_CLOSED_TTL;
    case "merged":
      return CHANGE_REQUEST_STATUS_MERGED_TTL;
  }
}
