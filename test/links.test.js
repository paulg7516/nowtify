/**
 * Tests for external-link handling: which hosts we're willing to hand to
 * the OS, and the Teams web->app deep-link rewrite. These are pure (no
 * electron) so they run under node:test and exercise the real module the
 * main process uses.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { toTeamsAppUrl, isAllowedExternalHost } = require('../src/main/links');

describe('toTeamsAppUrl', () => {
  test('rewrites a teams.microsoft.com chat link to the msteams: app scheme', () => {
    assert.equal(
      toTeamsAppUrl('https://teams.microsoft.com/l/chat/0/0?users=a@b.com'),
      'msteams:/l/chat/0/0?users=a@b.com',
    );
  });
  test('rewrites a meetup-join link to the app scheme', () => {
    assert.equal(
      toTeamsAppUrl('https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc/0'),
      'msteams:/l/meetup-join/19%3ameeting_abc/0',
    );
  });
  test('is case-insensitive on the host', () => {
    assert.equal(
      toTeamsAppUrl('https://Teams.Microsoft.Com/l/chat/0/0'),
      'msteams:/l/chat/0/0',
    );
  });
  test('returns non-teams URLs unchanged', () => {
    assert.equal(
      toTeamsAppUrl('https://outlook.office365.com/mail/id/123'),
      'https://outlook.office365.com/mail/id/123',
    );
    assert.equal(
      toTeamsAppUrl('https://xolv.atlassian.net/browse/CASE-1'),
      'https://xolv.atlassian.net/browse/CASE-1',
    );
  });
});

describe('isAllowedExternalHost', () => {
  const jsmHost = 'xolv.atlassian.net';

  test('allows the configured JSM site', () => {
    assert.equal(isAllowedExternalHost('https://xolv.atlassian.net/browse/CASE-1', { jsmHost }), true);
  });
  test('allows the Atlassian identity token page', () => {
    assert.equal(isAllowedExternalHost('https://id.atlassian.com/manage-profile', { jsmHost }), true);
  });
  test('allows Microsoft Teams hosts', () => {
    assert.equal(isAllowedExternalHost('https://teams.microsoft.com/l/chat/0/0', { jsmHost }), true);
  });
  test('allows Outlook web hosts (the click that used to be silently blocked)', () => {
    assert.equal(isAllowedExternalHost('https://outlook.office365.com/mail/id/1', { jsmHost }), true);
    assert.equal(isAllowedExternalHost('https://outlook.office.com/mail/id/1', { jsmHost }), true);
  });
  test('denies an arbitrary host', () => {
    assert.equal(isAllowedExternalHost('https://evil.example.com/x', { jsmHost }), false);
  });
  test('denies non-http(s) schemes', () => {
    assert.equal(isAllowedExternalHost('file:///etc/passwd', { jsmHost }), false);
    assert.equal(isAllowedExternalHost('javascript:alert(1)', { jsmHost }), false);
  });
  test('denies a malformed URL', () => {
    assert.equal(isAllowedExternalHost('not a url', { jsmHost }), false);
  });
  test('denies the JSM host when none is configured', () => {
    assert.equal(isAllowedExternalHost('https://xolv.atlassian.net/x', {}), false);
  });
});
