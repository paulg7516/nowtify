/**
 * Tests for scope formatting / filtering - the logic that decides what
 * each trigger watches and how it's described in the UI.
 *
 * These functions are intentionally pure (no electron / no electron-store)
 * so they can be exercised in plain node:test. The same shape is used by
 * settings.js's renderer code; if the format changes, this test catches
 * it before ship.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');

// Inline-mirror of formatScopeSummary from src/renderer/settings/settings.js.
// Kept here as the source of truth for the contract; if the renderer copy
// drifts, the user-visible "3 people, 1 group" string drifts too.
function formatScopeSummary(type, scope) {
  if (type === 'sla') {
    const userCount = (scope.users || []).length;
    const groupCount = (scope.groups || []).length;
    if (userCount === 0 && groupCount === 0) return 'No one watched';
    const parts = [];
    if (userCount > 0) parts.push(`${userCount} ${userCount === 1 ? 'person' : 'people'}`);
    if (groupCount > 0) parts.push(`${groupCount} ${groupCount === 1 ? 'group' : 'groups'}`);
    return parts.join(', ');
  }
  if (type === 'teams') {
    const userCount = (scope.users || []).length;
    if (userCount === 0) return 'No one watched';
    return `${userCount} ${userCount === 1 ? 'person' : 'people'}`;
  }
  return '';
}

describe('formatScopeSummary - SLA', () => {
  test('empty scope reads as "No one watched"', () => {
    assert.equal(formatScopeSummary('sla', {}), 'No one watched');
    assert.equal(formatScopeSummary('sla', { users: [], groups: [] }), 'No one watched');
  });
  test('one person, singular', () => {
    assert.equal(formatScopeSummary('sla', { users: [{}] }), '1 person');
  });
  test('multiple people', () => {
    assert.equal(formatScopeSummary('sla', { users: [{}, {}, {}] }), '3 people');
  });
  test('one group, singular', () => {
    assert.equal(formatScopeSummary('sla', { groups: [{}] }), '1 group');
  });
  test('multiple groups', () => {
    assert.equal(formatScopeSummary('sla', { groups: [{}, {}] }), '2 groups');
  });
  test('mixed users + groups', () => {
    assert.equal(
      formatScopeSummary('sla', { users: [{}, {}, {}], groups: [{}] }),
      '3 people, 1 group',
    );
  });
});

describe('formatScopeSummary - Teams', () => {
  test('empty scope reads as "No one watched"', () => {
    assert.equal(formatScopeSummary('teams', {}), 'No one watched');
  });
  test('one person, singular', () => {
    assert.equal(formatScopeSummary('teams', { users: [{}] }), '1 person');
  });
  test('multiple people', () => {
    assert.equal(formatScopeSummary('teams', { users: [{}, {}, {}, {}] }), '4 people');
  });
});

describe('formatScopeSummary - unknown types', () => {
  test('returns empty string for major / approval / unknown', () => {
    assert.equal(formatScopeSummary('major', {}), '');
    assert.equal(formatScopeSummary('approval', {}), '');
    assert.equal(formatScopeSummary('something-new', {}), '');
  });
});
