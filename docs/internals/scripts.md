# Scripts

> For maintainers. Using T3 Code? See [docs/user](../user/).

## First checkout

T3 Code uses [Vite+](https://viteplus.dev/guide/). Install the global `vp` command, install
dependencies, then start the dev stack:

```bash
curl -fsSL https://vite.plus | bash   # Windows: irm https://vite.plus/ps1 | iex
vp i
vp run dev
```

Node 24 is required. Bun is not: the server picks Bun adapters when it detects Bun and falls back to
Node otherwise, and nothing in contributor setup needs it.

`vp run dev` prints a one-time pairing URL. Open it so the first browser navigation is
authenticated.

## Dev

- `vp run dev`: Starts contracts, server, and web in watch mode.
- `vp run dev --share`: Also publishes the web port over HTTPS on this machine's tailnet. The
  startup pairing URL is built against the shared origin, and the mapping is removed on exit.
  Shared runs default to Vite's bundled dev mode (`T3CODE_BUNDLED_DEV=1`): a remote browser pays a
  network round trip per import level in unbundled dev, which turns a cold module graph into
  minutes of waterfall. Set `T3CODE_BUNDLED_DEV=0` to opt a shared run back out.
- `vp run dev --browser`: Auto-opens a browser. Off by default. The dev runner writes
  `T3CODE_NO_BROWSER` itself from this flag, so setting `T3CODE_NO_BROWSER=0` in your environment has
  no effect; use `--browser`.
- `vp run dev:server`: Starts just the server. It runs on Node (`node --watch src/bin.ts`), so
  without Bun present it selects `NodePtyAdapter` and `NodeHttpServer`.
- `vp run dev:web`: Starts just the Vite dev server for the web app.
- `vp run dev:desktop`: Starts the Electron shell against the dev server.
- `vp run dev:marketing`: Starts the Astro marketing site.
- Pass dev-runner flags directly after the root task name, for example:
  `vp run dev --home-dir /tmp/t3code-dev`

### Dev state directories

- Dev commands run from a linked **git worktree** default to that worktree's gitignored `.t3`, even
  when `T3CODE_HOME` is set, storing state in `<worktree>/.t3/userdata`. Pass `--home-dir <path>` to
  choose another isolated directory explicitly. Submodules are not worktrees and keep the normal
  precedence.
- From the **main checkout**, dev commands implicitly use `~/.t3/dev`, keeping development state
  separate from `~/.t3/userdata`. An explicit `--home-dir <path>` stores state under
  `<path>/userdata`; the base directory remains available for caches, worktrees, and other shared
  data.

## Build, check, test

- `vp run build`: Fans out over `apps/*`, `packages/*`, `oxlint-plugin-t3code`, and `scripts`.
  Workspaces that define a build task run one: desktop, marketing, server (which depends on web), and
  web. Shared packages are consumed and bundled transitively rather than built separately.
- `vp run build:desktop`: Builds the desktop pipeline (desktop plus server).
- `vp run start`: Runs the production server (serves the built web app as static files).
- `vp check`: Vite+ format, lint, and type checks. This repo sets `typeCheck: false` in its lint
  options, so workspace type checking runs separately.
- `vp run typecheck`: Strict TypeScript checks for all packages.
- `vp run test`: Runs workspace tests.
- `vp run lint:mobile`: Mobile native static analysis (`scripts/mobile-native-static-check.ts`).
- `node apps/server/scripts/t3-sqlite-state.ts <query|exec> --base-dir <path> ...`: Inspects or seeds
  an isolated T3 SQLite database; writes create a private backup first.

## Desktop artifacts

- `vp run dist:desktop:artifact --platform <mac|linux|win> --target <target> --arch <arch>`: Builds a desktop artifact for a specific platform/target/arch.
- `vp run dist:desktop:dmg`: Builds a shareable macOS `.dmg` into `./release`. Architecture defaults
  to the host, so this produces an arm64 DMG on Apple Silicon. Use `dist:desktop:dmg:arm64` or
  `dist:desktop:dmg:x64`, or pass `--arch <arm64|x64|universal>`, to force one.
- `vp run setup:desktop:signing`: On macOS, creates or verifies the personal fork's persistent,
  machine-local signing identity. Run it once per machine; it never writes certificate material to
  the repository.
- `vp run install:desktop:arm64`: Builds a production arm64 ZIP with that identity, validates and
  installs the app in `/Applications`, and launches it. This is a standalone packaged application;
  it does not leave a development server or build process running.
- `vp run dist:desktop:linux`: Builds a Linux AppImage into `./release`.
- `vp run dist:desktop:win`: Builds a Windows NSIS installer into `./release`. `:arm64` and `:x64`
  variants exist.

### Personal-fork local signed install

The one-time setup command creates the self-signed Keychain identity
`T3 Code Fork Local Signing`. The certificate and private key remain in
the default user Keychain. Its pinned SHA-1/SHA-256 fingerprints live outside the checkout at:

```text
~/Library/Application Support/T3 Code Fork Local Signing/identity.json
```

That state file is not a credential, but it is intentionally machine-local and must not be copied
between machines. Setup is idempotent when the pinned certificate is still present. If the
certificate or private key is deleted, replaced, expired, or duplicated as a valid identity under
the same name, setup, build, and install stop with a warning. There is deliberately no automatic rotation: a new key
changes the designated requirement and causes macOS to treat the fork as a new application,
invalidating permission continuity.

After setup, `vp run install:desktop:arm64` performs this transaction:

1. Preflights the pinned Keychain certificate before doing build work.
2. Builds the production client/server/desktop app in explicit `local` signing mode and emits only
   an arm64 ZIP into a disposable directory. Release `--signed` and normal ad-hoc builds are
   unchanged.
3. Extracts the ZIP, rechecks the Keychain identity, and checks `com.t3tools.t3code.fork`, the
   complete deep signature, the leaf certificate on every Mach-O helper/framework/native binary,
   and a non-`cdhash` designated requirement constrained to the pinned certificate. macOS may emit
   that constraint as either a certificate-root clause or a hash anchor. The first valid
   requirement is pinned in the machine-local state; later builds must match it exactly.
4. Copies the validated app to a hidden transaction directory on the `/Applications` filesystem,
   validates that copy, and only then asks the running fork to quit gracefully.
5. Moves the previous app into the transaction directory, moves the new app into place, validates
   it again, and launches it. A validation or launch failure moves the new app aside, restores the
   previous app, and attempts to relaunch the previous version. If filesystem rollback itself
   fails, the transaction directory is retained and reported instead of deleting the backup.

The installer never removes signature metadata with `xattr`, never falls back to ad-hoc signing,
and never force-kills the app. A self-signed local certificate is not suitable for distribution or
Gatekeeper trust on other Macs.

To create a local-signed ZIP without installing it, run:

```bash
vp run dist:desktop:artifact --platform mac --arch arm64 --local-signed
```

Local signing accepts only the macOS ZIP target on a macOS host. `--signed` and `--local-signed`
are mutually exclusive; the environment equivalent is `T3CODE_DESKTOP_LOCAL_SIGNED=true`.

#### Permission-continuity verification

The first real `/Applications` replacement requires explicit maintainer approval. On that approved
pass:

1. Run setup, then `vp run install:desktop:arm64`, and save
   `codesign --display --requirements - "/Applications/T3 Code (Fork).app" 2>&1`.
2. Grant notification permission and exercise a protected file/folder access that appears under
   **System Settings → Privacy & Security** for `T3 Code (Fork)`.
3. Change the build input (or rebuild from a different commit), run the install command again, and
   save the designated requirement a second time.
4. Confirm the two requirements are identical and contain no `cdhash`; confirm notifications and
   the protected file/folder access still work without another prompt.
5. Use the focused tests for deletion/replacement warnings. Do not delete or replace the real
   certificate merely to test the warning, because doing so is the identity reset the workflow is
   designed to prevent.

### Linux AppImage prerequisites

Linux AppImage packaging compiles the Rust resource monitor. Install a Rust toolchain, the standard
C/C++ build tools, and ImageMagick before running `vp run dist:desktop:linux`.

Ubuntu and Debian:

```bash
sudo apt-get update
sudo apt-get install cargo rustc build-essential imagemagick
```

Fedora:

```bash
sudo dnf install rust cargo gcc gcc-c++ make ImageMagick
```

Arch Linux:

```bash
sudo pacman -S rust base-devel imagemagick
```

The artifact script checks these capabilities before starting the web and desktop builds. If
anything is unavailable, it reports every failed check together and prints the Ubuntu/Debian
installation command. The check compiles and links tiny temporary programs, so it also catches
installed runtime X11 libraries that are missing their development headers or linker symlinks.

### macOS DMG prerequisites

Install the Xcode Command Line Tools and Rust before building a DMG:

```bash
xcode-select --install
```

Install Rust from [rustup.rs](https://rustup.rs). The artifact script checks Cargo, Clang, Make,
`sips`, and `iconutil`. Universal builds additionally require `lipo`. It also verifies that Rust
has every requested target; add missing targets with:

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
```

Unsigned local builds need no Apple credentials. Builds using `--signed` additionally require the
certificate, provisioning profile, team ID, and notarization configuration described below.

### Windows installer prerequisites

Install Rust from [rustup.rs](https://rustup.rs), Python 3, and Visual Studio Build Tools. In the
Visual Studio Installer, select **Desktop development with C++** and include:

- MSVC x64/x86 build tools
- A Windows 10 or Windows 11 SDK
- MSVC Spectre-mitigated libraries

ARM64 installers require the corresponding MSVC ARM64 build tools and Spectre-mitigated libraries
instead of the x64/x86 components.

Add the Rust target matching the installer architecture:

```powershell
rustup target add x86_64-pc-windows-msvc
# For an arm64 installer:
rustup target add aarch64-pc-windows-msvc
```

Windows supplies `tar.exe`; it is checked when `--wsl-prebuild` makes the artifact include the WSL
runtime. NSIS is downloaded by electron-builder and does not need a separate installation.
When `T3CODE_DESKTOP_REUSE_RESOURCE_MONITOR=true` points the build at an existing resource monitor,
the artifact script skips the Rust and Visual Studio checks because it does not compile the monitor.
Unsigned local builds need no Azure credentials. Builds using `--signed` additionally require the
Azure Trusted Signing configuration described below.

### Desktop `.dmg` packaging notes

- Default build is unsigned/not notarized for local sharing.
- The DMG build uses `assets/prod/black-macos-1024.png` as the production app icon source.
- The DMG chrome follows the release channel: neutral for Latest and the Nightly sky artwork for
  Nightly. Blueprint artwork remains exclusive to Dev builds. Packaging rasterizes the selected
  SVG into standard and Retina PNGs inside the disposable staging directory.
- The Finder window is 540×412 while its background is 540×380; the extra 32px accounts for the
  title bar included in Finder's window bounds.
- Desktop production windows load the bundled UI from the `t3code://app/` root URL (not a
  `127.0.0.1` document URL, and not an explicit `index.html` path).
- Desktop packaging includes `apps/server/dist` (the `t3` backend) and starts it on loopback with an
  auth token for WebSocket/API traffic.
- Your tester can still open it on macOS by right-clicking the app and choosing **Open** on first
  launch.
- To keep staging files for debugging package contents, run: `vp run dist:desktop:dmg --keep-stage`
- To allow code-signing/notarization when configured in CI/secrets, add: `--signed`.
- Signed macOS builds also require `T3CODE_APPLE_TEAM_ID` and
  `T3CODE_MACOS_PROVISIONING_PROFILE`. The passkey RP domain is derived from
  `T3CODE_CLERK_PUBLISHABLE_KEY` unless `T3CODE_CLERK_PASSKEY_RP_DOMAINS` overrides it.
- Windows `--signed` uses Azure Trusted Signing and expects:
  `AZURE_TRUSTED_SIGNING_ENDPOINT`, `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME`,
  `AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME`, and `AZURE_TRUSTED_SIGNING_PUBLISHER_NAME`.
- Azure authentication env vars are also required (for example service principal with secret):
  `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`.

## Browser development

`dev` and `dev:web` leave `VITE_HTTP_URL` and `VITE_WS_URL` unset so the browser resolves the backend
from `window.location.origin`. Vite proxies `/api`, `/ws`, `/oauth`, and `/.well-known` to the
server, allowing the same bundle to work from localhost or a tailnet hostname.

## Running multiple dev instances

Worktrees derive a preferred port offset from their path.

- Default ports: server `13773`, web `5733`
- Shifted ports: `base + offset`
- Example: `T3CODE_DEV_INSTANCE=branch-a vp run dev:desktop`

Offset resolution, in order:

1. `T3CODE_PORT_OFFSET`, which must be a non-negative integer. Negative values are rejected.
2. `T3CODE_DEV_INSTANCE`. An all-digit value is used directly as the offset; any other non-empty
   value is hashed into one.
3. The worktree path hash.

Collision scanning depends on the mode. `dev:web` scans only the web port and shifts only the web
offset. `dev:server` scans only the server port. `dev` and `dev:desktop` scan both and shift them
together as one shared offset. Explicit server or dev-URL overrides remove the corresponding port
from the availability check. Treat the `[dev-runner]` output as authoritative.
