// Integration test for the watchlist-PII encryption WIRING in store.js.
//
// secure-fields.test.js proves the crypto primitives. This drives the REAL
// store.js (its migration, its centralized load/save routing, getAllForRenderer,
// getTeams, and the trigger/teams CRUD) against a realistic config shape, with
// electron + electron-store mocked so it runs in plain node (no Electron
// runtime, no OS keystore). It catches the failure modes that matter: a missed
// call site writing plaintext, ciphertext leaking to the renderer, or data loss
// on migration.
//
// The fake store write-throughs to a temp JSON file on every set, so the file
// on disk is the true "at rest" state we assert against - exactly what a
// security reviewer would grep.
//
// Named *.itest.js so the default `test/**/*.test.js` run skips it (it globally
// mocks module loading); run explicitly with `node --test test/*.itest.js`.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

// Reversible fake keystore (same interface as Electron safeStorage).
const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from('E:' + s, 'utf8'),
  decryptString: (buf) => {
    const s = buf.toString('utf8');
    if (!s.startsWith('E:')) throw new Error('bad ciphertext');
    return s.slice(2);
  },
};

const tmpFile = path.join(os.tmpdir(), `nowtify-itest-${process.pid}.json`);

function makeFixture() {
  // Real post-4.x on-disk shape: PII lives in trigger scopes, in
  // teams.watchedUsers, and in the legacy top-level lists. Tokens arrive
  // already-encrypted (E: prefix) as the real app would have written them.
  return {
    jsm: { siteUrl: 'x.atlassian.net', email: 'me@corp.com', apiTokenEnc: 'E:tok', userDisplayName: 'Me' },
    teams: {
      userId: 'me', userDisplayName: 'Me', expiresAt: 123,
      accessTokenEnc: 'E:at', refreshTokenEnc: 'E:rt',
      watchedUsers: [{ id: 'u9', displayName: 'Carol VIP', mail: 'carol@corp.com' }],
    },
    watchList: [{ accountId: 'a1', displayName: 'Legacy Person', emailAddress: 'legacy@corp.com' }],
    watchGroups: [{ name: 'Team A' }],
    triggers: [
      { id: 'major-incident', type: 'major', enabled: true, color: '#dc2626' },
      { id: 'sla-breach-imminent', type: 'sla', enabled: true, color: '#ff8800',
        scope: { users: [{ accountId: 'a1', displayName: 'Jane Doe', emailAddress: 'jane@corp.com' }], groups: [{ name: 'Team A' }] } },
      { id: 'sla-breached', type: 'sla', enabled: true, color: '#dc2626', scope: { users: [], groups: [] } },
      { id: 'pending-approvals', type: 'approval', enabled: true, color: '#a855f7' },
      { id: 'teams-vip-message', type: 'teams', enabled: true, color: '#5059c9',
        scope: { users: [{ id: 'u2', displayName: 'Bob Smith', mail: 'bob@corp.com' }] } },
      { id: 'email-from-watched', type: 'email', enabled: true, color: '#0078d4',
        scope: { users: [{ address: 'sender@corp.com', displayName: 'Sender X' }] } },
    ],
    pollIntervalSeconds: 30, pulseTarget: 'both', theme: 'system',
  };
}

function getPath(obj, key) {
  return key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, key, val) {
  const parts = key.split('.');
  const last = parts.pop();
  const parent = parts.reduce((o, k) => (o[k] = o[k] || {}), obj);
  parent[last] = val;
}
function delPath(obj, key) {
  const parts = key.split('.');
  const last = parts.pop();
  const parent = parts.reduce((o, k) => (o == null ? undefined : o[k]), obj);
  if (parent) delete parent[last];
}

class FakeStore {
  constructor(opts = {}) {
    this._data = makeFixture();
    for (const [k, v] of Object.entries(opts.defaults || {})) {
      if (this._data[k] === undefined) this._data[k] = JSON.parse(JSON.stringify(v));
    }
    this.path = tmpFile;
    this._flush();
  }
  _flush() { fs.writeFileSync(tmpFile, JSON.stringify(this._data, null, 2)); }
  get store() { return this._data; }
  get(key) { return getPath(this._data, key); }
  set(key, val) {
    if (typeof key === 'object') Object.assign(this._data, key);
    else setPath(this._data, key, val);
    this._flush();
  }
  delete(key) { delPath(this._data, key); this._flush(); }
}

const origLoad = Module._load;
let store;
before(() => {
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return { safeStorage: fakeSafeStorage };
    if (request === 'electron-store') return FakeStore;
    return origLoad.call(this, request, parent, isMain);
  };
  delete require.cache[require.resolve('../src/main/store')];
  store = require('../src/main/store'); // runs module-load migrations on the fixture
  Module._load = origLoad;
});
after(() => { try { fs.unlinkSync(tmpFile); } catch (_e) { /* ignore */ } });

const PII = ['Jane Doe', 'Bob Smith', 'Carol VIP', 'Legacy Person', 'Sender X',
  'jane@corp.com', 'bob@corp.com', 'carol@corp.com', 'legacy@corp.com', 'sender@corp.com'];
const atRest = () => fs.readFileSync(tmpFile, 'utf8');

describe('store.js watchlist-PII encryption (real wiring, mocked keystore)', () => {
  test('before migration: plaintext PII IS on disk (sanity)', () => {
    const disk = atRest();
    assert.ok(disk.includes('Jane Doe') && disk.includes('carol@corp.com'),
      'fixture should start with plaintext PII');
  });

  test('migration removes ALL plaintext PII and writes Enc blobs', () => {
    store.migratePiiEncryption();
    const disk = atRest();
    for (const s of PII) {
      assert.ok(!disk.includes(s), `plaintext PII leaked at rest: "${s}"`);
    }
    assert.ok(disk.includes('scopeEnc'), 'trigger scopes encrypted');
    assert.ok(disk.includes('watchedUsersEnc'), 'teams watchedUsers encrypted');
    assert.ok(disk.includes('watchListEnc'), 'legacy watchList encrypted');
    assert.ok(disk.includes('watchGroupsEnc'), 'legacy watchGroups encrypted');
  });

  test('tokens remain intact (not disturbed by PII migration)', () => {
    const disk = JSON.parse(atRest());
    assert.equal(disk.jsm.apiTokenEnc, 'E:tok');
    assert.equal(disk.teams.accessTokenEnc, 'E:at');
    assert.equal(disk.teams.refreshTokenEnc, 'E:rt');
  });

  test('engine read path get("triggers") returns DECRYPTED scopes', () => {
    const triggers = store.get('triggers');
    const sla = triggers.find((t) => t.id === 'sla-breach-imminent');
    assert.deepEqual(sla.scope.users, [{ accountId: 'a1', displayName: 'Jane Doe', emailAddress: 'jane@corp.com' }]);
    const teams = triggers.find((t) => t.id === 'teams-vip-message');
    assert.deepEqual(teams.scope.users, [{ id: 'u2', displayName: 'Bob Smith', mail: 'bob@corp.com' }]);
    // No ciphertext key should reach a consumer.
    assert.ok(triggers.every((t) => t.scopeEnc === undefined), 'scopeEnc must not leak to consumers');
  });

  test('renderer path getAll() returns decrypted lists and NO Enc keys', () => {
    const all = store.getAll();
    assert.deepEqual(all.teams.watchedUsers, [{ id: 'u9', displayName: 'Carol VIP', mail: 'carol@corp.com' }]);
    assert.equal(all.watchList[0].displayName, 'Legacy Person');
    const json = JSON.stringify(all);
    for (const leak of ['scopeEnc', 'watchedUsersEnc', 'watchListEnc', 'watchGroupsEnc', 'apiTokenEnc', 'accessTokenEnc']) {
      assert.ok(!json.includes(leak), `renderer payload leaked "${leak}"`);
    }
  });

  test('getTeams() decrypts watchedUsers for the Graph client', () => {
    assert.deepEqual(store.getTeams().watchedUsers, [{ id: 'u9', displayName: 'Carol VIP', mail: 'carol@corp.com' }]);
  });

  test('no data loss: every original entry survived the round-trip', () => {
    const triggers = store.get('triggers');
    assert.equal(triggers.length, 6);
    assert.equal(store.getTeams().watchedUsers.length, 1);
    assert.equal(store.getAll().watchList.length, 1);
  });

  test('CRUD write path encrypts: addTeamsWatchedUser stays encrypted at rest', () => {
    store.addTeamsWatchedUser({ id: 'u3', displayName: 'Dana New', mail: 'dana@corp.com' });
    const disk = atRest();
    assert.ok(!disk.includes('Dana New') && !disk.includes('dana@corp.com'), 'new watchee written plaintext');
    assert.ok(disk.includes('watchedUsersEnc'));
    // ...and reads back correctly.
    const back = store.getTeams().watchedUsers.find((u) => u.id === 'u3');
    assert.deepEqual(back, { id: 'u3', displayName: 'Dana New', mail: 'dana@corp.com' });
  });

  test('CRUD write path encrypts: updateTrigger scope stays encrypted at rest', () => {
    store.updateTrigger('teams-vip-message', {
      scope: { users: [{ id: 'u2', displayName: 'Bob Smith', mail: 'bob@corp.com' }, { id: 'u4', displayName: 'Eve Add', mail: 'eve@corp.com' }] },
    });
    const disk = atRest();
    assert.ok(!disk.includes('Eve Add') && !disk.includes('eve@corp.com'), 'updated scope written plaintext');
    const back = store.get('triggers').find((t) => t.id === 'teams-vip-message');
    assert.equal(back.scope.users.length, 2);
  });

  test('migration is idempotent (second run does not corrupt or double-encrypt)', () => {
    store.migratePiiEncryption();
    assert.deepEqual(store.getTeams().watchedUsers.find((u) => u.id === 'u9'),
      { id: 'u9', displayName: 'Carol VIP', mail: 'carol@corp.com' });
    const disk = atRest();
    for (const s of ['Carol VIP', 'carol@corp.com']) assert.ok(!disk.includes(s));
  });
});
