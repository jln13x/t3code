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
