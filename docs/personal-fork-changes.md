# Personal Fork Changes

The personal fork intentionally maintains six product differences from `upstream/main`: desktop
fork identity, completion/attention sounds, native macOS completion notifications,
worktree-grouped web/desktop threads, cross-environment chat transfer, and Codex skill
and active-turn handling. Everything else follows upstream directly.

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
- Personal-fork maintainers can create one persistent self-signed Keychain certificate and use the
  explicit local signing mode. Its fingerprints and first validated designated requirement are
  pinned in machine-local state outside the repository; missing, changed, and ambiguous identities
  fail instead of falling back to ad-hoc signing. The requirement accepts macOS's equivalent
  certificate-root and hash-anchor syntax only when it constrains the pinned certificate.
- `install:desktop:arm64` builds a production ZIP, verifies the stable bundle/signing identity of
  the app and all nested native code, and uses a rollback-safe `/Applications` replacement. It
  passes certificate extraction prefixes as attached `codesign` option values for compatibility
  with the macOS command-line parser. It remains local maintainer tooling: release signing,
  unsigned artifacts, wire contracts, and app runtime behavior are unchanged.
- Sync boundary: preserve the three signing modes and the local setup/validation/install scripts.
  Never commit the local certificate or its fingerprint state, and never turn the local identity
  into a distribution credential.

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
- The renderer keeps a per-environment completion ledger and pending-delivery queue in local
  storage. A VPS completion that lands while its connection is unavailable is delivered when the
  environment reconnects; the first snapshot on a new installation remains a silent baseline.
- Notifications are always enabled when Electron and macOS report support. Notification permission
  and presentation remain controlled by macOS System Settings; there is no fork feature flag.
- Detection uses the existing shell snapshots and does not add a server RPC or wire-contract fork.

### Worktree-grouped threads and checkout resources

- Unpinned active threads that share the same Git worktree, or the same project's main checkout,
  render in one sidebar card. Settled siblings stay hidden while that card has active work, and
  snoozed and fully settled checkouts collapse to one shelf row per checkout.
- Opening or multi-selecting a conversation highlights only that conversation's inner row; the
  surrounding checkout card adds no selection or hover fill, so it stays visually neutral and does
  not imply checkout-wide scope.
- Each settled inner conversation row exposes its own archive action on hover or keyboard focus. It
  uses the existing archive confirmation preference; running rows keep their status indicator and
  do not expose the archive action.
  A temporary success toast offers Undo through the existing unarchive path.
- Checkout headers show identity and shared resource icons, not aggregate lifecycle labels such as
  Done, Woke, Approval, Input, or Failed. The project name recedes behind the branch, and checkout
  actions appear only while the header itself is hovered or keyboard-focused. Each conversation
  owns one compact right-edge status slot: working and monitoring use blue activity, approval and
  input share an amber attention icon, failure uses a red alert, a thread that is still snoozed uses
  a blue clock, and a newly completed unread conversation uses an orange dot. Read completions and
  threads returning from snooze have no persistent marker. The newly completed conversation keeps
  its brighter, stronger title until it opens; ordinary idle siblings recede slightly without
  adding a row tint.
- Conversation typography has two states: finished-unread, focused, and multi-selected titles are
  medium at full foreground; every other title is normal and muted. Working, monitoring, snoozed,
  approval, input, and failure keep their status markers without changing title typography or
  dimming the parent checkout.
- Active pinned threads retain upstream's dedicated pinned block and drag ordering. Settled and
  snoozed pinned threads follow upstream into their lifecycle sections, keep a visible pin marker,
  and participate in the fork's checkout grouping there. This compatibility boundary keeps
  upstream pinning behavior intact instead of replacing it with a fork-specific group-order model.
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

### Codex project skills, explicit invocation, and active-turn steering

- Codex skill discovery follows the active project or worktree instead of only the server process
  directory, so the composer shows workspace-local skills alongside personal skills.
- Explicit `$skill-name` tokens are sent to Codex as structured skill inputs while the original
  prompt text remains intact.
- Unknown explicit skill names fail visibly instead of silently becoming plain prompt text.
  Path-like shell variables such as `$HOME/.config` remain ordinary text.
- A message sent during an active Codex turn uses native `turn/steer` instead of a second
  `turn/start`. The start response ID remains authoritative for steering, interrupting, and emitted
  lifecycle events even when an earlier `turn/started` notification names a different review turn.
- Source candidates: upstream [#5335](https://github.com/pingdotgg/t3code/pull/5335) for
  workspace-aware discovery and [#7196](https://github.com/pingdotgg/t3code/pull/7196) for
  structured invocation and token matching. Upstream [#5795](https://github.com/pingdotgg/t3code/pull/5795)
  is the adapter-only steering candidate; it remains open.
- Fork implementation: [jln13x/t3code#28](https://github.com/jln13x/t3code/pull/28).
- Sync boundary: preserve the project-scoped `providerSkills` RPC path through contracts, server
  registry, client runtime, and composer queries. In `CodexSessionRuntime`, skill binding stays
  shared by `turn/start` and `turn/steer`; the start-response ID handoff must remain available until
  the queued `turn/started` notification is projected.

### Cross-environment chat transfer

- On web/desktop, **Move chat to…** transfers an idle thread to a connected environment that has the
  same canonical repository project. It creates an ordinary destination thread with the source
  title, model (or a destination fallback), runtime/interaction modes, branch, and worktree. The
  complete source snapshot remains visible ahead of future destination-native turns, including
  message timestamps, image attachments, plans, activities, and checkpoint metadata.
- The client captures the source HEAD, index, and non-ignored worktree as separate temporary Git
  trees. It pushes those trees, the exact local branch as `origin/<branch>`, and checkpoint objects
  through operation-scoped remote refs. The destination creates or reuses the branch's normal
  worktree, rejects unrelated existing changes or checkpoint refs, and restores committed, staged,
  unstaged, and non-ignored untracked state exactly. Source and destination Git state are verified
  before the source lifecycle changes. Temporary local, tracking, and remote refs are cleaned on
  success and bounded failure paths. Hidden terminal Git commands disable Git, Credential Manager,
  and SSH askpass prompts. A destination without usable credentials fails with its terminal error
  instead of waiting on an invisible prompt.
- The implementation uses only unmodified upstream server operations. It pages the stock thread
  snapshot API where supported, downloads every referenced image once, and writes a versioned
  history capsule through the stock project-file RPC. Capsules live in the destination checkout at
  `.t3/chat-transfers/<destination-thread-id>/`, are split below the upstream one-megabyte read
  limit, SHA-256 verified after writing, and excluded through the repository's local Git exclude
  file. The web client loads and verifies the capsule after reload, then overlays later native
  destination events by ID.
- A move never deletes the source. After the capsule, destination thread, and both Git states pass
  integrity checks, the client archives the source as a recoverable backup. It reads the source
  again after archiving and compares a content fingerprint that ignores only archive lifecycle
  timestamps. A detected race restores the source and archives the destination copy.
- Provider-native sessions are not portable across machines. The first destination-native turn gets
  a provider-neutral, bounded recent transcript; the complete imported transcript remains stored and
  visible in the client. The context envelope is retained by the ordinary destination thread for
  future provider resumes but stripped from the rendered user message. Historical source approvals,
  plan actions, and checkpoint reverts stay read-only because their database IDs are not present on
  the destination server; new destination-native history remains fully interactive.
- Fork implementation: [jln13x/t3code#31](https://github.com/jln13x/t3code/pull/31), corrected
  to the client-only boundary in [#38](https://github.com/jln13x/t3code/pull/38), then updated to
  publish by local branch name in [#39](https://github.com/jln13x/t3code/pull/39) and fetch only the
  exact destination branch in [#40](https://github.com/jln13x/t3code/pull/40).
  Destination checkout failures are made bounded and visible in
  [#45](https://github.com/jln13x/t3code/pull/45).
- Sync boundary: keep the action, history capsule, context overlay, integrity checks, and Git
  transport in `apps/web`. Preserve upstream contracts, `apps/server`, client-runtime command
  unions, and server databases unchanged.

## Retired on 2026-08-18

| Customization              | Retirement                                                                                                                                                                                                                                                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Active-turn message queues | PR [#28](https://github.com/jln13x/t3code/pull/28) briefly added a durable server queue, and [#35](https://github.com/jln13x/t3code/pull/35) replaced it with a client-local web queue. Both queues are retired. Active-turn sends now submit immediately through the existing turn-start path, including native Codex steering. |

## Retired on 2026-08-16

The following customizations and their centralized feature flags were removed in favor of current
upstream behavior. Their migrations, contracts, settings controls, UI branches, native bridges, and
tests were removed with them.

| Retired customization                 | Historical fork behavior and retirement decision                                                                                                                                                                                                                                                                                  |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Projectless standalone chats          | Allowed conversations without a project, including optimistic local drafts, completion feedback, and mobile activity. The fork now uses upstream's thread model and creation flows.                                                                                                                                               |
| Native macOS sidebar                  | Supplied the fork's denser project/worktree hierarchy, typography, empty-worktree handling, and archive actions. The fork now uses upstream's sidebar and its upstream legacy-sidebar preference.                                                                                                                                 |
| Server event replay for notifications | Replayed raw orchestration events through a fork-only RPC. The maintained notification now compares standard shell snapshots against client-local state, so remote servers need no fork behavior.                                                                                                                                 |
| Sidebar worktree navigation           | The former native-style project/worktree hierarchy exposed checkout actions and preserved empty checkout groups. That hierarchy remains retired. The maintained grouping is narrower: it groups live threads by checkout inside the upstream sidebar and does not restore empty checkout navigation.                              |
| Worktree source control               | Opened a checkout-scoped staged/unstaged viewer with stage, unstage, discard, review-draft, and mixed-version compatibility behavior. The fork now uses upstream source-control surfaces.                                                                                                                                         |
| Checkout-aware thread creation        | The broad implementation reused arbitrary existing worktrees, added a searchable mobile picker, resolved pull requests to worktrees, and changed cross-project draft inheritance. Those behaviors remain retired. Grouping now carries only the explicit web/desktop `chat.newInWorktree` sibling-thread command described above. |
| Fork-aware pull-request targeting     | Targeted the upstream repository when creating a pull request from a fork. This remained a real fork difference when retired; it was removed by explicit product choice in favor of upstream targeting.                                                                                                                           |
| Durable pull-request status           | Persisted canonical PR identity and last-known state, retained stale state through provider failures, and refreshed through a shared rate-limited cache. The fork now uses upstream change-request discovery and status.                                                                                                          |
| Markdown and text attachments         | Allowed text files to be attached directly to prompts. The fork now uses upstream attachment behavior.                                                                                                                                                                                                                            |
| Generated-image rendering             | Rendered generated image artifacts inline in chat. The fork now uses upstream artifact rendering.                                                                                                                                                                                                                                 |
| Fork backports and integration ledger | Fork-carried upstream fixes and `docs/upstream-integrations.md` were removed after syncing to an upstream revision that contains or supersedes the applicable work. Future sync history belongs in Git and this inventory.                                                                                                        |

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
