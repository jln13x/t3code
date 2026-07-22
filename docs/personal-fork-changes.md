# Personal Fork Changes

Turning a flag off preserves upstream behavior.

| Feature                            | Flag                                 | Default |
| ---------------------------------- | ------------------------------------ | ------- |
| Projectless standalone chats       | `enableStandaloneChats`              | On      |
| Native macOS sidebar               | `enableNativeMacSidebar`             | On      |
| macOS completion notifications     | `enableMacosCompletionNotifications` | On      |
| Sidebar worktree navigation        | `enableSidebarWorktreeNavigation`    | On      |
| Worktree source control            | `enableWorktreeSourceControl`        | On      |
| Checkout-aware thread creation     | `enableCheckoutAwareThreadCreation`  | On      |
| Completion and attention sounds    | `enableCompletionSounds`             | On      |
| Fork-aware pull requests           | `enableForkPullRequests`             | On      |
| Durable pull request status        | `enableDurableChangeRequestStatus`   | On      |
| Project provider skill discovery   | `enableProviderSkillDiscovery`       | On      |
| Markdown and text file attachments | `enableTextFileAttachments`          | On      |
| Inline generated-image rendering   | `enableGeneratedImageRendering`      | On      |
| Project file and content search    | `enableProjectSearch`                | On      |

Upstream PRs integrated into the fork are listed in
[Upstream Integrations](./upstream-integrations.md).

## Retired customizations

- Working-change diff workflow (`enablePersonalDiffWorkflow`): retired after upstream adopted
  working-tree-first diff selection and active-worktree scoping. The redundant feature flag and
  settings control were removed.

## Desktop fork identity

- Packaged desktop builds use the `T3 Code (Fork)` product name and
  `com.t3tools.t3code.fork` application identity.
- macOS packages use the orange fork icon for both latest and nightly builds, while development
  builds keep the upstream development identity and icon.
- The packaged fork uses its own `t3code-fork` Electron user-data directory and can coexist with
  the upstream macOS application. This build-time identity is intentionally not a runtime feature
  flag because changing it after packaging would break OS-level app registration and data paths.

## Checkout-aware thread creation

- On mobile, the new-task workspace control opens a searchable checkout picker. Existing checkouts
  are reused, branches that are not checked out create a worktree, and a pull request URL/number can
  be resolved into an isolated worktree. Turning off the flag restores the compact upstream
  workspace menu.
- With New worktree selected, creating a chat from an existing worktree seeds the draft from that
  worktree's branch without reusing its path. Creating a chat for a different project still uses that
  project's main branch.
- Cmd+N from an active chat preserves that chat's checkout mode, branch, and worktree path. From
  outside a chat it continues to use the configured project defaults.
- With sidebar worktree navigation enabled, right-clicking a worktree label opens an actions menu
  for starting a chat in that checkout or renaming its branch.

## Worktree source control

- With worktree source control enabled, selecting a sidebar worktree opens a checkout-scoped
  source control surface instead of creating a chat. The surface separates staged and unstaged
  files, renders the selected diff, and exposes file-level stage, unstage, and confirmed discard
  actions. Selecting diff lines adds comments to an isolated review draft, so opening the viewer
  does not retarget an existing chat. Pending comments remain visible in a review tray and merge
  into the project's reusable draft only after Continue in chat, preserving the selected checkout's
  branch and worktree path. New chats remain available from the worktree row action and context
  menu.
- Disabling the flag restores the previous worktree-label behavior, where selecting the label
  immediately creates a chat in that checkout.

## Durable pull request status

- Threads created from a resolved pull request persist its provider, number, URL, refs, and
  last-known display state. Sidebar status refreshes query that canonical identity instead of
  rediscovering historical pull requests from a reused branch name.
- A persisted pull request remains visible when a thread no longer has a branch. It refreshes by
  canonical identity when repository context is available and otherwise renders the stored state
  as last-known; inferred pull requests still require an exact checked-out branch match.
- The sidebar keeps the compact icon-only treatment: open is green, merged is purple, and closed
  is muted gray. Provider failures retain the latest cached result and mark last-known fallback
  metadata as stale instead of making the icon disappear.
- Background change-request polling has a sustained budget of 30 provider requests per minute, a
  burst limit of 10, and at most four concurrent provider calls. It is shared by canonical
  provider/URL/number identity across worktrees. Open results refresh at most once per minute,
  closed and merged results use progressively longer cache windows, and provider failures back off
  exponentially up to 15 minutes. Throttled or failed inferred lookups preserve the last successful
  icon as stale instead of clearing it, but only while the inferred branch identity still matches.
- GitHub durable refreshes use the repository-qualified pull request URL to derive the target
  repository, so a shared cache entry cannot be populated from an unrelated checkout that happens
  to contain the same pull request number.
- Turning the flag off preserves branch-name discovery and does not attach new pull request
  associations to threads.

## Projectless standalone chats

- Creating a standalone chat opens a local draft immediately, matching project-thread creation;
  the server thread is materialized atomically with the first message instead of blocking
  navigation on an empty-thread request.
- Standalone chats participate in the same desktop completion sounds and macOS notifications as
  project threads. When agent-activity publishing is enabled, they also publish completion and
  attention states to connected mobile clients under the generic `Chats` activity group.

## Native macOS sidebar

- Inactive thread titles are regular weight and subdued. The focused thread, multi-selected
  threads, and newly completed threads use a medium, bold-ish weight and full emphasis. Hovering an
  inactive thread keeps that hierarchy intact.
- Project titles use regular weight and remain subdued until one of their threads has an unseen
  completion. Worktree labels remain quieter than inactive thread titles so conversation names
  carry more visual weight.
- Light mode uses dark, regular-weight conversation text with progressively softer project and
  worktree context. Worktree labels use the same 14px size as thread titles instead of appearing
  disabled or undersized.
- Worktrees use compact branch headers with subtly inset conversation rows, keeping each checkout
  visually distinct without repeating its branch on every thread. Worktree labels omit redundant
  thread counts. Empty worktrees remain standalone rows so they are still available for new-chat
  and archive actions. Turning off the native sidebar flag restores the upstream grouped layout
  and counts.
- The native layout omits the generic "No threads yet" row. It hides the redundant main-checkout
  label when no other checkout is shown, but restores a "Main checkout" header when multiple
  checkout groups need a visible boundary. Actionable worktree rows use a pointer cursor. Turning
  the flag off restores upstream labels.
- With sidebar worktree navigation enabled, worktree groups remain visible after their last thread
  is archived. Archiving the last thread requires confirmation and leaves the checkout and its Git
  registration intact. Worktree rows do not show inline archive buttons; every non-main worktree
  keeps the explicit worktree-archive action in its context menu, which deletes the checkout and its
  Git registration.

## macOS completion notifications and sounds

- With macOS completion notifications enabled, the Electron host posts a native, silent macOS
  notification whenever a project thread or standalone chat transitions to completed. Clicking it
  reveals the app and opens the exact environment-scoped conversation. Web and non-macOS runtimes
  retain upstream behavior.
- The synthesized completion cue plays at 110% of its original gain; attention cues retain their
  original gain. Disabling completion sounds preserves the upstream silent behavior.
