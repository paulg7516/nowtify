const path = require('path');
const { BrowserWindow, screen } = require('electron');

/**
 * Manages one transparent click-through always-on-top window per display.
 * Refreshes on display add/remove.
 */
class OverlayWindows {
  constructor() {
    this.windows = new Map(); // displayId -> BrowserWindow
    this.lastState = { status: 'idle', color: null, pulse: false, alerts: [] };
    this._onDisplayChanged = this.rebuild.bind(this);
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
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'overlay-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });

    win.setIgnoreMouseEvents(true, { forward: true });
    win.setAlwaysOnTop(true, 'screen-saver');
    if (typeof win.setVisibleOnAllWorkspaces === 'function') {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }

    win.loadFile(path.join(__dirname, '..', 'renderer', 'overlay', 'overlay.html'));
    win.once('ready-to-show', () => win.showInactive());
    return win;
  }

  broadcast(state) {
    this.lastState = state;
    for (const win of this.windows.values()) {
      if (!win.isDestroyed()) {
        win.webContents.send('overlay:state', state);
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
