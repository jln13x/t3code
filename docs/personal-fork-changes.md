# Personal Fork Changes

The personal fork intentionally maintains only three product differences from `upstream/main`:
desktop fork identity, completion/attention sounds, and native macOS completion notifications.
Everything else follows upstream directly.

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

## Retired on 2026-08-16

The following customizations and their centralized feature flags were removed in favor of current
upstream behavior. Their migrations, contracts, settings controls, UI branches, native bridges, and
tests were removed with them.

| Retired customization                  | Historical fork behavior and retirement decision                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Projectless standalone chats           | Allowed conversations without a project, including optimistic local drafts, completion feedback, and mobile activity. The fork now uses upstream's thread model and creation flows.                                                                                                                                                                                                                           |
| Native macOS sidebar                   | Supplied the fork's denser project/worktree hierarchy, typography, empty-worktree handling, and archive actions. The fork now uses upstream's sidebar and its upstream legacy-sidebar preference.                                                                                                                                                                                                             |
| Durable completion-notification replay | Persisted an event cursor/outbox so notifications could survive renderer reloads and retry failed IPC delivery. The durable replay machinery remains retired; the maintained native notification uses the live completion transition instead.                                                                                                                                                                 |
| Sidebar worktree navigation            | Exposed worktree actions and preserved empty checkout groups in the sidebar. The fork now uses upstream navigation.                                                                                                                                                                                                                                                                                           |
| Worktree source control                | Opened a checkout-scoped staged/unstaged viewer with stage, unstage, discard, review-draft, and mixed-version compatibility behavior. The fork now uses upstream source-control surfaces.                                                                                                                                                                                                                     |
| Checkout-aware thread creation         | Preserved the exact active checkout for keyboard-created threads, reused arbitrary existing worktrees, added a searchable mobile checkout picker, resolved pull requests to worktrees, and prevented cross-project drafts from inheriting the active project's checkout. This remained a real fork difference when retired; it was removed by explicit product choice in favor of upstream creation behavior. |
| Fork-aware pull-request targeting      | Targeted the upstream repository when creating a pull request from a fork. This remained a real fork difference when retired; it was removed by explicit product choice in favor of upstream targeting.                                                                                                                                                                                                       |
| Durable pull-request status            | Persisted canonical PR identity and last-known state, retained stale state through provider failures, and refreshed through a shared rate-limited cache. The fork now uses upstream change-request discovery and status.                                                                                                                                                                                      |
| Project provider skill discovery       | Rediscovered provider skills for the active project and worktree. The fork now uses upstream provider-skill behavior.                                                                                                                                                                                                                                                                                         |
| Markdown and text attachments          | Allowed text files to be attached directly to prompts. The fork now uses upstream attachment behavior.                                                                                                                                                                                                                                                                                                        |
| Generated-image rendering              | Rendered generated image artifacts inline in chat. The fork now uses upstream artifact rendering.                                                                                                                                                                                                                                                                                                             |
| Fork backports and integration ledger  | Fork-carried upstream fixes and `docs/upstream-integrations.md` were removed after syncing to an upstream revision that contains or supersedes the applicable work. Future sync history belongs in Git and this inventory.                                                                                                                                                                                    |

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
