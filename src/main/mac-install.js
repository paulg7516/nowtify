/**
 * macOS self-update: can this copy of Nowtify replace itself, and the
 * helper script that does the swap.
 *
 * Why this exists: Nowtify on Mac is unsigned, so updates are applied by a
 * detached bash helper (Squirrel.Mac refuses unsigned bundles). The helper
 * runs as the signed-in user. When the app belongs to another account
 * (installed by IT / Intune or an admin account), the old helper's
 * `rm -rf` failed with "Permission denied", the new version never landed,
 * the old one relaunched and offered the same update again - forever.
 *
 * Now: (1) copies that can't replace themselves are treated as managed by
 * IT and never offered an install, (2) the swap moves the old app aside
 * instead of deleting it, verifies the new version, and rolls back on any
 * failure, and (3) the result is written to a file so a failed version is
 * never offered again.
 */

const fs = require('fs');
const path = require('path');

/** /Applications/Nowtify.app/Contents/MacOS/Nowtify -> /Applications/Nowtify.app */
function appBundlePathFrom(execPath) {
  return path.dirname(path.dirname(path.dirname(execPath)));
}

/**
 * True only if the signed-in user can swap this bundle: it must not be on
 * a read-only disk image or a macOS quarantine copy (App Translocation),
 * and the user must be able to write the bundle and the folder it's in.
 */
function canReplaceAppBundle(bundlePath, access = (p) => fs.accessSync(p, fs.constants.W_OK)) {
  if (!bundlePath) return false;
  if (bundlePath.startsWith('/Volumes/') || bundlePath.includes('/AppTranslocation/')) return false;
  for (const p of [bundlePath, path.join(bundlePath, 'Contents'), path.dirname(bundlePath)]) {
    try {
      access(p);
    } catch (_) {
      return false;
    }
  }
  return true;
}

const sh = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

/**
 * Bash helper that waits for Nowtify to quit, then swaps in the update:
 *   move old app aside -> move new app in -> check its version ->
 *   delete the old copy. Any failure puts the old app back, records
 *   "failed <version> <reason>" in resultPath, and relaunches the old app.
 *   Success records "ok <version>".
 */
function buildInstallScript({ pid, bundlePath, zipPath, newVersion, tmpDir, logPath, resultPath, launch = 'open' }) {
  const newApp = path.join(tmpDir, 'Nowtify.app');
  const backup = path.join(path.dirname(bundlePath), `.Nowtify-previous-${path.basename(tmpDir)}.app`);
  const plistVersion = (app) =>
    `/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' ${sh(path.join(app, 'Contents', 'Info.plist'))} 2>/dev/null`;
  return `#!/bin/bash
exec >>${sh(logPath)} 2>&1
echo "[$(date)] install helper starting v${newVersion}"
echo "  pid=${pid} bundle=${bundlePath} zip=${zipPath}"

fail() {
  echo "FAILED: $1"
  printf 'failed %s %s\\n' ${sh(newVersion)} "$1" > ${sh(resultPath)}
  rm -rf ${sh(tmpDir)}
  ${launch} ${sh(bundlePath)}
  exit 1
}

# Wait for Nowtify to exit (up to 30s)
for i in $(seq 1 60); do
  if ! kill -0 ${pid} 2>/dev/null; then break; fi
  sleep 0.5
done
sleep 1

mkdir -p ${sh(tmpDir)}
cd ${sh(tmpDir)} || fail staging
unzip -q -o ${sh(zipPath)} || fail unzip
[ -d ${sh(newApp)} ] || fail missing-app
[ "$(${plistVersion(newApp)})" = ${sh(newVersion)} ] || fail wrong-version-in-download

# Swap: never delete the old app until the new one is verified in place.
mv ${sh(bundlePath)} ${sh(backup)} || fail cannot-move-old-app
if ! mv ${sh(newApp)} ${sh(bundlePath)}; then
  mv ${sh(backup)} ${sh(bundlePath)}
  fail cannot-place-new-app
fi
if [ "$(${plistVersion(bundlePath)})" != ${sh(newVersion)} ]; then
  rm -rf ${sh(bundlePath)}
  mv ${sh(backup)} ${sh(bundlePath)}
  fail version-check
fi
rm -rf ${sh(backup)}
xattr -dr com.apple.quarantine ${sh(bundlePath)} 2>/dev/null || true

# Re-register with Launch Services so nowtify:// (OAuth callback) keeps
# working after the swap.
LSREGISTER='/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister'
if [ -x "\${LSREGISTER}" ]; then
  "\${LSREGISTER}" -f ${sh(bundlePath)} 2>/dev/null || true
fi

rm -rf ${sh(tmpDir)}
printf 'ok %s\\n' ${sh(newVersion)} > ${sh(resultPath)}
${launch} ${sh(bundlePath)}
echo "[$(date)] install helper done"
`;
}

/** Last install result: { ok, version, reason } or null. */
function readInstallResult(resultPath) {
  try {
    const [status, version, reason] = fs.readFileSync(resultPath, 'utf8').trim().split(/\s+/);
    if (!version || (status !== 'ok' && status !== 'failed')) return null;
    return { ok: status === 'ok', version, reason: reason || '' };
  } catch (_) {
    return null;
  }
}

module.exports = { appBundlePathFrom, canReplaceAppBundle, buildInstallScript, readInstallResult };
