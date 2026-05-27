/**
 * Thin Microsoft Graph REST client - the data plane to ms-graph-oauth's
 * control plane. Handles authenticated GETs against graph.microsoft.com,
 * automatic token refresh on 401, and shape normalization for the small
 * set of endpoints Nowtify uses.
 */

const msGraphOAuth = require('./ms-graph-oauth');

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

/**
 * Authenticated Graph GET with automatic token refresh on 401. Caller
 * passes a relative path (e.g. "/users?$search=...") and optional headers.
 * Returns the parsed JSON body; throws with a useful message on error.
 */
async function graphGet(path, extraHeaders = {}) {
  let accessToken = await msGraphOAuth.getValidAccessToken();
  if (!accessToken) {
    throw new Error('Not connected to Microsoft Teams');
  }

  const doRequest = (token) =>
    fetch(`${GRAPH_BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...extraHeaders,
      },
    });

  let res = await doRequest(accessToken);
  // On 401, refresh once and retry - token may have expired between our
  // proactive check and the actual request.
  if (res.status === 401) {
    accessToken = await msGraphOAuth.refreshAccessToken();
    res = await doRequest(accessToken);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Graph ${path} -> ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

/**
 * Search the tenant's directory for users matching a free-text query.
 * Returns up to 25 hits, each normalized to { id, displayName, mail }.
 *
 * Uses Graph's $search parameter (requires the ConsistencyLevel: eventual
 * header). Falls back to $filter startswith() if $search fails - some
 * tenants restrict $search or require additional permissions.
 */
async function searchUsers(query) {
  const trimmed = (query || '').trim();
  if (!trimmed) return [];

  // Primary: $search (fuzzy, ranked).
  try {
    const encoded = encodeURIComponent(`"${trimmed.replace(/"/g, '')}"`);
    const data = await graphGet(
      `/users?$search=${encoded}&$select=id,displayName,mail,userPrincipalName&$top=25&$count=true`,
      { ConsistencyLevel: 'eventual' },
    );
    return (data.value || []).map(normalizeUser);
  } catch (err) {
    console.warn('[graph] $search failed, falling back to $filter:', err.message);
  }

  // Fallback: $filter startswith on displayName/mail.
  const escaped = trimmed.replace(/'/g, "''");
  const filter = encodeURIComponent(
    `startswith(displayName,'${escaped}') or startswith(mail,'${escaped}') or startswith(userPrincipalName,'${escaped}')`,
  );
  const data = await graphGet(
    `/users?$filter=${filter}&$select=id,displayName,mail,userPrincipalName&$top=25`,
  );
  return (data.value || []).map(normalizeUser);
}

function normalizeUser(u) {
  // mail is sometimes null for accounts that haven't been email-enabled;
  // fall back to userPrincipalName so the UI always has something to show.
  return {
    id: u.id,
    displayName: u.displayName || '(no name)',
    mail: u.mail || u.userPrincipalName || '',
  };
}

module.exports = {
  searchUsers,
};
