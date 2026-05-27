const EventEmitter = require('events');
const { JsmClient, parseSlaField, parseMajorIncident } = require('./jsm-client');
const msGraphClient = require('./ms-graph-client');
const msGraphOAuth = require('./ms-graph-oauth');
const store = require('./store');

/**
 * Alert engine: polls JSM on an interval, evaluates triggers against the
 * watch list, applies snooze/dismiss state, emits an overall overlay state.
 *
 * Emits:
 *   'state'  -> { status, color, pulse, alerts: [...] }
 *   'error'  -> Error
 */
class AlertEngine extends EventEmitter {
  constructor() {
    super();
    this.client = null;
    this.fieldCache = null; // { majorIncidentFieldId, slaFieldIds: [{id,name}] }
    this.timer = null;
    this.lastState = { status: 'idle', color: null, pulse: false, alerts: [] };
    this.running = false;
    this.previousActiveKeys = new Set(); // ticketKeys of last tick's active alerts
  }

  rebuildClient() {
    const cfg = store.get('jsm') || {};
    this.client = new JsmClient(cfg);
    this.fieldCache = null;
  }

  async ensureFields() {
    if (this.fieldCache) return this.fieldCache;
    const cfg = store.get('jsm') || {};
    const overrideId = cfg.majorIncidentFieldId;
    const resolved = await this.client.resolveFieldIds();
    if (overrideId) resolved.majorIncidentFieldId = overrideId;
    this.fieldCache = resolved;
    return resolved;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.rebuildClient();
    const intervalSec = store.get('pollIntervalSeconds') || 30;
    this.tick().catch((err) => this.emit('error', err));
    this.timer = setInterval(() => {
      this.tick().catch((err) => this.emit('error', err));
    }, intervalSec * 1000);
  }

  stop() {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async pokeNow() {
    return this.tick();
  }

  async tick() {
    console.log('[engine] tick start');
    if (!this.client || !this.client.isConfigured()) {
      console.log('[engine] early exit: client not configured');
      this.emitState({ status: 'idle', color: null, pulse: false, alerts: [] });
      return;
    }
    const allTriggers = store.get('triggers') || [];
    const enabledTriggers = allTriggers.filter((t) => t.enabled);
    const majorTriggers = enabledTriggers.filter((t) => t.type === 'major');
    const slaTriggers = enabledTriggers.filter((t) => t.type === 'sla');
    const approvalTriggers = enabledTriggers.filter((t) => t.type === 'approval');
    const teamsTriggers = enabledTriggers.filter((t) => t.type === 'teams');
    const snoozed = store.isSnoozed();
    const snoozeUntilMs = store.get('snoozeUntil') || 0;
    const anyEnabled = enabledTriggers.length > 0;

    if (!anyEnabled) {
      console.log('[engine] early exit: no triggers enabled');
      this.emitState(computeOverallState([], { snoozed, anyEnabled }));
      return;
    }

    let fields;
    try {
      fields = await this.ensureFields();
    } catch (err) {
      this.emit('error', err);
      return;
    }

    const fieldIds = [
      'summary',
      'priority',
      'assignee',
      'status',
      'project',
      ...(fields.majorIncidentFieldId ? [fields.majorIncidentFieldId] : []),
      ...fields.slaFieldIds.map((f) => f.id),
    ];

    // 1) Instance-wide Major Incident query (no assignee filter)
    let majorIssues = [];
    if (majorTriggers.length && fields.majorIncidentFieldId) {
      try {
        majorIssues = await this.client.searchMajorIncidents({
          fieldId: fields.majorIncidentFieldId,
          fields: fieldIds,
        });
      } catch (err) {
        this.emit('error', err);
      }
    }

    // 2) SLA queries: per-trigger now (scope embedded in each trigger).
    //    Map trigger -> issues so per-trigger scope can filter alerts.
    const slaIssuesByTrigger = new Map();
    for (const trig of slaTriggers) {
      const scope = trig.scope || {};
      const accountIds = (scope.users || []).map((u) => u.accountId).filter(Boolean);
      const groupNames = (scope.groups || []).map((g) => g.name).filter(Boolean);
      if (accountIds.length === 0 && groupNames.length === 0) {
        slaIssuesByTrigger.set(trig.id, []);
        continue;
      }
      try {
        const issues = await this.client.searchAssignedOpen({
          accountIds,
          groupNames,
          fields: fieldIds,
        });
        slaIssuesByTrigger.set(trig.id, issues);
      } catch (err) {
        slaIssuesByTrigger.set(trig.id, []);
        this.emit('error', err);
      }
    }
    // Flat list of unique issues for the disappear-detection downstream.
    const slaIssuesMap = new Map();
    for (const issues of slaIssuesByTrigger.values()) {
      for (const i of issues) slaIssuesMap.set(i.key, i);
    }
    const slaIssues = Array.from(slaIssuesMap.values());

    // 3) Personal approval queue (JSM evaluates approver = currentUser()
    //    against the configured API token's owner).
    let approvalIssues = [];
    if (approvalTriggers.length) {
      try {
        approvalIssues = await this.client.searchMyPendingApprovals({
          fields: ['summary', 'assignee', 'status', 'created'],
        });
      } catch (err) {
        this.emit('error', err);
      }
    }

    // 4) Teams: per-trigger now. Each Teams trigger has its own scope.users
    //    list of Graph user IDs. We query Graph once per trigger to keep
    //    the per-trigger filtering accurate.
    const teamsHitsByTrigger = new Map();
    if (teamsTriggers.length && msGraphOAuth.isConnected()) {
      for (const trig of teamsTriggers) {
        const userIds = ((trig.scope || {}).users || []).map((u) => u.id).filter(Boolean);
        if (userIds.length === 0) {
          teamsHitsByTrigger.set(trig.id, []);
          continue;
        }
        try {
          const hits = await msGraphClient.getRecentMessagesFromWatchedUsers(userIds);
          teamsHitsByTrigger.set(trig.id, hits);
        } catch (err) {
          teamsHitsByTrigger.set(trig.id, []);
          console.warn('[teams] graph query failed:', err.message);
          this.emit('error', err);
        }
      }
    }
    // Flat list for log summary
    let teamsHitsTotal = 0;
    for (const hits of teamsHitsByTrigger.values()) teamsHitsTotal += hits.length;

    const alerts = [];

    // Resolve a display name for an assignee. Prefer cached scope-display
    // names (collected from all SLA triggers' scope.users) so the popover
    // shows the same name the user typed when picking the watcher; fall
    // back to the assignee's own displayName from the JSM API.
    const scopeNameById = new Map();
    for (const trig of slaTriggers) {
      for (const u of (trig.scope || {}).users || []) {
        if (u && u.accountId && u.displayName) scopeNameById.set(u.accountId, u.displayName);
      }
    }
    const nameFor = (assignee) => {
      const accountId = assignee && assignee.accountId;
      if (accountId && scopeNameById.has(accountId)) return scopeNameById.get(accountId);
      return (assignee && assignee.displayName) || 'Unassigned';
    };

    // For Major Incident tickets, fetch the Teams meeting URL in parallel.
    // JSM's chat platform stores one per ticket via the msteams integration.
    const truthMajorIssues = majorIssues.filter((iss) =>
      parseMajorIncident((iss.fields || {})[fields.majorIncidentFieldId]),
    );
    const connByKey = new Map();
    await Promise.all(
      truthMajorIssues.map(async (iss) => {
        const projectId = iss.fields && iss.fields.project && iss.fields.project.id;
        const conn = await this.client.getTeamsConnection({
          issueId: iss.id,
          projectId,
        });
        if (conn) connByKey.set(iss.key, conn);
      }),
    );

    // Evaluate Major Incident triggers (instance-wide).
    for (const issue of truthMajorIssues) {
      const fmap = issue.fields || {};
      const jsmUrl = `${this.client.siteUrl}/browse/${issue.key}`;
      const conn = connByKey.get(issue.key) || null;
      for (const trig of majorTriggers) {
        alerts.push({
          ticketKey: issue.key,
          ticketSummary: fmap.summary || '',
          assigneeName: nameFor(fmap.assignee),
          conditionId: trig.id,
          conditionLabel: trig.label,
          color: trig.color,
          pulse: Boolean(trig.pulse),
          severity: 100,
          jsmUrl,
          trigType: 'major',
          meetingUrl: conn ? conn.url : null,
          meetingType: conn ? conn.type : null,
        });
      }
    }

    // Evaluate Teams triggers per-trigger using their scoped chat hits.
    const nowForTeams = Date.now();
    for (const trig of teamsTriggers) {
      const hitsForTrig = teamsHitsByTrigger.get(trig.id) || [];
      for (const hit of hitsForTrig) {
        const msg = hit.lastMessage;
        const createdMs = msg.createdDateTime ? Date.parse(msg.createdDateTime) : nowForTeams;
        const ageMinutes = Math.max(0, (nowForTeams - createdMs) / 60_000);
        const senderName = msg.sender.displayName || 'Watched user';
        const threshold = Number(trig.ageThresholdMinutes) || 0;
        if (threshold > 0 && ageMinutes < threshold) continue;
        const ageLabel =
          ageMinutes < 1
            ? 'just now'
            : ageMinutes < 60
              ? `${Math.round(ageMinutes)}m ago`
              : `${(ageMinutes / 60).toFixed(1)}h ago`;
        alerts.push({
          ticketKey: senderName,
          ticketSummary: msg.preview ? msg.preview.slice(0, 140) : '(no preview)',
          assigneeName: senderName,
          conditionId: `${trig.id}:${hit.chatId}`,
          conditionLabel: `Teams · ${ageLabel}`,
          color: trig.color,
          pulse: Boolean(trig.pulse),
          // Severity: scales with age, capped at 75 (below SLA-breach so
          // an active incident still wins the border color).
          severity: Math.min(75, 35 + Math.floor(ageMinutes / 5)),
          jsmUrl: hit.webUrl || '',
          trigType: 'teams',
        });
      }
    }

    // Evaluate approval triggers. Each enabled approval trigger fires per
    // matching ticket; ageThresholdHours filters out approvals that haven't
    // sat in the queue long enough yet.
    const nowMs = Date.now();
    for (const issue of approvalIssues) {
      const fmap = issue.fields || {};
      const jsmUrl = `${this.client.siteUrl}/browse/${issue.key}`;
      const createdMs = fmap.created ? Date.parse(fmap.created) : nowMs;
      const ageHours = (nowMs - createdMs) / 3_600_000;
      for (const trig of approvalTriggers) {
        const threshold = Number(trig.ageThresholdHours) || 0;
        if (threshold > 0 && ageHours < threshold) continue;
        const ageLabel =
          threshold > 0
            ? `Pending approval (${threshold}+ hours)`
            : `Pending approval`;
        alerts.push({
          ticketKey: issue.key,
          ticketSummary: fmap.summary || '',
          assigneeName: nameFor(fmap.assignee),
          conditionId: `${trig.id}`,
          conditionLabel: ageLabel,
          color: trig.color,
          pulse: Boolean(trig.pulse),
          // Severity scales with age so older approvals sort to the top of
          // the popover list. Capped to keep below SLA-breach severity.
          severity: Math.min(70, 30 + Math.floor(ageHours)),
          jsmUrl,
          trigType: 'approval',
        });
      }
    }

    // Evaluate SLA triggers per-trigger using their scoped issue lists.
    for (const trig of slaTriggers) {
      const issuesForTrig = slaIssuesByTrigger.get(trig.id) || [];
      for (const issue of issuesForTrig) {
        const fmap = issue.fields || {};
        const jsmUrl = `${this.client.siteUrl}/browse/${issue.key}`;
        for (const slaField of fields.slaFieldIds) {
          const parsed = parseSlaField(fmap[slaField.id]);
          if (!parsed || !parsed.hasOngoing) continue;
          if (!matchesSlaCondition(parsed, trig)) continue;
          const key = `${trig.id}:${slaField.id}:${issue.key}`;
          alerts.push({
            ticketKey: issue.key,
            ticketSummary: fmap.summary || '',
            assigneeName: nameFor(fmap.assignee),
            conditionId: key,
            conditionLabel: `${slaField.name} - ${trig.label}`,
            color: trig.color,
            pulse: Boolean(trig.pulse),
            severity: severityFor(trig, parsed),
            remainingMinutes: parsed.remainingMinutes,
            jsmUrl,
            trigType: 'sla',
          });
        }
      }
    }

    const state = computeOverallState(alerts, { snoozed, snoozeUntilMs, anyEnabled });
    this.emitState(state);

    // Detect resolutions: tickets that were active last tick are gone now,
    // AND their actual status moved to a Done category. Fires a one-shot
    // green pulse via the 'resolved' event - but only when NOT paused.
    // Pause means "no border activity at all," red or green.
    const currentActiveKeys = new Set(alerts.map((a) => a.ticketKey));
    const disappeared = [...this.previousActiveKeys].filter(
      (k) => !currentActiveKeys.has(k),
    );
    this.previousActiveKeys = currentActiveKeys;
    if (disappeared.length > 0 && !snoozed) {
      const resolvedKeys = [];
      await Promise.all(
        disappeared.map(async (key) => {
          const iss = await this.client.getIssue(key, { fields: ['status'] });
          const sc =
            iss && iss.fields && iss.fields.status && iss.fields.status.statusCategory;
          const scKey = sc && (sc.key || '').toLowerCase();
          if (scKey === 'done') resolvedKeys.push(key);
        }),
      );
      if (resolvedKeys.length > 0) {
        this.emit('resolved', { keys: resolvedKeys });
      }
    }

    // One-line tick summary.
    console.log(
      `[engine tick] mi=${majorIssues.length} sla=${slaIssues.length} appr=${approvalIssues.length} teams=${teamsHitsTotal} alerts=${alerts.length} disappeared=${disappeared.length} snoozed=${snoozed} status=${state.status}`,
    );
  }

  emitState(state) {
    this.lastState = state;
    this.emit('state', state);
  }

  getState() {
    return this.lastState;
  }
}

/**
 * Convert JSM remote links into meeting entries based on URL pattern.
 * JSM integrations attach Teams/Zoom/Slack links as remote links.
 */
function matchesSlaCondition(parsed, cond) {
  if (cond.thresholdMinutes === 0) {
    // "Breached" condition: only fires once breached or already past zero.
    return parsed.breached || (parsed.remainingMinutes !== null && parsed.remainingMinutes <= 0);
  }
  if (parsed.remainingMinutes === null) return false;
  if (parsed.breached) return false; // breached has its own zero-threshold rule
  return parsed.remainingMinutes <= cond.thresholdMinutes && parsed.remainingMinutes > 0;
}

function severityFor(cond, parsed) {
  if (parsed.breached) return 90;
  // Smaller remaining minutes = higher severity
  if (parsed.remainingMinutes !== null) {
    return Math.max(10, 80 - parsed.remainingMinutes);
  }
  return 50;
}

function computeOverallState(alerts, { snoozed, snoozeUntilMs, anyEnabled }) {
  const base = {
    alerts,
    snoozed: Boolean(snoozed),
    snoozeUntilMs: snoozeUntilMs || 0,
    anyEnabled: Boolean(anyEnabled),
  };
  if (!anyEnabled) {
    return { status: 'paused', color: null, pulse: false, ...base };
  }
  if (alerts.length === 0) {
    return { status: 'idle', color: null, pulse: false, ...base };
  }
  if (snoozed) {
    return { status: 'snoozed', color: null, pulse: false, ...base };
  }
  const top = alerts.slice().sort((a, b) => b.severity - a.severity)[0];
  const pulse = alerts.some((a) => a.pulse);
  return { status: 'alerting', color: top.color, pulse, ...base };
}

module.exports = { AlertEngine };
