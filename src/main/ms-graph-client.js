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

/**
 * Returns the user's recent chats whose most recent message was sent by
 * one of the given watchedUserIds (i.e. "VIP just messaged you"). Each
 * entry is normalized to:
 *   { chatId, topic, webUrl, lastMessage: { id, sender: {id, displayName},
 *     createdDateTime, preview } }
 *
 * Graph's chats endpoint doesn't expose an "unread" flag (read state is
 * managed by the Teams client locally), so we use the heuristic
 * "watched user sent the most recent message in this chat" as the proxy
 * for "they're waiting on you." Age-based filtering happens upstream in
 * the alert engine.
 */
async function getRecentMessagesFromWatchedUsers(watchedUserIds) {
  if (!watchedUserIds || watchedUserIds.length === 0) return [];
  const idSet = new Set(watchedUserIds);

  const data = await graphGet(
    '/me/chats?$expand=lastMessagePreview&$top=50&$orderby=lastUpdatedDateTime desc',
  );
  const chats = data.value || [];
  console.log(`[graph] /me/chats returned ${chats.length} chats`);
  const hits = [];
  const sampleSenderIds = [];
  for (const chat of chats) {
    const msg = chat.lastMessagePreview;
    if (!msg) continue;
    if (msg.isDeleted) continue;
    const fromId = msg.from && msg.from.user && msg.from.user.id;
    if (sampleSenderIds.length < 5 && fromId) sampleSenderIds.push(fromId);
    if (!fromId || !idSet.has(fromId)) continue;
    hits.push({
      chatId: chat.id,
      topic: chat.topic || '',
      webUrl: chat.webUrl || '',
      lastMessage: {
        id: msg.id,
        sender: {
          id: fromId,
          displayName: (msg.from.user.displayName) || '',
        },
        createdDateTime: msg.createdDateTime,
        preview: (msg.body && msg.body.content) || '',
      },
    });
  }
  // If we got chats but no hits, log a sample of sender IDs so we can
  // tell whether the watched-user IDs are matching what Graph reports.
  if (chats.length > 0 && hits.length === 0) {
    console.log(
      `[graph] no matches. Sample sender IDs from latest chats: ${sampleSenderIds.join(', ')} | watching: ${Array.from(idSet).join(', ')}`,
    );
  }
  return hits;
}

module.exports = {
  searchUsers,
  getRecentMessagesFromWatchedUsers,
};
