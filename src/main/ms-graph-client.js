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

  // NOTE: Graph's /me/chats does not support $orderby (returns 400 if you
  // try). Just pull the top 50 and filter client-side.
  const data = await graphGet('/me/chats?$expand=lastMessagePreview&$top=50');
  const chats = data.value || [];
  console.log(`[graph] /me/chats returned ${chats.length} chats`);
  const hits = [];
  const sampleSenderIds = [];
  for (const chat of chats) {
    // Skip meeting-sidebar chats - these are auto-created when you join a
    // Teams meeting and often persist invisibly in Graph long after the
    // meeting is over. They create false-positive alerts ("ghost messages"
    // the user doesn't see in their Teams app). 1:1 + group chats only.
    if (chat.chatType === 'meeting') continue;

    const msg = chat.lastMessagePreview;
    if (!msg) continue;
    if (msg.isDeleted) continue;
    const fromId = msg.from && msg.from.user && msg.from.user.id;
    if (sampleSenderIds.length < 5 && fromId) sampleSenderIds.push(fromId);
    if (!fromId || !idSet.has(fromId)) continue;

    // Read-status filter: skip if the user has already viewed this chat
    // since the message arrived. Matches email "read = clears alert"
    // behavior. Graph exposes the read receipt as
    // chat.viewpoint.lastMessageReadDateTime - the timestamp of the last
    // message the current user has read in this chat.
    //
    // Fallback: if viewpoint or lastMessageReadDateTime is missing
    // (some tenants disable read receipts, or older Graph versions),
    // treat as unread - better to alert about a possibly-seen message
    // than to silently drop a real unread one.
    const lastReadIso = chat.viewpoint && chat.viewpoint.lastMessageReadDateTime;
    if (lastReadIso && msg.createdDateTime) {
      const lastReadMs = Date.parse(lastReadIso);
      const messageMs = Date.parse(msg.createdDateTime);
      if (Number.isFinite(lastReadMs) && Number.isFinite(messageMs) && messageMs <= lastReadMs) {
        continue; // already read in Teams - don't alert
      }
    }

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
        // Graph returns the body as HTML (<p>, <div>, etc). Strip tags +
        // collapse whitespace so the popover shows the actual text.
        preview: stripHtml((msg.body && msg.body.content) || ''),
      },
    });
  }
  if (chats.length > 0 && hits.length === 0) {
    console.log(
      `[graph] no matches. Sample sender IDs from latest chats: ${sampleSenderIds.join(', ')} | watching: ${Array.from(idSet).join(', ')}`,
    );
  }
  return hits;
}

function stripHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Returns unread emails in the user's mailbox sent by any of the given
 * email addresses. Normalized to:
 *   { messageId, subject, preview, sender: {displayName, address},
 *     receivedDateTime, webLink }
 *
 * Uses /me/messages with an OData $filter combining isRead = false +
 * sender address in (...). Caps at 50 results - if a watched user has
 * more than 50 unread emails, we'd still show the most recent 50 which
 * is plenty for "you have a stack waiting" alerting.
 */
async function getUnreadEmailsFromUsers(emailAddresses) {
  if (!emailAddresses || emailAddresses.length === 0) return [];
  const cleaned = emailAddresses
    .map((e) => String(e || '').trim().toLowerCase())
    .filter(Boolean);
  if (cleaned.length === 0) return [];
  const addressSet = new Set(cleaned);

  // Graph's /me/messages $filter only allows ONE indexed property at a
  // time on mail items. Combining `isRead eq false` AND
  // `from/emailAddress/address eq '...'` returns 400 "InefficientFilter".
  // Strategy: filter server-side by isRead=false, pull the top 150
  // most-recent unread, then filter by sender client-side. For users with
  // an enormous unread backlog this could miss older unread from a
  // watched sender, but the most-recent 150 captures the "needs attention
  // today" set which is what alerting is about.
  const path =
    '/me/messages?$select=id,subject,bodyPreview,from,receivedDateTime,webLink' +
    '&$filter=' +
    encodeURIComponent('isRead eq false') +
    '&$orderby=receivedDateTime desc' +
    '&$top=150';

  const data = await graphGet(path);
  const messages = data.value || [];

  const matches = messages.filter((m) => {
    const addr = (
      (m.from && m.from.emailAddress && m.from.emailAddress.address) ||
      ''
    ).toLowerCase();
    return addr && addressSet.has(addr);
  });
  console.log(
    `[graph] /me/messages returned ${messages.length} unread, ${matches.length} from watched`,
  );

  return matches.map((m) => ({
    messageId: m.id,
    subject: m.subject || '(no subject)',
    preview: (m.bodyPreview || '').trim(),
    sender: {
      displayName:
        (m.from && m.from.emailAddress && m.from.emailAddress.name) || '',
      address:
        (m.from && m.from.emailAddress && m.from.emailAddress.address) || '',
    },
    receivedDateTime: m.receivedDateTime,
    webLink: m.webLink || '',
  }));
}

module.exports = {
  searchUsers,
  getRecentMessagesFromWatchedUsers,
  getUnreadEmailsFromUsers,
};
