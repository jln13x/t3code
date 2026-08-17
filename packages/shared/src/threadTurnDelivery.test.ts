import { describe, expect, it } from "vite-plus/test";

import { resolveComposerDeliveryMode } from "./threadTurnDelivery.ts";

describe("resolveComposerDeliveryMode", () => {
  it("queues by default while a turn is active", () => {
    expect(resolveComposerDeliveryMode({ hasActiveTurn: true })).toBe("after-current");
  });

  it("sends immediately by default while idle", () => {
    expect(resolveComposerDeliveryMode({ hasActiveTurn: false })).toBe("immediate");
  });

  it("preserves an explicit steer request", () => {
    expect(resolveComposerDeliveryMode({ hasActiveTurn: true, requested: "immediate" })).toBe(
      "immediate",
    );
  });
});
