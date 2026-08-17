# Message composer

Messages can contain up to 120,000 characters. If a draft is longer, T3 Code keeps it in the
composer and shows how many characters need to be removed. Shorten the draft or split it into
multiple messages, then send again in the same thread.

While an agent is working, the primary send action queues the message to run after the active turn.
Use **Steer** when the message should reach the active Codex turn immediately instead. On mobile,
expand the composer to see both actions. Server-queued messages remain visible in the thread and
can be cancelled before they start, even if the client disconnects.

If the server restarts during the narrow handoff to a provider, T3 Code reports the delivery as
interrupted instead of replaying it automatically, because the provider may already have received
the message. Check the provider transcript before resending it.
