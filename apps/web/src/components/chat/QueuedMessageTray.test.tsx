import { MessageId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { QueuedMessageTray } from "./QueuedMessageTray";

describe("QueuedMessageTray", () => {
  it("shows queued copy with only steer and delete actions", () => {
    const markup = renderToStaticMarkup(
      <QueuedMessageTray
        messages={[
          {
            id: MessageId.make("queued-message"),
            role: "user",
            text: "Check the failing test next",
            turnId: null,
            streaming: false,
            deliveryState: "queued",
            createdAt: "2026-08-17T10:00:00.000Z",
            updatedAt: "2026-08-17T10:00:00.000Z",
          },
        ]}
        busyMessageIds={new Set()}
        onSteer={() => {}}
        onDelete={() => {}}
      />,
    );

    expect(markup).toContain("Queue");
    expect(markup).toContain("Check the failing test next");
    expect(markup).toContain('aria-label="Steer queued message now"');
    expect(markup).toContain('aria-label="Delete queued message"');
    expect(markup).not.toContain("Cancel queued message");
  });
});
