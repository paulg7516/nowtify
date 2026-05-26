/**
 * Minimal JSM / Jira Cloud REST client for the POC.
 * Auth: Atlassian API token (Basic auth: email:token base64).
 */

class JsmClient {
  constructor({ siteUrl, email, apiToken }) {
    this.siteUrl = (siteUrl || '').replace(/\/+$/, '');
    this.email = email || '';
    this.apiToken = apiToken || '';
  }

  // Reject anything that isn't HTTPS so we never send Basic-auth credentials
  // (email + token) over a cleartext connection. Atlassian Cloud is always
  // https; this guards against a misconfigured siteUrl downgrading auth.
  isHttpsSite() {
    if (!this.siteUrl) return false;
    try {
      return new URL(this.siteUrl).protocol === 'https:';
    } catch (_) {
      return false;
    }
  }

  isConfigured() {
    return Boolean(this.siteUrl && this.email && this.apiToken && this.isHttpsSite());
  }

  authHeader() {
    const raw = `${this.email}:${this.apiToken}`;
    const b64 = Buffer.from(raw, 'utf8').toString('base64');
    return `Basic ${b64}`;
  }

  async request(path, { method = 'GET', body, query } = {}) {
    if (!this.isConfigured()) {
      if (this.siteUrl && !this.isHttpsSite()) {
        throw new Error('JSM site URL must use https:// - refusing to send credentials over http');
      }
      throw new Error('JSM client not configured');
    }
    const url = new URL(path.startsWith('http') ? path : `${this.siteUrl}${path}`);
    if (url.protocol !== 'https:') {
      throw new Error('JSM request blocked: non-https URL ' + url.toString().slice(0, 200));
    }
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }
    const res = await fetch(url.toString(), {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: this.authHeader(),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`JSM ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  async getMyself() {
    return this.request('/rest/api/3/myself');
  }

  async searchUsers(query) {
    const users = await this.request('/rest/api/3/user/search', {
      query: { query, maxResults: 20 },
    });
    return (users || []).map((u) => ({
      accountId: u.accountId,
      displayName: u.displayName,
      emailAddress: u.emailAddress || '',
      avatarUrl: (u.avatarUrls && u.avatarUrls['24x24']) || '',
      active: u.active !== false,
    }));
  }

  async searchGroups(query) {
    const data = await this.request('/rest/api/3/groups/picker', {
      query: { query, maxResults: 20 },
    });
    return ((data && data.groups) || []).map((g) => ({
      name: g.name,
      groupId: g.groupId || '',
      html: g.html || '',
    }));
  }

  async listFields() {
    return this.request('/rest/api/3/field');
  }

  // Atlassian Cloud assigns each tenant a UUID exposed via the undocumented
  // /_edge/tenant_info endpoint. Required by the chatplatform routes below.
  async getCloudId() {
    if (this._cloudId) return this._cloudId;
    try {
      const data = await this.request('/_edge/tenant_info');
      this._cloudId = data && data.cloudId;
      return this._cloudId || null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Look up the Microsoft Teams meeting URL for a given JSM issue.
   * Uses Atlassian's chatplatform gateway (the same endpoint JSM's web UI
   * calls to render the "Microsoft Teams: Join CASE-575" link in the
   * Details panel). Authenticated by the same Basic auth (email + API
   * token) we already use - no separate JSM Ops token required.
   *
   * Returns the full https://teams.microsoft.com/l/meetup-join/... URL,
   * or null if no Teams conversation exists for the issue.
   */
  /**
   * Returns { url, type } for the Teams conversation attached to the issue,
   * or null if none exists. `type` is JSM's conversationType field, e.g.:
   *   - "msteams-meeting" → a scheduled video meeting (Join button = video)
   *   - "msteams-channel" / "msteams-chat" → a chat surface (Join button = chat bubble)
   */
  async getTeamsConnection({ issueId, projectId }) {
    if (!issueId || !projectId) return null;
    const cloudId = await this.getCloudId();
    if (!cloudId) return null;
    const path = `/gateway/api/chatplatform/opsgenie/${cloudId}/api/internal-api/v3/chat/issue-state`;
    try {
      const data = await this.request(path, {
        query: {
          issuerType: 'jsm-issue',
          issuerId: String(issueId),
          chatType: 'msteams',
          entityType: 'jsm-project',
          entityId: String(projectId),
          appType: 'jsm-msteams-app',
        },
      });
      const conv =
        data &&
        data.data &&
        Array.isArray(data.data.conversations) &&
        data.data.conversations.find((c) => c && c.chatType === 'msteams');
      if (!conv || !conv.conversationLink) return null;
      return {
        url: conv.conversationLink,
        type: conv.conversationType || 'msteams-meeting',
      };
    } catch (_) {
      return null;
    }
  }

  async getIssue(issueKey, { fields = ['status'] } = {}) {
    try {
      return await this.request(`/rest/api/3/issue/${encodeURIComponent(issueKey)}`, {
        query: { fields: fields.join(',') },
      });
    } catch (_) {
      return null;
    }
  }

  /**
   * Resolve the field IDs we care about from the JSM instance.
   * Returns { majorIncidentFieldId, majorIncidentSchema, slaFieldIds: [{id, name}] }
   */
  async resolveFieldIds({ majorIncidentName = 'Major Incident' } = {}) {
    const fields = await this.listFields();
    const major = fields.find(
      (f) => f.name && f.name.toLowerCase() === majorIncidentName.toLowerCase(),
    );
    const slaFields = fields
      .filter((f) => {
        const t = f.schema && (f.schema.custom || f.schema.type);
        return t && String(t).toLowerCase().includes('sla');
      })
      .map((f) => ({ id: f.id, name: f.name }));
    return {
      majorIncidentFieldId: major ? major.id : '',
      majorIncidentSchema: major ? major.schema || null : null,
      slaFieldIds: slaFields,
    };
  }

  /**
   * Instance-wide search for open tickets where the Major Incident field is
   * "true". The field's underlying type varies per instance - boolean toggle,
   * option-select (Yes/No), labels, etc. - so we try each common shape and
   * union the results. Individual query failures are tolerated (a wrong-type
   * predicate against a typed field will error; another will succeed).
   */
  async searchMajorIncidents({ fieldId, fields }) {
    if (!fieldId) return [];
    const cfNum = String(fieldId).replace(/^customfield_/, '');
    const predicates = [
      `cf[${cfNum}] is not EMPTY`,
      `cf[${cfNum}] = true`,
      `cf[${cfNum}] = "Yes"`,
      `cf[${cfNum}] = Yes`,
      `cf[${cfNum}] = "true"`,
    ];
    const body = {
      jql: '',
      fields: fields && fields.length ? fields : ['summary', 'priority', 'assignee', 'status'],
      maxResults: 100,
    };
    const seen = new Set();
    const results = [];
    const probes = []; // diagnostic: per-predicate result/error
    for (const pred of predicates) {
      try {
        body.jql = `statusCategory != Done AND assignee is not EMPTY AND ${pred} ORDER BY updated DESC`;
        const data = await this.request('/rest/api/3/search/jql', { method: 'POST', body });
        const got = (data && data.issues) || [];
        probes.push({ pred, count: got.length });
        for (const issue of got) {
          if (!seen.has(issue.key)) {
            seen.add(issue.key);
            results.push(issue);
          }
        }
      } catch (err) {
        probes.push({ pred, error: (err && err.message) || String(err) });
      }
    }
    results.__probes = probes; // attach for diagnostic logging
    return results;
  }

  /**
   * Returns the authenticated user's pending approvals - the same list the
   * JSM customer portal shows under "Approvals" in the user menu.
   *
   * Uses JSM's Service Desk REST API (`/rest/servicedeskapi/request` with
   * `approvalState=MY_PENDING_APPROVAL`) rather than generic JQL, because:
   *   - The portal Approvals badge count comes from this endpoint, so we
   *     get exact parity with what the user sees in the UI.
   *   - `approver = currentUser()` JQL fails on a lot of JSM setups
   *     (permission scoping, custom field name differences, etc) and
   *     silently returns 0 even when approvals exist.
   *   - Service Desk endpoint applies the right permission model for
   *     cross-project approvals.
   *
   * Falls back to JQL if the servicedesk endpoint is unavailable (e.g. the
   * site has Software but not Service Management licensed).
   */
  async searchMyPendingApprovals(_opts) {
    // Primary: JSM Service Desk approvals endpoint.
    try {
      const data = await this.request('/rest/servicedeskapi/request', {
        query: {
          approvalState: 'MY_PENDING_APPROVAL',
          limit: 100,
        },
      });
      const values = (data && data.values) || [];
      console.log(`[jsm-client] servicedeskapi MY_PENDING_APPROVAL -> ${values.length}`);
      return values.map((v) => mapServiceDeskRequestToIssue(v));
    } catch (err) {
      console.warn(
        '[jsm-client] servicedeskapi approvals query failed, falling back to JQL:',
        err.message,
      );
    }

    // Fallback: generic JQL. Less reliable but covers Software-only sites.
    const body = {
      jql: 'approver = currentUser() AND resolution = Unresolved ORDER BY updated DESC',
      fields: ['summary', 'assignee', 'status', 'created'],
      maxResults: 100,
    };
    try {
      const data = await this.request('/rest/api/3/search/jql', { method: 'POST', body });
      const issues = (data && data.issues) || [];
      console.log(`[jsm-client] fallback JQL approver=currentUser -> ${issues.length}`);
      return issues;
    } catch (err) {
      console.warn('[jsm-client] approver JQL fallback also failed:', err.message);
      return [];
    }
  }

  /**
   * JQL search for open tickets assigned to any of the given accountIds
   * OR to any member of the given group names. Uses /search/jql.
   */
  async searchAssignedOpen({ accountIds, groupNames, fields }) {
    const clauses = [];
    if (accountIds && accountIds.length) {
      const quoted = accountIds.map((id) => `"${id}"`).join(',');
      clauses.push(`assignee in (${quoted})`);
    }
    if (groupNames && groupNames.length) {
      for (const name of groupNames) {
        const escaped = String(name).replace(/"/g, '\\"');
        clauses.push(`assignee in membersOf("${escaped}")`);
      }
    }
    if (clauses.length === 0) return [];
    const jql = `(${clauses.join(' OR ')}) AND statusCategory != Done ORDER BY priority DESC, updated DESC`;
    const body = {
      jql,
      fields: fields && fields.length ? fields : ['summary', 'priority', 'assignee', 'status'],
      maxResults: 100,
    };
    const data = await this.request('/rest/api/3/search/jql', { method: 'POST', body });
    return (data && data.issues) || [];
  }
}

/**
 * Parse a JSM SLA custom field value into a normalized shape.
 * JSM returns SLA fields with structure:
 *   { ongoingCycle: { remainingTime: { millis }, breached }, completedCycles: [...] }
 */
function parseSlaField(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const ongoing = raw.ongoingCycle;
  if (!ongoing) {
    const last = (raw.completedCycles || []).slice(-1)[0];
    if (!last) return null;
    return {
      hasOngoing: false,
      breached: Boolean(last.breached),
      remainingMillis: null,
      remainingMinutes: null,
    };
  }
  const millis =
    ongoing.remainingTime && typeof ongoing.remainingTime.millis === 'number'
      ? ongoing.remainingTime.millis
      : null;
  return {
    hasOngoing: true,
    breached: Boolean(ongoing.breached),
    remainingMillis: millis,
    remainingMinutes: millis === null ? null : Math.round(millis / 60_000),
    goalDuration:
      ongoing.goalDuration && ongoing.goalDuration.friendly
        ? ongoing.goalDuration.friendly
        : null,
  };
}

/**
 * Read a Major Incident custom field value. Different JSM instances and
 * field types serialize this differently:
 *   - Modern JSM "major-incident-entity" field stores the literal string
 *     "MAJOR_INCIDENT" when toggled on, empty/null otherwise.
 *   - Legacy option-select field stores { value: "Yes" } / { value: "No" }.
 *   - Boolean field stores true / false.
 *   - Labels field stores ["Yes"].
 */
const TRUTHY_TOKENS = new Set([
  'yes',
  'true',
  'on',
  '1',
  'major_incident',
  'major incident',
]);

function parseMajorIncident(raw) {
  if (raw === true) return true;
  if (raw == null || raw === false) return false;
  if (typeof raw === 'string') {
    return TRUTHY_TOKENS.has(raw.trim().toLowerCase());
  }
  if (Array.isArray(raw)) {
    return raw.some((item) => parseMajorIncident(item));
  }
  if (typeof raw === 'object') {
    const v = raw.value ?? raw.name ?? raw.id ?? '';
    return TRUTHY_TOKENS.has(String(v).trim().toLowerCase());
  }
  return false;
}

/**
 * Map a Service Desk request payload into the issue-shape the alert engine
 * expects. The servicedeskapi response is structurally different from
 * /rest/api/3/search results (request-centric vs issue-centric), so we
 * normalize it here so downstream code doesn't have to branch.
 */
function mapServiceDeskRequestToIssue(req) {
  const fieldValues = Array.isArray(req.requestFieldValues) ? req.requestFieldValues : [];
  const findFieldValue = (id) => {
    const f = fieldValues.find((x) => x && x.fieldId === id);
    return f ? f.value : null;
  };
  const summary = findFieldValue('summary') || req.requestType?.name || '';
  const createdIso =
    (req.createdDate && (req.createdDate.iso8601 || req.createdDate.epochMillis)) ||
    new Date().toISOString();
  const assignee = req.reporter
    ? {
        accountId: req.reporter.accountId,
        displayName: req.reporter.displayName,
      }
    : null;
  return {
    id: req.issueId,
    key: req.issueKey,
    fields: {
      summary: typeof summary === 'string' ? summary : String(summary || ''),
      assignee,
      status: req.currentStatus
        ? {
            name: req.currentStatus.status || '',
            statusCategory: {
              key: (req.currentStatus.statusCategory || '').toLowerCase(),
            },
          }
        : null,
      created:
        typeof createdIso === 'string'
          ? createdIso
          : new Date(Number(createdIso) || Date.now()).toISOString(),
    },
  };
}

module.exports = { JsmClient, parseSlaField, parseMajorIncident };
