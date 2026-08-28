const { test, describe } = require('node:test');
const assert = require('node:assert');
const { shouldApplyDefaultOnLaunch, loginItemOptions } = require('../src/main/login-item');

describe('shouldApplyDefaultOnLaunch', () => {
  test('applies the default-on only until it has been initialized once', () => {
    assert.equal(shouldApplyDefaultOnLaunch(false), true);
    assert.equal(shouldApplyDefaultOnLaunch(undefined), true);
    assert.equal(shouldApplyDefaultOnLaunch(true), false);
  });
});

describe('loginItemOptions', () => {
  test('macOS includes openAsHidden matching openAtLogin', () => {
    assert.deepEqual(loginItemOptions(true, 'darwin'), { openAtLogin: true, openAsHidden: true });
    assert.deepEqual(loginItemOptions(false, 'darwin'), { openAtLogin: false, openAsHidden: false });
  });
  test('Windows omits openAsHidden', () => {
    assert.deepEqual(loginItemOptions(true, 'win32'), { openAtLogin: true });
    assert.deepEqual(loginItemOptions(false, 'win32'), { openAtLogin: false });
  });
  test('coerces truthy/falsy inputs to real booleans', () => {
    assert.deepEqual(loginItemOptions(1, 'win32'), { openAtLogin: true });
    assert.deepEqual(loginItemOptions(0, 'darwin'), { openAtLogin: false, openAsHidden: false });
  });
});
