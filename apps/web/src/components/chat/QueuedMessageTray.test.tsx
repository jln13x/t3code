import { MessageId, ProviderInstanceId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { QueuedMessageTray } from "./QueuedMessageTray";

describe("QueuedMessageTray", () => {
  it("shows queued copy with only steer and delete actions", () => {
    const markup = renderToStaticMarkup(
      <QueuedMessageTray
        messages={[
          {
            id: MessageId.make("queued-message"),
            text: "Run this next",
            attachments: [],
            modelSelection: {
              instanceId: ProviderInstanceId.make("codex"),
              model: "gpt-5.4",
            },
            runtimeMode: "full-access",
            interactionMode: "default",
            createdAt: "2026-08-17T10:00:00.000Z",
          },
        ]}
        busyMessageIds={new Set()}
        onSteer={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(markup).toContain("Queue");
    expect(markup).toContain("Run this next");
    expect(markup).toContain('aria-label="Steer queued message now"');
    expect(markup).toContain('aria-label="Delete queued message"');
    expect(markup).not.toContain("Runs after the current turn");
    expect(markup).not.toContain("Cancel queued message");
  });
});
