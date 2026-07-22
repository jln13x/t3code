import { describe, expect, it } from "vite-plus/test";
import * as Duration from "effect/Duration";

import {
  CHANGE_REQUEST_STATUS_REQUEST_BURST,
  changeRequestStatusFailureDelay,
  recordChangeRequestStatusRequestFailure,
  recordChangeRequestStatusRequestSuccess,
  successfulChangeRequestStatusTtl,
  takeChangeRequestStatusRequestPermit,
  throttledChangeRequestStatusTtl,
} from "./ChangeRequestStatusPollingPolicy.ts";

describe("ChangeRequestStatusPollingPolicy", () => {
  it("caps background polling and refills the request budget over time", () => {
    let state = undefined;
    for (let index = 0; index < CHANGE_REQUEST_STATUS_REQUEST_BURST; index += 1) {
      const permit = takeChangeRequestStatusRequestPermit(state, 1_000);
      expect(permit.allowed).toBe(true);
      state = permit.state;
    }

    const denied = takeChangeRequestStatusRequestPermit(state, 1_000);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBe(2_000);

    const refilled = takeChangeRequestStatusRequestPermit(denied.state, 3_000);
    expect(refilled.allowed).toBe(true);
  });

  it("reserves the full cost of multi-query branch discovery", () => {
    const first = takeChangeRequestStatusRequestPermit(undefined, 0, 4);
    expect(first.allowed).toBe(true);
    expect(first.state.availableTokens).toBe(CHANGE_REQUEST_STATUS_REQUEST_BURST - 4);

    const denied = takeChangeRequestStatusRequestPermit(first.state, 0, 7);
    expect(denied.allowed).toBe(false);
    expect(denied.state.availableTokens).toBe(CHANGE_REQUEST_STATUS_REQUEST_BURST - 4);
  });

  it("backs provider failures off exponentially without a concurrent success clearing cooldown", () => {
    const first = recordChangeRequestStatusRequestFailure(undefined, 1_000);
    expect(Duration.toMillis(first.retryAfter)).toBe(60_000);

    const second = recordChangeRequestStatusRequestFailure(first.state, 61_000);
    expect(Duration.toMillis(second.retryAfter)).toBe(120_000);

    const concurrentSuccess = recordChangeRequestStatusRequestSuccess(second.state, 61_001);
    expect(concurrentSuccess.blockedUntilMs).toBe(181_000);

    expect(Duration.toMillis(changeRequestStatusFailureDelay(2))).toBe(120_000);
    expect(Duration.toMillis(changeRequestStatusFailureDelay(20))).toBe(900_000);
  });

  it("uses slower refreshes for terminal states and bounds throttled retries", () => {
    expect(Duration.toMillis(successfulChangeRequestStatusTtl("open"))).toBe(60_000);
    expect(Duration.toMillis(successfulChangeRequestStatusTtl("closed"))).toBe(300_000);
    expect(Duration.toMillis(successfulChangeRequestStatusTtl("merged"))).toBe(900_000);
    expect(Duration.toMillis(throttledChangeRequestStatusTtl(2_000))).toBe(30_000);
    expect(Duration.toMillis(throttledChangeRequestStatusTtl(120_000))).toBe(120_000);
  });
});
