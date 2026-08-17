# Message composer

Messages can contain up to 120,000 characters. If a draft is longer, T3 Code keeps it in the
composer and shows how many characters need to be removed. Shorten the draft or split it into
multiple messages, then send again in the same thread.

While an agent is working, the primary send action queues the message to run after the active turn.
Pending messages appear in a queue above the composer. Use the arrow button on a queued message to
**Steer now**, sending that message to the active Codex turn immediately, or use the trash button to
delete it. Server-queued messages survive client disconnects and remain available until they start
or you delete them. Mobile offers the same controls on each queued message.

If the server restarts during the narrow handoff to a provider, T3 Code reports the delivery as
interrupted instead of replaying it automatically, because the provider may already have received
the message. Check the provider transcript before resending it.
