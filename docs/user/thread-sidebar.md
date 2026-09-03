# Organizing threads

Pin a thread from its context menu to keep it in the pinned section above your active work.
`mod+shift+p` pins or unpins the thread you have open. Pinned threads are shown independently of
their project, including when you connect to more than one environment.

To require confirmation before unpinning, enable **Settings → General → Unpin confirmation**. The
confirmation applies to the sidebar controls, thread menus, and the `mod+shift+p` shortcut.

Pinned threads still move to **Settled** when they become inactive. They also move when their pull
request merges if **Auto-settle merged threads** is enabled.

Each server stores its own copy of the automatic settlement settings and checks them even when no
web, desktop, or mobile client is connected. By default, it settles threads after three days without
activity and when their pull request merges. An eligible idle thread also settles when its pull
request closes. An open pull request blocks inactivity settlement. Active work, pending input, and
live background work keep the thread active. T3 Code settles from a closed or merged pull request
only when its timestamp is not older than the user's latest activity. If that timestamp is not
available, the inactivity rule still applies. A manual un-settle also keeps the thread active.

**Settled** lists threads by when their work finished, newest first. A thread you settle yourself
sorts by the moment you settled it. A thread that settled on its own sorts by its last message or
turn, not by when the server noticed it was inactive.

Change these rules in **Settings > General**. The change is written to every environment you are
connected to at that moment. An environment that is offline keeps its old value. When a connected
environment holds a different value, **Settings > General** shows a warning that names it. Choose
**Apply to all** to write your current values to every connected environment. The same applies to
the new-thread workspace mode and the source control writing style.

A settings change affects future settlement and does not reopen a settled thread. Settings saved
by older clients on one device no longer control this behavior.

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

## Panel motion

The main sidebar, right panel, and terminal drawer open and close immediately by default. Under
**Settings → Appearance → Motion**, move the **Panel animations** slider above 0 ms to add motion.
The duration can be set up to 400 ms. Clicking the preview replays all three panel transitions; at
0 ms, it snaps between the same open and closed states.

## Environment icons

When you are connected to more than one environment, every thread that lives somewhere other than
the machine you are on wears a small icon for that machine at the end of its row: a server, a cloud
VM, a desktop, a laptop, a Mac mini, or a Mac Studio. In the hosted web app and the mobile app,
where every environment is remote, each row wears its machine so you can tell them apart at a
glance. The same icon appears in the thread tooltip, the "Run on" picker, the pull request server
filter, and the environment lists under **Settings → Connections**.

Servers pick the icon themselves from the hardware they run on. A Mac reports its model, a Linux
machine reports its chassis type and whether it is a virtual machine, and anything without a usable
signal shows a generic server. To override it, open **Settings → Connections** and choose an icon
for that environment; **Automatic** goes back to what the server detected. The choice is stored on
that server, so every device that connects to it sees the same icon.

## Environment artwork

Dev and Nightly environments can identify themselves with artwork at the top of the sidebar and in
the send button. Choose **Artwork**, **Version pill**, or **None** in Settings under environment
identification. Artwork is recolored to match each built-in theme. Custom themes use the **Version
pill** fallback because their colors are not controlled by T3 Code.

To generate a fresh title from the conversation, open a thread's context menu and choose
**Regenerate title**. While T3 Code is generating it, the action reads **Regenerating…** and cannot
be selected again. The option is hidden when the connected environment needs a server update.
