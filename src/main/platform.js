// src/main/platform.js
//
// Single source of truth for OS differences. Pure helpers take `platform`
// (and other inputs) explicitly so they can be unit-tested without mocking
// process.platform; thin wrappers at the bottom apply the real values.
const fs = require('fs');
const path = require('path');

const PLATFORM = process.platform;
const isMac = PLATFORM === 'darwin';
const isWin = PLATFORM === 'win32';

const STATUS_TO_BASENAME = {
  alerting: 'alert',
  snoozed: 'snoozed',
  paused: 'paused',
  idle: 'idle',
};

// Which tray icon file + template flag to use. macOS uses monochrome template
// PNGs for idle/paused (the menu bar tints them); Windows has no template
// concept and a dark taskbar, so it uses colored PNGs in a `win` subdir for
// every state. Returns a relative dir ('.' = the tray root).
function trayIconSpec(platform, status) {
  const base = STATUS_TO_BASENAME[status] || 'idle';
  if (platform === 'win32') {
    return { dir: 'win', file: `${base}.png`, template: false };
  }
  const template = base === 'idle' || base === 'paused';
  return { dir: '.', file: `${base}.png`, template };
}

// Guard against path traversal when building a tray-icon path. The segments
// are derived from internal status/variant state (never remote input), but the
// 2026-07 security assessment flagged the raw path.join calls, so we refuse any
// segment that isn't a plain filename component and verify the joined path
// stays inside baseDir. Returns the safe joined path, or null if unsafe.
const SAFE_ICON_SEGMENT = /^[A-Za-z0-9._-]+$/;
function safeIconPath(baseDir, ...segments) {
  for (const seg of segments) {
    if (typeof seg !== 'string' || seg === '..' || !SAFE_ICON_SEGMENT.test(seg)) {
      return null;
    }
  }
  const joined = path.join(baseDir, ...segments);
  const root = path.resolve(baseDir);
  const resolved = path.resolve(joined);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return joined;
}

// Fill color for the tray mark in a given state. Alerting uses the live
// trigger color (so the menu bar / taskbar shows WHICH trigger fired); the
// steady states use fixed hues. Used by the rasterizer on both platforms.
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

// IT-managed install: the MSI installs per-machine under Program Files
// (Intune / IT deploys new versions). The self-service .exe installs
// per-user under %LOCALAPPDATA%. On a managed install Nowtify must not
// self-update - that would drop a second, per-user copy next to IT's.
function isMachineWideInstall(platform, execPath, env) {
  if (platform !== 'win32' || !execPath) return false;
  const e = env || {};
  const exe = String(execPath).toLowerCase().replace(/\//g, '\\');
  const roots = [e.ProgramFiles, e.ProgramW6432, e['ProgramFiles(x86)']]
    .filter(Boolean)
    .map((r) => String(r).toLowerCase().replace(/\//g, '\\').replace(/\\+$/, '') + '\\');
  return roots.some((root) => exe.startsWith(root));
}

// Keep the screen-edge border out of screen shares / recordings while it
// stays visible to the user. macOS: always. Windows: only on Windows 10
// 2004 (build 19041) and later, which support "exclude from capture".
// Older Windows can only black the window out in captures, and since the
// overlay covers the whole display that would black out the entire shared
// screen - far worse than a visible border.
function shouldHideFromCapture(platform, osRelease) {
  if (platform === 'darwin') return true;
  if (platform !== 'win32') return false;
  const build = Number(String(osRelease || '').split('.')[2]);
  return Number.isFinite(build) && build >= 19041;
}

// Popover sizing + placement next to the tray icon. Same rules on both
// platforms; the difference is where the tray lives. macOS menu bar is at
// the top, so the popover opens BELOW the icon. The Windows taskbar is
// usually at the bottom, so it opens ABOVE (and a left/right/top taskbar
// still lands inside the screen via the clamp).
const POPOVER_DEFAULT_SIZE = { width: 460, height: 600 };
const POPOVER_MIN_SIZE = { width: 420, height: 440 };
const POPOVER_GAP = 4;

// Saved size -> usable size: falls back to the default for missing/garbage
// values, never smaller than the minimum, never bigger than the screen.
function clampPopoverSize(saved, workArea) {
  const pick = (v, def) => (Number.isFinite(v) && v > 0 ? Math.round(v) : def);
  const s = saved || {};
  const maxW = workArea ? workArea.width - POPOVER_GAP * 2 : Infinity;
  const maxH = workArea ? workArea.height - POPOVER_GAP * 2 : Infinity;
  const width = Math.min(Math.max(pick(s.width, POPOVER_DEFAULT_SIZE.width), POPOVER_MIN_SIZE.width), maxW);
  const height = Math.min(Math.max(pick(s.height, POPOVER_DEFAULT_SIZE.height), POPOVER_MIN_SIZE.height), maxH);
  return { width, height };
}

// Top-left position for a popover of `size` anchored to the tray icon.
function popoverPosition(trayBounds, size, workArea) {
  const { x: dx, y: dy, width: dw, height: dh } = workArea;
  const trayCenterY = trayBounds.y + trayBounds.height / 2;
  const trayAtBottom = trayCenterY > dy + dh / 2;
  let x = Math.round(trayBounds.x + trayBounds.width / 2 - size.width / 2);
  let y = trayAtBottom
    ? Math.round(trayBounds.y - size.height - POPOVER_GAP)
    : Math.round(trayBounds.y + trayBounds.height + POPOVER_GAP);
  x = Math.min(Math.max(x, dx + POPOVER_GAP), dx + dw - size.width - POPOVER_GAP);
  y = Math.min(Math.max(y, dy + POPOVER_GAP), dy + dh - size.height - POPOVER_GAP);
  return { x, y };
}

module.exports = {
  isMachineWideInstall,
  shouldHideFromCapture,
  POPOVER_MIN_SIZE,
  clampPopoverSize,
  popoverPosition,
  isMac,
  isWin,
  trayIconSpec,
  safeIconPath,
  trayStateColor,
  protocolClientArgs,
  shouldLockdownFile,
  lockdownFile,
};
