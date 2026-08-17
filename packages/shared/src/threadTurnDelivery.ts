import type { ThreadTurnDeliveryMode } from "@t3tools/contracts";

export function resolveComposerDeliveryMode(input: {
  readonly hasActiveTurn: boolean;
  readonly requested?: ThreadTurnDeliveryMode;
}): ThreadTurnDeliveryMode {
  return input.requested ?? (input.hasActiveTurn ? "after-current" : "immediate");
}
