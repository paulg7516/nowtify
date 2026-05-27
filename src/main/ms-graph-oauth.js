/**
 * Microsoft Graph OAuth 2.0 with PKCE (Authorization Code flow).
 *
 * Public-client desktop pattern: no client secret. Each user authenticates
 * individually in their browser, Microsoft redirects to our custom
 * nowtify:// URL scheme, the macOS protocol handler routes the redirect
 * back to this Electron process (see app.on('open-url') in index.js), and
 * we exchange the auth code + PKCE verifier for access + refresh tokens.
 *
 * Both tokens are encrypted at rest via electron's safeStorage (macOS
 * Keychain) - same pattern as the JSM API token.
 *
 * The tenant + client IDs below are public OAuth identifiers (NOT secrets)
 * for the "Nowtify" app registered in the Xolv Technology Solutions Entra
 * tenant. Safe to commit to a public repo.
 */

const { shell } = require('electron');
const crypto = require('crypto');
const store = require('./store');

const TENANT_ID = '029a1c12-d919-4156-aa19-0b333f133667';
const CLIENT_ID = '055ec7b8-8818-4b1d-aeff-28fddf36486e';
const REDIRECT_URI = 'nowtify://oauth/callback';
const SCOPES = ['Chat.Read', 'User.Read', 'offline_access'];

const AUTHORITY = `https://login.microsoftonline.com/${TENANT_ID}`;
const AUTH_URL = `${AUTHORITY}/oauth2/v2.0/authorize`;
const TOKEN_URL = `${AUTHORITY}/oauth2/v2.0/token`;
const GRAPH_ME_URL = 'https://graph.microsoft.com/v1.0/me';

// In-memory state for an in-flight authorization. Cleared on completion or
// timeout. Holds the PKCE code_verifier (which must NOT be persisted to disk
// per OAuth spec - it's a one-shot ephemeral secret).
let pendingAuth = null;
const PENDING_AUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function base64url(buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function generatePkce() {
  // RFC 7636: code_verifier = high-entropy random, code_challenge = S256(verifier)
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function generateState() {
  return base64url(crypto.randomBytes(16));
}

/**
 * Open the user's default browser to the Microsoft sign-in page. The
 * subsequent callback arrives via the nowtify:// protocol handler, which
 * forwards to handleCallback() below.
 */
async function beginAuth() {
  const { verifier, challenge } = generatePkce();
  const state = generateState();
  pendingAuth = { verifier, state, startedAt: Date.now() };

  const url = new URL(AUTH_URL);
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('scope', SCOPES.join(' '));
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  // 'select_account' forces an account picker rather than silently using
  // whichever account the browser last signed in with - matters for users
  // with both work and personal Microsoft accounts.
  url.searchParams.set('prompt', 'select_account');

  console.log('[teams-oauth] opening browser for sign-in');
  await shell.openExternal(url.toString());
}

/**
 * Handle the redirect from Microsoft back to nowtify://oauth/callback.
 * Validates state (CSRF check), exchanges the code for tokens, persists
 * them encrypted, then fetches /me to populate the connected-user UI.
 *
 * Throws on any failure (caller surfaces the error to the renderer).
 */
async function handleCallback(callbackUrl) {
  if (!pendingAuth) {
    throw new Error('No sign-in is in progress. Click Connect Microsoft Teams to start.');
  }
  if (Date.now() - pendingAuth.startedAt > PENDING_AUTH_TIMEOUT_MS) {
    pendingAuth = null;
    throw new Error('Sign-in timed out. Click Connect Microsoft Teams to try again.');
  }

  let url;
  try {
    url = new URL(callbackUrl);
  } catch (_) {
    pendingAuth = null;
    throw new Error('Invalid OAuth callback URL');
  }

  const error = url.searchParams.get('error');
  if (error) {
    const desc = url.searchParams.get('error_description') || '';
    pendingAuth = null;
    throw new Error(`Microsoft sign-in error: ${error}${desc ? ' - ' + desc : ''}`);
  }

  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');
  if (!code || !returnedState) {
    pendingAuth = null;
    throw new Error('OAuth callback missing code or state');
  }
  if (returnedState !== pendingAuth.state) {
    pendingAuth = null;
    throw new Error('OAuth state mismatch - possible CSRF, aborting');
  }

  const verifier = pendingAuth.verifier;
  pendingAuth = null;

  const tokens = await exchangeCodeForTokens(code, verifier);
  const user = await fetchMe(tokens.access_token);

  store.setTeamsTokens({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  });
  store.setTeamsUser({
    userId: user.id,
    userDisplayName: user.displayName,
  });

  console.log('[teams-oauth] connected as', user.displayName);
  return user;
}

async function exchangeCodeForTokens(code, verifier) {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
    scope: SCOPES.join(' '),
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Token exchange failed: ${res.status} ${text.slice(0, 300)}`);
  }
  return res.json();
}

/**
 * Trade the stored refresh token for a fresh access token. Called when an
 * existing access token has expired (or within 60s of expiring). The new
 * refresh token (if Microsoft rotates it) replaces the old one.
 */
async function refreshAccessToken() {
  const stored = store.getTeams();
  if (!stored.refreshToken) {
    throw new Error('Not connected to Microsoft Teams');
  }

  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: stored.refreshToken,
    scope: SCOPES.join(' '),
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // 4xx on refresh usually means the refresh token has been revoked
    // (user signed out elsewhere, admin reset sessions, etc). Clear local
    // state so the UI prompts the user to reconnect.
    if (res.status >= 400 && res.status < 500) {
      store.clearTeams();
    }
    throw new Error(`Token refresh failed: ${res.status} ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  store.setTeamsTokens({
    accessToken: data.access_token,
    // Microsoft rotates refresh tokens on each use; fall back to the old
    // one if for some reason a new one wasn't issued.
    refreshToken: data.refresh_token || stored.refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  });
  return data.access_token;
}

/**
 * Returns a non-expired access token, refreshing if necessary. Returns
 * null if the user has never connected.
 */
async function getValidAccessToken() {
  const stored = store.getTeams();
  if (!stored.accessToken) return null;
  // Refresh ~60s before expiry to avoid races with in-flight requests.
  if (stored.expiresAt && Date.now() > stored.expiresAt - 60_000) {
    return refreshAccessToken();
  }
  return stored.accessToken;
}

async function fetchMe(accessToken) {
  const res = await fetch(GRAPH_ME_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`/me failed: ${res.status} ${text.slice(0, 300)}`);
  }
  return res.json();
}

function disconnect() {
  store.clearTeams();
  pendingAuth = null;
  console.log('[teams-oauth] disconnected');
}

function isConnected() {
  return Boolean(store.getTeams().accessToken);
}

module.exports = {
  beginAuth,
  handleCallback,
  refreshAccessToken,
  getValidAccessToken,
  disconnect,
  isConnected,
  REDIRECT_URI,
};
