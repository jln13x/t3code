import type { MessageId } from "@t3tools/contracts";
import { ForwardIcon, ListTodoIcon, PaperclipIcon, Trash2Icon } from "lucide-react";
import { memo } from "react";

import type { ChatMessage } from "../../types";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

interface QueuedMessageTrayProps {
  readonly messages: ReadonlyArray<ChatMessage>;
  readonly busyMessageIds: ReadonlySet<MessageId>;
  readonly onSteer: (messageId: MessageId) => void;
  readonly onDelete: (messageId: MessageId) => void;
}

function queuedMessageLabel(message: ChatMessage): string {
  const text = message.text.trim();
  if (text.length > 0) return text;
  const attachmentCount = message.attachments?.length ?? 0;
  return attachmentCount === 1 ? "Image attachment" : `${attachmentCount} image attachments`;
}

export const QueuedMessageTray = memo(function QueuedMessageTray({
  messages,
  busyMessageIds,
  onSteer,
  onDelete,
}: QueuedMessageTrayProps) {
  if (messages.length === 0) return null;

  return (
    <section
      aria-label="Queued messages"
      className="mx-auto mb-2 w-full max-w-3xl overflow-hidden rounded-2xl border border-border/70 bg-card/95 shadow-lg shadow-black/6 backdrop-blur-xl dark:bg-card/90 dark:shadow-black/20"
      data-chat-queued-messages="true"
    >
      <div className="flex items-center gap-2 border-border/60 border-b px-3 py-2 text-muted-foreground">
        <ListTodoIcon aria-hidden="true" className="size-3.5" />
        <h2 className="font-medium text-xs">
          Queue <span className="tabular-nums text-foreground/70">{messages.length}</span>
        </h2>
        <span className="ml-auto text-[11px]">Runs after the current turn</span>
      </div>
      <ol className="max-h-40 divide-y divide-border/50 overflow-y-auto overscroll-contain">
        {messages.map((message) => {
          const isBusy = busyMessageIds.has(message.id);
          const attachmentCount = message.attachments?.length ?? 0;
          return (
            <li className="flex min-h-11 items-center gap-2 px-3 py-2" key={message.id}>
              <p className="min-w-0 flex-1 truncate text-foreground text-sm">
                {queuedMessageLabel(message)}
              </p>
              {attachmentCount > 0 ? (
                <span
                  aria-label={`${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"}`}
                  className="flex shrink-0 items-center gap-1 text-muted-foreground text-xs tabular-nums"
                >
                  <PaperclipIcon aria-hidden="true" className="size-3" />
                  {attachmentCount}
                </span>
              ) : null}
              <div className="ml-1 flex shrink-0 items-center gap-1">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        aria-label="Steer queued message now"
                        disabled={isBusy}
                        onClick={() => onSteer(message.id)}
                        size="icon-xs"
                        variant="ghost"
                      />
                    }
                  >
                    <ForwardIcon aria-hidden="true" />
                  </TooltipTrigger>
                  <TooltipPopup side="top">Steer now</TooltipPopup>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        aria-label="Delete queued message"
                        disabled={isBusy}
                        onClick={() => onDelete(message.id)}
                        size="icon-xs"
                        variant="ghost"
                      />
                    }
                  >
                    <Trash2Icon aria-hidden="true" />
                  </TooltipTrigger>
                  <TooltipPopup side="top">Delete</TooltipPopup>
                </Tooltip>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
});
