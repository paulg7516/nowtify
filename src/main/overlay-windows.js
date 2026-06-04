const path = require('path');
const { BrowserWindow, screen } = require('electron');

/**
 * Manages one transparent click-through always-on-top window per display.
 * Refreshes on display add/remove.
 */
class OverlayWindows {
  constructor({ getPulseTarget } = {}) {
    this.windows = new Map(); // displayId -> BrowserWindow
    this.lastState = { status: 'idle', color: null, pulse: false, alerts: [] };
    this._onDisplayChanged = this.rebuild.bind(this);
    // Live read of the user's pulseTarget. 'tray' means the user opted
    // out of the screen-edge pulse, so the overlays stay dark even when
    // alerting. Falls back to 'both' (pre-feature behaviour).
    this.getPulseTarget = getPulseTarget || (() => 'both');
  }

  init() {
    this.rebuild();
    screen.on('display-added', this._onDisplayChanged);
    screen.on('display-removed', this._onDisplayChanged);
    screen.on('display-metrics-changed', this._onDisplayChanged);
  }

  destroy() {
    screen.off('display-added', this._onDisplayChanged);
    screen.off('display-removed', this._onDisplayChanged);
    screen.off('display-metrics-changed', this._onDisplayChanged);
    for (const win of this.windows.values()) {
      if (!win.isDestroyed()) win.close();
    }
    this.windows.clear();
  }

  rebuild() {
    const displays = screen.getAllDisplays();
    const seen = new Set();

    for (const display of displays) {
      seen.add(display.id);
      let win = this.windows.get(display.id);
      if (!win || win.isDestroyed()) {
        win = this.createWindow(display);
        this.windows.set(display.id, win);
      } else {
        win.setBounds(display.bounds);
      }
    }

    // Remove windows for displays that no longer exist
    for (const [id, win] of this.windows.entries()) {
      if (!seen.has(id)) {
        if (!win.isDestroyed()) win.close();
        this.windows.delete(id);
      }
    }

    this.broadcast(this.lastState);
  }

  createWindow(display) {
    const win = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      focusable: false,
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      show: false,
      // Hide the overlay from the macOS Window menu + Cmd-` window
      // cycle. Without this, every overlay (one per display) shows up
      // as a "Nowtify" entry in those menus.
      title: '',
      excludedFromShownWindowsMenu: true,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'overlay-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        // Sandbox the overlay renderer - defence in depth, the renderer
        // only sets CSS variables and class names from a narrow IPC
        // channel so it has no need for any non-sandbox capability.
        sandbox: true,
      },
    });

    win.setIgnoreMouseEvents(true, { forward: true });
    win.setAlwaysOnTop(true, 'screen-saver');
    if (typeof win.setVisibleOnAllWorkspaces === 'function') {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
    // Keep the overlay out of Mission Control + App Expose. This is
    // the load-bearing call - without it the window is publicly listed
    // as a Nowtify window tile when the user invokes the macOS window
    // switcher, even though it's transparent + click-through. Electron
    // 18+ exposes this; guard for older builds just in case.
    if (typeof win.setHiddenInMissionControl === 'function') {
      win.setHiddenInMissionControl(true);
    }

    win.loadFile(path.join(__dirname, '..', 'renderer', 'overlay', 'overlay.html'));
    win.once('ready-to-show', () => win.showInactive());
    return win;
  }

  broadcast(state) {
    this.lastState = state;
    // 'tray' mode: user wants the pulse to live only in the menu bar.
    // Rewrite alerting states to idle BEFORE forwarding to the overlay
    // renderer so no screen-edge stroke ever paints. The tray manager
    // still receives the unmodified state from alert-engine and pulses
    // its own icon. 'screen' and 'both' modes pass through unchanged.
    const target = this.getPulseTarget();
    const out =
      target === 'tray' && state.status === 'alerting'
        ? { ...state, status: 'idle', color: null, pulse: false }
        : state;
    console.log(
      `[overlay] broadcast: target=${target} status=${state.status} -> ${out.status} color=${out.color || 'none'} windows=${this.windows.size}`,
    );
    for (const win of this.windows.values()) {
      if (!win.isDestroyed()) {
        win.webContents.send('overlay:state', out);
      }
    }
  }

  flashResolved(payload) {
    for (const win of this.windows.values()) {
      if (!win.isDestroyed()) {
        win.webContents.send('overlay:resolved', payload || {});
      }
    }
  }

  getState() {
    return this.lastState;
  }
}

module.exports = { OverlayWindows };
