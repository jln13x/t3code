# Personal fork sync

When asked to sync or rebuild the personal fork, run this checklist end-to-end.

## Sync

- `origin/main` mirrors `upstream/main`; `personal` is the long-lived fork branch.
- Read [docs/personal-fork-changes.md](docs/personal-fork-changes.md) before resolving conflicts.
  Preserve only the maintained desktop identity, completion/attention sounds, and native macOS
  completion notifications, plus the documented local signed-install workflow, worktree grouping,
  and checkout-resource boundary.
- If upstream replaces or makes a customization obsolete, update the inventory instead of silently
  dropping it.
- Do not restore retired customizations or fork feature flags during conflict resolution.
- Never reset, rebase, or develop features directly on `personal`.
- Never resolve `apps/web/src/components/Sidebar.tsx` wholesale as ours or theirs. Start from the
  current upstream sidebar and reapply/reconcile only the documented grouping boundary. Verify that
  upstream search, drafts, pinned-thread ordering, context-menu actions, provider badges, persisted
  shelves, and PR snapshot behavior are still present before committing a sync.

Start with a clean working tree, then:

```bash
git fetch origin
git fetch upstream
git push origin upstream/main:main --force-with-lease

git checkout personal
git merge --no-edit upstream/main

vp check
vp run typecheck
# Also run `vp run lint:mobile` if native mobile code changed.
git push origin personal
```

Resolve merge conflicts at the narrow boundaries documented in the inventory, then rerun the
checks. Run the focused worktree grouping/resource tests, and verify completion sounds and macOS
notifications from a live completion transition.

## Rebuild the macOS app

Only when requested; do not start a development server. Run the setup command once on a new Mac.
Do not run the install command for the first `/Applications` replacement until the maintainer has
explicitly approved that replacement.

```bash
vp run setup:desktop:signing
vp run install:desktop:arm64
```

Report the validated designated requirement, whether an existing app was replaced, and whether the
new app launched. Follow the permission-continuity checklist in `docs/internals/scripts.md` for the
first two separately built installs.
