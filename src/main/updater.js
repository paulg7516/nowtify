const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { app, dialog, Notification } = require('electron');
const { autoUpdater } = require('electron-updater');
const platform = require('./platform');
const { isPoisonedCacheError } = require('./updater-errors');
const macInstall = require('./mac-install');

/**
 * Directory electron-updater stores downloads in, matching the path it logs
 * ("updater cache dir: .../nowtify-updater"). Used to purge a poisoned cache
 * so a corrupt/partial download can't fail the checksum forever.
 *   macOS:        ~/Library/Caches/nowtify-updater
 *   Windows/Linux: <app cache>/nowtify-updater
 */
function updaterCacheDir() {
  try {
    if (process.platform === 'darwin') {
      return path.join(app.getPath('home'), 'Library', 'Caches', 'nowtify-updater');
    }
    return path.join(app.getPath('cache'), 'nowtify-updater');
  } catch (_) {
    return null;
  }
}

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
function performUnsignedUpdateMac(zipPath, newVersion) {
  const appBundlePath = macInstall.appBundlePathFrom(process.execPath);
  // One timestamp for both paths so the staging dir and helper script always
  // share a suffix. os.tmpdir() is per-user on macOS (/var/folders/...), not
  // the shared /tmp, so there is no cross-user race.
  const stamp = Date.now();
  const tmpDir = path.join(os.tmpdir(), `nowtify-install-${stamp}`);
  const helperPath = path.join(os.tmpdir(), `nowtify-install-${stamp}.sh`);
  const script = macInstall.buildInstallScript({
    pid: process.pid,
    bundlePath: appBundlePath,
    zipPath,
    newVersion,
    tmpDir,
    logPath: path.join(os.tmpdir(), 'nowtify-install.log'),
    resultPath: installResultPath(),
  });

  fs.writeFileSync(helperPath, script, { mode: 0o755 });

  const child = spawn('/bin/bash', [helperPath], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  console.log('[updater] manual install helper spawned, pid', child.pid);
}

// Where the Mac install helper records "ok <version>" / "failed <version> <reason>".
function installResultPath() {
  return path.join(app.getPath('userData'), 'last-update-install.txt');
}

/**
 * Apply the already-downloaded update, branching by platform.
 *
 * Windows: NSIS installs unsigned updates natively, so the standard
 * electron-updater quitAndInstall() is the supported path.
 *
 * macOS: Squirrel.Mac silently fails on unsigned bundles, so we hand the
 * swap off to a detached bash helper (performUnsignedUpdateMac) that takes
 * over after we quit.
 *
 * Returns true when an install was kicked off, false when there was nothing
 * to install (no downloaded file on macOS).
 */
function installDownloadedUpdate(updaterStatus) {
  // IT-managed installs never install here (see setupAutoUpdater).
  if (updaterStatus.managed) return false;
  if (platform.isWin) {
    // NSIS installs unsigned updates natively; this is the supported path.
    autoUpdater.quitAndInstall();
    return true;
  }
  if (updaterStatus.downloadedFile) {
    performUnsignedUpdateMac(updaterStatus.downloadedFile, updaterStatus.result.version || '');
    app.quit();
    return true;
  }
  return false;
}

const MANAGED_NOTE = 'Kept up to date by your IT administrator';

function setupAutoUpdater(ctx) {
  const { updaterStatus, broadcastUpdaterStatus, getSettingsWin, refreshTrayForUpdate, getAppDialogIcon } = ctx;
  // IT-managed (per-machine MSI) installs: still check, so the user can see
  // a newer version exists, but never download or install - IT deploys it.
  autoUpdater.autoDownload = !updaterStatus.managed;
  // Squirrel.Mac can't install unsigned updates on quit either - disable so
  // updates only apply via our manual helper (triggered by the Restart-now
  // dialog button).
  autoUpdater.autoInstallOnAppQuit = false;
  updaterStatus.currentVersion = app.getVersion();

  // If the Mac helper couldn't install a version, never offer that same
  // version again (that was the "Restart now" loop). Cleared once a newer
  // version shows up or an install succeeds.
  const lastInstall = process.platform === 'darwin' ? macInstall.readInstallResult(installResultPath()) : null;
  const failedVersion = lastInstall && !lastInstall.ok && lastInstall.version !== app.getVersion() ? lastInstall.version : null;
  if (lastInstall) console.log('[updater] last install attempt:', lastInstall);

  // One-shot guard so a poisoned-cache heal (purge + re-check) can't loop. It
  // is reset only on a genuine success signal (update-downloaded /
  // update-not-available), so a persistently failing download surfaces the
  // error after a single heal attempt instead of thrashing.
  let cacheHealAttempted = false;
  autoUpdater.on('checking-for-update', () => {
    updaterStatus.result = { type: 'checking', message: 'Checking for updates…', version: '' };
    broadcastUpdaterStatus();
  });
  autoUpdater.on('update-available', (info) => {
    console.log('[updater] update available:', info.version);
    if (updaterStatus.managed) {
      cacheHealAttempted = false;
      updaterStatus.lastCheckedAt = Date.now();
      updaterStatus.result = {
        type: 'managed',
        message: `Version ${info.version} is available. ${MANAGED_NOTE}.`,
        version: info.version,
      };
      broadcastUpdaterStatus();
      refreshTrayForUpdate();
      return;
    }
    updaterStatus.result = {
      type: 'available',
      message: `Update v${info.version} found - downloading…`,
      version: info.version,
    };
    broadcastUpdaterStatus();
  });
  autoUpdater.on('update-not-available', () => {
    console.log('[updater] up to date');
    cacheHealAttempted = false;
    updaterStatus.lastCheckedAt = Date.now();
    updaterStatus.result = { type: 'up-to-date', message: 'You are on the latest version', version: '' };
    broadcastUpdaterStatus();
    // Clears a stale "managed update available" tray item once IT has
    // rolled the new version out.
    refreshTrayForUpdate();
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
    if (failedVersion && info.version === failedVersion) {
      updaterStatus.lastCheckedAt = Date.now();
      updaterStatus.result = {
        type: 'error',
        message: `Version ${info.version} couldn't be installed automatically on this Mac. Ask IT to install it, or download it from the Nowtify releases page.`,
        version: info.version,
      };
      broadcastUpdaterStatus();
      return;
    }
    cacheHealAttempted = false;
    updaterStatus.lastCheckedAt = Date.now();
    updaterStatus.downloadedFile = info && (info.downloadedFile || info.path);
    updaterStatus.result = {
      type: 'downloaded',
      message: `Update v${info.version} downloaded - ready to install`,
      version: info.version,
    };
    broadcastUpdaterStatus();
    // Rebuild the tray menu so the new "Install update vX.Y.Z" item
    // appears at the top of the right-click menu immediately.
    refreshTrayForUpdate();

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
    if (Notification.isSupported()) {
      try {
        const n = new Notification({
          title: 'Nowtify update ready',
          body: `Version ${info.version} is ready - click to install now.`,
          silent: false,
          // No explicit icon - macOS already draws the app's bundle
          // icon on the LEFT of every notification banner. Setting
          // `icon` adds a SECOND tile on the right (contentImage),
          // which makes the banner read as doubled.
        });
        n.on('click', () => {
          installDownloadedUpdate(updaterStatus);
        });
        n.show();
      } catch (_) {}
    }

    // If the user has the Settings window open, anchor the dialog to it so
    // it appears as a sheet rather than a free-floating window.
    const settingsWin = getSettingsWin();
    const parent =
      settingsWin && !settingsWin.isDestroyed() ? settingsWin : undefined;
    const dialogIcon = getAppDialogIcon();
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
      // Pass the icon explicitly so freshly-installed unsigned bundles
      // with LSUIElement: true don't render with the generic system icon
      // (Launch Services takes time to register bundle icons for
      // unsigned + dockless apps).
      ...(dialogIcon ? { icon: dialogIcon } : {}),
    });

    if (response === 0) {
      // Bypass Squirrel.Mac (which silently fails for unsigned bundles) and
      // hand the swap off to a detached bash helper that takes over after we
      // quit. On Windows, NSIS handles the unsigned install natively. See
      // installDownloadedUpdate.
      installDownloadedUpdate(updaterStatus);
    } else if (dockWasHidden && process.platform === 'darwin' && app.dock && app.dock.hide) {
      // Re-hide the dock only on the Later path. On Restart, we're about to
      // quit so the dock hide is pointless and racing the install helper.
      app.dock.hide();
    }
  });
  autoUpdater.on('error', (err) => {
    const msg = (err && (err.message || String(err))) || 'Update failed';
    console.warn('[updater] error:', msg);

    // Self-heal a poisoned download cache. A partial/corrupt pending download
    // fails the sha512 check on every retry, which reads to the user as "can't
    // download the update". Purge the cache once and re-check so the next
    // download starts clean - guarded so a genuinely persistent failure can't
    // loop (see cacheHealAttempted).
    if (isPoisonedCacheError(msg) && !cacheHealAttempted) {
      cacheHealAttempted = true;
      const dir = updaterCacheDir();
      let purged = false;
      if (dir) {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
          purged = true;
        } catch (e) {
          console.warn('[updater] cache purge failed:', e.message);
        }
      }
      console.warn(
        '[updater] poisoned update cache', purged ? 'purged' : 'not purged', '- re-checking'
      );
      updaterStatus.result = {
        type: 'checking',
        message: 'Update cache was reset - retrying…',
        version: '',
      };
      broadcastUpdaterStatus();
      // Kick the re-check off the current stack so the failed download fully
      // unwinds first. Swallow its rejection; a second failure surfaces via
      // this same handler (now with cacheHealAttempted=true).
      Promise.resolve().then(() => autoUpdater.checkForUpdates()).catch((e) => {
        console.warn('[updater] retry check failed:', e && e.message);
      });
      return;
    }

    updaterStatus.lastCheckedAt = Date.now();
    updaterStatus.result = {
      type: 'error',
      message: msg,
      version: '',
    };
    broadcastUpdaterStatus();
  });
}

module.exports = { setupAutoUpdater, installDownloadedUpdate, MANAGED_NOTE };
