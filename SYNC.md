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
