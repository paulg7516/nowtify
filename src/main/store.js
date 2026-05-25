const fs = require('fs');
const { app, safeStorage } = require('electron');
const Store = require('electron-store');

const defaults = {
  jsm: {
    siteUrl: '',
    email: '',
    apiToken: '',
    majorIncidentFieldId: '',
  },
  watchList: [],
  watchGroups: [],
  triggers: [
    {
      id: 'major-incident',
      type: 'major',
      label: 'Major Incident = true',
      enabled: true,
      color: '#ff0033',
      pulse: true,
    },
    {
      id: 'sla-breach-imminent',
      type: 'sla',
      label: 'SLA breach < 30 min',
      enabled: true,
      color: '#ff8800',
      pulse: true,
      thresholdMinutes: 30,
    },
    {
      id: 'sla-breached',
      type: 'sla',
      label: 'SLA already breached',
      enabled: true,
      color: '#ff0033',
      pulse: true,
      thresholdMinutes: 0,
    },
  ],
  pollIntervalSeconds: 30,
  snoozeUntil: 0,
};

const store = new Store({
  name: 'sla-overlay-config',
  defaults,
});

// Restrict config file to owner read/write only. electron-store writes 0644 by
// default; we drop group + other so backup tools, sync utilities, and any
// other process not running as this user cannot read the encrypted token blob.
function lockdownConfigFile() {
  try {
    fs.chmodSync(store.path, 0o600);
  } catch (err) {
    console.warn('[store] chmod 600 failed on', store.path, err.message);
  }
}

// One-time lockdown at startup so the file is locked even if the user never
// saves anything in this session.
if (app.isReady()) lockdownConfigFile();
else app.whenReady().then(lockdownConfigFile);

/* ------------------------ API token encryption ------------------------ *
 * The Atlassian API token is the only secret we hold. Everything else
 * (siteUrl, email, watch list, triggers) is non-sensitive config.
 *
 * At rest: token is encrypted via Electron safeStorage (which delegates to
 * macOS Keychain) and persisted as base64 under jsm.apiTokenEnc. The legacy
 * plaintext field (jsm.apiToken) is migrated to encrypted form on first read
 * after upgrade and then deleted.
 *
 * In memory: decrypted only on demand inside the main process, never sent
 * to renderers (settings:get redacts it - see getAllForRenderer).
 * --------------------------------------------------------------------- */

function readDecryptedToken() {
  const enc = store.get('jsm.apiTokenEnc');
  if (enc && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'));
    } catch (err) {
      console.warn('[store] failed to decrypt token:', err.message);
      return '';
    }
  }
  // Legacy plaintext - migrate transparently on first read. Best-effort:
  // if Keychain access is unavailable we keep the plaintext (with file mode
  // 0600 as the only protection) so the app still functions, and retry the
  // migration on the next launch.
  const plain = store.get('jsm.apiToken');
  if (plain) {
    try {
      writeEncryptedToken(plain);
    } catch (err) {
      console.warn(
        '[store] token migration to encrypted form failed - keeping plaintext for now:',
        err.message,
      );
      lockdownConfigFile();
    }
    return plain;
  }
  return '';
}

function writeEncryptedToken(token) {
  if (!token) {
    store.delete('jsm.apiTokenEnc');
    store.delete('jsm.apiToken');
    lockdownConfigFile();
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    // safeStorage falls back to plaintext on systems where the OS keystore
    // is unavailable. We refuse to store the token in that case rather than
    // silently downgrading to disk plaintext.
    throw new Error(
      'OS keystore (Keychain) is not available - cannot store API token securely. ' +
        'Make sure macOS Keychain access is enabled for Nowtify.',
    );
  }
  const enc = safeStorage.encryptString(token);
  store.set('jsm.apiTokenEnc', enc.toString('base64'));
  store.delete('jsm.apiToken'); // wipe any legacy plaintext
  lockdownConfigFile();
}

/* ------------------------ public API ------------------------ */

// Internal getter: returns full jsm config with decrypted token. Used by the
// alert engine + JsmClient. Never expose this shape to renderers.
function getJsm() {
  const jsm = store.get('jsm') || {};
  return {
    siteUrl: jsm.siteUrl || '',
    email: jsm.email || '',
    apiToken: readDecryptedToken(),
    majorIncidentFieldId: jsm.majorIncidentFieldId || '',
  };
}

function setJsm(patch) {
  const current = store.get('jsm') || {};
  const next = {
    siteUrl: typeof patch.siteUrl === 'string' ? patch.siteUrl : current.siteUrl || '',
    email: typeof patch.email === 'string' ? patch.email : current.email || '',
    majorIncidentFieldId:
      typeof patch.majorIncidentFieldId === 'string'
        ? patch.majorIncidentFieldId
        : current.majorIncidentFieldId || '',
  };
  // Save non-secret fields. apiToken goes through encrypted channel below.
  store.set('jsm', next);

  // Token: only update if caller provided a non-empty new value. Empty string
  // means "keep existing" (the renderer never sees the real value, so it
  // can't echo it back on save).
  if (typeof patch.apiToken === 'string' && patch.apiToken.length > 0) {
    writeEncryptedToken(patch.apiToken);
  }
  lockdownConfigFile();
}

function get(key) {
  if (key === 'jsm') return getJsm();
  return store.get(key);
}

function set(key, value) {
  if (key === 'jsm') {
    setJsm(value || {});
    return;
  }
  store.set(key, value);
}

// Renderer-safe snapshot: replaces the API token with a presence boolean.
// Renderer code uses hasApiToken for UI state and never receives the real
// secret. The actual token value never leaves the main process.
function getAllForRenderer() {
  const all = store.store;
  const jsm = all.jsm || {};
  const hasApiToken = Boolean(jsm.apiTokenEnc || jsm.apiToken);
  return {
    ...all,
    jsm: {
      siteUrl: jsm.siteUrl || '',
      email: jsm.email || '',
      majorIncidentFieldId: jsm.majorIncidentFieldId || '',
      apiToken: '', // never sent to renderer
      hasApiToken,
    },
  };
}

function addWatchee(user) {
  const list = store.get('watchList') || [];
  if (list.some((u) => u.accountId === user.accountId)) return list;
  const next = [...list, user];
  store.set('watchList', next);
  return next;
}

function removeWatchee(accountId) {
  const list = store.get('watchList') || [];
  const next = list.filter((u) => u.accountId !== accountId);
  store.set('watchList', next);
  return next;
}

function addGroup(group) {
  const list = store.get('watchGroups') || [];
  if (list.some((g) => g.name === group.name)) return list;
  const next = [...list, group];
  store.set('watchGroups', next);
  return next;
}

function removeGroup(groupName) {
  const list = store.get('watchGroups') || [];
  const next = list.filter((g) => g.name !== groupName);
  store.set('watchGroups', next);
  return next;
}

const INDEFINITE_SNOOZE = Number.MAX_SAFE_INTEGER;

function setSnooze(minutes) {
  let until;
  if (minutes === 'indefinite') until = INDEFINITE_SNOOZE;
  else if (minutes > 0) until = Date.now() + minutes * 60_000;
  else until = 0;
  store.set('snoozeUntil', until);
  return until;
}

function isSnoozed() {
  const until = store.get('snoozeUntil') || 0;
  return until > Date.now();
}

function setTriggerEnabled(triggerId, enabled) {
  const list = store.get('triggers') || [];
  const next = list.map((t) => (t.id === triggerId ? { ...t, enabled: Boolean(enabled) } : t));
  store.set('triggers', next);
  return next;
}

function updateTrigger(triggerId, patch) {
  const list = store.get('triggers') || [];
  const next = list.map((t) => (t.id === triggerId ? { ...t, ...patch } : t));
  store.set('triggers', next);
  return next;
}

function addTrigger(trigger) {
  const list = store.get('triggers') || [];
  const id = trigger.id || `trigger-${Date.now()}`;
  const next = [...list, { ...trigger, id }];
  store.set('triggers', next);
  return next;
}

function removeTrigger(triggerId) {
  const list = store.get('triggers') || [];
  const next = list.filter((t) => t.id !== triggerId);
  store.set('triggers', next);
  return next;
}

module.exports = {
  get,
  set,
  getAll: getAllForRenderer,
  addWatchee,
  removeWatchee,
  addGroup,
  removeGroup,
  setSnooze,
  isSnoozed,
  setTriggerEnabled,
  updateTrigger,
  addTrigger,
  removeTrigger,
};
