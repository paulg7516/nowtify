const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { app, BrowserWindow, Notification, ipcMain, shell, Menu, dialog, nativeImage } = require('electron');
const { autoUpdater } = require('electron-updater');

// macOS dialogs + notifications fall back to a generic icon on
// freshly-installed unsigned bundles with LSUIElement: true because
// Launch Services hasn't fully registered the app's bundle icon yet.
// We work around that by loading assets/icon.png at runtime and
// passing it explicitly. Lazy + cached so repeat opens don't re-read
// the PNG from disk. Returns null if the asset is missing so callers
// can skip the icon option rather than passing an empty image.
let _appDialogIcon = null;
let _appDialogIconLoaded = false;
function getAppDialogIcon() {
  if (_appDialogIconLoaded) return _appDialogIcon;
  _appDialogIconLoaded = true;
  try {
    const iconPath = path.join(__dirname, '..', '..', 'assets', 'icon.png');
    const img = nativeImage.createFromPath(iconPath);
    if (!img.isEmpty() && img.getSize().width > 0) {
      _appDialogIcon = img;
    }
  } catch (e) {
    console.warn('[icon] failed to load assets/icon.png', e && e.message);
  }
  return _appDialogIcon;
}

/* ----- security helpers ----- */

// Top-level config keys the renderer is allowed to write via settings:save.
// Anything else (e.g. snoozeUntil, future internal state) is rejected so a
// compromised renderer cannot scribble arbitrary keys into the store.
const ALLOWED_SAVE_KEYS = new Set([
  'jsm',
  'watchList',
  'watchGroups',
  'triggers',
  'pollIntervalSeconds',
  'pulseTarget',
]);

// Allow-list check for URLs we hand to the OS. URLs come from JSM API
// responses (browse URLs, Teams meeting URLs) and Microsoft Graph (Teams
// chat + Outlook mail links), so a JSM admin or mailbox sender could
// otherwise smuggle arbitrary destinations into the data. The host policy
// lives in ./links (pure + unit-tested); here we just supply the configured
// JSM host read from the store.
function isAllowedExternalHost(urlString) {
  let jsmHost = '';
  try {
    const cfg = require('./store').get('jsm') || {};
    jsmHost = cfg.siteUrl ? new URL(cfg.siteUrl).hostname.toLowerCase() : '';
  } catch (_) {
    jsmHost = '';
  }
  return isAllowedExternalHostPure(urlString, { jsmHost });
}

function safeOpenExternal(url) {
  if (typeof url !== 'string') return;
  if (!isAllowedExternalHost(url)) {
    console.warn('[security] blocked openExternal for', url.slice(0, 200));
    return;
  }
  // Teams links: prefer the desktop app via the msteams: deep-link scheme,
  // falling back to the web URL if no Teams app is registered (openExternal
  // rejects when the OS has no handler for the scheme). Outlook + JSM links
  // have no reliable desktop deep link, so they open in the browser.
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch (_) {
    host = '';
  }
  if (host === 'teams.microsoft.com' || host.endsWith('.teams.microsoft.com')) {
    const appUrl = toTeamsAppUrl(url);
    shell.openExternal(appUrl).catch((err) => {
      console.warn('[links] Teams app open failed, falling back to web:', err && err.message);
      shell.openExternal(url);
    });
    return;
  }
  shell.openExternal(url);
}

const BRAND_ICON_PATH = path.join(__dirname, '..', '..', 'build', 'icon.png');

const store = require('./store');
const { AlertEngine } = require('./alert-engine');
const { OverlayWindows } = require('./overlay-windows');
const { TrayManager } = require('./tray-manager');
const { JsmClient } = require('./jsm-client');
const {
  toTeamsAppUrl,
  isAllowedExternalHost: isAllowedExternalHostPure,
} = require('./links');
const msGraphOAuth = require('./ms-graph-oauth');
const msGraphClient = require('./ms-graph-client');

// macOS: keep app running when all windows are closed (we live in the menu bar)
app.on('window-all-closed', (e) => {
  e.preventDefault();
});

// Global navigation + window-open guard. Every BrowserWindow our app
// owns loads a local file:// URL with strict CSP. If a defect ever
// caused a renderer to attempt navigation away from its file:// origin,
// or to spawn a new window, this handler stops it. Defence in depth
// against an XSS landing in any renderer (CSP makes that unlikely,
// not impossible).
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      console.warn('[security] blocked will-navigate to', url);
      e.preventDefault();
    }
  });
});

// macOS: clicking the dock icon (when visible) fires 'activate'. Since this
// is a menu-bar app with no main window, route the click to opening Settings
// - that's the "if you tapped the icon, you probably wanted to see the app"
// affordance. Without this handler, dock clicks silently do nothing.
app.on('activate', () => {
  openSettings();
});

// Single-instance lock: prevents a second copy of Nowtify from launching
// when macOS hands us an OAuth callback URL. Without this, every
// nowtify://oauth/callback click would spawn a new process and our
// pendingAuth state (held in the original process) would be unreachable.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// Register nowtify:// as our custom URL scheme so macOS routes
// nowtify://oauth/callback back to this app after Microsoft sign-in.
// Safe to call repeatedly; idempotent at the OS level.
app.setAsDefaultProtocolClient('nowtify');

// macOS: when the system invokes nowtify://... and the app is already
// running, this event fires with the full URL. (Cold-start invocations
// also come through here on macOS - the OS launches us and immediately
// dispatches open-url.)
app.on('open-url', async (event, url) => {
  event.preventDefault();
  console.log(`[open-url] received pid=${process.pid} url=${url.slice(0, 120)}…`);
  if (url.startsWith('nowtify://oauth/callback')) {
    try {
      const user = await msGraphOAuth.handleCallback(url);
      console.log('[open-url] OAuth callback succeeded, user:', user.displayName);
      if (settingsWin && !settingsWin.isDestroyed()) {
        settingsWin.webContents.send('settings:teams-connected', {
          userDisplayName: user.displayName,
          userId: user.id,
        });
      }
    } catch (err) {
      console.warn('[open-url] OAuth callback failed:', err.message);
      if (settingsWin && !settingsWin.isDestroyed()) {
        settingsWin.webContents.send('settings:teams-error', err.message);
      }
    }
  }
});

// If a second Nowtify instance launches (e.g. macOS spawning a new copy
// to handle a nowtify:// URL because Launch Services didn't route to the
// existing one), the single-instance lock above sends the second-instance
// args here. Extract any nowtify:// URL from argv and process it in this
// (the first) instance.
app.on('second-instance', (_event, argv) => {
  console.log('[second-instance] argv:', argv.slice(2));
  const url = argv.find((a) => typeof a === 'string' && a.startsWith('nowtify://'));
  if (url) {
    console.log('[second-instance] forwarding URL to open-url handler:', url.slice(0, 120));
    app.emit('open-url', { preventDefault: () => {} }, url);
  }
});

if (process.platform === 'darwin') {
  app.dock.hide();
}

// In dev (unpackaged) mode the OS shows the default Electron icon for the
// dock, Cmd+Tab, and any native dialogs the app spawns. Override it with our
// real brand icon so the experience matches the packaged build.
function applyBrandIcon() {
  // Packaged builds already have the right icon baked into the .app bundle
  // via the .icns file. Only the dev runtime (which uses the generic Electron
  // bundle from node_modules) needs the runtime override.
  if (app.isPackaged) return;
  if (process.platform !== 'darwin') return;
  const img = nativeImage.createFromPath(BRAND_ICON_PATH);
  if (img.isEmpty()) {
    console.warn('[brand-icon] failed to load:', BRAND_ICON_PATH);
    return;
  }
  if (app.dock && app.dock.setIcon) {
    app.dock.setIcon(img);
    console.log('[brand-icon] dock icon set:', img.getSize());
  }
}

let overlay;
let tray;
let engine;
let settingsWin;

// Snapshot of what the auto-updater is doing so the Settings → Updates
// panel can show a useful diagnostic readout. Mutated by autoUpdater event
// listeners (see setupAutoUpdater) and queried via settings:get-update-status.
const updaterStatus = {
  currentVersion: '',
  lastCheckedAt: 0, // epoch ms; 0 = never checked this session
  // type values: never | checking | up-to-date | available | downloading
  //              | downloaded | error
  result: { type: 'never', message: 'Never checked this session', version: '' },
};

function broadcastUpdaterStatus() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.webContents.send('settings:updater-status', updaterStatus);
  }
}

function broadcastTriggers(triggers) {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.webContents.send('settings:triggers-updated', triggers);
  }
}

function openSettings() {
  if (process.platform === 'darwin' && app.dock && app.dock.show) {
    app.dock.show();
  }
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    if (app.focus) app.focus({ steal: true });
    return;
  }
  settingsWin = new BrowserWindow({
    width: 780,
    height: 760,
    title: 'Nowtify - Settings',
    icon: BRAND_ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Sandbox the renderer process so even a V8 exploit lands in an
      // OS-sandboxed worker, not a full-privilege Electron process. Our
      // preload only uses contextBridge + ipcRenderer (both sandbox-
      // compatible) so this is a drop-in.
      sandbox: true,
    },
  });
  settingsWin.setMenu(null);
  settingsWin.loadFile(path.join(__dirname, '..', 'renderer', 'settings', 'settings.html'));
  settingsWin.once('ready-to-show', () => {
    settingsWin.show();
    settingsWin.focus();
    if (app.focus) app.focus({ steal: true });
  });
  settingsWin.on('closed', () => {
    settingsWin = null;
    if (process.platform === 'darwin' && app.dock && app.dock.hide) {
      app.dock.hide();
    }
  });
}

// Verify the IPC sender is one of OUR own renderer mainFrames (settings
// window or popover window). Both load file:// URLs with strict CSP that
// has `frame-ancestors 'none'`, so a legitimate call can ONLY come from
// the top-level frame of one of those WebContents. Applied to handlers
// whose effects are destructive (install update, disconnect, mass-save)
// so a defect / compromise in any other Electron process the OS might
// own can't trigger them.
function isTrustedSender(event) {
  const senderFrame = event && event.senderFrame;
  if (!senderFrame) return false;
  if (
    settingsWin &&
    !settingsWin.isDestroyed() &&
    senderFrame === settingsWin.webContents.mainFrame
  ) return true;
  if (
    tray &&
    tray.popover &&
    !tray.popover.isDestroyed() &&
    senderFrame === tray.popover.webContents.mainFrame
  ) return true;
  return false;
}

function denyUntrusted(channel, event) {
  console.warn('[security] rejected', channel, 'from untrusted sender frame');
  void event;
}

function wireIpc() {
  // Overlay
  ipcMain.handle('overlay:get-state', () => engine.getState());

  // Settings
  ipcMain.handle('settings:get', () => store.getAll());
  // Per-key value validators. Any settings:save value that fails its
  // validator is rejected with a warning. Prevents a compromised or buggy
  // renderer from writing the wrong-shape value (e.g. `triggers: "foo"`)
  // which would then crash the engine on the next tick.
  const SAVE_VALIDATORS = {
    jsm: (v) => v && typeof v === 'object',
    watchList: Array.isArray,
    watchGroups: Array.isArray,
    triggers: Array.isArray,
    pollIntervalSeconds: (v) => typeof v === 'number' && Number.isFinite(v),
    pulseTarget: (v) => v === 'screen' || v === 'tray' || v === 'both',
  };

  ipcMain.handle('settings:save', (event, patch) => {
    if (!isTrustedSender(event)) {
      denyUntrusted('settings:save', event);
      return store.getAll();
    }
    if (!patch || typeof patch !== 'object') return store.getAll();
    let pulseTargetChanged = false;
    for (const [key, value] of Object.entries(patch)) {
      if (!ALLOWED_SAVE_KEYS.has(key)) {
        console.warn('[security] rejected settings:save for disallowed key', key);
        continue;
      }
      const validator = SAVE_VALIDATORS[key];
      if (validator && !validator(value)) {
        console.warn('[security] rejected settings:save for malformed value:', key, typeof value);
        continue;
      }
      store.set(key, value);
      if (key === 'pulseTarget') pulseTargetChanged = true;
    }
    engine.rebuildClient();
    // Re-broadcast the live state so flipping pulseTarget takes effect
    // immediately. Without this, overlays would stay in their previous
    // mode (lit or dark) until the next engine tick (~30s default).
    if (pulseTargetChanged) {
      const live = engine.getState();
      overlay.broadcast(live);
      tray.setState(live);
    }
    return store.getAll();
  });
  ipcMain.handle('settings:disconnect', (event) => {
    if (!isTrustedSender(event)) {
      denyUntrusted('settings:disconnect', event);
      return store.getAll();
    }
    // Clear only the encrypted API token - keep site URL + email so the user
    // can reconnect by just pasting a fresh token. The engine will see
    // isConfigured() return false on the next tick and emit idle state.
    store.clearApiToken();
    engine.rebuildClient();
    engine.pokeNow();
    return store.getAll();
  });
  ipcMain.handle('settings:test-connection', async (_e, creds) => {
    try {
      // If the renderer omits the token (because the field is blank and a
      // token is already stored), fall back to the stored one. The token
      // never round-trips through the renderer.
      const merged = { ...(creds || {}) };
      if (!merged.apiToken) {
        const stored = store.get('jsm') || {};
        merged.apiToken = stored.apiToken || '';
      }
      const client = new JsmClient(merged);
      const user = await client.getMyself();
      // Persist the display name so the "Connected as <name>" pill can
      // restore on next launch without re-fetching /myself.
      if (user && user.displayName) {
        store.setUserDisplayName(user.displayName);
      }
      return {
        ok: true,
        user: { displayName: user.displayName, accountId: user.accountId },
      };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });
  ipcMain.handle('settings:search-users', async (_e, query) => {
    const cfg = store.get('jsm');
    const client = new JsmClient(cfg);
    return client.searchUsers(query);
  });
  ipcMain.handle('settings:add-watchee', (_e, user) => store.addWatchee(user));
  ipcMain.handle('settings:remove-watchee', (_e, accountId) => store.removeWatchee(accountId));
  ipcMain.handle('settings:search-groups', async (_e, query) => {
    const cfg = store.get('jsm');
    const client = new JsmClient(cfg);
    return client.searchGroups(query);
  });
  ipcMain.handle('settings:add-group', (_e, group) => store.addGroup(group));
  ipcMain.handle('settings:remove-group', (_e, groupName) => store.removeGroup(groupName));
  ipcMain.handle('settings:resolve-fields', async () => {
    const cfg = store.get('jsm');
    const client = new JsmClient(cfg);
    const fields = await client.resolveFieldIds();
    return fields;
  });
  ipcMain.handle('settings:poke-engine', () => engine.pokeNow());
  ipcMain.handle('settings:open-external', (_e, url) => safeOpenExternal(url));

  // Triggers CRUD - broadcasts back to settings so all UIs stay in sync.
  ipcMain.handle('settings:set-trigger-enabled', (_e, { triggerId, enabled }) => {
    const next = store.setTriggerEnabled(triggerId, enabled);
    broadcastTriggers(next);
    return next;
  });
  ipcMain.handle('settings:update-trigger', (_e, { triggerId, patch }) => {
    const next = store.updateTrigger(triggerId, patch);
    broadcastTriggers(next);
    return next;
  });
  ipcMain.handle('settings:add-trigger', (_e, trigger) => {
    const next = store.addTrigger(trigger);
    broadcastTriggers(next);
    return next;
  });
  ipcMain.handle('settings:remove-trigger', (_e, triggerId) => {
    const next = store.removeTrigger(triggerId);
    broadcastTriggers(next);
    return next;
  });

  // Popover
  ipcMain.handle('popover:get-state', () => engine.getState());
  ipcMain.handle('popover:open-ticket', (_e, url) => safeOpenExternal(url));
  ipcMain.handle('popover:snooze', (_e, value) => {
    // Accept either a numeric minutes value or the string 'indefinite'.
    if (value === 'indefinite') store.setSnooze('indefinite');
    else store.setSnooze(Number(value) || 0);
  });
  ipcMain.handle('popover:poke-engine', () => engine.pokeNow());
  ipcMain.handle('popover:open-settings', () => openSettings());
  ipcMain.handle('popover:get-version', () => app.getVersion());
  ipcMain.handle('popover:get-engine-health', () => engine.getHealth());
  // Mirror of update status so the popover can show an "Update ready"
  // pill without needing the full Settings → Updates panel open.
  ipcMain.handle('popover:get-update-status', () => updaterStatus);
  ipcMain.handle('popover:install-update-now', (event) => {
    if (!isTrustedSender(event)) {
      denyUntrusted('popover:install-update-now', event);
      return false;
    }
    if (updaterStatus.downloadedFile) {
      performUnsignedUpdate(updaterStatus.downloadedFile, updaterStatus.result.version || '');
      app.quit();
      return true;
    }
    return false;
  });
  ipcMain.handle('settings:get-engine-health', () => engine.getHealth());

  // Microsoft Teams OAuth (Phase 1: just the auth handshake)
  ipcMain.handle('settings:teams-begin-auth', async () => {
    try {
      await msGraphOAuth.beginAuth();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });
  ipcMain.handle('settings:teams-disconnect', (event) => {
    if (!isTrustedSender(event)) {
      denyUntrusted('settings:teams-disconnect', event);
      return store.getAll();
    }
    msGraphOAuth.disconnect();
    return store.getAll();
  });
  ipcMain.handle('settings:teams-search-users', async (_e, query) => {
    try {
      return await msGraphClient.searchUsers(query);
    } catch (err) {
      // Surface Graph errors back to the renderer so they show up in the
      // search results pane rather than the IPC bridge swallowing them.
      throw new Error(err.message || String(err));
    }
  });
  ipcMain.handle('settings:teams-add-watched-user', (_e, user) =>
    store.addTeamsWatchedUser(user || {}),
  );
  ipcMain.handle('settings:teams-remove-watched-user', (_e, userId) =>
    store.removeTeamsWatchedUser(userId),
  );

  // Updates diagnostic panel
  ipcMain.handle('settings:get-update-status', () => updaterStatus);
  ipcMain.handle('settings:check-for-updates', async () => {
    if (!app.isPackaged) {
      updaterStatus.result = {
        type: 'error',
        message: 'Auto-updater is disabled in dev mode (npm start)',
        version: '',
      };
      broadcastUpdaterStatus();
      return updaterStatus;
    }
    updaterStatus.result = { type: 'checking', message: 'Checking for updates…', version: '' };
    broadcastUpdaterStatus();
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      updaterStatus.result = {
        type: 'error',
        message: err.message || String(err),
        version: '',
      };
      updaterStatus.lastCheckedAt = Date.now();
      broadcastUpdaterStatus();
    }
    return updaterStatus;
  });
  ipcMain.handle('settings:install-update-now', (event) => {
    if (!isTrustedSender(event)) {
      denyUntrusted('settings:install-update-now', event);
      return false;
    }
    // The downloaded ZIP path is captured in updaterStatus.downloadedFile
    // when update-downloaded fires (set in setupAutoUpdater below). If we
    // have it, run our unsigned-install helper directly without going
    // through the dialog.
    if (updaterStatus.downloadedFile) {
      performUnsignedUpdate(updaterStatus.downloadedFile, updaterStatus.result.version || '');
      app.quit();
      return true;
    }
    return false;
  });
}

app.whenReady().then(() => {
  applyBrandIcon();
  // Minimal app menu - needed on macOS so Cmd+C/V/X/A keyboard shortcuts
  // work inside renderer windows (they're wired through Edit role items).
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
    ]),
  );

  engine = new AlertEngine();
  overlay = new OverlayWindows({
    getPulseTarget: () => store.get('pulseTarget') || 'both',
  });
  tray = new TrayManager({
    onOpenSettings: openSettings,
    onSnooze: (minutes) => {
      store.setSnooze(minutes);
      // Synchronously rebuild the cached state with the new snooze
      // gate so Resume now / snooze take effect IMMEDIATELY in the
      // pulse + tray icon, without waiting for the next JIRA tick
      // (which can be seconds away). The pokeNow below still runs
      // so the engine reconfirms with fresh data on the next round.
      engine.refreshSnoozeGate();
      engine.pokeNow();
    },
    onPoke: () => engine.pokeNow(),
    onQuit: () => app.quit(),
    onToggleTrigger: (triggerId, enabled) => {
      const next = store.setTriggerEnabled(triggerId, enabled);
      broadcastTriggers(next);
      engine.pokeNow();
    },
    onInstallUpdate: () => {
      if (updaterStatus.downloadedFile) {
        performUnsignedUpdate(updaterStatus.downloadedFile, updaterStatus.result.version || '');
        app.quit();
      }
    },
    getState: () => engine.getState(),
    getTriggers: () => store.get('triggers') || [],
    getUpdateStatus: () => updaterStatus,
    getPulseTarget: () => store.get('pulseTarget') || 'both',
  });

  overlay.init();
  tray.init();
  wireIpc();

  engine.on('state', (state) => {
    overlay.broadcast(state);
    tray.setState(state);
  });
  engine.on('resolved', (payload) => {
    console.log('[resolved]', (payload && payload.keys) || []);
    overlay.flashResolved(payload);
  });
  engine.on('error', (err) => {
    console.error('[engine error]', err.message || err);
  });

  engine.start();

  // First-run: if no JSM creds, pop the settings window
  const cfg = store.get('jsm') || {};
  if (!cfg.siteUrl || !cfg.email || !cfg.apiToken) {
    openSettings();
  }

  // Auto-updates: check on launch, then again every 6 hours.
  // Only meaningful when running a packaged build (skipped in `npm start` dev).
  if (app.isPackaged) {
    setupAutoUpdater();
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      console.warn('[updater] initial check failed:', err.message || err);
    });
    // Re-check hourly so a newly-published version is detected fast.
    // Previous 6h interval was too slow - users would ship a release and
    // be on the old version for hours before the pill appeared.
    setInterval(() => {
      autoUpdater.checkForUpdatesAndNotify().catch(() => {});
    }, 60 * 60 * 1000);
  }
});

/**
 * Install a downloaded update by bypassing Squirrel.Mac entirely.
 *
 * Squirrel.Mac (which electron-updater uses on macOS) requires the new app
 * bundle to carry a valid Developer ID code signature - it validates the
 * signature before performing the swap and bails silently if the bundle is
 * unsigned. Since Nowtify is currently shipped unsigned (see SECURITY.md H2),
 * autoUpdater.quitAndInstall() looks like it works but actually relaunches
 * the OLD bundle with no error surface.
 *
 * Workaround: write a tiny detached bash helper that waits for our process
 * to exit, then replaces the .app bundle with the downloaded ZIP and
 * relaunches. The helper outlives this process via setsid/detached spawn so
 * macOS doesn't kill it when the parent dies. Helper output goes to a log
 * in tmp for post-mortem debugging.
 *
 * The integrity of the downloaded ZIP itself is already verified by
 * electron-updater against the SHA-512 in latest-mac.yml, so we don't
 * re-validate it here.
 */
function performUnsignedUpdate(zipPath, newVersion) {
  // process.execPath is /Applications/Nowtify.app/Contents/MacOS/Nowtify
  // - climb three dirs to get the .app bundle root.
  const appBundlePath = path.dirname(path.dirname(path.dirname(process.execPath)));
  const tmpDir = path.join(os.tmpdir(), `nowtify-install-${Date.now()}`);
  const helperPath = path.join(os.tmpdir(), `nowtify-install-${Date.now()}.sh`);
  const logPath = path.join(os.tmpdir(), 'nowtify-install.log');
  const pid = process.pid;
  const sh = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

  const script = `#!/bin/bash
exec >>${sh(logPath)} 2>&1
echo "[$(date)] install helper starting v${newVersion}"
echo "  pid=${pid} bundle=${appBundlePath} zip=${zipPath}"

# Wait for parent to exit (up to 30s)
for i in $(seq 1 60); do
  if ! kill -0 ${pid} 2>/dev/null; then break; fi
  sleep 0.5
done
sleep 1

# Extract to staging dir
mkdir -p ${sh(tmpDir)}
cd ${sh(tmpDir)} || exit 1
if ! unzip -q -o ${sh(zipPath)}; then
  echo "FAILED: unzip ${zipPath}"
  exit 1
fi
if [ ! -d ${sh(path.join(tmpDir, 'Nowtify.app'))} ]; then
  echo "FAILED: Nowtify.app not found in extracted ZIP"
  ls -la ${sh(tmpDir)}
  exit 1
fi

# Swap bundle
rm -rf ${sh(appBundlePath)}
mv ${sh(path.join(tmpDir, 'Nowtify.app'))} ${sh(appBundlePath)}
xattr -dr com.apple.quarantine ${sh(appBundlePath)} 2>/dev/null || true

# Force macOS Launch Services to re-scan the new bundle so URL scheme
# handlers (nowtify://) are correctly re-registered after the swap.
# Without this, OAuth callbacks break after every auto-update because the
# new binary's hash doesn't match what LS had registered for the old one.
LSREGISTER='/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister'
if [ -x "\${LSREGISTER}" ]; then
  "\${LSREGISTER}" -f ${sh(appBundlePath)} 2>/dev/null || true
fi

rm -rf ${sh(tmpDir)}

# Launch new version
open ${sh(appBundlePath)}
echo "[$(date)] install helper done"
`;

  fs.writeFileSync(helperPath, script, { mode: 0o755 });

  const child = spawn('/bin/bash', [helperPath], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  console.log('[updater] manual install helper spawned, pid', child.pid);
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  // Squirrel.Mac can't install unsigned updates on quit either - disable so
  // updates only apply via our manual helper (triggered by the Restart-now
  // dialog button).
  autoUpdater.autoInstallOnAppQuit = false;
  updaterStatus.currentVersion = app.getVersion();
  autoUpdater.on('checking-for-update', () => {
    updaterStatus.result = { type: 'checking', message: 'Checking for updates…', version: '' };
    broadcastUpdaterStatus();
  });
  autoUpdater.on('update-available', (info) => {
    console.log('[updater] update available:', info.version);
    updaterStatus.result = {
      type: 'available',
      message: `Update v${info.version} found - downloading…`,
      version: info.version,
    };
    broadcastUpdaterStatus();
  });
  autoUpdater.on('update-not-available', () => {
    console.log('[updater] up to date');
    updaterStatus.lastCheckedAt = Date.now();
    updaterStatus.result = { type: 'up-to-date', message: 'You are on the latest version', version: '' };
    broadcastUpdaterStatus();
  });
  autoUpdater.on('download-progress', (progress) => {
    updaterStatus.result = {
      type: 'downloading',
      message: `Downloading update (${Math.round(progress.percent || 0)}%)`,
      version: updaterStatus.result.version,
      percent: progress.percent || 0,
    };
    broadcastUpdaterStatus();
  });
  autoUpdater.on('update-downloaded', async (info) => {
    console.log('[updater] downloaded:', info.version);
    updaterStatus.lastCheckedAt = Date.now();
    updaterStatus.downloadedFile = info && (info.downloadedFile || info.path);
    updaterStatus.result = {
      type: 'downloaded',
      message: `Update v${info.version} downloaded - ready to install`,
      version: info.version,
    };
    broadcastUpdaterStatus();
    // Rebuild the tray menu so the new "Install update vX.Y.Z" item
    // appears at the top of the right-click menu immediately.
    if (tray && tray.refreshMenuForUpdate) tray.refreshMenuForUpdate();

    // Menu-bar apps (LSUIElement: true) have no dock icon, which means
    // dialog.showMessageBox can appear without focus on a random space and
    // get missed entirely. Surface the dock + steal focus for the duration
    // of the dialog so the user actually sees it.
    const dockWasHidden =
      process.platform === 'darwin' && app.dock && !app.dock.isVisible();
    if (process.platform === 'darwin' && app.dock && app.dock.show) {
      app.dock.show();
    }
    if (app.focus) app.focus({ steal: true });

    // Fire a native macOS notification as a fallback signal in case the
    // dialog still gets buried (other-Space focus, Do-Not-Disturb off, etc).
    // Clicking the notification triggers the unsigned-install helper, same
    // path as the Restart-now dialog button.
    const zipPath = info && (info.downloadedFile || info.path);
    if (Notification.isSupported()) {
      try {
        const n = new Notification({
          title: 'Nowtify update ready',
          body: `Version ${info.version} is ready - click to install now.`,
          silent: false,
          // No explicit icon - macOS already draws the app's bundle
          // icon on the LEFT of every notification banner. Setting
          // `icon` adds a SECOND tile on the right (contentImage),
          // which makes the banner read as doubled.
        });
        n.on('click', () => {
          if (zipPath) {
            performUnsignedUpdate(zipPath, info.version);
            app.quit();
          }
        });
        n.show();
      } catch (_) {}
    }

    // If the user has the Settings window open, anchor the dialog to it so
    // it appears as a sheet rather than a free-floating window.
    const parent =
      settingsWin && !settingsWin.isDestroyed() ? settingsWin : undefined;
    const dialogIcon = getAppDialogIcon();
    const { response } = await dialog.showMessageBox(parent, {
      type: 'info',
      title: 'Nowtify update ready',
      message: `Version ${info.version} is ready to install.`,
      detail:
        'Click Restart now to apply the update immediately.\n\n' +
        'If you choose Later, you can install it from the Settings window ' +
        'when ready. Closing this window does not quit the app.',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      // Pass the icon explicitly so freshly-installed unsigned bundles
      // with LSUIElement: true don't render with the generic system icon
      // (Launch Services takes time to register bundle icons for
      // unsigned + dockless apps).
      ...(dialogIcon ? { icon: dialogIcon } : {}),
    });

    if (response === 0) {
      // Bypass Squirrel.Mac (which silently fails for unsigned bundles) and
      // hand the swap off to a detached bash helper that takes over after we
      // quit. See performUnsignedUpdate doc-comment.
      const zipPath = info && (info.downloadedFile || info.path);
      if (zipPath) {
        performUnsignedUpdate(zipPath, info.version);
        app.quit();
      } else {
        console.warn('[updater] no downloadedFile path on info, falling back to quitAndInstall');
        autoUpdater.quitAndInstall();
      }
    } else if (dockWasHidden && process.platform === 'darwin' && app.dock && app.dock.hide) {
      // Re-hide the dock only on the Later path. On Restart, we're about to
      // quit so the dock hide is pointless and racing the install helper.
      app.dock.hide();
    }
  });
  autoUpdater.on('error', (err) => {
    console.warn('[updater] error:', err.message || err);
    updaterStatus.lastCheckedAt = Date.now();
    updaterStatus.result = {
      type: 'error',
      message: err.message || String(err),
      version: '',
    };
    broadcastUpdaterStatus();
  });
}

app.on('before-quit', () => {
  if (engine) engine.stop();
  if (overlay) overlay.destroy();
  if (tray) tray.destroy();
});
