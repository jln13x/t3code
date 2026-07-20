# Upstream Integrations

This is the provenance ledger for changes brought from
[`pingdotgg/t3code`](https://github.com/pingdotgg/t3code) into the personal fork. Record the exact
upstream revision, local adaptation, and verification whenever this worktree integrates an upstream
pull request.

## Remote-agent deployment profile

The primary deployment is a T3 server running on a VPS and reached directly over Tailscale. It does
not use Android and does not currently depend on the hosted T3 Connect relay.

That makes long-lived server memory, reconnect/catch-up behavior, remote history loading, and
background VPS process load the highest-priority upstream areas. T3 Connect and mobile-only changes
remain part of normal upstream syncs, but are not reasons to selectively port an open pull request.

## 2026-07-20 upstream sync

- Merged `upstream/main` at `5d34f9ff235115d43a6cb4b4561d10badf218b87` into the fork baseline
  `09860ea2b7c377c82e46fdf05bed46abce138d2e`.
- Preserved the fork's desktop identity, native macOS sidebar presentation, checkout-aware thread
  creation, worktree grouping, file-drag mentions, and Codex project-skill discovery.
- Adopted upstream's working-change diff defaults and retired the now-redundant
  `enablePersonalDiffWorkflow` flag. The fork's worktree-aware diff root and cache invalidation remain
  active.
- Relevant remote-agent improvements arriving through this baseline include headless T3 Connect
  setup ([#3749](https://github.com/pingdotgg/t3code/pull/3749)), lightweight connection probes
  ([#4137](https://github.com/pingdotgg/t3code/pull/4137)), and faster new-chat/offline catch-up
  ([#4177](https://github.com/pingdotgg/t3code/pull/4177)). Of these, #4137 and #4177 directly benefit
  direct Tailscale connections; #3749 is available but is not required by the current deployment.

## Selectively integrated open pull requests

### Priority 1: remote history pagination — #4018

- Source: [fix(web): paginate large thread history for remote clients
  #4018](https://github.com/pingdotgg/t3code/pull/4018), head
  `de8fd65934768173819b93adcd6b92af3e8c7fc3`.
- Why: bounds initial activity reads and lets the web client fetch older conversation history on
  demand. This reduces VPS heap pressure and remote reconnect payload size for long-running threads.
- Local adaptation: retained the newer upstream draft-hero/composer layout and fed its context meter
  the merged paginated-plus-live activity set. The fork's empty-draft presentation remains intact.
- Verification: projection pagination, reducer merging/deduplication, and timeline auto-load tests.

### Priority 2: bounded long-lived state — #4176

- Source: [perf(orchestration): bound in-memory read model and client per-thread state
  #4176](https://github.com/pingdotgg/t3code/pull/4176), head
  `56b6615afdfe3804a466e33cbab9056b8981f217`.
- Why: caps orchestration read-model growth and removes browser, preview, VCS broadcaster, and UI
  state when threads are deleted. This protects a continuously running VPS from memory growth tied
  to lifetime thread count.
- Local adaptation: none; the upstream commit applied cleanly after the main sync.
- Verification: command read-model, deletion cleanup, projector, VCS broadcaster, and client-store
  regression tests supplied by the pull request.

### Priority 3: lower background Git and port polling — #4187

- Source: [Reduce background Git ref and port polling
  #4187](https://github.com/pingdotgg/t3code/pull/4187), head
  `5b816e5fce668d361ec417431535fb9500c51cb1`.
- Why: reduces idle Git-ref refreshes and system-wide port scans on the VPS while preserving immediate
  refreshes when selectors open or managed terminal processes change.
- Local adaptation: integrated as a squash because the pull-request branch contains merge history;
  omitted its branch-local `BRANCH_DETAILS.md` in favor of this ledger.
- Verification: port-scanner replay, ordering, retention, and redundant-scan regression tests.

All three pull requests were still open at integration time. On later upstream syncs, compare their
final merged commits against these recorded heads before dropping or resolving duplicate patches.

## Integration checklist

1. Fetch `upstream/main` and the candidate pull-request head.
2. Record the pull-request URL, exact head SHA, priority, and deployment rationale here.
3. Prefer the final net diff when a pull-request branch contains merge commits; preserve upstream
   commits directly when their history is clean.
4. Resolve against current fork behavior at the narrowest boundary and update
   `personal-fork-changes.md` for preserved, replaced, or retired customizations.
5. Run focused regression tests plus `vp check` and `vp run typecheck`. Run native-mobile lint when an
   upstream sync changes native mobile code.
