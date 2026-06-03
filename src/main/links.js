/**
 * Pure helpers for handling the external URLs we hand to the OS. Kept free
 * of any electron dependency so they can be unit-tested directly (see
 * test/links.test.js) - the main process wraps these in shell.openExternal.
 */

/**
 * Rewrite a Microsoft Teams web link into the `msteams:` deep-link scheme so
 * macOS opens the desktop Teams client instead of a browser tab. Teams web
 * links all look like `https://teams.microsoft.com/l/<...>`; the app handles
 * the exact same path under `msteams:/l/<...>`. Non-Teams URLs are returned
 * unchanged so this is safe to call on any link.
 */
function toTeamsAppUrl(urlString) {
  if (typeof urlString !== 'string') return urlString;
  return urlString.replace(/^https:\/\/teams\.microsoft\.com\//i, 'msteams:/');
}

/**
 * Allow-list check for URLs we're willing to open in the user's browser.
 * URLs originate from JSM ticket data and Microsoft Graph responses, so we
 * constrain them to: the configured JSM site, Atlassian's identity page,
 * Microsoft Teams, and Outlook on the web. `jsmHost` is passed in (read from
 * the store by the caller) to keep this function pure/testable.
 */
function isAllowedExternalHost(urlString, { jsmHost = '' } = {}) {
  let u;
  try {
    u = new URL(urlString);
  } catch (_) {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const host = u.hostname.toLowerCase();
  // Configured JSM site (e.g. xolv.atlassian.net)
  if (jsmHost && host === jsmHost.toLowerCase()) return true;
  // Atlassian identity (API-token management page)
  if (host === 'id.atlassian.com') return true;
  // Microsoft Teams meeting / chat endpoints
  if (host === 'teams.microsoft.com' || host.endsWith('.teams.microsoft.com')) return true;
  // Outlook on the web (Graph mail webLink lands on outlook.office365.com /
  // outlook.office.com depending on tenant). Without this the email rows in
  // the Messages tab were silently un-clickable.
  if (
    host === 'outlook.office.com' ||
    host === 'outlook.office365.com' ||
    host === 'outlook.live.com' ||
    host.endsWith('.outlook.com')
  ) {
    return true;
  }
  return false;
}

module.exports = { toTeamsAppUrl, isAllowedExternalHost };
