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

module.exports = {
  isMac,
  isWin,
  trayIconSpec,
  safeIconPath,
  trayStateColor,
  protocolClientArgs,
  shouldLockdownFile,
  lockdownFile,
};
