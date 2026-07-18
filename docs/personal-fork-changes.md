# Personal Fork Changes

Turning a flag off preserves upstream behavior.

| Feature                            | Flag                                | Default |
| ---------------------------------- | ----------------------------------- | ------- |
| Projectless standalone chats       | `enableStandaloneChats`             | On      |
| Native macOS sidebar               | `enableNativeMacSidebar`            | On      |
| Sidebar worktree navigation        | `enableSidebarWorktreeNavigation`   | On      |
| Checkout-aware thread creation     | `enableCheckoutAwareThreadCreation` | On      |
| Completion and attention sounds    | `enableCompletionSounds`            | On      |
| Fork-aware pull requests           | `enableForkPullRequests`            | On      |
| Project provider skill discovery   | `enableProviderSkillDiscovery`      | On      |
| Markdown and text file attachments | `enableTextFileAttachments`         | On      |
| Inline generated-image rendering   | `enableGeneratedImageRendering`     | On      |
| Project file and content search    | `enableProjectSearch`               | On      |
| Working-change diff workflow       | `enablePersonalDiffWorkflow`        | On      |

## Desktop fork identity

- Packaged desktop builds use the `T3 Code (Fork)` product name and
  `com.t3tools.t3code.fork` application identity.
- macOS packages use the orange fork icon for both latest and nightly builds, while development
  builds keep the upstream development identity and icon.
- The packaged fork uses its own `t3code-fork` Electron user-data directory and can coexist with
  the upstream macOS application. This build-time identity is intentionally not a runtime feature
  flag because changing it after packaging would break OS-level app registration and data paths.

## Checkout-aware thread creation

- With New worktree selected, creating a chat from an existing worktree seeds the draft from that
  worktree's branch without reusing its path. Creating a chat for a different project still uses that
  project's main branch.
- Cmd+N from an active chat preserves that chat's checkout mode, branch, and worktree path. From
  outside a chat it continues to use the configured project defaults.
- With sidebar worktree navigation enabled, right-clicking a worktree label opens an actions menu
  for starting a chat in that checkout or renaming its branch.

## Native macOS sidebar

- Inactive thread titles are subdued so the focused thread and newly completed threads retain the
  strongest visual emphasis. Hovering an inactive thread keeps that hierarchy intact.
- Project titles use regular weight and remain subdued until one of their threads has an unseen
  completion. Worktree labels remain quieter than inactive thread titles so conversation names
  carry more visual weight.
- Light mode uses dark, regular-weight conversation text with progressively softer project and
  worktree context. Worktree labels use the same 14px size as thread titles instead of appearing
  disabled or undersized.
- Populated worktrees use compact, branch-prefixed thread rows instead of separate group headers.
  Conversation rows use a taller click target, and standalone worktree rows include a branch icon.
  Worktree labels omit redundant thread counts. Empty worktrees remain standalone rows so they are
  still available for new-chat and archive actions. Turning off the native sidebar flag restores
  the upstream grouped layout and counts.
- The native layout omits the generic "No threads yet" row and the redundant main-checkout label;
  main-checkout threads render as plain conversation titles. Actionable worktree rows use a pointer
  cursor. Turning the flag off restores those upstream labels.
- With sidebar worktree navigation enabled, worktree groups remain visible after their last thread
  is archived. Archiving the last thread requires confirmation and leaves the checkout and its Git
  registration intact. Worktree rows do not show inline archive buttons; every non-main worktree
  keeps the explicit worktree-archive action in its context menu, which deletes the checkout and its
  Git registration.
