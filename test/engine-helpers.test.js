/**
 * Tests for the engine's pure helpers:
 *   - isDoneIssue: gates out approvals/incidents whose ticket has moved to
 *     a Done-category status (Cancelled / Closed / Resolved). This is what
 *     stops a cancelled approval lingering in the popover.
 *   - formatTriggeredAgo: the "how long ago" relative label shown on
 *     approval + Major Incident rows.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { isDoneIssue, formatTriggeredAgo } = require('../src/main/jsm-client');

describe('isDoneIssue', () => {
  const withCategory = (key) => ({ fields: { status: { statusCategory: { key } } } });

  test('true when status category is done (resolved/closed/cancelled)', () => {
    assert.equal(isDoneIssue(withCategory('done')), true);
    assert.equal(isDoneIssue(withCategory('Done')), true); // case-insensitive
  });
  test('false for in-progress / to-do categories', () => {
    assert.equal(isDoneIssue(withCategory('indeterminate')), false);
    assert.equal(isDoneIssue(withCategory('new')), false);
  });
  test('false (safe) when status shape is missing', () => {
    assert.equal(isDoneIssue(null), false);
    assert.equal(isDoneIssue({}), false);
    assert.equal(isDoneIssue({ fields: {} }), false);
    assert.equal(isDoneIssue({ fields: { status: {} } }), false);
  });
});

describe('formatTriggeredAgo', () => {
  const now = 1_700_000_000_000;
  test('sub-minute reads as "just now"', () => {
    assert.equal(formatTriggeredAgo(now - 30_000, now), 'just now');
  });
  test('minutes', () => {
    assert.equal(formatTriggeredAgo(now - 5 * 60_000, now), '5m ago');
  });
  test('hours', () => {
    assert.equal(formatTriggeredAgo(now - 3 * 3_600_000, now), '3h ago');
  });
  test('days', () => {
    assert.equal(formatTriggeredAgo(now - 2 * 86_400_000, now), '2d ago');
  });
  test('empty string when timestamp is missing or not finite', () => {
    assert.equal(formatTriggeredAgo(null, now), '');
    assert.equal(formatTriggeredAgo(undefined, now), '');
    assert.equal(formatTriggeredAgo(NaN, now), '');
  });
  test('never shows a negative age (clock skew clamps to "just now")', () => {
    assert.equal(formatTriggeredAgo(now + 10_000, now), 'just now');
  });
});
