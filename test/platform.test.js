const { test, describe } = require('node:test');
const assert = require('node:assert');
const { trayIconSpec, trayStateColor, protocolClientArgs, shouldLockdownFile } = require('../src/main/platform');

describe('trayIconSpec', () => {
  test('windows uses colored png per state, never template', () => {
    assert.deepEqual(trayIconSpec('win32', 'idle'), { dir: 'win', file: 'idle.png', template: false });
    assert.deepEqual(trayIconSpec('win32', 'alerting'), { dir: 'win', file: 'alert.png', template: false });
    assert.deepEqual(trayIconSpec('win32', 'snoozed'), { dir: 'win', file: 'snoozed.png', template: false });
    assert.deepEqual(trayIconSpec('win32', 'paused'), { dir: 'win', file: 'paused.png', template: false });
  });
  test('macOS uses template pngs for idle/paused, colored for snoozed/alert', () => {
    assert.deepEqual(trayIconSpec('darwin', 'idle'), { dir: '.', file: 'idle.png', template: true });
    assert.deepEqual(trayIconSpec('darwin', 'paused'), { dir: '.', file: 'paused.png', template: true });
    assert.deepEqual(trayIconSpec('darwin', 'snoozed'), { dir: '.', file: 'snoozed.png', template: false });
    assert.deepEqual(trayIconSpec('darwin', 'alerting'), { dir: '.', file: 'alert.png', template: false });
  });
  test('unknown status falls back to idle', () => {
    assert.equal(trayIconSpec('win32', 'bogus').file, 'idle.png');
  });
});

describe('protocolClientArgs', () => {
  test('macOS needs no extra args', () => {
    assert.deepEqual(protocolClientArgs('darwin', '/Apps/Nowtify', ['/Apps/Nowtify']), []);
  });
  test('windows packaged needs no extra args', () => {
    assert.deepEqual(protocolClientArgs('win32', 'C:/App/Nowtify.exe', ['C:/App/Nowtify.exe'], true), []);
  });
  test('windows dev (unpackaged) passes execPath + resolved script path', () => {
    const args = protocolClientArgs('win32', 'C:/electron.exe', ['C:/electron.exe', '.'], false);
    assert.deepEqual(args, ['C:/electron.exe', ['.']]);
  });
});

describe('shouldLockdownFile', () => {
  test('true on posix, false on windows', () => {
    assert.equal(shouldLockdownFile('darwin'), true);
    assert.equal(shouldLockdownFile('linux'), true);
    assert.equal(shouldLockdownFile('win32'), false);
  });
});

describe('trayStateColor', () => {
  test('alerting uses the live trigger color, falling back to red', () => {
    assert.equal(trayStateColor('alerting', '#a855f7'), '#a855f7');
    assert.equal(trayStateColor('alerting', null), '#dc2626');
  });
  test('steady states use fixed hues', () => {
    assert.equal(trayStateColor('snoozed'), '#fbbf24');
    assert.equal(trayStateColor('paused'), '#6b7280');
    assert.equal(trayStateColor('idle'), '#9aa0aa');
    assert.equal(trayStateColor('bogus'), '#9aa0aa');
  });
});
