// src/main/secure-fields.js
//
// Pure helpers for encrypting non-secret-but-sensitive PII at rest (watchlist
// display names + email addresses). No Electron dependency: the caller injects
// an `enc` adapter, so the risky crypto/migration logic is fully unit-testable
// (store.js wires the real safeStorage-backed adapter in).
//
// Model: a "secured field" named `foo` on some container object is persisted as
// the encrypted JSON of its value under `fooEnc` (base64), with the plaintext
// `foo` removed. This mirrors the existing token pattern (`apiTokenEnc`).
//
// Three safety guarantees, chosen because this ships org-wide and a bad
// migration could destroy users' watchlists:
//
//   1. READ-BOTH. Reads prefer the encrypted copy but fall back to plaintext,
//      so a half-migrated store, or one on a machine without a keystore, keeps
//      working.
//   2. WRITE-THEN-VERIFY-THEN-DELETE. Encoding never removes the plaintext
//      until the ciphertext has been decrypted back and confirmed to match. If
//      anything is off, the plaintext is left untouched - worst case is "not
//      yet encrypted", never "lost".
//   3. GRACEFUL DEGRADATION. If the keystore is unavailable, encoding is a
//      no-op that keeps the plaintext (0600 file perms remain the control).
//      It never throws, so the app cannot be broken by a keystore hiccup.
//
// The `enc` adapter interface:
//   available() -> boolean
//   encrypt(plainString) -> Buffer      (may throw)
//   decrypt(buffer) -> plainString      (may throw)

'use strict';

function encKeyFor(name) {
  return `${name}Enc`;
}

// Encrypt container[name] in place-ish (returns a new container). Sets
// `${name}Enc` and removes the plaintext `${name}` - but ONLY after verifying
// the ciphertext round-trips. On any failure or unavailable keystore, returns
// the container with plaintext intact and no Enc key (no data loss, retried
// next write/launch).
function secureEncode(container, name, enc) {
  if (!container || typeof container !== 'object') return container;
  const value = container[name];
  // Nothing to secure (field absent). Leave whatever is there (possibly an
  // existing Enc key) untouched.
  if (value === undefined) return container;
  if (!enc || !enc.available()) return container; // graceful degrade

  const key = encKeyFor(name);
  try {
    const serialized = JSON.stringify(value);
    const cipher = enc.encrypt(serialized).toString('base64');
    // Verify BEFORE dropping plaintext.
    const check = enc.decrypt(Buffer.from(cipher, 'base64'));
    if (check !== serialized) return container; // verify failed -> keep plaintext
    const next = { ...container, [key]: cipher };
    delete next[name];
    return next;
  } catch (_err) {
    return container; // any crypto failure -> keep plaintext, never throw
  }
}

// Decrypt to a plaintext value. Prefers `${name}Enc`, falls back to plaintext
// `${name}`. Returns undefined if neither is present.
function secureDecode(container, name, enc) {
  if (!container || typeof container !== 'object') return undefined;
  const key = encKeyFor(name);
  const cipher = container[key];
  if (cipher && enc && enc.available()) {
    try {
      const plain = enc.decrypt(Buffer.from(cipher, 'base64'));
      return JSON.parse(plain);
    } catch (_err) {
      // fall through to plaintext fallback
    }
  }
  return container[name];
}

// Return a container in the shape the rest of the app expects: plaintext
// `${name}` populated (decoded), `${name}Enc` stripped. Used on every read
// boundary so consumers never see ciphertext.
function hydrateField(container, name, enc) {
  if (!container || typeof container !== 'object') return container;
  const key = encKeyFor(name);
  if (container[key] === undefined && container[name] === undefined) {
    return container; // neither form present - nothing to do
  }
  const value = secureDecode(container, name, enc);
  const next = { ...container };
  delete next[key];
  if (value === undefined) {
    delete next[name];
  } else {
    next[name] = value;
  }
  return next;
}

// Convenience for arrays of containers (e.g. triggers, each with a `scope`).
function hydrateEach(list, name, enc) {
  if (!Array.isArray(list)) return list;
  return list.map((item) => hydrateField(item, name, enc));
}

function secureEncodeEach(list, name, enc) {
  if (!Array.isArray(list)) return list;
  return list.map((item) => secureEncode(item, name, enc));
}

module.exports = {
  encKeyFor,
  secureEncode,
  secureDecode,
  hydrateField,
  hydrateEach,
  secureEncodeEach,
};
