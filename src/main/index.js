const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { app, BrowserWindow, Notification, ipcMain, shell, Menu, dialog, nativeImage } = require('electron');
const { autoUpdater } = require('electron-updater');

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
]);

// Hostnames the app is allowed to hand to the user's default browser via
// shell.openExternal. URLs come from JSM API responses (browse URLs, Teams
// meeting URLs) so a JSM admin could otherwise smuggle arbitrary http(s)
// destinations into ticket data. Limited to: the configured JSM site,
// Atlassian's account-management origin (for the API-token help link), and
// Microsoft Teams' meeting-join origin.
function isAllowedExternalHost(urlString) {
  let u;
  try {
    u = new URL(urlString);
  } catch (_) {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const host = u.hostname.toLowerCase();
  // Configured JSM site (e.g. xolv-sandbox.atlassian.net)
  const jsmHost = (() => {
    try {
      const cfg = require('./store').get('jsm') || {};
      return cfg.siteUrl ? new URL(cfg.siteUrl).hostname.toLowerCase() : '';
    } catch (_) {
      return '';
    }
  })();
  if (jsmHost && host === jsmHost) return true;
  // Atlassian identity (API-token management page)
  if (host === 'id.atlassian.com') return true;
  // Microsoft Teams meeting / chat endpoints
  if (host === 'teams.microsoft.com' || host.endsWith('.teams.microsoft.com')) return true;
  return false;
}

function safeOpenExternal(url) {
  if (typeof url !== 'string') return;
  if (!isAllowedExternalHost(url)) {
    console.warn('[security] blocked openExternal for', url.slice(0, 200));
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

// macOS: keep app running when all windows are closed (we live in the menu bar)
app.on('window-all-closed', (e) => {
  e.preventDefault();
});

// macOS: clicking the dock icon (when visible) fires 'activate'. Since this
// is a menu-bar app with no main window, route the click to opening Settings
// - that's the "if you tapped the icon, you probably wanted to see the app"
// affordance. Without this handler, dock clicks silently do nothing.
app.on('activate', () => {
  openSettings();
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

function wireIpc() {
  // Overlay
  ipcMain.handle('overlay:get-state', () => engine.getState());

  // Settings
  ipcMain.handle('settings:get', () => store.getAll());
  ipcMain.handle('settings:save', (_e, patch) => {
    if (!patch || typeof patch !== 'object') return store.getAll();
    for (const [key, value] of Object.entries(patch)) {
      if (!ALLOWED_SAVE_KEYS.has(key)) {
        console.warn('[security] rejected settings:save for disallowed key', key);
        continue;
      }
      store.set(key, value);
    }
    engine.rebuildClient();
    return store.getAll();
  });
  ipcMain.handle('settings:disconnect', () => {
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
  ipcMain.handle('settings:install-update-now', () => {
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
  overlay = new OverlayWindows();
  tray = new TrayManager({
    onOpenSettings: openSettings,
    onSnooze: (minutes) => {
      store.setSnooze(minutes);
      engine.pokeNow();
    },
    onPoke: () => engine.pokeNow(),
    onQuit: () => app.quit(),
    onToggleTrigger: (triggerId, enabled) => {
      const next = store.setTriggerEnabled(triggerId, enabled);
      broadcastTriggers(next);
      engine.pokeNow();
    },
    getState: () => engine.getState(),
    getTriggers: () => store.get('triggers') || [],
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
    setInterval(() => {
      autoUpdater.checkForUpdatesAndNotify().catch(() => {});
    }, 6 * 60 * 60 * 1000);
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
