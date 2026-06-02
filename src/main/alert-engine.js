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
    // Pokes that arrive during an in-flight tick set this flag, and the
    // tick's `finally` block schedules a follow-up tick so the user's
    // intent (e.g. "Resume now" cancelling a snooze) takes effect on
    // the next event-loop tick instead of waiting up to a full poll
    // interval for the next scheduled tick.
    this._needsReTick = false;
    this.previousActiveKeys = new Set(); // ticketKeys of last tick's active alerts
    // Health: surfaced via IPC so the UI can show "engine working / engine
    // broken" instead of silently presenting an empty popover when a code
    // bug or API error kills the tick.
    this.health = {
      lastTickAt: 0,
      lastTickDurationMs: 0,
      lastCounts: null, // { mi, sla, approval, teams }
      stepErrors: {}, // { major: {message, at}, sla: ..., approval: ..., teams: ..., fatal: ... }
      isHealthy: true, // false if any step errored on the last tick
    };
  }

  getHealth() {
    return JSON.parse(JSON.stringify(this.health));
  }

  recordStepError(step, err) {
    const message = (err && err.message) || String(err);
    console.warn(`[engine ${step}] error:`, message);
    this.health.stepErrors[step] = { message, at: Date.now() };
    this.health.isHealthy = false;
    this.emit('error', err);
  }

  clearStepError(step) {
    if (this.health.stepErrors[step]) delete this.health.stepErrors[step];
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
    // Re-entrancy guard. setInterval can fire while pokeNow() is in
    // flight (or a long Graph call from a previous tick is still
    // resolving). Two concurrent ticks would race on previousActiveKeys
    // and the resolution-detection logic - leading to spurious
    // "ticket resolved" green-pulses or missed clears.
    if (this._ticking) {
      // Don't drop the poke - flag it so we re-tick once the current
      // one resolves. Resume-now / snooze-clear depend on this for
      // immediate feedback (otherwise pulse can stay dark for up to
      // a full poll interval, see "Pulse Off / Pulse On" bug).
      this._needsReTick = true;
      console.log('[engine] tick already running - re-tick queued');
      return;
    }
    this._needsReTick = false;
    this._ticking = true;
    const tickStart = Date.now();
    // Tick is wrapped in an outer try/catch: any uncaught throw from the
    // tick body becomes a "fatal" health error rather than a silent crash
    // that leaves the popover at 0 forever.
    try {
      await this._tickInner();
      this.health.lastTickAt = Date.now();
      this.health.lastTickDurationMs = this.health.lastTickAt - tickStart;
      this.clearStepError('fatal');
      // Healthy if no per-step errors remain after this tick.
      this.health.isHealthy = Object.keys(this.health.stepErrors).length === 0;
    } catch (err) {
      this.health.lastTickAt = Date.now();
      this.health.lastTickDurationMs = this.health.lastTickAt - tickStart;
      this.recordStepError('fatal', err);
    } finally {
      this._ticking = false;
      if (this._needsReTick) {
        this._needsReTick = false;
        // Defer one event-loop tick so any awaiters of the just-
        // finished tick resolve before the follow-up tick starts.
        setTimeout(() => {
          this.tick().catch((err) => this.emit('error', err));
        }, 0);
      }
    }
  }

  async _tickInner() {
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
    const emailTriggers = enabledTriggers.filter((t) => t.type === 'email');
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
      this.clearStepError('fields');
    } catch (err) {
      this.recordStepError('fields', err);
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
        this.clearStepError('major');
      } catch (err) {
        this.recordStepError('major', err);
      }
    } else {
      this.clearStepError('major');
    }

    // 2) SLA queries: per-trigger now (scope embedded in each trigger).
    //    Map trigger -> issues so per-trigger scope can filter alerts.
    //    Errors accumulate across the loop and are recorded ONCE at the
    //    end - otherwise trigger B succeeding would clear trigger A's
    //    error and the health panel would lie.
    const slaIssuesByTrigger = new Map();
    let slaLastError = null;
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
        slaLastError = err;
      }
    }
    if (slaLastError) this.recordStepError('sla', slaLastError);
    else this.clearStepError('sla');
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
        this.clearStepError('approval');
      } catch (err) {
        this.recordStepError('approval', err);
      }
    } else {
      this.clearStepError('approval');
    }

    // 4) Teams: per-trigger now. Each Teams trigger has its own scope.users
    //    list of Graph user IDs. We query Graph once per trigger to keep
    //    the per-trigger filtering accurate. Errors accumulate - see SLA
    //    block above for the rationale.
    const teamsHitsByTrigger = new Map();
    let teamsLastError = null;
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
          teamsLastError = err;
        }
      }
    }
    if (teamsLastError) this.recordStepError('teams', teamsLastError);
    else this.clearStepError('teams');

    // 5) Outlook email: per-trigger Graph query of /me/messages filtered
    //    by sender address. Same per-step error accumulation as Teams so
    //    one bad trigger doesn't lie about the others' health.
    const emailHitsByTrigger = new Map();
    let emailLastError = null;
    if (emailTriggers.length && msGraphOAuth.isConnected()) {
      for (const trig of emailTriggers) {
        const scopeUsers = (trig.scope || {}).users || [];
        const addresses = scopeUsers
          .map((u) => u.mail || u.address || '')
          .filter(Boolean);
        if (addresses.length === 0) {
          emailHitsByTrigger.set(trig.id, []);
          continue;
        }
        try {
          const hits = await msGraphClient.getUnreadEmailsFromUsers(addresses);
          emailHitsByTrigger.set(trig.id, hits);
        } catch (err) {
          emailHitsByTrigger.set(trig.id, []);
          emailLastError = err;
        }
      }
    }
    if (emailLastError) this.recordStepError('email', emailLastError);
    else this.clearStepError('email');
    let emailHitsTotal = 0;
    for (const hits of emailHitsByTrigger.values()) emailHitsTotal += hits.length;
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
        // Set medium so the popover can show a "Teams" badge per row
        // when email + Teams alerts mix in the Messages tab.
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
          medium: 'teams',
        });
      }
    }

    // Evaluate Email triggers per-trigger. Same shape as Teams alerts so
    // the popover renders them uniformly in the Messages tab.
    for (const trig of emailTriggers) {
      const hitsForTrig = emailHitsByTrigger.get(trig.id) || [];
      for (const msg of hitsForTrig) {
        const receivedMs = msg.receivedDateTime ? Date.parse(msg.receivedDateTime) : nowForTeams;
        const ageMinutes = Math.max(0, (nowForTeams - receivedMs) / 60_000);
        const threshold = Number(trig.ageThresholdMinutes) || 0;
        if (threshold > 0 && ageMinutes < threshold) continue;
        const ageLabel =
          ageMinutes < 1
            ? 'just now'
            : ageMinutes < 60
              ? `${Math.round(ageMinutes)}m ago`
              : `${(ageMinutes / 60).toFixed(1)}h ago`;
        const senderName = msg.sender.displayName || msg.sender.address || 'Watched user';
        alerts.push({
          ticketKey: senderName,
          ticketSummary: msg.subject || '(no subject)',
          assigneeName: senderName,
          conditionId: `${trig.id}:${msg.messageId}`,
          conditionLabel: `Outlook · ${ageLabel}`,
          color: trig.color,
          pulse: Boolean(trig.pulse),
          // Same severity scaling as Teams - capped below MI/SLA-breach so
          // urgent incidents still win the screen-border color.
          severity: Math.min(70, 30 + Math.floor(ageMinutes / 10)),
          jsmUrl: msg.webLink || '',
          trigType: 'email',
          medium: 'outlook',
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
    this.health.lastCounts = {
      mi: majorIssues.length,
      sla: slaIssues.length,
      approval: approvalIssues.length,
      teams: teamsHitsTotal,
      email: emailHitsTotal,
      alerts: alerts.length,
    };
    console.log(
      `[engine tick] mi=${majorIssues.length} sla=${slaIssues.length} appr=${approvalIssues.length} teams=${teamsHitsTotal} email=${emailHitsTotal} alerts=${alerts.length} disappeared=${disappeared.length} snoozed=${snoozed} status=${state.status}`,
    );
  }

  emitState(state) {
    this.lastState = state;
    this.emit('state', state);
  }

  getState() {
    return this.lastState;
  }

  // Synchronously rebuild + re-emit the cached state with the current
  // snooze gate. Called from the "Resume now" / "Snooze for X" menu
  // actions so the pulse comes back (or goes away) the instant the
  // user clicks, not after a JIRA round-trip. The next pokeNow tick
  // will reconfirm with fresh data; this just gets the UI in sync
  // immediately.
  refreshSnoozeGate() {
    const last = this.lastState;
    if (!last) return;
    const snoozed = store.isSnoozed();
    const snoozeUntilMs = store.get('snoozeUntil') || 0;
    // No-op if the snooze gate hasn't actually changed - avoids
    // emitting a duplicate state event on a no-change click.
    if (Boolean(last.snoozed) === snoozed && (last.snoozeUntilMs || 0) === snoozeUntilMs) {
      return;
    }
    const refreshed = computeOverallState(last.alerts || [], {
      snoozed,
      snoozeUntilMs,
      anyEnabled: Boolean(last.anyEnabled),
    });
    this.emitState(refreshed);
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
