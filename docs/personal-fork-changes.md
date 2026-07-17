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

## Checkout-aware thread creation

- With New worktree selected, creating a chat from an existing worktree seeds the draft from that
  worktree's branch without reusing its path. Creating a chat for a different project still uses that
  project's main branch.
