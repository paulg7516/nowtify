/**
 * macOS self-update: the "can this copy replace itself" check, and the
 * real install helper script run against throwaway app bundles - including
 * the bug-report case where the installed app belongs to another account
 * and the old helper looped forever.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { appBundlePathFrom, canReplaceAppBundle, buildInstallScript, readInstallResult } = require('../src/main/mac-install');

describe('canReplaceAppBundle', () => {
  const ok = () => {};
  test('writable bundle in a writable folder can update itself', () => {
    assert.equal(canReplaceAppBundle('/Applications/Nowtify.app', ok), true);
  });
  test('bundle owned by another account (IT / admin install) cannot', () => {
    const denyBundle = (p) => {
      if (p.startsWith('/Applications/Nowtify.app')) throw new Error('EACCES');
    };
    assert.equal(canReplaceAppBundle('/Applications/Nowtify.app', denyBundle), false);
  });
  test('folder the user cannot write (e.g. standard user, /Applications) cannot', () => {
    const denyParent = (p) => {
      if (p === '/Applications') throw new Error('EACCES');
    };
    assert.equal(canReplaceAppBundle('/Applications/Nowtify.app', denyParent), false);
  });
  test('running from the disk image or a quarantine copy cannot', () => {
    assert.equal(canReplaceAppBundle('/Volumes/Nowtify/Nowtify.app', ok), false);
    assert.equal(canReplaceAppBundle('/private/var/folders/x/AppTranslocation/ABC/d/Nowtify.app', ok), false);
  });
  test('bundle path from the executable path', () => {
    assert.equal(appBundlePathFrom('/Applications/Nowtify.app/Contents/MacOS/Nowtify'), '/Applications/Nowtify.app');
  });
});

describe('readInstallResult', () => {
  test('parses ok / failed and ignores junk', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nowtify-res-'));
    const f = path.join(dir, 'r');
    fs.writeFileSync(f, 'failed 0.7.1 cannot-move-old-app\n');
    assert.deepEqual(readInstallResult(f), { ok: false, version: '0.7.1', reason: 'cannot-move-old-app' });
    fs.writeFileSync(f, 'ok 0.7.1\n');
    assert.deepEqual(readInstallResult(f), { ok: true, version: '0.7.1', reason: '' });
    fs.writeFileSync(f, 'garbage');
    assert.equal(readInstallResult(f), null);
    assert.equal(readInstallResult(path.join(dir, 'missing')), null);
  });
});

// The helper uses macOS tools (PlistBuddy), so it only runs on a Mac.
describe('install helper script (macOS)', { skip: process.platform !== 'darwin' }, () => {
  const plist = (v) =>
    `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleShortVersionString</key><string>${v}</string></dict></plist>`;
  const makeApp = (dir, v) => {
    fs.mkdirSync(path.join(dir, 'Nowtify.app', 'Contents'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'Nowtify.app', 'Contents', 'Info.plist'), plist(v));
  };
  const versionOf = (app) =>
    execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', path.join(app, 'Contents', 'Info.plist')])
      .toString()
      .trim();

  function setup() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nowtify-helper-'));
    const apps = path.join(root, 'Applications');
    fs.mkdirSync(apps);
    makeApp(apps, '0.7.0');
    const dl = path.join(root, 'dl');
    makeApp(dl, '0.7.1');
    const zip = path.join(root, 'update.zip');
    execFileSync('zip', ['-qr', zip, 'Nowtify.app'], { cwd: dl });
    const opts = {
      pid: 999999, // not running
      bundlePath: path.join(apps, 'Nowtify.app'),
      zipPath: zip,
      newVersion: '0.7.1',
      tmpDir: path.join(root, 'stage'),
      logPath: path.join(root, 'install.log'),
      resultPath: path.join(root, 'result'),
      launch: 'echo launch',
    };
    const run = () => {
      fs.writeFileSync(path.join(root, 'helper.sh'), buildInstallScript(opts), { mode: 0o755 });
      return spawnSync('/bin/bash', [path.join(root, 'helper.sh')]).status;
    };
    return { root, apps, opts, run };
  }

  test('normal case: new version in place, old copy gone, result ok', () => {
    const { apps, opts, run } = setup();
    assert.equal(run(), 0);
    assert.equal(versionOf(opts.bundlePath), '0.7.1');
    assert.deepEqual(fs.readdirSync(apps), ['Nowtify.app']);
    assert.deepEqual(readInstallResult(opts.resultPath), { ok: true, version: '0.7.1', reason: '' });
  });

  test('bug report case: app the user cannot modify -> old app intact, failure recorded, no nesting', () => {
    const { apps, opts, run, root } = setup();
    fs.chmodSync(apps, 0o555); // user can't move anything out of this folder
    try {
      assert.equal(run(), 1);
      assert.equal(versionOf(opts.bundlePath), '0.7.0');
      assert.equal(fs.existsSync(path.join(opts.bundlePath, 'Nowtify.app')), false);
      assert.deepEqual(readInstallResult(opts.resultPath), { ok: false, version: '0.7.1', reason: 'cannot-move-old-app' });
      assert.match(fs.readFileSync(opts.logPath, 'utf8'), /FAILED: cannot-move-old-app/);
    } finally {
      fs.chmodSync(apps, 0o755);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('download with the wrong version is refused before touching the app', () => {
    const { opts, run } = setup();
    opts.newVersion = '0.7.2';
    assert.equal(run(), 1);
    assert.equal(versionOf(opts.bundlePath), '0.7.0');
    assert.equal(readInstallResult(opts.resultPath).reason, 'wrong-version-in-download');
  });
});
