'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { isPoisonedCacheError } = require('../src/main/updater-errors');

test('isPoisonedCacheError', async (t) => {
  await t.test('flags the real sha512 mismatch electron-updater emits', () => {
    assert.equal(
      isPoisonedCacheError(
        'sha512 checksum mismatch, expected 3Onjs4..., got 056wXp...'
      ),
      true
    );
  });

  await t.test('flags generic checksum / integrity wording', () => {
    assert.equal(isPoisonedCacheError('checksum mismatch'), true);
    assert.equal(isPoisonedCacheError('File integrity check failed'), true);
    assert.equal(isPoisonedCacheError('SHA512 verification failed'), true);
  });

  await t.test('does NOT flag network/timeout/not-found errors (purge would not help)', () => {
    assert.equal(isPoisonedCacheError('net::ERR_INTERNET_DISCONNECTED'), false);
    assert.equal(isPoisonedCacheError('ETIMEDOUT'), false);
    assert.equal(isPoisonedCacheError('Cannot find latest-mac.yml in the latest release'), false);
    assert.equal(isPoisonedCacheError('HttpError: 404 Not Found'), false);
  });

  await t.test('handles empty / null / undefined safely', () => {
    assert.equal(isPoisonedCacheError(''), false);
    assert.equal(isPoisonedCacheError(null), false);
    assert.equal(isPoisonedCacheError(undefined), false);
  });

  await t.test('works with the err.message string passed by the updater', () => {
    assert.equal(isPoisonedCacheError(new Error('sha512 mismatch').message), true);
  });
});
