'use strict';

// Pure helpers for the auto-updater, deliberately free of electron imports so
// they can be unit-tested under `node --test` (updater.js itself requires
// electron and can't load outside the Electron runtime).

/**
 * True when an updater error means the cached download is partial/corrupt.
 *
 * A poisoned cache fails the sha512/size check on EVERY retry until the cache
 * is cleared, which looks to the user like "can't download the update". We only
 * flag integrity-class errors here - clearing the cache fixes those. Network /
 * timeout / "release not found" errors are intentionally NOT flagged: purging
 * the cache wouldn't help and a purge+retry loop would just thrash.
 */
function isPoisonedCacheError(message) {
  if (!message) return false;
  const m = String(message).toLowerCase();
  return (
    m.includes('sha512') ||
    m.includes('checksum') ||
    m.includes('integrity') ||
    m.includes('mismatch')
  );
}

module.exports = { isPoisonedCacheError };
