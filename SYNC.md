# Personal fork sync

When asked to sync or rebuild the personal fork, run this checklist end-to-end.

## Sync

- `origin/main` mirrors `upstream/main`; `personal` is the long-lived fork branch.
- Read [docs/personal-fork-changes.md](docs/personal-fork-changes.md) before resolving conflicts. Keep
  every listed customization, its centralized flag and default, and upstream behavior when disabled.
- If upstream replaces or makes a customization obsolete, update the inventory instead of silently
  dropping it.
- Never reset, rebase, or develop features directly on `personal`.

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

Resolve merge conflicts in favor of the documented fork behavior, then rerun the checks. Test both
flag states for affected customizations.

## Rebuild the macOS app

Only when requested; do not start a development server.

```bash
set -euo pipefail
ARCH=$([ "$(uname -m)" = arm64 ] && echo arm64 || echo x64)
bun run "dist:desktop:dmg:$ARCH"

DMG=$(ls -t release/T3-Code-*-$ARCH.dmg | head -1)
VOL=$(hdiutil attach "$DMG" -nobrowse | sed -n 's|^.*	\(/Volumes/.*\)$|\1|p' | tail -1)
SOURCE_APP="$VOL/T3 Code (Fork).app"
test -d "$SOURCE_APP"

rm -rf "/Applications/T3 Code (Fork).app"
ditto "$SOURCE_APP" "/Applications/T3 Code (Fork).app"
xattr -cr "/Applications/T3 Code (Fork).app"
hdiutil detach "$VOL"
open -a "T3 Code (Fork)"
```

Report the DMG path and whether the app launched.
