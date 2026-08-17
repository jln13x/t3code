# Personal Fork Changes

The personal fork intentionally maintains seven product differences from `upstream/main`: desktop
fork identity, completion/attention sounds, native macOS completion notifications,
worktree-grouped web/desktop threads, cross-environment branch continuation, and Codex skill
handling, plus a client-local active-turn message queue. Everything else follows upstream directly.

This file is both the current inventory and the retirement record used during upstream syncs.

## Maintained differences

### Desktop fork identity

- Packaged desktop builds use the `T3 Code (Fork)` product name and
  `com.t3tools.t3code.fork` application identity.
- macOS packages use the orange fork icon for latest and nightly builds. Development builds retain
  upstream's development identity and artwork.
- The packaged fork stores Electron data in `t3code-fork`, separate from upstream's `t3code`
  directory, so both applications can coexist.
- Identity is a build-time distinction, not a runtime feature flag. A runtime switch would not
  safely change OS registration, package identity, or storage paths.

### Completion and attention sounds

- A `success` cue plays when a thread's latest turn transitions to completed. Its gain is 110% of
  the sound library's default.
- A `bloom` cue plays when a thread begins waiting for user input or approval.
- Existing completed or attention-waiting threads establish a silent baseline when the app loads,
  so opening the app does not replay old cues.
- Both cues are always enabled. There is no fork feature flag or app preference for sounds.
- The fork patches `cuelume@0.1.0` to accept an optional per-play volume multiplier.

### Native macOS completion notifications

- When a live thread transitions to completed, the desktop host posts a silent native macOS
  notification titled `Thread finished` with the thread title as its body. The app's completion
  sound remains the only audio cue.
- Clicking the notification reveals the desktop window and opens the exact environment-scoped
  thread.
- The Electron bridge reports whether macOS acknowledged the notification and retains the native
  notification object until it is clicked, closed, or fails.
- Notifications are always enabled when Electron and macOS report support. Notification permission
  and presentation remain controlled by macOS System Settings; there is no fork feature flag.
- Detection intentionally shares the renderer's live completion transition. It does not restore the
  retired event-replay cursor or durable notification outbox.

### Worktree-grouped threads and checkout resources

- Unpinned active threads that share the same Git worktree, or the same project's main checkout,
  render in one sidebar card. Settled siblings stay hidden while that card has active work, and
  snoozed and fully settled checkouts collapse to one shelf row per checkout.
- Opening or multi-selecting a conversation highlights only that conversation's inner row; the
  surrounding checkout card adds no selection or hover fill, so it stays visually neutral and does
  not imply checkout-wide scope.
- Each inner conversation row exposes its own archive action on hover or keyboard focus. It uses the
  existing archive confirmation preference and remains unavailable while that conversation runs.
  A temporary success toast offers Undo through the existing unarchive path.
- A newly completed, unvisited conversation uses a brighter, stronger title until the conversation
  opens; ordinary idle siblings recede slightly without adding a completion icon or row tint.
- Pinned threads intentionally retain upstream's dedicated pinned block and drag ordering. This is
  the compatibility boundary that keeps upstream pinning behavior intact instead of replacing it
  with a fork-specific group-order model.
- Each conversation keeps independent messages and agent state, while terminal sessions, terminal
  layout, preview tabs, open-file state, and Git diff state use a canonical checkout identity.
- Checkout-level terminal and dev-server indicators appear on the grouped card. Removing one thread
  preserves shared resources while siblings remain; removing the final sibling performs cleanup.
- Settle, snooze, wake, and un-settle actions expand from a selected grouped thread to the checkout's
  member threads. Search results, drafts, archive/delete, copying, title regeneration, provider
  badges, durable PR display state, and project filtering continue to follow upstream behavior.
- `chat.newInWorktree` creates a sibling conversation in the current checkout and defaults to
  `mod+t`. This is a narrow explicit command; the retired arbitrary-worktree picker, mobile checkout
  flow, PR-to-worktree resolution, and cross-project checkout inheritance remain retired.
- The behavior is always enabled on web/desktop and has no fork feature flag or app preference.
- Sync boundary: grouping helpers live in `SidebarV2.logic.ts`, checkout resource identity lives in
  `worktreeScope.ts` and `packages/shared/src/worktreeResource.ts`, and the upstream sidebar is
  extended rather than replaced. Future merges must preserve upstream search, drafts, pinning and
  reorder, lifecycle/context-menu actions, provider badges, shelf persistence, and PR snapshots.

### Codex project skills and explicit invocation

- Codex skill discovery follows the active project or worktree instead of only the server process
  directory, so the composer shows workspace-local skills alongside personal skills.
- Explicit `$skill-name` tokens are sent to Codex as structured skill inputs while the original
  prompt text remains intact.
- Unknown explicit skill names fail visibly instead of silently becoming plain prompt text.
  Path-like shell variables such as `$HOME/.config` remain ordinary text.
- Source candidates: upstream [#5335](https://github.com/pingdotgg/t3code/pull/5335) for
  workspace-aware discovery and [#7196](https://github.com/pingdotgg/t3code/pull/7196) for
  structured invocation and token matching.
- Fork implementation: [jln13x/t3code#28](https://github.com/jln13x/t3code/pull/28).
- Sync boundary: preserve the project-scoped `providerSkills` RPC path through contracts, server
  registry, client runtime, and composer queries. In `CodexSessionRuntime`, skill binding stays on
  the `turn/start` path.

### Cross-environment branch continuation

- A web/desktop thread can start a new draft for the same logical project on another connected
  environment while carrying only its Git branch, not its conversation.
- The destination fetches `origin` and checks out that exact branch on first send. An existing
  checkout of the branch is reused, including the project's primary checkout.
- If destination bootstrap fails after consuming its event-sourced thread identity, retry keeps the
  draft and branch intent but mints a fresh thread identity.
- Fork implementation: [jln13x/t3code#31](https://github.com/jln13x/t3code/pull/31).
- Sync boundary: the menu and destination resolution stay in the upstream sidebar, while the draft
  handoff context and bootstrap behavior remain narrow additions to composer state and turn start.

### Client-local active-turn message queue

- Web and desktop hold messages submitted during an active turn in the current browser client and
  show them in a queue attached directly above the composer. The queue is kept out of the
  conversation timeline.
- The primary composer action adds to the queue. Each queued item can be submitted immediately
  through the existing `thread.turn.start` path or deleted. When the active turn becomes ready, the
  client submits the next queued item automatically.
- This queue intentionally has no server contract, database migration, projection, or provider
  adapter customization. It is not persisted across a reload, shared with other clients, or drained
  while the relevant client is closed. Immediate mid-turn submission retains upstream provider
  behavior and is not guaranteed to use Codex's native `turn/steer` protocol.
- Source candidates: upstream [#7240](https://github.com/pingdotgg/t3code/pull/7240) informed the
  queue UX and [#5795](https://github.com/pingdotgg/t3code/pull/5795) documented the native Codex
  steering distinction. Neither server implementation is carried by this fork.
- Fork implementation: [jln13x/t3code#35](https://github.com/jln13x/t3code/pull/35).
- Sync boundary: the queue state stays in `clientTurnQueueStore.ts`; `ChatView` owns enqueue and
  dispatch, and `QueuedMessageTray` owns the two per-item controls. Preserve upstream orchestration,
  persistence, wire contracts, provider adapters, and mobile behavior.

## Retired on 2026-08-16

The following customizations and their centralized feature flags were removed in favor of current
upstream behavior. Their migrations, contracts, settings controls, UI branches, native bridges, and
tests were removed with them.

| Retired customization                  | Historical fork behavior and retirement decision                                                                                                                                                                                                                                                                                  |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Projectless standalone chats           | Allowed conversations without a project, including optimistic local drafts, completion feedback, and mobile activity. The fork now uses upstream's thread model and creation flows.                                                                                                                                               |
| Native macOS sidebar                   | Supplied the fork's denser project/worktree hierarchy, typography, empty-worktree handling, and archive actions. The fork now uses upstream's sidebar and its upstream legacy-sidebar preference.                                                                                                                                 |
| Durable completion-notification replay | Persisted an event cursor/outbox so notifications could survive renderer reloads and retry failed IPC delivery. The durable replay machinery remains retired; the maintained native notification uses the live completion transition instead.                                                                                     |
| Sidebar worktree navigation            | The former native-style project/worktree hierarchy exposed checkout actions and preserved empty checkout groups. That hierarchy remains retired. The maintained grouping is narrower: it groups live threads by checkout inside the upstream sidebar and does not restore empty checkout navigation.                              |
| Worktree source control                | Opened a checkout-scoped staged/unstaged viewer with stage, unstage, discard, review-draft, and mixed-version compatibility behavior. The fork now uses upstream source-control surfaces.                                                                                                                                         |
| Checkout-aware thread creation         | The broad implementation reused arbitrary existing worktrees, added a searchable mobile picker, resolved pull requests to worktrees, and changed cross-project draft inheritance. Those behaviors remain retired. Grouping now carries only the explicit web/desktop `chat.newInWorktree` sibling-thread command described above. |
| Fork-aware pull-request targeting      | Targeted the upstream repository when creating a pull request from a fork. This remained a real fork difference when retired; it was removed by explicit product choice in favor of upstream targeting.                                                                                                                           |
| Durable pull-request status            | Persisted canonical PR identity and last-known state, retained stale state through provider failures, and refreshed through a shared rate-limited cache. The fork now uses upstream change-request discovery and status.                                                                                                          |
| Durable server turn queue and steering | PR [#28](https://github.com/jln13x/t3code/pull/28) briefly added queued-turn persistence, projections, migrations, cross-client commands, and explicit Codex `turn/steer`. Those server changes were removed; the maintained queue is intentionally client-local and uses the existing turn-start command.                        |
| Markdown and text attachments          | Allowed text files to be attached directly to prompts. The fork now uses upstream attachment behavior.                                                                                                                                                                                                                            |
| Generated-image rendering              | Rendered generated image artifacts inline in chat. The fork now uses upstream artifact rendering.                                                                                                                                                                                                                                 |
| Fork backports and integration ledger  | Fork-carried upstream fixes and `docs/upstream-integrations.md` were removed after syncing to an upstream revision that contains or supersedes the applicable work. Future sync history belongs in Git and this inventory.                                                                                                        |

## Earlier retirements

- Working-change diff workflow (`enablePersonalDiffWorkflow`): retired after upstream adopted
  working-tree-first diff selection and active-worktree scoping.
- Periodic client-side branch-ref revalidation: retired after upstream added generation-aware
  refresh retries and server-side ref snapshot invalidation for Git mutations.
- The fork's `@pierre/diffs` beta 9 editor-identity compatibility patch: retired after beta 10
  exposed the editor file state required by the upstream implementation.
- Fork-local project file/content search and `enableProjectSearch`: retired after upstream shipped
  unified project search overlays, file picking, content search, and `projectSearch.toggle`.
- The fork's `SidebarV2` split and beta toggle: retired after upstream promoted that sidebar to the
  default implementation.
