const path = require('path');
const { app, BrowserWindow, ipcMain, shell, Menu, dialog, nativeImage } = require('electron');
const { autoUpdater } = require('electron-updater');

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
      store.set(key, value);
    }
    engine.rebuildClient();
    return store.getAll();
  });
  ipcMain.handle('settings:test-connection', async (_e, creds) => {
    try {
      const client = new JsmClient(creds);
      const user = await client.getMyself();
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
  ipcMain.handle('settings:open-external', (_e, url) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) shell.openExternal(url);
  });

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
  ipcMain.handle('popover:open-ticket', (_e, url) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) shell.openExternal(url);
  });
  ipcMain.handle('popover:snooze', (_e, value) => {
    // Accept either a numeric minutes value or the string 'indefinite'.
    if (value === 'indefinite') store.setSnooze('indefinite');
    else store.setSnooze(Number(value) || 0);
  });
  ipcMain.handle('popover:poke-engine', () => engine.pokeNow());
  ipcMain.handle('popover:open-settings', () => openSettings());
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

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', (info) => {
    console.log('[updater] update available:', info.version);
  });
  autoUpdater.on('update-not-available', () => {
    console.log('[updater] up to date');
  });
  autoUpdater.on('update-downloaded', async (info) => {
    console.log('[updater] downloaded:', info.version);
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: 'Nowtify update ready',
      message: `Version ${info.version} is ready to install.`,
      detail: 'Restart now to apply, or it will install automatically when you quit.',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });
  autoUpdater.on('error', (err) => {
    console.warn('[updater] error:', err.message || err);
  });
}

app.on('before-quit', () => {
  if (engine) engine.stop();
  if (overlay) overlay.destroy();
  if (tray) tray.destroy();
});
