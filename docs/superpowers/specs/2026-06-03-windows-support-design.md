# Windows support for Nowtify

Date: 2026-06-03
Status: Approved design, ready for implementation planning
Branch: `feat/windows-support`

## Goal

Run Nowtify on Windows with full feature parity to the macOS build: tray +
popover, native notifications, Teams/Outlook deep-links, the screen-edge pulse
overlay, and auto-update. Today the app is macOS-only (build config, the
unsigned-update bash helper, dock APIs, and tray template images are all
Mac-coupled).

## Non-goals

- Code signing on Windows (ship unsigned for now; see Decisions).
- Linux support.
- Any change to the alerting logic, JSM/Graph clients, or data model.
- Replacing the macOS unsigned-update bash helper (it stays for Mac).

## Decisions

1. **Full feature parity**, including the screen-edge pulse overlay.
2. **GitHub Actions CI** produces all release builds. A version tag triggers a
   matrix build (macOS runner + Windows runner) that publishes both platforms
   to one GitHub Release. `workflow_dispatch` builds on-demand test artifacts
   without cutting a release. `ship.sh` slims to bump + commit + tag + push.
3. **Unsigned** on both platforms. Windows shows a one-time SmartScreen warning
   ("More info -> Run anyway"); IT can whitelist via Defender/Intune. Reversible
   later by adding a cert to CI secrets. Update integrity is still guaranteed by
   electron-updater's SHA-512 manifest check.
4. **Light platform abstraction**: a `src/main/platform.js` module owns every
   OS branch; the divergent auto-update install logic moves into a dedicated
   `src/main/updater.js`. Keeps platform branching out of the 871-line
   `index.js` and makes the pure helpers unit-testable.

## Architecture

### 1. Platform layer: `src/main/platform.js`
Single source of truth for OS differences. Pure helpers accept their inputs so
they can be unit-tested without mocking `process.platform`; thin wrappers call
the real Electron APIs.

- `isMac` / `isWin` constants (read `process.platform`).
- `resolveTrayIcon(platform, state)` -> icon path. macOS = monochrome template
  PNG; Windows = colored `.ico`. Pure.
- `protocolClientArgs(platform, execPath, argv)` -> the extra args Windows
  needs to register `nowtify://` when unpackaged (dev). Returns `[]` on mac.
  Pure.
- `lockdownFile(path)` -> `fs.chmodSync(path, 0o600)` on POSIX, no-op on
  Windows (the API token is protected by DPAPI through safeStorage regardless).
- `hideFromTaskbarOrDock()` / `showAppForDialog()` -> wrap the existing
  `app.dock` calls on mac; no-ops on Windows (taskbar suppression is handled by
  `skipTaskbar` on each window instead).

### 2. Auto-update: extract `src/main/updater.js`
Move `setupAutoUpdater` and `performUnsignedUpdate` out of `index.js` into one
module. The dialog + notification UX is shared. The install action branches:

- **macOS:** keep the bash-helper bundle swap (Squirrel.Mac refuses to install
  unsigned bundles).
- **Windows:** call `autoUpdater.quitAndInstall()`. NSIS installs unsigned
  updates natively, so no workaround is needed.

`index.js` wires the module the same way it does today (listeners + the
Settings/popover "install now" IPC handlers call into it).

### 3. Tray + taskbar
- `tray-manager.js` resolves its icon through `platform.resolveTrayIcon`.
  Windows requires a real `.ico` (template images are mac-only). The
  idle/alert/alert-dim states and the pulse loop keep working via `setImage`.
- The popover, settings, and overlay `BrowserWindow`s set `skipTaskbar: true`
  on Windows, so Nowtify stays tray-only with no taskbar button. This is the
  Windows equivalent of the macOS `LSUIElement` flag.
- Tray-click opens the popover (already handled). The macOS-only dock
  `activate` handler stays `darwin`-guarded.

### 4. Deep-link / OAuth callback (`nowtify://`)
- Register via `app.setAsDefaultProtocolClient('nowtify', execPath, argv)` using
  `platform.protocolClientArgs` so dev (unpackaged) registration works on
  Windows.
- macOS delivers the callback through the `open-url` event (unchanged). Windows
  delivers it through `process.argv`: the existing `second-instance` handler
  covers the warm path, and a new cold-start argv scan at launch covers the
  case where Windows starts the app to handle the URL.
- The Azure AD redirect URI (`nowtify://oauth/callback`) is unchanged and
  platform-agnostic.

### 5. Keychain / store
`safeStorage` already uses Windows DPAPI, so `isEncryptionAvailable()` is true
and token encryption works with no change. The only edit: route the existing
`chmod 0600` lockdown through `platform.lockdownFile` (no-op on Windows). No
data-model change.

### 6. Overlay (screen-edge pulse)
`overlay-windows.js` already creates transparent, frameless, always-on-top,
click-through windows. Windows-specific requirements, centralized in the
platform layer where they diverge:

- `backgroundColor: '#00000000'` (explicit transparent on Windows).
- `skipTaskbar: true` (keep the overlay out of Alt-Tab / taskbar).
- `alwaysOnTop: true` plain on Windows vs the macOS `'screen-saver'` level.
- `setIgnoreMouseEvents(true, { forward: true })` for click-through.

This is the highest-risk area and is flagged for dedicated hands-on testing on
real Windows hardware.

### 7. Build + CI
- `package.json` `build` gains a `win` block: `nsis` target, `icon:
  build/icon.ico`. Add a committed `build/icon.ico` (or extend
  `scripts/generate-icon.js` to emit it).
- New `.github/workflows/release.yml`:
  - Trigger: push of a `v*` tag (release) and `workflow_dispatch` (test
    artifacts, no publish).
  - Matrix: `macos-latest`, `windows-latest`.
  - Steps per runner: `npm ci` -> `npm run lint` -> `npm test` ->
    `electron-builder --publish always` for that platform (mac builds
    `--mac --universal`, win builds `--win`).
  - Auth: built-in `GITHUB_TOKEN` (release write); no PAT needed.
  - Both platforms publish to the same Release; electron-builder emits
    `latest-mac.yml` and `latest.yml` so auto-update works per platform.
- `ship.sh` slims to: optional local lint/test -> `npm version` bump -> commit
  -> create `v$VERSION` tag -> push branch + tag -> print the CI run URL. The
  local build, publish, and CDN-wait logic is removed (CI owns it).

### 8. Testing
- **Unit tests** (`node --test`) for the pure platform helpers
  (`resolveTrayIcon`, `protocolClientArgs`, and the `lockdownFile` platform
  selection) by passing `platform` explicitly.
- **Manual Windows checklist** (run on real hardware or a VM):
  1. Install from the `.exe`; confirm SmartScreen "Run anyway" works.
  2. Tray icon appears; tray-click opens the popover; no taskbar button.
  3. `nowtify://oauth/callback` round-trips back into the app (Teams connect).
  4. Native notifications fire.
  5. Screen-edge overlay pulses on a live alert and is click-through.
  6. Auto-update from a prior version installs cleanly.

## Phasing

Single release, two implementation phases so the core is validated before
chasing transparency quirks:

- **Phase 1:** platform layer, build config + CI, tray/taskbar, store,
  deep-link, updater split. Yields a working Windows build with tray + popover
  + notifications + auto-update.
- **Phase 2:** overlay (screen-edge pulse) tuning on real Windows hardware.

## Risks / open items

- **Overlay transparency + click-through** behaves differently on Windows; may
  need iteration on real hardware (mitigated by phasing + centralized flags).
- **A Windows test device is required.** CI builds the app but cannot validate
  UX; assumes an available Windows machine or VM.
- **Tray-icon pulse** currently logs a rasterize failure on macOS
  (`[tray] rasterize failed`); pre-existing and out of scope here, but worth
  verifying the Windows tray pulse path while we are in `tray-manager.js`.
