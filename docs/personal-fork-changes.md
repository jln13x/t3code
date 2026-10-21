# Personal fork changes

The fork maintains its success sound, icon-only working status, pinned-thread idle reminders, a
distinct locally installable desktop identity, and fork CI runners. Other product behavior,
including the rest of the sidebar, follows upstream.

Reviewed against upstream `680152e27b` on 2026-10-21. The success cue, icon-only working status,
pinned-thread idle reminders, desktop identity/local signing, and fork CI runners are preserved.
Worktree grouping remains retired. The working-status customization follows upstream's extracted
sidebar row; other sidebar sections, statuses, thread actions, and permission checks stay upstream.
Pinned reminders now use upstream's shortened notification tags and window-reveal behavior, preserving
replacement of completion alerts and reliable Windows delivery. Desktop builds retain the fork
identity and local signing alongside upstream's packaging changes. The server, wire contracts, mobile
client, and other notification behavior follow upstream. The per-thread new-thread-on-branch action
still reuses its existing checkout.

## Maintained differences

### Completion sound

- Use the fork's cuelume 0.1.0 `success` cue, rendered as a static audio asset at the previous 110%
  gain. Upstream owns audio playback, completion detection, notification settings, and system alerts.
- Attention audio follows upstream. There is no second completion detector, custom audio engine,
  always-on override, native notification bridge, or offline completion queue.

### Sidebar working status and pinned-thread reminders

- Sidebar rows show only the blue working icon for a running agent: no "Working"/"Goal" text or
  elapsed time. The label stays available to screen readers. Other row statuses follow upstream.
- Pinned threads act as high priority. In a connected environment, while a pinned thread has no
  running agent or background work that can wake it and is not snoozed, archived, or open in a focused window,
  the web/desktop client repeats an idle reminder every 2.5 minutes (`PinnedThreadReminders`). It
  uses upstream's sound, toast, and system-notification settings and adds no server state, so it works
  against unmodified upstream servers. A web tab or desktop window must stay open. Mobile follows
  upstream and does not remind.

### Desktop identity and local installation

- Preserve `T3 Code (Fork)`, the orange macOS icon, `com.t3tools.t3code.fork`, and the separate
  `t3code-fork` Electron data directory. Development builds retain upstream identity and artwork.
- Keep the existing pinned, machine-local signing certificate and rollback-safe install commands
  needed for local macOS builds. No certificate or fingerprint state belongs in the repository.
- Do not install over the live app during routine development or syncs.

### Fork CI

- Preserve repository-aware GitHub-hosted runner selection in `ci.yml`. Upstream's private
  Blacksmith runners are unavailable to the fork. Keep upstream jobs and validation commands.
- `CI` is the only enabled workflow. Every other workflow is disabled in the GitHub repository
  settings (`gh workflow disable`), not in files, and keeps its upstream contents. They need
  Blacksmith, Expo, release secrets, or upstream-only integrations; enabled, they queue for 24 hours
  or do nothing useful.

## Retired on 2026-10-13

- Web/desktop sidebar worktree grouping, checkout headers, and compact active rows are removed.
  The sidebar uses upstream rows and individual thread ordering within Active, Snoozed, Settled,
  and Working when enabled, with the working-status label exception above. Mobile follows upstream.
- Grouping helpers and drag geometry overrides are removed. Existing threads, checkouts, and
  saved thread order remain intact. Future syncs must keep the rest of the sidebar upstream.

## Retired on 2026-10-07

- The leftover worktree-header hover button, "New conversation in this worktree", was removed in
  PR [#74](https://github.com/jln13x/t3code/pull/74). Creating a sibling remains available through
  a thread's upstream "New thread on [branch]" action, which carries its existing worktree path.

## Retired on 2026-09-20

- Cross-environment chat transfer, Git snapshot transport, imported-history overlays, and transfer
  actions are removed. No user data or previously transferred checkout files are deleted.
- Checkout-wide lifecycle actions, shared terminals/previews/files/diffs, the previous sidebar
  typography and status markers, custom archive/Undo controls, and `chat.newInWorktree` are removed.
  The compact row layout retained then was retired on 2026-10-13; the current icon-only working
  status is described above.
- Always-on completion/attention detection, the cuelume dependency/volume patch, and native macOS
  completion delivery/acknowledgement/reconnect queues are replaced by upstream notification handling.
  System notifications require upstream settings and permission, appear while the app is unfocused,
  and do not replay completions missed during a disconnection.
- Remote-editor protocol-handler discovery and the browser Zed fallback are removed. Upstream owns
  Zed SSH links, the `zeditor` alias, and editor discovery outside PATH.
- The preview instant-scroll click patch and incidental fork-only code cleanups are removed.
- The fork server and wire API follow upstream; the checkout terminal archive cleanup override is gone.

## Retired on 2026-09-06

- Codex active-turn steering, structured `$skill` invocation, and unknown-skill rejection now follow
  upstream behavior. The fork no longer sends native `turn/steer` requests or interprets ordinary
  shell variables as mandatory skill invocations.
- The project-scoped `server.listProviderSkills` RPC and its contracts, registry hooks, and client
  query are removed. Web, desktop, and mobile use upstream workspace snapshots for skill menus.
- Do not restore these provider overrides during syncs. Upstream Codex turn handling and workspace
  discovery are authoritative, including their future changes. The upstream Queue/Steer follow-up
  preference and send-now shortcut use upstream's message queue and provider dispatch; they do not
  restore the retired fork queues or Codex steering override.

## Retired on 2026-08-18

| Customization              | Retirement                                                                                                                                                                                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Active-turn message queues | PR [#28](https://github.com/jln13x/t3code/pull/28) briefly added a durable server queue, and [#35](https://github.com/jln13x/t3code/pull/35) replaced it with a client-local web queue. Both queues are retired. Active-turn sends follow upstream behavior; native Codex steering was retired on 2026-09-06. |

## Retired on 2026-08-16

The following customizations and their centralized feature flags were removed in favor of current
upstream behavior. Their migrations, contracts, settings controls, UI branches, native bridges, and
tests were removed with them.

| Retired customization                 | Historical fork behavior and retirement decision                                                                                                                                                                                                                                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Projectless standalone chats          | Allowed conversations without a project, including optimistic local drafts, completion feedback, and mobile activity. The fork now uses upstream's thread model and creation flows.                                                                                                                                                 |
| Native macOS sidebar                  | Supplied the fork's denser project/worktree hierarchy, typography, empty-worktree handling, and archive actions. The fork now uses upstream's sidebar and its upstream legacy-sidebar preference.                                                                                                                                   |
| Server event replay for notifications | Replayed raw orchestration events through a fork-only RPC. It was replaced by client-local snapshot detection, which was itself retired on 2026-09-20 in favor of upstream notifications.                                                                                                                                           |
| Sidebar worktree navigation           | The former native-style project/worktree hierarchy exposed checkout actions and preserved empty checkout groups. That hierarchy remains retired. The narrower grouping within upstream sidebar sections was also retired on 2026-10-13.                                                                                             |
| Worktree source control               | Opened a checkout-scoped staged/unstaged viewer with stage, unstage, discard, review-draft, and mixed-version compatibility behavior. The fork uses upstream source-control surfaces.                                                                                                                                               |
| Checkout-aware thread creation        | The broad implementation reused arbitrary existing worktrees, added a searchable mobile picker, resolved pull requests to worktrees, and changed cross-project draft inheritance. Those behaviors remain retired. The remaining `chat.newInWorktree` command was retired on 2026-09-20; sibling creation now uses upstream actions. |
| Fork-aware pull-request targeting     | Targeted the upstream repository when creating a pull request from a fork. This remained a real fork difference when retired; it was removed by explicit product choice in favor of upstream targeting.                                                                                                                             |
| Durable pull-request status           | Persisted canonical PR identity and last-known state, retained stale state through provider failures, and refreshed through a shared rate-limited cache. The fork now uses upstream change-request discovery and status.                                                                                                            |
| Markdown and text attachments         | Allowed text files to be attached directly to prompts. The fork now uses upstream attachment behavior.                                                                                                                                                                                                                              |
| Generated-image rendering             | Rendered generated image artifacts inline in chat. The fork now uses upstream artifact rendering.                                                                                                                                                                                                                                   |
| Fork backports and integration ledger | Fork-carried upstream fixes and `docs/upstream-integrations.md` were removed after syncing to an upstream revision that contains or supersedes the applicable work. Future sync history belongs in Git and this inventory.                                                                                                          |

## Earlier retirements

- Fork-specific draft retry ID reminting: retired after upstream added bootstrap-deletion-scoped
  thread ID rotation that preserves the draft while avoiding unnecessary rotation for unrelated
  failures.
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
