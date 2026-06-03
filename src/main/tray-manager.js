const path = require('path');
const { Tray, Menu, BrowserWindow, nativeImage, screen } = require('electron');

const TRAY_DIR = path.join(__dirname, '..', '..', 'assets', 'tray');

// Hex/rgba color sanitiser for the dynamic alert icon. The colour comes
// from per-trigger config (store.triggers[].color), which is user-editable
// in Settings — so we treat it as untrusted before splicing it into an
// SVG. Anything that doesn't look like a #rgb / #rrggbb is replaced with
// a safe red so the user still sees something fire.
function sanitizeColor(c) {
  if (typeof c === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c)) {
    return c;
  }
  return '#dc2626';
}

// Build the three-bar Nowtify mark coloured to the active trigger.
// All bars now render at full opacity (1.0) so the icon paints in the
// trigger's actual hue at every pixel. The 0.55/0.80/1.00 gradient
// from the dock-scale generator was too washed-out at the 22px tray
// scale - the top bar at 55% read as a fade rather than a stacked
// graphic next to the surrounding solid system icons.
//
// alpha is the pulse-loop dim factor (1.0 = full frame, 0.5 = dim
// frame). At dim, all bars drop to 50% opacity in lockstep, so the
// icon is still clearly visible (just calmer) instead of fading to
// near-transparent.
function buildAlertSVG(color, alpha) {
  const c = sanitizeColor(color);
  const o = alpha.toFixed(3);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">`
    + `<rect x="5"   y="5.0"  width="12" height="2.5" rx="1.25" fill="${c}" opacity="${o}"/>`
    + `<rect x="3.5" y="9.0"  width="15" height="3.0" rx="1.50" fill="${c}" opacity="${o}"/>`
    + `<rect x="2"   y="13.5" width="18" height="3.5" rx="1.75" fill="${c}" opacity="${o}"/>`
    + `</svg>`;
}

// nativeImage.createFromDataURL / createFromBuffer with SVG bytes
// returns empty on macOS in Electron 33 - those entry points only
// document PNG/JPEG support and the Skia path treats SVG as raw bitmap
// garbage. To get a coloured tray icon we have to rasterize the SVG to
// PNG ourselves first. We do that via a single hidden offscreen
// BrowserWindow (lazily created on first use, kept around for the life
// of the app since teardown costs more than the idle memory).
//
// Results are cached per colour so the pulse loop (650ms) doesn't kick
// off a render every tick. First time a new colour appears we return
// null and let the caller fall back to the legacy red PNG; the next
// pulse tick after the rasterize promise resolves picks up the cached
// coloured image.
let _rasterizerWindow = null;

function getRasterizerWindow() {
  if (_rasterizerWindow && !_rasterizerWindow.isDestroyed()) return _rasterizerWindow;
  _rasterizerWindow = new BrowserWindow({
    width: 64,
    height: 64,
    show: false,
    transparent: true,
    frame: false,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      offscreen: true,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  return _rasterizerWindow;
}

function destroyRasterizerWindow() {
  if (_rasterizerWindow && !_rasterizerWindow.isDestroyed()) {
    _rasterizerWindow.destroy();
  }
  _rasterizerWindow = null;
}

// Render SVG via the offscreen window AND force the resulting PNG
// down to exactly targetPx x targetPx pixels. The force-resize is
// load-bearing: capturePage on retina returns a NativeImage whose
// PNG bitmap is 2x the requested logical size (44 when we asked for
// 22), and macOS's addRepresentation reads the PNG header for the
// rep's dimensions. Without the resize, a "1x" rep tagged with a
// 44px PNG paints at 44 logical points - twice the correct menu-bar
// height. Resizing collapses both logical AND bitmap dimensions to
// the intended pixel count.
async function rasterizeSVGToExactPx(svg, targetPx) {
  const win = getRasterizerWindow();
  win.setBounds({ x: 0, y: 0, width: targetPx, height: targetPx });
  const html = `<!doctype html><html><head><style>
      html,body{margin:0;padding:0;background:transparent;width:${targetPx}px;height:${targetPx}px;overflow:hidden;}
      img{display:block;width:${targetPx}px;height:${targetPx}px;}
    </style></head><body>
    <img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}">
    </body></html>`;
  await win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'));
  await new Promise((resolve) => setTimeout(resolve, 80));
  const captured = await win.webContents.capturePage({
    x: 0, y: 0, width: targetPx, height: targetPx,
  });
  // Resize even if the captured size already looks right - this
  // forces both the logical AND bitmap dimensions to targetPx,
  // independent of whatever retina factor capturePage applied.
  return captured.resize({ width: targetPx, height: targetPx, quality: 'best' });
}

// Build a multi-rep NativeImage that matches the alert.png +
// alert@2x.png pattern exactly: a 22pt logical icon with a 22x22 PNG
// for 1x displays and a 44x44 PNG for retina. macOS Tray picks the
// right rep based on the menu-bar density - same code path the
// original tray icons go through.
async function buildColoredAlertImage(color, alpha) {
  // Bumped dim alpha from 0.4 -> 0.5 so the pulse cycle reads as a
  // breathing-not-blinking icon. At 0.4 the dim frame was so faded
  // it looked like the icon momentarily disappeared rather than
  // pulsed - making the pulse imperceptible to the user.
  const finalAlpha = alpha >= 1 ? 1 : 0.5;
  const svg = buildAlertSVG(color, finalAlpha);
  const [img22, img44] = await Promise.all([
    rasterizeSVGToExactPx(svg, 22),
    rasterizeSVGToExactPx(svg, 44),
  ]);
  const final = nativeImage.createEmpty();
  final.addRepresentation({
    scaleFactor: 1,
    dataURL: 'data:image/png;base64,' + img22.toPNG().toString('base64'),
  });
  final.addRepresentation({
    scaleFactor: 2,
    dataURL: 'data:image/png;base64,' + img44.toPNG().toString('base64'),
  });
  return final;
}

// Per-colour { full, dim } cache. Both frames precomputed so the pulse
// loop is a pure map lookup at 650ms cadence.
const alertImageCache = new Map();
const alertRasterizing = new Set();

// Kick off (or fast-skip) a rasterize for a given colour. When both
// frames land in the cache we call onReady so the tray can refresh
// without waiting for the next pulse tick.
function ensureAlertImagesForColor(color, onReady) {
  if (alertImageCache.has(color)) {
    if (onReady) onReady();
    return;
  }
  if (alertRasterizing.has(color)) return;
  alertRasterizing.add(color);
  (async () => {
    try {
      const [full, dim] = await Promise.all([
        buildColoredAlertImage(color, 1),
        buildColoredAlertImage(color, 0.4),
      ]);
      if (!full.isEmpty()) {
        alertImageCache.set(color, { full, dim });
        if (onReady) onReady();
      } else {
        console.warn('[tray] rasterize produced empty image for', color);
      }
    } catch (e) {
      console.warn('[tray] rasterize failed for', color, e && e.message);
    } finally {
      alertRasterizing.delete(color);
    }
  })();
}

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
    onInstallUpdate,
    getState,
    getTriggers,
    getUpdateStatus,
    getPulseTarget,
  }) {
    this.onOpenSettings = onOpenSettings;
    this.onSnooze = onSnooze;
    this.onPoke = onPoke;
    this.onQuit = onQuit;
    this.onToggleTrigger = onToggleTrigger;
    this.onInstallUpdate = onInstallUpdate;
    this.getState = getState;
    this.getTriggers = getTriggers;
    this.getUpdateStatus = getUpdateStatus;
    // Reads the live pulseTarget setting at decision time so flipping it
    // in Settings takes effect without restarting. Falls back to 'both'
    // if the host forgot to wire it.
    this.getPulseTarget = getPulseTarget || (() => 'both');
    this.tray = null;
    this.popover = null;
    this.iconCache = {};
    this.pulseTimer = null;
    this.pulseFrame = 0;
    this.lastStatus = null;
  }

  // Surfaced when an update has been downloaded so the tray-menu rebuild
  // can prepend an "Install vX.Y.Z" item at the top.
  refreshMenuForUpdate() {
    const state = this.getState ? this.getState() : { status: 'idle', alerts: [] };
    this.rebuildMenu(state);
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
    // Tear down the offscreen SVG rasterizer too - it's process-wide
    // (module-level singleton) but the only consumer is this manager,
    // so a manager destroy is the right tear-down point.
    destroyRasterizerWindow();
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
    // Notification-stack glyph in 5 flavors. Idle/paused stay template
    // images (macOS auto-tints them to the menu-bar foreground). When
    // alerting, we now build the bars dynamically in the active trigger's
    // colour so the menu bar itself communicates which trigger is firing
    // (red Major Incident vs amber SLA vs purple Approval, etc.). Falls
    // back to the legacy alert.png pair if no colour is available on the
    // state - shouldn't happen in practice since alert-engine always
    // emits a colour when alerting.
    if (state.status === 'alerting') {
      if (state.color) {
        const cached = alertImageCache.get(state.color);
        if (cached) {
          return frame === 0 ? cached.full : cached.dim;
        }
        // First time we see this colour: kick off async rasterize and
        // fall through to the red PNG for THIS tick. Once the cache
        // populates we repaint immediately via the onReady callback.
        ensureAlertImagesForColor(state.color, () => {
          if (this.tray && !this.tray.isDestroyed()) {
            const s = this.getState ? this.getState() : null;
            if (s && s.status === 'alerting') {
              this.tray.setImage(this.iconFor(s, this.pulseFrame));
            }
          }
        });
      }
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
    console.log('[tray] startPulse: kicking off 650ms tray-icon pulse loop');
    this.pulseFrame = 0;
    this.pulseTimer = setInterval(() => {
      if (!this.tray || this.tray.isDestroyed()) {
        this.stopPulse();
        return;
      }
      this.pulseFrame = this.pulseFrame === 0 ? 1 : 0;
      // Pull the live state so the pulse keeps the current trigger
      // colour even if the top alert switched mid-animation (e.g. a
      // Major Incident clears and SLA takes over).
      const state = this.getState
        ? this.getState()
        : { status: 'alerting' };
      this.tray.setImage(this.iconFor(state, this.pulseFrame));
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
    // Drive the pulse animation off the canonical state, BUT gate it
    // on the user's pulseTarget preference. The tray icon itself still
    // switches to the active trigger's colour the moment alerting
    // begins (so users in 'screen' mode still have an always-on
    // indicator in the menu bar); only the breathing animation is
    // conditional. 'tray' and 'both' get the pulse; 'screen' gets a
    // static coloured icon.
    if (state.status === 'alerting') {
      const target = this.getPulseTarget();
      if (target === 'tray' || target === 'both') {
        this.startPulse();
      } else {
        this.stopPulse();
      }
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

    // If an update has been downloaded and is waiting, surface it at the
    // top of the menu - same place users glance most often. Click to
    // install (app quits, helper swaps bundle, relaunches on new version).
    const updateStatus = this.getUpdateStatus ? this.getUpdateStatus() : null;
    const updateReady =
      updateStatus && updateStatus.result && updateStatus.result.type === 'downloaded';
    const updateItems = updateReady
      ? [
          {
            label: `↑ Install update v${updateStatus.result.version || ''}`,
            click: () => this.onInstallUpdate && this.onInstallUpdate(),
          },
          { type: 'separator' },
        ]
      : [];

    this.menu = Menu.buildFromTemplate([
      ...updateItems,
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
        // Sandbox the popover renderer. contextBridge + ipcRenderer are
        // sandbox-compatible, so this is a no-impact change for the
        // existing UI.
        sandbox: true,
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
