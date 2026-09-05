# Working with threads

Use a new thread for a separate task. Choose **New worktree** when its code changes
need a separate branch and working directory.

## Start a thread

On web and desktop, a new thread keeps the current project and carries your model
and mode selections, unless the destination project has its own model default.
Its branch and workspace mode come from your configured defaults. To continue in
an existing worktree, use **New thread in this worktree** from the branch toolbar.

When you change a new thread's project, T3 Code stays in the current environment
if that project exists there. Otherwise it selects an environment that has it.

### Start in the background

In a desktop browser or the desktop app, press `Cmd+Enter` on macOS or `Ctrl+Enter`
on Windows and Linux to start a new thread and immediately open another draft. The
next draft keeps the workspace mode and base branch you selected. With **New
worktree**, each background submission creates its own worktree.

## Pin and reorder threads

Pin a thread from its menu to keep it above your active work. Drag pinned threads
to reorder them on web and desktop, or use **Move up** and **Move down** on mobile.
The order syncs across devices.

Pinning does not prevent automatic settlement. Settling a thread removes its pin.

## Settle finished work

Choose **Settle thread** from its menu to move finished work out of the active list
without deleting the conversation. **Un-settle thread** restores it to active work
and prevents automatic settlement until new activity resumes the usual rules.

By default, environments settle inactive threads after three days and settle
threads whose pull request merged. A closed pull request can also settle an idle
thread. Work in progress, pending questions or approvals, and live background work
prevent automatic settlement. An open pull request does not prevent inactivity
settlement, but an old closed or merged pull request does not settle work you
resumed after it closed.

Change these rules in **Settings → General**. They continue to run when your apps
are closed. Changes apply to connected environments that support shared settings;
offline environments and older servers keep their previous values. If connected
environments disagree, **Apply to all** copies your current settings to those named
in the warning. Changing a rule does not reopen already settled threads.

## Move a chat to another environment

When the same repository project is available on two connected environments, open a thread's menu,
choose **Move chat to…**, and select the destination. T3 Code recreates the same branch and standard
worktree name there, then transfers the complete stored conversation, including messages, image
attachments, plans, activity history, and checkpoint history.

Committed, staged, unstaged, and non-ignored untracked Git work is restored exactly on the other
machine. The branch is published as `origin/<branch>`; its configured upstream is ignored. Ignored
files stay in the source checkout. Both machines need non-interactive access to that `origin`.

The complete conversation is stored as a verified, Git-ignored history capsule in the destination
checkout and remains available after reconnecting or reloading. Historical approvals, plan actions,
and checkpoint reverts are read-only there; new destination turns remain fully interactive.

The source chat is archived only after the destination history and both Git states have been
verified, and it remains available under Archive as a recovery copy. If verification fails or the
source changes during the move, the source stays active or is restored and the partial destination
thread is archived.

Provider-native session IDs cannot move between machines. The first destination turn receives a
bounded recent transcript as context while the complete imported history remains visible.

## Link a pull request

On web and desktop, right-click a pull request link in a thread and choose
**Link to thread**. Use **Unlink from thread** on the same link to remove it.
The linked pull request participates in automatic settlement.

## Find and reference work

On web and desktop, open the command palette with `Cmd/Ctrl+K` to search threads
across connected environments. Message search starts after two characters and
includes your messages and final agent responses.

Use **Settings → Keybindings** to find or customize shortcuts for searching files
and copying a thread reference. A copied reference uses the thread's pull request
link when available, otherwise its thread ID. See [keybindings](./keybindings.md)
for custom configuration.

## Inspect agent work

On web and desktop, use **Agents** to follow work delegated to subagents.

Expand a tool call in the conversation to see its full command and output.
Summaries shorten shell wrappers and can still describe the latest call after it
finishes; the call's own result shows its status.
