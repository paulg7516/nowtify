const path = require('path');
const { Tray, Menu, BrowserWindow, nativeImage, screen } = require('electron');

/**
 * Tray + popover window. The popover is a small frameless window positioned
 * near the tray icon, showing the list of triggering tickets.
 */
class TrayManager {
  constructor({
    onOpenSettings,
    onSnooze,
    onClearDismissals,
    onPoke,
    onQuit,
    onToggleTrigger,
    getState,
    getTriggers,
  }) {
    this.onOpenSettings = onOpenSettings;
    this.onSnooze = onSnooze;
    this.onClearDismissals = onClearDismissals;
    this.onPoke = onPoke;
    this.onQuit = onQuit;
    this.onToggleTrigger = onToggleTrigger;
    this.getState = getState;
    this.getTriggers = getTriggers;
    this.tray = null;
    this.popover = null;
  }

  init() {
    this.tray = new Tray(this.iconFor({ status: 'idle' }));
    this.tray.setToolTip('SLA Overlay — idle');
    this.tray.on('click', () => this.togglePopover());
    this.tray.on('right-click', () => this.showMenu());
    this.rebuildMenu({ status: 'idle', alerts: [], snoozed: false });
  }

  destroy() {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
    if (this.popover && !this.popover.isDestroyed()) this.popover.close();
    this.popover = null;
  }

  iconFor(state) {
    let name = 'NSStatusAvailable';
    if (state.status === 'alerting') name = 'NSStatusUnavailable';
    else if (state.status === 'snoozed' || state.status === 'paused')
      name = 'NSStatusPartiallyAvailable';
    try {
      const img = nativeImage.createFromNamedImage(name);
      if (!img.isEmpty()) return img;
    } catch (_) {
      // ignore — non-mac platforms or missing named image
    }
    // Fallback: empty 16x16 image (will appear as blank label)
    return nativeImage.createEmpty();
  }

  setState(state) {
    if (!this.tray) return;
    this.tray.setImage(this.iconFor(state));
    const count = (state.alerts || []).length;
    let tip = 'SLA Overlay — idle';
    if (state.status === 'alerting') tip = `SLA Overlay — ${count} alert${count === 1 ? '' : 's'}`;
    else if (state.status === 'snoozed') tip = 'SLA Overlay — snoozed';
    else if (state.status === 'paused') tip = 'SLA Overlay — all triggers off';
    this.tray.setToolTip(tip);
    this.rebuildMenu(state);
    if (this.popover && !this.popover.isDestroyed()) {
      this.popover.webContents.send('popover:state', state);
    }
  }

  rebuildMenu(state) {
    const count = (state.alerts || []).length;
    const triggers = this.getTriggers ? this.getTriggers() : [];
    const statusLabel =
      state.status === 'alerting'
        ? `${count} triggering ticket${count === 1 ? '' : 's'}`
        : state.status === 'snoozed'
          ? 'Snoozed'
          : state.status === 'paused'
            ? 'All triggers off'
            : 'No active alerts';

    const triggerItems = triggers.map((t) => ({
      label: t.label,
      type: 'checkbox',
      checked: Boolean(t.enabled),
      click: () => this.onToggleTrigger(t.id, !t.enabled),
    }));
    if (triggerItems.length === 0) {
      triggerItems.push({ label: 'No triggers configured', enabled: false });
    }

    const menu = Menu.buildFromTemplate([
      { label: statusLabel, enabled: false },
      { type: 'separator' },
      { label: 'View triggering tickets…', click: () => this.showPopover() },
      { type: 'separator' },
      { label: 'Triggers', submenu: triggerItems },
      {
        label: 'Snooze',
        submenu: [
          { label: '5 minutes', click: () => this.onSnooze(5) },
          { label: '15 minutes', click: () => this.onSnooze(15) },
          { label: '30 minutes', click: () => this.onSnooze(30) },
          { type: 'separator' },
          {
            label: 'End snooze',
            click: () => this.onSnooze(0),
            enabled: state.snoozed === true,
          },
        ],
      },
      { label: 'Clear all dismissals', click: () => this.onClearDismissals() },
      { label: 'Refresh now', click: () => this.onPoke() },
      { type: 'separator' },
      { label: 'Settings…', click: () => this.onOpenSettings() },
      { type: 'separator' },
      { label: 'Quit', click: () => this.onQuit() },
    ]);
    this.tray.setContextMenu(menu);
  }

  showMenu() {
    this.tray.popUpContextMenu();
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
      width: 440,
      height: 520,
      frame: false,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
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
