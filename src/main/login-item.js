// src/main/login-item.js
//
// Pure helpers for the launch-at-login (autostart) feature, testable without
// the Electron runtime. index.js wires the real app.getLoginItemSettings /
// app.setLoginItemSettings around these.

'use strict';

// Autostart defaults ON, but we apply that default only ONCE - tracked by a
// store flag - so we never re-force it after a user has turned it off (e.g. via
// the toggle, or the OS's own login-items list). Returns whether THIS launch
// should apply the default-on.
function shouldApplyDefaultOnLaunch(initialized) {
  return !initialized;
}

// Options object for app.setLoginItemSettings. `openAsHidden` (macOS only)
// starts the app without flashing a window on login; Windows launches straight
// to the tray regardless, so it is omitted there.
function loginItemOptions(openAtLogin, platform) {
  const on = Boolean(openAtLogin);
  const opts = { openAtLogin: on };
  if (platform === 'darwin') opts.openAsHidden = on;
  return opts;
}

module.exports = { shouldApplyDefaultOnLaunch, loginItemOptions };
