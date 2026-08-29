# Organizing threads

Pin a thread from its context menu to keep it in the pinned section above your active work.
`mod+shift+p` pins or unpins the thread you have open. Pinned threads are shown independently of
their project, including when you connect to more than one environment.

To require confirmation before unpinning, enable **Settings → General → Unpin confirmation**. The
confirmation applies to the sidebar controls, thread menus, and the `mod+shift+p` shortcut.

Pinned threads still move to **Settled** when they become inactive. They also move when their pull
request merges if **Auto-settle merged threads** is enabled.

When you un-settle a thread, it returns to the top of the active list so you can find it right
away. Its timestamps do not change. Other threads keep their positions.

Right-click a pull request link in a thread and choose **Link to thread** to show that pull request
in the sidebar. The thread settles when the linked pull request merges if **Auto-settle merged
threads** is enabled. Right-click the same link and choose **Unlink from thread** to remove it.

On web and desktop, drag a pinned thread to change its position. On mobile, open the thread's menu
and choose **Move up** or **Move down**. The order is stored by the server and appears on your
other connected devices.

If reordering is unavailable for one environment, update the T3 Code server running in that
environment. Older servers can still pin and unpin threads, but do not understand synced ordering;
their pinned threads keep the default newest-first order below the ones you have arranged.

## Move a chat to another environment

When the same repository project is available on two connected environments, open a thread's menu,
choose **Move chat to…**, and select the destination. T3 Code recreates the same branch and standard
worktree name there, then moves the complete stored conversation: messages, image attachments,
plans, activity history, and checkpoint history.

Committed, staged, unstaged, and non-ignored untracked Git work is restored exactly on the other
machine. The branch is always published as `origin/<branch>`; its configured upstream is ignored,
so a feature branch cannot be pushed to its base branch by mistake. Ignored files stay in the source
checkout. Local changes and checkpoint objects travel through short-lived refs on the repository's
`origin`, which T3 Code removes after the move.

Both machines need non-interactive access to that `origin`. If the destination cannot authenticate,
the move stops with the Git error and leaves the source chat active.

The move uses the standard T3 server APIs. The complete conversation is stored as a verified,
Git-ignored history capsule in the destination checkout and remains available after reconnecting or
reloading the client. The destination thread stores new turns normally. Historical approvals, plan
actions, and checkpoint reverts are read-only after the move; the exact current files and checkpoint
Git objects still move, and new destination turns get normal checkpoints.

The source chat is archived only after the destination history and both Git states have been
verified. It remains available under Archive as a recovery copy. If the source changes during the
move or the destination copy fails verification, the source stays active (or is restored) and the
partial destination thread is archived, so no chat or work is discarded.

Provider-native session IDs cannot move between machines. The first turn on the destination receives
a bounded recent transcript as context, while the complete history remains visible in the chat.

## Environment artwork

Dev and Nightly environments can identify themselves with artwork at the top of the sidebar and in
the send button. Choose **Artwork**, **Version pill**, or **None** in Settings under environment
identification. Artwork is recolored to match each built-in theme. Custom themes use the **Version
pill** fallback because their colors are not controlled by T3 Code.

To generate a fresh title from the conversation, open a thread's context menu and choose
**Regenerate title**. While T3 Code is generating it, the action reads **Regenerating…** and cannot
be selected again. The option is hidden when the connected environment needs a server update.
