# Windows Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Nowtify on Windows with full feature parity to macOS (tray + popover, notifications, deep-links, screen-edge overlay, auto-update), built and published via GitHub Actions CI, unsigned.

**Architecture:** A `src/main/platform.js` module centralizes every OS branch behind pure, testable helpers. The divergent auto-update install logic moves into `src/main/updater.js` (macOS bash-helper vs Windows NSIS `quitAndInstall`). Existing files call into the platform layer instead of inlining `process.platform` checks. CI builds both platforms on a version tag.

**Tech Stack:** Electron 33, electron-builder 25, electron-updater, `node --test`, GitHub Actions.

**Reference spec:** `docs/superpowers/specs/2026-06-03-windows-support-design.md`

**Phasing:** Phase 1 (Tasks 1-9) yields a working Windows build with tray + popover + notifications + auto-update. Phase 2 (Tasks 10-11) tunes the screen-edge overlay on real Windows hardware. Each task ends in a commit.

---

## Phase 1: Core Windows build

### Task 1: Platform abstraction module + tests

**Files:**
- Create: `src/main/platform.js`
- Test: `test/platform.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/platform.test.js
const { test, describe } = require('node:test');
const assert = require('node:assert');
const { trayIconSpec, trayStateColor, protocolClientArgs, shouldLockdownFile } = require('../src/main/platform');

describe('trayIconSpec', () => {
  test('windows uses colored png per state, never template', () => {
    assert.deepEqual(trayIconSpec('win32', 'idle'), { dir: 'win', file: 'idle.png', template: false });
    assert.deepEqual(trayIconSpec('win32', 'alerting'), { dir: 'win', file: 'alert.png', template: false });
    assert.deepEqual(trayIconSpec('win32', 'snoozed'), { dir: 'win', file: 'snoozed.png', template: false });
    assert.deepEqual(trayIconSpec('win32', 'paused'), { dir: 'win', file: 'paused.png', template: false });
  });
  test('macOS uses template pngs for idle/paused, colored for snoozed/alert', () => {
    assert.deepEqual(trayIconSpec('darwin', 'idle'), { dir: '.', file: 'idle.png', template: true });
    assert.deepEqual(trayIconSpec('darwin', 'paused'), { dir: '.', file: 'paused.png', template: true });
    assert.deepEqual(trayIconSpec('darwin', 'snoozed'), { dir: '.', file: 'snoozed.png', template: false });
    assert.deepEqual(trayIconSpec('darwin', 'alerting'), { dir: '.', file: 'alert.png', template: false });
  });
  test('unknown status falls back to idle', () => {
    assert.equal(trayIconSpec('win32', 'bogus').file, 'idle.png');
  });
});

describe('protocolClientArgs', () => {
  test('macOS needs no extra args', () => {
    assert.deepEqual(protocolClientArgs('darwin', '/Apps/Nowtify', ['/Apps/Nowtify']), []);
  });
  test('windows packaged needs no extra args', () => {
    assert.deepEqual(protocolClientArgs('win32', 'C:/App/Nowtify.exe', ['C:/App/Nowtify.exe'], true), []);
  });
  test('windows dev (unpackaged) passes execPath + resolved script path', () => {
    const args = protocolClientArgs('win32', 'C:/electron.exe', ['C:/electron.exe', '.'], false);
    assert.deepEqual(args, ['C:/electron.exe', ['.']]);
  });
});

describe('shouldLockdownFile', () => {
  test('true on posix, false on windows', () => {
    assert.equal(shouldLockdownFile('darwin'), true);
    assert.equal(shouldLockdownFile('linux'), true);
    assert.equal(shouldLockdownFile('win32'), false);
  });
});

describe('trayStateColor', () => {
  test('alerting uses the live trigger color, falling back to red', () => {
    assert.equal(trayStateColor('alerting', '#a855f7'), '#a855f7');
    assert.equal(trayStateColor('alerting', null), '#dc2626');
  });
  test('steady states use fixed hues', () => {
    assert.equal(trayStateColor('snoozed'), '#fbbf24');
    assert.equal(trayStateColor('paused'), '#6b7280');
    assert.equal(trayStateColor('idle'), '#9aa0aa');
    assert.equal(trayStateColor('bogus'), '#9aa0aa');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/platform.test.js`
Expected: FAIL with "Cannot find module '../src/main/platform'".

- [ ] **Step 3: Write `src/main/platform.js`**

```js
// src/main/platform.js
//
// Single source of truth for OS differences. Pure helpers take `platform`
// (and other inputs) explicitly so they can be unit-tested without mocking
// process.platform; thin wrappers at the bottom apply the real values.
const fs = require('fs');

const PLATFORM = process.platform;
const isMac = PLATFORM === 'darwin';
const isWin = PLATFORM === 'win32';

const STATUS_TO_BASENAME = {
  alerting: 'alert',
  snoozed: 'snoozed',
  paused: 'paused',
  idle: 'idle',
};

// Which tray icon file + template flag to use. macOS uses monochrome
// template PNGs for idle/paused (the menu bar tints them); Windows has no
// template concept and a dark taskbar, so it uses colored PNGs in a `win`
// subdir for every state. Returns a relative dir ('.' = the tray root).
function trayIconSpec(platform, status) {
  const base = STATUS_TO_BASENAME[status] || 'idle';
  if (platform === 'win32') {
    return { dir: 'win', file: `${base}.png`, template: false };
  }
  const template = base === 'idle' || base === 'paused';
  return { dir: '.', file: `${base}.png`, template };
}

// Fill color for the tray mark in a given state. Alerting uses the live
// trigger color (so the menu bar / taskbar shows WHICH trigger fired);
// the steady states use fixed hues. Used by the rasterizer on both
// platforms (and by Windows for every state, since it can't tint templates).
function trayStateColor(status, alertColor) {
  if (status === 'alerting') return alertColor || '#dc2626';
  if (status === 'snoozed') return '#fbbf24';
  if (status === 'paused') return '#6b7280';
  return '#9aa0aa'; // idle
}

// The args app.setAsDefaultProtocolClient needs. Packaged apps (any OS) just
// register the scheme. Unpackaged Windows (dev) must pass execPath + the
// resolved entry script so the OS relaunches electron with our app, not a
// bare electron prompt. Returns [] when no extra args are needed, otherwise
// [execPath, [args...]] ready to spread into setAsDefaultProtocolClient.
function protocolClientArgs(platform, execPath, argv, isPackaged = true) {
  if (platform === 'win32' && !isPackaged) {
    return [execPath, [argv[1]]];
  }
  return [];
}

// chmod 0600 only matters on POSIX; on Windows the token is protected by
// DPAPI via safeStorage and chmod is a no-op anyway.
function shouldLockdownFile(platform) {
  return platform !== 'win32';
}

function lockdownFile(filePath) {
  if (!shouldLockdownFile(PLATFORM)) return;
  try {
    fs.chmodSync(filePath, 0o600);
  } catch (err) {
    console.warn('[platform] chmod 600 failed on', filePath, err.message);
  }
}

module.exports = {
  isMac,
  isWin,
  trayIconSpec,
  trayStateColor,
  protocolClientArgs,
  shouldLockdownFile,
  lockdownFile,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/platform.test.js`
Expected: PASS (all assertions).

- [ ] **Step 5: Run lint + full suite**

Run: `npm run lint && npm test`
Expected: 0 errors; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/main/platform.js test/platform.test.js
git commit -m "feat(platform): add OS abstraction layer with tray/protocol/lockdown helpers"
```

---

### Task 2: Route store lockdown through the platform layer

**Files:**
- Modify: `src/main/store.js` (the `lockdownConfigFile` function near line 113)

- [ ] **Step 1: Replace the lockdown implementation**

In `src/main/store.js`, add the import near the top (after the existing requires):

```js
const platform = require('./platform');
```

Replace the body of `lockdownConfigFile`:

```js
function lockdownConfigFile() {
  platform.lockdownFile(store.path);
}
```

(Leave every call site of `lockdownConfigFile()` unchanged.)

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: PASS (existing store-dependent tests unaffected; lockdown is a no-op in test env).

- [ ] **Step 3: Commit**

```bash
git add src/main/store.js
git commit -m "refactor(store): route config-file lockdown through platform layer (no-op on Windows)"
```

---

### Task 3: Generate Windows tray fallback icons

Windows can't tint template PNGs, so it needs visible colored icons. The
runtime rasterizer (Task 4) is the *primary* source of the colored, pulsing
Windows tray icon; these 4 static PNGs are the *fallback* shown on the first
tick (before the first rasterize resolves) or if rasterization ever fails on a
given machine, so the tray is never blank.

**Files:**
- Create: `scripts/generate-win-tray.js`
- Create (generated output, committed): `assets/tray/win/idle.png`, `assets/tray/win/alert.png`, `assets/tray/win/snoozed.png`, `assets/tray/win/paused.png`

- [ ] **Step 1: Write the generator script**

```js
// scripts/generate-win-tray.js
//
// One-shot: rasterizes the 3-bar Nowtify mark in 4 state colors to PNGs for
// the Windows system tray. Run with `electron scripts/generate-win-tray.js`,
// then commit assets/tray/win/*.png. Windows tray icons are static per state
// (no per-trigger color pulse in phase 1).
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, nativeImage } = require('electron');

const OUT_DIR = path.join(__dirname, '..', 'assets', 'tray', 'win');
const STATES = {
  idle: '#9aa0aa',
  alert: '#dc2626',
  snoozed: '#fbbf24',
  paused: '#6b7280',
};

function svg(color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 22 22">`
    + `<rect x="5" y="5.0" width="12" height="2.5" rx="1.25" fill="${color}"/>`
    + `<rect x="3.5" y="9.0" width="15" height="3.0" rx="1.50" fill="${color}"/>`
    + `<rect x="2" y="13.5" width="18" height="3.5" rx="1.75" fill="${color}"/>`
    + `</svg>`;
}

async function rasterize(win, color, size) {
  win.setBounds({ x: 0, y: 0, width: size, height: size });
  const html = `<!doctype html><html><head><style>
    html,body{margin:0;padding:0;background:transparent;width:${size}px;height:${size}px;}
    img{display:block;width:${size}px;height:${size}px;}
    </style></head><body>
    <img src="data:image/svg+xml;base64,${Buffer.from(svg(color)).toString('base64')}">
    </body></html>`;
  await win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'));
  await new Promise((r) => setTimeout(r, 120));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  return img.resize({ width: size, height: size, quality: 'best' });
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const win = new BrowserWindow({
    width: 64, height: 64, show: false, transparent: true, frame: false,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true },
  });
  for (const [state, color] of Object.entries(STATES)) {
    const img = await rasterize(win, color, 32);
    fs.writeFileSync(path.join(OUT_DIR, `${state}.png`), img.toPNG());
    console.log('wrote', state, img.getSize());
  }
  app.quit();
});
```

- [ ] **Step 2: Generate the assets**

Run: `npx electron scripts/generate-win-tray.js`
Expected: console prints `wrote idle ...` etc.; 4 PNGs appear in `assets/tray/win/`.

- [ ] **Step 3: Verify the files exist and are non-empty**

Run: `ls -la assets/tray/win/ && file assets/tray/win/*.png`
Expected: four `PNG image data, 32 x 32` files.

- [ ] **Step 4: Commit**

```bash
git add scripts/generate-win-tray.js assets/tray/win/
git commit -m "build(tray): static Windows tray fallback icons"
```

---

### Task 4: Cross-platform rasterizer + Windows tray wiring

Make the SVG rasterizer the primary tray-icon source on **both** platforms,
size-aware (Mac 22/44 retina, Windows 16/32), and fix the shared-offscreen-
window race that produces the intermittent `ERR_ABORTED` (the two size renders
currently run via `Promise.all` against one window and abort each other). On
Windows, every state gets a colored rasterized icon (pulsing on alert); the
Task 3 static PNGs are the fallback until the first render lands or if a render
fails.

**Files:**
- Modify: `src/main/tray-manager.js` (rasterizer functions, cache, `iconFor`, and add the platform import + a fallback loader)

- [ ] **Step 1: Add the platform import + a static fallback loader**

At the top of `src/main/tray-manager.js`, after the existing requires:

```js
const platform = require('./platform');

const MAC_SIZES = [22, 44];
const WIN_SIZES = [16, 32];
```

Add a method on `TrayManager` (next to the existing `loadTrayIcon`) that loads
the platform-correct static fallback file via `trayIconSpec`:

```js
  loadFallbackIcon(status) {
    const spec = platform.trayIconSpec(process.platform, status);
    const key = `fallback:${spec.dir}/${spec.file}:${spec.template ? 't' : 'c'}`;
    if (this.iconCache[key]) return this.iconCache[key];
    const file = path.join(TRAY_DIR, spec.dir, spec.file);
    const img = nativeImage.createFromPath(file);
    if (!img.isEmpty() && spec.template) img.setTemplateImage(true);
    this.iconCache[key] = img;
    return img;
  }
```

- [ ] **Step 2: Generalize + harden the rasterizer (size-aware, serialized)**

Replace `buildColoredAlertImage(color, alpha)` with a size-aware version that
renders the sizes **sequentially** (not `Promise.all`) so the two loads don't
abort each other on the shared offscreen window:

```js
// Render the colored mark at the given sizes into one multi-rep NativeImage.
// Sizes are rendered SEQUENTIALLY on purpose: both share the single offscreen
// rasterizer window, and overlapping loadURL calls abort each other (the
// source of the intermittent "[tray] rasterize failed ... ERR_ABORTED"). The
// scaleFactor for each rep is its size relative to the base (first) size.
async function buildColoredStateImage(color, alpha, sizes) {
  const finalAlpha = alpha >= 1 ? 1 : 0.5;
  const svg = buildAlertSVG(color, finalAlpha);
  const base = sizes[0];
  const final = nativeImage.createEmpty();
  for (const px of sizes) {
    const img = await rasterizeSVGToExactPx(svg, px);
    final.addRepresentation({
      scaleFactor: px / base,
      dataURL: 'data:image/png;base64,' + img.toPNG().toString('base64'),
    });
  }
  return final;
}
```

Replace the `alertImageCache` / `alertRasterizing` / `ensureAlertImagesForColor`
trio with a size-aware generalization (keyed by color + size-set so Mac and
Windows entries coexist):

```js
const stateImageCache = new Map(); // `${color}@${sizes}` -> { full, dim }
const stateRasterizing = new Set();
const stateCacheKey = (color, sizes) => `${color}@${sizes.join('x')}`;

function ensureStateImagesForColor(color, sizes, onReady) {
  const key = stateCacheKey(color, sizes);
  if (stateImageCache.has(key)) {
    if (onReady) onReady();
    return;
  }
  if (stateRasterizing.has(key)) return;
  stateRasterizing.add(key);
  (async () => {
    try {
      const full = await buildColoredStateImage(color, 1, sizes);
      const dim = await buildColoredStateImage(color, 0.4, sizes);
      if (!full.isEmpty()) {
        stateImageCache.set(key, { full, dim });
        if (onReady) onReady();
      } else {
        console.warn('[tray] rasterize produced empty image for', key);
      }
    } catch (e) {
      console.warn('[tray] rasterize failed for', key, e && e.message);
    } finally {
      stateRasterizing.delete(key);
    }
  })();
}
```

- [ ] **Step 3: Point the macOS alerting path at the generalized cache**

In `iconFor`, inside the existing `state.status === 'alerting'` branch, replace
the `alertImageCache.get(state.color)` lookup and the
`ensureAlertImagesForColor(state.color, ...)` call with the generalized
equivalents using `MAC_SIZES` (behaviour identical, just routed through the new
cache):

```js
        const cached = stateImageCache.get(stateCacheKey(state.color, MAC_SIZES));
        if (cached) {
          return frame === 0 ? cached.full : cached.dim;
        }
        ensureStateImagesForColor(state.color, MAC_SIZES, () => {
          if (this.tray && !this.tray.isDestroyed()) {
            const s = this.getState ? this.getState() : null;
            if (s && s.status === 'alerting') {
              this.tray.setImage(this.iconFor(s, this.pulseFrame));
            }
          }
        });
```

(The rest of the macOS body - template idle/paused PNGs, named-image fallback -
stays unchanged.)

- [ ] **Step 4: Add the Windows branch to `iconFor`**

At the very top of the `iconFor(state, frame = 0)` body, before the macOS
logic, add: rasterize every state in its `trayStateColor`, pulse via full/dim,
and fall back to the static PNG until the first render lands.

```js
    if (platform.isWin) {
      const status = state.status || 'idle';
      const color = platform.trayStateColor(status, state.color);
      const cached = stateImageCache.get(stateCacheKey(color, WIN_SIZES));
      if (cached) {
        this._lastWinIcon = frame === 0 ? cached.full : cached.dim;
        return this._lastWinIcon;
      }
      ensureStateImagesForColor(color, WIN_SIZES, () => {
        if (this.tray && !this.tray.isDestroyed()) {
          const s = this.getState ? this.getState() : { status };
          this.tray.setImage(this.iconFor(s, this.pulseFrame));
        }
      });
      // Until the first render resolves (or if it fails), show the static
      // fallback PNG, then the last good rasterized icon, then empty.
      const fallback = this.loadFallbackIcon(status);
      if (fallback && !fallback.isEmpty()) return fallback;
      return this._lastWinIcon || nativeImage.createEmpty();
    }
```

Note: `setState` already starts the pulse loop only when `status === 'alerting'`,
so on Windows the alert icon pulses (full/dim) and the steady states render a
solid colored icon - full parity with macOS.

- [ ] **Step 5: macOS smoke test (no regression + race gone)**

Run: `npm run dev`, then trigger/observe an alert.
Expected: tray pulses in the trigger color exactly as before, AND the
`[tray] rasterize failed ... ERR_ABORTED` line no longer appears in the logs
(sequential rendering removed the self-collision). Quit.

- [ ] **Step 6: Run lint + tests**

Run: `npm run lint && npm test`
Expected: 0 errors; all pass.

- [ ] **Step 7: Commit**

```bash
git add src/main/tray-manager.js
git commit -m "feat(tray): cross-platform rasterized icons + serialized render (fixes ERR_ABORTED); Windows parity"
```

---

### Task 5: Protocol registration + cold-start deep-link on Windows

**Files:**
- Modify: `src/main/index.js` (the `setAsDefaultProtocolClient` call near line 144; add a cold-start argv scan)

- [ ] **Step 1: Add platform import**

In `src/main/index.js`, with the other `./` requires (near the `links` import):

```js
const platform = require('./platform');
```

- [ ] **Step 2: Register the protocol with Windows dev args**

Replace the single line `app.setAsDefaultProtocolClient('nowtify');` with:

```js
const protoArgs = platform.protocolClientArgs(
  process.platform,
  process.execPath,
  process.argv,
  app.isPackaged,
);
if (protoArgs.length) {
  app.setAsDefaultProtocolClient('nowtify', protoArgs[0], protoArgs[1]);
} else {
  app.setAsDefaultProtocolClient('nowtify');
}
```

- [ ] **Step 3: Handle the cold-start callback URL from argv (Windows)**

macOS gets the OAuth callback via the `open-url` event; Windows passes it in
`process.argv` when it launches the app to handle the URL. Add this helper and
call it once during `app.whenReady().then(...)` (right after `wireIpc()`):

```js
// Windows delivers nowtify:// URLs as a process argument rather than via the
// macOS open-url event. On cold start, scan argv and route any callback URL
// through the same handler the open-url event uses.
function handleWindowsColdStartUrl() {
  if (process.platform !== 'win32') return;
  const url = process.argv.find(
    (a) => typeof a === 'string' && a.startsWith('nowtify://'),
  );
  if (url) {
    console.log('[cold-start] forwarding nowtify URL from argv:', url.slice(0, 120));
    app.emit('open-url', { preventDefault: () => {} }, url);
  }
}
```

Add the call inside `app.whenReady().then(() => { ... })` after `wireIpc();`:

```js
  handleWindowsColdStartUrl();
```

(The existing `second-instance` handler already covers the warm path on
Windows; this only adds cold start.)

- [ ] **Step 4: Run lint + tests**

Run: `npm run lint && npm test`
Expected: 0 errors; all pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/index.js
git commit -m "feat(deep-link): register nowtify:// on Windows + cold-start argv callback"
```

---

### Task 6: Guard dock calls + taskbar suppression on Windows

**Files:**
- Modify: `src/main/index.js` (dock calls already `darwin`-guarded; add `skipTaskbar` to the Settings window)
- Reference: `src/main/tray-manager.js` popover already sets `skipTaskbar: true`; `overlay-windows.js` already sets `skipTaskbar: true`.

- [ ] **Step 1: Add `skipTaskbar` to the Settings window**

In `src/main/index.js`, in `openSettings()` where the `settingsWin` BrowserWindow
is constructed, add `skipTaskbar: true` to the options object (alongside
`width`, `height`, `title`):

```js
  settingsWin = new BrowserWindow({
    width: 780,
    height: 760,
    title: 'Nowtify - Settings',
    icon: BRAND_ICON_PATH,
    skipTaskbar: true,
    webPreferences: {
```

- [ ] **Step 2: Verify dock calls are guarded**

Confirm (read-only check) that every `app.dock.*` call in `index.js` is inside
a `process.platform === 'darwin'` guard. They already are (lines ~186, 239,
273, 788, 855). No change needed; this step is a verification gate.

Run: `grep -n "app.dock" src/main/index.js`
Expected: every match sits under a `darwin` check.

- [ ] **Step 3: Run lint + tests**

Run: `npm run lint && npm test`
Expected: 0 errors; all pass.

- [ ] **Step 4: Commit**

```bash
git add src/main/index.js
git commit -m "feat(windows): keep Settings window out of the taskbar (tray-only parity)"
```

---

### Task 7: Extract the updater + branch the install strategy

**Files:**
- Create: `src/main/updater.js`
- Modify: `src/main/index.js` (move `setupAutoUpdater` + `performUnsignedUpdate`; wire via the new module)

- [ ] **Step 1: Create `src/main/updater.js`**

Move the existing `performUnsignedUpdate(zipPath, newVersion)` function and the
`setupAutoUpdater()` function bodies from `index.js` into this module nearly
verbatim, with one change: the install action branches by platform. The module
exports a small surface the main process wires up.

```js
// src/main/updater.js
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { app, dialog, Notification } = require('electron');
const { autoUpdater } = require('electron-updater');
const platform = require('./platform');

// === macOS unsigned-install helper (unchanged from index.js) =============
// Squirrel.Mac refuses to install unsigned bundles, so on macOS we hand the
// swap to a detached bash helper. (Full doc-comment preserved from index.js.)
function performUnsignedUpdateMac(zipPath, newVersion) {
  // ... MOVE THE EXISTING performUnsignedUpdate BODY HERE VERBATIM ...
}

// Platform-correct "install the downloaded update now".
//   - Windows: electron-updater's NSIS differential installer handles unsigned
//     updates natively; quitAndInstall() is the supported path.
//   - macOS: bypass Squirrel.Mac via the bash helper, then quit.
function installDownloadedUpdate(updaterStatus) {
  if (platform.isWin) {
    autoUpdater.quitAndInstall();
    return true;
  }
  if (updaterStatus.downloadedFile) {
    performUnsignedUpdateMac(updaterStatus.downloadedFile, updaterStatus.result.version || '');
    app.quit();
    return true;
  }
  return false;
}

// Wire all autoUpdater event listeners. `ctx` provides the shared mutable
// updaterStatus object + callbacks into the main process (broadcast, tray
// refresh, settings window getter). MOVE the existing setupAutoUpdater body
// here, replacing the inline install branch in the 'update-downloaded' dialog
// handler with a call to installDownloadedUpdate(ctx.updaterStatus).
function setupAutoUpdater(ctx) {
  // ... MOVE THE EXISTING setupAutoUpdater BODY HERE ...
  // In the 'update-downloaded' handler, where it currently does the macOS
  // performUnsignedUpdate/app.quit() on "Restart now", call:
  //   installDownloadedUpdate(ctx.updaterStatus);
}

module.exports = { setupAutoUpdater, installDownloadedUpdate };
```

> Implementation note for the engineer: this is a mechanical extraction. Copy
> the two functions out of `index.js` exactly as they are, rename the macOS one
> to `performUnsignedUpdateMac`, and replace the three call sites that decide
> "install now" (the tray menu `onInstallUpdate`, the `popover:install-update-now`
> IPC handler, the `settings:install-update-now` IPC handler, and the dialog
> "Restart now" branch) so they all call `installDownloadedUpdate(updaterStatus)`.

- [ ] **Step 2: Update `index.js` to use the module**

In `index.js`: delete the moved `performUnsignedUpdate` and `setupAutoUpdater`
definitions; add `const { setupAutoUpdater, installDownloadedUpdate } = require('./updater');`
near the other requires. Replace every former call to `performUnsignedUpdate(...)
; app.quit()` (tray `onInstallUpdate`, `popover:install-update-now`,
`settings:install-update-now`) with `installDownloadedUpdate(updaterStatus);`.
Pass a context object to `setupAutoUpdater`:

```js
  if (app.isPackaged) {
    setupAutoUpdater({
      updaterStatus,
      broadcastUpdaterStatus,
      getSettingsWin: () => settingsWin,
      refreshTrayForUpdate: () => tray && tray.refreshMenuForUpdate && tray.refreshMenuForUpdate(),
      getAppDialogIcon,
    });
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      console.warn('[updater] initial check failed:', err.message || err);
    });
    setInterval(() => {
      autoUpdater.checkForUpdatesAndNotify().catch(() => {});
    }, 60 * 60 * 1000);
  }
```

> Note: move `dialog`, `Notification`, `autoUpdater`, `spawn`, `os` usage as
> needed. If `getAppDialogIcon` / `broadcastUpdaterStatus` stay in `index.js`,
> pass them through `ctx` as shown. Keep `updaterStatus` owned by `index.js`
> and passed in, since the IPC handlers there read it.

- [ ] **Step 3: Smoke test on macOS (dev mode skips updater, so just verify boot)**

Run: `npm run dev`
Expected: app boots, no `require` errors, tray + popover work. (Auto-update is
disabled in dev; this only verifies the extraction didn't break wiring.) Quit.

- [ ] **Step 4: Run lint + tests**

Run: `npm run lint && npm test`
Expected: 0 errors; all pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/updater.js src/main/index.js
git commit -m "refactor(updater): extract auto-update module; NSIS quitAndInstall on Windows"
```

---

### Task 8: Windows build config

**Files:**
- Modify: `package.json` (the `build` block + a `dist:win` script)

- [ ] **Step 1: Add the `win` target and NSIS config**

In `package.json`, inside `"build"`, add a `win` and `nsis` block (sibling of
`mac`). Also ensure `build/icon.png` is at least 256x256 so electron-builder
derives the `.ico` automatically (the repo's existing `build/icon.png` is large
enough; no separate `.ico` asset required).

```json
    "win": {
      "target": [
        { "target": "nsis" }
      ],
      "icon": "build/icon.png"
    },
    "nsis": {
      "oneClick": true,
      "perMachine": false,
      "allowToChangeInstallationDirectory": false,
      "deleteAppDataOnUninstall": false
    },
```

- [ ] **Step 2: Add convenience scripts**

In `package.json` `"scripts"`, add (do not remove the existing mac ones):

```json
    "dist:win": "electron-builder --win",
    "dist:all": "electron-builder --mac --universal --win",
```

- [ ] **Step 3: Verify config parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('ok')"`
Expected: `ok`.

- [ ] **Step 4: Verify electron-builder accepts the config (dry, no publish)**

Run: `npx electron-builder --win --dir -c.compression=store 2>&1 | tail -20`
Expected: it packages a `dist/win-unpacked/` (building the NSIS installer fully
may require Windows; `--dir` just unpacks and validates config). If it errors on
Wine/makensis on macOS, that is expected and acceptable - CI builds the real
installer. Confirm the config itself was accepted (no schema errors).

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "build(win): add NSIS target + icon for Windows"
```

---

### Task 9: GitHub Actions release CI + slim ship.sh

**Files:**
- Create: `.github/workflows/release.yml`
- Modify: `scripts/ship.sh`

- [ ] **Step 1: Write the release workflow**

```yaml
# .github/workflows/release.yml
name: Release
on:
  push:
    tags:
      - 'v*'
  workflow_dispatch: {}   # on-demand test build (artifacts only, no publish)

permissions:
  contents: write          # needed to publish GitHub Releases

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: macos-latest
            args: --mac --universal
          - os: windows-latest
            args: --win
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm test
      # Tag push -> publish to the GitHub Release. Manual run -> just build.
      - name: Build & publish
        if: startsWith(github.ref, 'refs/tags/v')
        run: npx electron-builder ${{ matrix.args }} --publish always
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: Build only (no publish)
        if: ${{ !startsWith(github.ref, 'refs/tags/v') }}
        run: npx electron-builder ${{ matrix.args }} --publish never
      - name: Upload artifacts (manual runs)
        if: ${{ !startsWith(github.ref, 'refs/tags/v') }}
        uses: actions/upload-artifact@v4
        with:
          name: nowtify-${{ matrix.os }}
          path: |
            dist/*.dmg
            dist/*.zip
            dist/*.exe
          if-no-files-found: ignore
```

- [ ] **Step 2: Slim `scripts/ship.sh` to tag-and-push**

Replace the body of `scripts/ship.sh` (keep the shebang + the `LEVEL` arg) with:

```bash
set -euo pipefail
LEVEL="${1:-patch}"

echo "→ Running lint…"
npm run lint --silent
echo "→ Running tests…"
npm test --silent
echo "  ✓ Pre-ship gate passed"

echo "→ Bumping version ($LEVEL)…"
npm version "$LEVEL" --no-git-tag-version >/dev/null
VERSION=$(node -p "require('./package.json').version")
echo "  package.json now at v$VERSION"

echo "→ Committing + tagging…"
git add -A
git commit -m "release: v$VERSION"
git tag "v$VERSION"

echo "→ Pushing branch + tag (this triggers the Release workflow)…"
git push
git push origin "v$VERSION"

echo
echo "✅ v$VERSION tagged + pushed."
echo "   CI is now building macOS + Windows and will publish the GitHub Release."
echo "   Watch: https://github.com/paulg7516/nowtify/actions"
echo "   Release will appear at: https://github.com/paulg7516/nowtify/releases/tag/v$VERSION"
```

(The old local-build + `GH_TOKEN` check + CDN-wait logic is removed; CI owns
building and publishing. `npm run release` stays in package.json for emergency
local mac-only publishes.)

- [ ] **Step 3: Validate the workflow YAML**

Run: `npx --yes js-yaml .github/workflows/release.yml >/dev/null && echo "yaml ok"`
Expected: `yaml ok`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml scripts/ship.sh
git commit -m "ci: build+publish macOS and Windows via GitHub Actions; slim ship.sh to tag-and-push"
```

---

## Phase 2: Screen-edge overlay on Windows

### Task 10: Overlay transparency hardening for Windows

**Files:**
- Modify: `src/main/overlay-windows.js` (the `createWindow` method)

- [ ] **Step 1: Add explicit transparent background color**

In `createWindow`, add `backgroundColor: '#00000000'` to the BrowserWindow
options (Windows needs an explicit fully-transparent background to composite a
transparent click-through window reliably; harmless on macOS):

```js
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
```

The existing `setIgnoreMouseEvents(true, { forward: true })`,
`setAlwaysOnTop(true, 'screen-saver')` (valid cross-platform level), and the
`typeof`-guarded macOS-only calls (`setVisibleOnAllWorkspaces`,
`setHiddenInMissionControl`) require no change.

- [ ] **Step 2: Run lint + tests + macOS smoke test**

Run: `npm run lint && npm test && npm run dev`
Expected: 0 errors; on macOS the screen-edge pulse still renders on a live
alert exactly as before. Quit.

- [ ] **Step 3: Commit**

```bash
git add src/main/overlay-windows.js
git commit -m "feat(overlay): explicit transparent background for Windows compositing"
```

---

### Task 11: Manual Windows acceptance test

This task is human verification on a real Windows machine or VM. No code; it
gates the release. Trigger a CI build first:

- [ ] **Step 1: Produce a Windows build**

Push the branch and run the workflow manually (Actions tab -> Release ->
"Run workflow"), or merge to main and tag. Download the Windows artifact/installer.

- [ ] **Step 2: Run the acceptance checklist on Windows**

- [ ] Installer runs; SmartScreen "More info -> Run anyway" works.
- [ ] App launches into the system tray with a visible icon; no taskbar button.
- [ ] Tray click opens the menu; "View alerts…" opens the popover.
- [ ] Settings window opens, has no taskbar button, and connects to JSM (token saved via DPAPI; reopen app and confirm "Connected as …" persists).
- [ ] Connect Microsoft 365: the browser sign-in completes and `nowtify://oauth/callback` returns into the app (both warm and cold start - quit the app, click a fresh callback link, confirm it routes).
- [ ] A live alert fires a native Windows notification.
- [ ] The screen-edge pulse overlay paints on a live alert, is click-through (you can click the desktop/apps behind it), and clears when the alert resolves.
- [ ] Auto-update: install an older version, publish a newer one, confirm the app detects + installs it via NSIS and relaunches on the new version.

- [ ] **Step 3: Record results**

Note any failures (especially overlay transparency/click-through) as follow-up
issues. If the overlay misbehaves, that is the expected risk area from the spec
and may need per-display or window-flag iteration.

---

## Self-review notes

- **Spec coverage:** platform layer (T1), store/DPAPI (T2), tray (T3-T4),
  deep-link (T5), dock/taskbar (T6), updater split (T7), build config (T8),
  CI + ship.sh (T9), overlay (T10), testing (T1 unit + T11 manual). All spec
  sections map to a task.
- **Phase boundary:** Tasks 1-9 are independently shippable (core Windows app);
  10-11 add/verify the overlay.
- **Tray parity:** Windows gets the same dynamic, per-trigger-color, pulsing
  tray icon as macOS via the generalized rasterizer (Task 4), with the static
  PNGs (Task 3) as a first-tick/failure fallback so the tray is never blank.
- **Bonus fix:** Task 4 serializes the two size renders that previously raced
  on the shared offscreen window, which removes the intermittent
  `ERR_ABORTED` rasterize log on macOS too (non-user-visible today, but real).
