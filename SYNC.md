# Personal fork sync

- Read [docs/personal-fork-changes.md](docs/personal-fork-changes.md) before syncing.
- Work on a task branch. Never reset, rebase, or develop directly on `personal`.
- Merge current `pingdotgg/t3code` main, then reconcile only sidebar worktree grouping,
  the completion sound asset, desktop identity/local signing, and fork CI runners.
- Keep upstream sidebar rows, thread actions, search, drafts, pinning, ordering, provider/model
  icons, shelf persistence, and PR state. Group independently within Active, Snoozed, and Settled.
  A conversation action must never expand to its worktree siblings.
- Keep server behavior, wire contracts, resources, notification delivery, and settings upstream.
- Update the inventory when upstream replaces a customization. Do not restore retired features.
- Run `vp check`, `vp run typecheck`, and focused grouping, notification, and desktop identity tests.
  Run `vp run lint:mobile` if the sync changes native mobile code.
- Only `CI` runs on the fork; every other workflow is disabled in GitHub, not in files. Keep
  upstream workflow files unedited, except the repository-aware `runs-on` lines in `ci.yml`.
  - Disabled state belongs to the workflow file path, so upstream edits never re-enable it. A new or
    renamed upstream workflow starts enabled and may already run on the sync PR itself. After the
    sync merges, run `gh workflow list -R jln13x/t3code --all`, disable every active workflow except
    `CI` and GitHub's `Dependency Graph`, and cancel their runs still queued on the sync PR.
  - If upstream adds a `ci.yml` job on a `blacksmith-*` runner, it stays queued for 24 hours on the
    fork. Give it the same `github.repository == 'pingdotgg/t3code' && … || 'ubuntu-24.04'`
    selection (`macos-26` for macOS jobs).
- Publish or open a PR only when requested. Do not replace an installed app as part of a code sync.

## Local macOS install

Retain the existing bundle ID, data directory, and pinned signing identity so upgrading the fork
preserves local app identity and permissions. When a local build/install is requested:

```bash
vp run setup:desktop:signing # once per Mac
vp run install:desktop:arm64
```

Follow the signing and rollback checks in `docs/internals/scripts.md`. The first replacement of an
installed app requires explicit approval. Report validation, replacement, and launch results.
