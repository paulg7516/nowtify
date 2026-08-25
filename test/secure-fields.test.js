const { test, describe } = require('node:test');
const assert = require('node:assert');
const {
  encKeyFor,
  secureEncode,
  secureDecode,
  hydrateField,
  hydrateEach,
  secureEncodeEach,
} = require('../src/main/secure-fields');

// Fake keystore adapter. Encryption is a reversible, tagged transform so we
// can assert ciphertext != plaintext and that round-tripping works, without
// needing the real Electron safeStorage / OS keystore.
function fakeEnc({ available = true, corruptDecrypt = false, throwOnEncrypt = false } = {}) {
  return {
    available: () => available,
    encrypt(s) {
      if (throwOnEncrypt) throw new Error('encrypt boom');
      return Buffer.from('ENC:' + s, 'utf8');
    },
    decrypt(buf) {
      if (corruptDecrypt) return 'garbage-not-matching';
      const s = buf.toString('utf8');
      if (!s.startsWith('ENC:')) throw new Error('bad ciphertext');
      return s.slice(4);
    },
  };
}

const SCOPE = { users: [{ id: 'u1', displayName: 'Jane Doe', mail: 'jane@corp.com' }] };

describe('secureEncode', () => {
  test('encrypts the field and removes the plaintext', () => {
    const out = secureEncode({ scope: SCOPE, color: '#fff' }, 'scope', fakeEnc());
    assert.equal(out.scope, undefined, 'plaintext removed');
    assert.ok(out.scopeEnc, 'Enc key present');
    assert.equal(out.color, '#fff', 'unrelated fields preserved');
  });

  test('round-trips back to the exact original value', () => {
    const enc = fakeEnc();
    const encoded = secureEncode({ scope: SCOPE }, 'scope', enc);
    const decoded = secureDecode(encoded, 'scope', enc);
    assert.deepEqual(decoded, SCOPE);
  });

  test('GRACEFUL DEGRADE: keystore unavailable -> keeps plaintext, no Enc, no throw', () => {
    const out = secureEncode({ scope: SCOPE }, 'scope', fakeEnc({ available: false }));
    assert.deepEqual(out.scope, SCOPE, 'plaintext kept');
    assert.equal(out.scopeEnc, undefined, 'no Enc written');
  });

  test('WRITE-THEN-VERIFY: if decrypt does not match, plaintext is NOT dropped', () => {
    const out = secureEncode({ scope: SCOPE }, 'scope', fakeEnc({ corruptDecrypt: true }));
    assert.deepEqual(out.scope, SCOPE, 'plaintext preserved when verify fails');
    assert.equal(out.scopeEnc, undefined, 'no Enc written when verify fails');
  });

  test('never throws even if encrypt() throws - keeps plaintext', () => {
    const out = secureEncode({ scope: SCOPE }, 'scope', fakeEnc({ throwOnEncrypt: true }));
    assert.deepEqual(out.scope, SCOPE);
    assert.equal(out.scopeEnc, undefined);
  });

  test('absent field is a no-op (triggers without scope)', () => {
    const out = secureEncode({ color: '#fff' }, 'scope', fakeEnc());
    assert.deepEqual(out, { color: '#fff' });
  });

  test('idempotent: encoding an already-encoded container does not lose the Enc', () => {
    const enc = fakeEnc();
    const once = secureEncode({ scope: SCOPE }, 'scope', enc);
    const twice = secureEncode(once, 'scope', enc);
    assert.equal(twice.scopeEnc, once.scopeEnc, 'Enc unchanged');
    assert.equal(twice.scope, undefined);
  });
});

describe('secureDecode (READ-BOTH)', () => {
  test('reads the encrypted copy when present', () => {
    const enc = fakeEnc();
    const encoded = secureEncode({ scope: SCOPE }, 'scope', enc);
    assert.deepEqual(secureDecode(encoded, 'scope', enc), SCOPE);
  });

  test('falls back to plaintext when no Enc key (pre-migration / degraded)', () => {
    assert.deepEqual(secureDecode({ scope: SCOPE }, 'scope', fakeEnc()), SCOPE);
  });

  test('falls back to plaintext when keystore unavailable at read time', () => {
    const encoded = secureEncode({ scope: SCOPE }, 'scope', fakeEnc());
    // Encrypted, but now keystore is gone AND plaintext also present (belt+braces)
    const withBoth = { ...encoded, scope: SCOPE };
    assert.deepEqual(secureDecode(withBoth, 'scope', fakeEnc({ available: false })), SCOPE);
  });

  test('corrupt ciphertext with no plaintext fallback returns undefined (no crash)', () => {
    assert.equal(secureDecode({ scopeEnc: 'not-valid' }, 'scope', fakeEnc()), undefined);
  });
});

describe('hydrateField', () => {
  test('returns plaintext field and strips the Enc key', () => {
    const enc = fakeEnc();
    const encoded = secureEncode({ scope: SCOPE, color: '#fff' }, 'scope', enc);
    const hydrated = hydrateField(encoded, 'scope', enc);
    assert.deepEqual(hydrated.scope, SCOPE);
    assert.equal(hydrated.scopeEnc, undefined, 'Enc stripped from app-facing shape');
    assert.equal(hydrated.color, '#fff');
  });

  test('no-op when neither form present', () => {
    assert.deepEqual(hydrateField({ color: '#fff' }, 'scope', fakeEnc()), { color: '#fff' });
  });
});

describe('array helpers', () => {
  const triggers = [
    { id: 'major', color: '#dc2626' }, // no scope
    { id: 'sla', color: '#ff8800', scope: SCOPE },
    { id: 'teams', color: '#5059c9', scope: { users: [{ id: 'u2', displayName: 'Sam', mail: 's@corp.com' }] } },
  ];

  test('secureEncodeEach encrypts scopes and leaves scopeless triggers alone', () => {
    const enc = fakeEnc();
    const out = secureEncodeEach(triggers, 'scope', enc);
    assert.equal(out[0].scope, undefined);
    assert.equal(out[0].scopeEnc, undefined, 'scopeless trigger untouched');
    assert.ok(out[1].scopeEnc && out[1].scope === undefined);
    assert.ok(out[2].scopeEnc && out[2].scope === undefined);
  });

  test('encode -> hydrate round-trips the whole triggers array', () => {
    const enc = fakeEnc();
    const encoded = secureEncodeEach(triggers, 'scope', enc);
    const hydrated = hydrateEach(encoded, 'scope', enc);
    assert.deepEqual(hydrated, triggers);
  });
});

describe('encKeyFor', () => {
  test('appends Enc', () => {
    assert.equal(encKeyFor('scope'), 'scopeEnc');
    assert.equal(encKeyFor('watchList'), 'watchListEnc');
  });
});
