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

  isConfigured() {
    return Boolean(this.siteUrl && this.email && this.apiToken);
  }

  authHeader() {
    const raw = `${this.email}:${this.apiToken}`;
    const b64 = Buffer.from(raw, 'utf8').toString('base64');
    return `Basic ${b64}`;
  }

  async request(path, { method = 'GET', body, query } = {}) {
    if (!this.isConfigured()) throw new Error('JSM client not configured');
    const url = new URL(path.startsWith('http') ? path : `${this.siteUrl}${path}`);
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
   * "true". The field's underlying type varies per instance — boolean toggle,
   * option-select (Yes/No), labels, etc. — so we try each common shape and
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

module.exports = { JsmClient, parseSlaField, parseMajorIncident };
