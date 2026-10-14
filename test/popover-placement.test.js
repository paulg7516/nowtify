/**
 * Popover size + placement: same rules on macOS (menu bar at the top) and
 * Windows (taskbar usually at the bottom, but can be on any edge).
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { clampPopoverSize, popoverPosition } = require('../src/main/platform');

// 1440x900 screen. macOS work area starts under the 25px menu bar;
// Windows work area ends above a 40px bottom taskbar.
const MAC_WORK = { x: 0, y: 25, width: 1440, height: 875 };
const WIN_WORK = { x: 0, y: 0, width: 1440, height: 860 };

describe('clampPopoverSize', () => {
  test('no saved size -> default', () => {
    assert.deepEqual(clampPopoverSize(null, MAC_WORK), { width: 460, height: 600 });
  });
  test('garbage values fall back to the default', () => {
    assert.deepEqual(clampPopoverSize({ width: 'big', height: -5 }, MAC_WORK), { width: 460, height: 600 });
  });
  test('never smaller than the minimum', () => {
    assert.deepEqual(clampPopoverSize({ width: 100, height: 100 }, MAC_WORK), { width: 420, height: 440 });
  });
  test('never taller or wider than the usable screen', () => {
    assert.deepEqual(clampPopoverSize({ width: 3000, height: 3000 }, MAC_WORK), { width: 1432, height: 867 });
  });
  test('keeps a sensible saved size as-is', () => {
    assert.deepEqual(clampPopoverSize({ width: 520, height: 700 }, WIN_WORK), { width: 520, height: 700 });
  });
});

describe('popoverPosition', () => {
  const size = { width: 460, height: 600 };

  test('macOS: opens below a menu-bar icon, centered on it', () => {
    const tray = { x: 1000, y: 0, width: 24, height: 25 };
    assert.deepEqual(popoverPosition(tray, size, MAC_WORK), { x: 782, y: 29 });
  });
  test('Windows bottom taskbar: opens above the icon', () => {
    const tray = { x: 1300, y: 864, width: 32, height: 32 };
    const { x, y } = popoverPosition(tray, size, WIN_WORK);
    // Sits just above the taskbar (work-area bottom), not overlapping it.
    assert.equal(y, 860 - 600 - 4);
    assert.equal(x, 1440 - 460 - 4); // pushed in from the right edge
  });
  test('Windows top taskbar: opens below like macOS', () => {
    const tray = { x: 1300, y: 0, width: 32, height: 40 };
    const work = { x: 0, y: 40, width: 1440, height: 860 };
    assert.equal(popoverPosition(tray, size, work).y, 44);
  });
  test('Windows left taskbar: stays inside the screen', () => {
    const tray = { x: 0, y: 800, width: 48, height: 32 };
    const work = { x: 48, y: 0, width: 1392, height: 900 };
    const { x, y } = popoverPosition(tray, size, work);
    assert.ok(x >= 48 + 4);
    assert.ok(y >= 4 && y + 600 <= 900 - 4);
  });
  test('second monitor offsets are respected', () => {
    const tray = { x: 2400, y: 0, width: 24, height: 25 };
    const work = { x: 1440, y: 25, width: 1920, height: 1055 };
    assert.deepEqual(popoverPosition(tray, size, work), { x: 2182, y: 29 });
  });
});
