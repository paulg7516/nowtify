const path = require('path');
const { Tray, Menu, BrowserWindow, nativeImage, screen } = require('electron');

const TRAY_DIR = path.join(__dirname, '..', '..', 'assets', 'tray');

/**
 * Tray + popover window. The popover is a small frameless window positioned
 * near the tray icon, showing the list of triggering tickets.
 */
class TrayManager {
  constructor({
    onOpenSettings,
    onSnooze,
    onPoke,
    onQuit,
    onToggleTrigger,
    getState,
    getTriggers,
  }) {
    this.onOpenSettings = onOpenSettings;
    this.onSnooze = onSnooze;
    this.onPoke = onPoke;
    this.onQuit = onQuit;
    this.onToggleTrigger = onToggleTrigger;
    this.getState = getState;
    this.getTriggers = getTriggers;
    this.tray = null;
    this.popover = null;
    this.iconCache = {};
    this.pulseTimer = null;
    this.pulseFrame = 0;
    this.lastStatus = null;
  }

  init() {
    this.tray = new Tray(this.iconFor({ status: 'idle' }));
    this.tray.setToolTip('Nowtify - idle');
    // Manual click handling - we explicitly do NOT call tray.setContextMenu()
    // because macOS auto-binds that menu to left-click, which would collide
    // with our togglePopover() and produce two popups at once.
    // Left + right click both show the menu (standard menu-bar app pattern).
    // The popover is accessed via "View triggering tickets…" inside the menu.
    this.tray.on('click', () => this.showMenu());
    this.tray.on('right-click', () => this.showMenu());
    this.menu = null;
    this.rebuildMenu({ status: 'idle', alerts: [], snoozed: false });
  }

  destroy() {
    this.stopPulse();
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
    if (this.popover && !this.popover.isDestroyed()) this.popover.close();
    this.popover = null;
  }

  loadTrayIcon(name, { template = false } = {}) {
    const key = `${name}:${template ? 't' : 'c'}`;
    if (this.iconCache[key]) return this.iconCache[key];
    const file = path.join(TRAY_DIR, `${name}.png`);
    const img = nativeImage.createFromPath(file);
    if (img.isEmpty()) {
      console.warn('[tray] image is empty:', file);
    } else {
      console.log('[tray] loaded', name, img.getSize(), template ? '(template)' : '');
    }
    if (template) img.setTemplateImage(true);
    this.iconCache[key] = img;
    return img;
  }

  iconFor(state, frame = 0) {
    // Notification-stack glyph in 5 flavors. Idle/paused are template images
    // (macOS tints them to match the menu bar). Alerting + snoozed are full
    // color so they pop. Pulse animation swaps alert ↔ alert-dim every tick.
    if (state.status === 'alerting') {
      const variant = frame === 0 ? 'alert' : 'alert-dim';
      const img = this.loadTrayIcon(variant);
      if (!img.isEmpty()) return img;
    } else if (state.status === 'snoozed') {
      const img = this.loadTrayIcon('snoozed');
      if (!img.isEmpty()) return img;
    } else if (state.status === 'paused') {
      const img = this.loadTrayIcon('paused', { template: true });
      if (!img.isEmpty()) return img;
    } else {
      const img = this.loadTrayIcon('idle', { template: true });
      if (!img.isEmpty()) return img;
    }
    // Fallback if PNG missing: legacy NSStatus dots.
    let name = 'NSStatusAvailable';
    if (state.status === 'alerting') name = 'NSStatusUnavailable';
    else if (state.status === 'snoozed' || state.status === 'paused')
      name = 'NSStatusPartiallyAvailable';
    try {
      const img = nativeImage.createFromNamedImage(name);
      if (!img.isEmpty()) return img;
    } catch (_) {}
    return nativeImage.createEmpty();
  }

  startPulse() {
    if (this.pulseTimer) return;
    this.pulseFrame = 0;
    this.pulseTimer = setInterval(() => {
      if (!this.tray || this.tray.isDestroyed()) {
        this.stopPulse();
        return;
      }
      this.pulseFrame = this.pulseFrame === 0 ? 1 : 0;
      this.tray.setImage(this.iconFor({ status: 'alerting' }, this.pulseFrame));
    }, 650);
  }

  stopPulse() {
    if (this.pulseTimer) {
      clearInterval(this.pulseTimer);
      this.pulseTimer = null;
    }
  }

  setState(state) {
    if (!this.tray) return;
    this.tray.setImage(this.iconFor(state, 0));
    const activeCount = (state.alerts || []).filter((a) => !a.dismissed).length;
    let tip = 'Nowtify - all quiet';
    if (state.status === 'alerting') tip = `Nowtify - ${activeCount} alert${activeCount === 1 ? '' : 's'}`;
    else if (state.status === 'snoozed') tip = 'Nowtify - paused';
    else if (state.status === 'paused') tip = 'Nowtify - all triggers off';
    this.tray.setToolTip(tip);
    this.rebuildMenu(state);
    if (this.popover && !this.popover.isDestroyed()) {
      this.popover.webContents.send('popover:state', state);
    }
    // Drive the pulse animation off the canonical state.
    if (state.status === 'alerting') {
      this.startPulse();
    } else {
      this.stopPulse();
    }
    this.lastStatus = state.status;
  }

  rebuildMenu(state) {
    const activeCount = (state.alerts || []).filter((a) => !a.dismissed).length;
    const triggers = this.getTriggers ? this.getTriggers() : [];
    const statusLabel =
      state.status === 'alerting'
        ? `${activeCount} alert${activeCount === 1 ? '' : 's'}`
        : state.status === 'snoozed'
          ? 'Paused'
          : state.status === 'paused'
            ? 'All triggers off'
            : 'All quiet';

    const triggerItems = triggers.map((t) => ({
      label: t.label,
      type: 'checkbox',
      checked: Boolean(t.enabled),
      click: () => this.onToggleTrigger(t.id, !t.enabled),
    }));
    if (triggerItems.length === 0) {
      triggerItems.push({ label: 'No triggers configured', enabled: false });
    }

    this.menu = Menu.buildFromTemplate([
      { label: statusLabel, enabled: false },
      { type: 'separator' },
      { label: 'View alerts…', click: () => this.showPopover() },
      { type: 'separator' },
      { label: 'Triggers', submenu: triggerItems },
      {
        label: 'Pause pulse alerts',
        submenu: [
          { label: 'For 5 minutes', click: () => this.onSnooze(5) },
          { label: 'For 15 minutes', click: () => this.onSnooze(15) },
          { label: 'For 30 minutes', click: () => this.onSnooze(30) },
          { label: 'Until I resume', click: () => this.onSnooze('indefinite') },
          { type: 'separator' },
          {
            label: 'Resume now',
            click: () => this.onSnooze(0),
            enabled: state.snoozed === true,
          },
        ],
      },
      { label: 'Refresh now', click: () => this.onPoke() },
      { type: 'separator' },
      { label: 'Settings…', click: () => this.onOpenSettings() },
      { type: 'separator' },
      { label: 'Quit', click: () => this.onQuit() },
    ]);
    // Intentionally NOT calling this.tray.setContextMenu(this.menu) - see init().
  }

  showMenu() {
    if (this.menu) this.tray.popUpContextMenu(this.menu);
  }

  togglePopover() {
    if (this.popover && !this.popover.isDestroyed() && this.popover.isVisible()) {
      this.popover.hide();
      return;
    }
    this.showPopover();
  }

  showPopover() {
    if (!this.popover || this.popover.isDestroyed()) {
      this.popover = this.createPopover();
    }
    this.positionPopover();
    this.popover.show();
    this.popover.focus();
    this.popover.webContents.send('popover:state', this.getState());
  }

  createPopover() {
    const win = new BrowserWindow({
      width: 420,
      height: 440,
      frame: false,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      hasShadow: true,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'popover-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    win.loadFile(path.join(__dirname, '..', 'renderer', 'popover', 'popover.html'));
    win.on('blur', () => {
      if (!win.isDestroyed()) win.hide();
    });
    return win;
  }

  positionPopover() {
    if (!this.popover || !this.tray) return;
    const trayBounds = this.tray.getBounds();
    const winBounds = this.popover.getBounds();
    const display = screen.getDisplayNearestPoint({
      x: trayBounds.x,
      y: trayBounds.y,
    });

    let x = Math.round(trayBounds.x + trayBounds.width / 2 - winBounds.width / 2);
    let y = Math.round(trayBounds.y + trayBounds.height + 4);

    // Keep within display bounds
    const { x: dx, y: dy, width: dw, height: dh } = display.workArea;
    if (x < dx + 4) x = dx + 4;
    if (x + winBounds.width > dx + dw - 4) x = dx + dw - winBounds.width - 4;
    if (y + winBounds.height > dy + dh - 4) y = dy + dh - winBounds.height - 4;
    if (y < dy + 4) y = dy + 4;

    this.popover.setPosition(x, y, false);
  }
}

module.exports = { TrayManager };
