const EventEmitter = require('events');
const { JsmClient, parseSlaField, parseMajorIncident } = require('./jsm-client');
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
    if (!this.client || !this.client.isConfigured()) {
      this.emitState({ status: 'idle', color: null, pulse: false, alerts: [] });
      return;
    }
    const watchList = store.get('watchList') || [];
    const watchGroups = store.get('watchGroups') || [];
    const allTriggers = store.get('triggers') || [];
    const enabledTriggers = allTriggers.filter((t) => t.enabled);
    const majorTriggers = enabledTriggers.filter((t) => t.type === 'major');
    const slaTriggers = enabledTriggers.filter((t) => t.type === 'sla');
    const snoozed = store.isSnoozed();
    const anyEnabled = enabledTriggers.length > 0;

    if (!anyEnabled) {
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

    // 2) Watch-list-scoped query for SLA evaluation
    let slaIssues = [];
    if (slaTriggers.length && (watchList.length || watchGroups.length)) {
      try {
        slaIssues = await this.client.searchAssignedOpen({
          accountIds: watchList.map((u) => u.accountId),
          groupNames: watchGroups.map((g) => g.name),
          fields: fieldIds,
        });
      } catch (err) {
        this.emit('error', err);
      }
    }

    const alerts = [];

    const nameFor = (assignee) => {
      const watchee = watchList.find((u) => u.accountId === (assignee && assignee.accountId));
      return watchee ? watchee.displayName : (assignee && assignee.displayName) || 'Unassigned';
    };

    // Evaluate Major Incident triggers (instance-wide).
    // Push every matching alert; tag with `dismissed` rather than filtering,
    // so the popover can show both Active and Previous (dismissed) tabs.
    for (const issue of majorIssues) {
      const fmap = issue.fields || {};
      if (!parseMajorIncident(fmap[fields.majorIncidentFieldId])) continue;
      const jsmUrl = `${this.client.siteUrl}/browse/${issue.key}`;
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
          dismissed: store.isDismissed(issue.key, trig.id),
        });
      }
    }

    // Evaluate SLA triggers (scoped to watched users/groups)
    for (const issue of slaIssues) {
      const fmap = issue.fields || {};
      const jsmUrl = `${this.client.siteUrl}/browse/${issue.key}`;
      for (const trig of slaTriggers) {
        for (const slaField of fields.slaFieldIds) {
          const parsed = parseSlaField(fmap[slaField.id]);
          if (!parsed || !parsed.hasOngoing) continue;
          if (!matchesSlaCondition(parsed, trig)) continue;
          const key = `${trig.id}:${slaField.id}`;
          alerts.push({
            ticketKey: issue.key,
            ticketSummary: fmap.summary || '',
            assigneeName: nameFor(fmap.assignee),
            conditionId: key,
            conditionLabel: `${slaField.name} — ${trig.label}`,
            color: trig.color,
            pulse: Boolean(trig.pulse),
            severity: severityFor(trig, parsed),
            remainingMinutes: parsed.remainingMinutes,
            jsmUrl,
            dismissed: store.isDismissed(issue.key, key),
          });
        }
      }
    }

    const state = computeOverallState(alerts, { snoozed, anyEnabled });
    this.emitState(state);

    // Detect resolutions: tickets that were active last tick are gone now,
    // AND their actual status moved to a Done category. Fires a one-shot
    // green pulse via the 'resolved' event.
    const currentActiveKeys = new Set(
      alerts.filter((a) => !a.dismissed).map((a) => a.ticketKey),
    );
    const disappeared = [...this.previousActiveKeys].filter(
      (k) => !currentActiveKeys.has(k),
    );
    this.previousActiveKeys = currentActiveKeys;
    if (disappeared.length > 0) {
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
      `[engine tick] mi=${majorIssues.length} sla=${slaIssues.length} alerts=${alerts.length} disappeared=${disappeared.length} snoozed=${snoozed} status=${state.status}`,
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

function computeOverallState(alerts, { snoozed, anyEnabled }) {
  // The overlay border reflects ACTIVE (non-dismissed) alerts only.
  // The popover sees all alerts (so it can split into Active vs Previous tabs).
  const activeAlerts = alerts.filter((a) => !a.dismissed);
  const base = { alerts, snoozed: Boolean(snoozed), anyEnabled: Boolean(anyEnabled) };
  if (!anyEnabled) {
    return { status: 'paused', color: null, pulse: false, ...base };
  }
  if (activeAlerts.length === 0) {
    return { status: 'idle', color: null, pulse: false, ...base };
  }
  if (snoozed) {
    return { status: 'snoozed', color: null, pulse: false, ...base };
  }
  const top = activeAlerts.slice().sort((a, b) => b.severity - a.severity)[0];
  const pulse = activeAlerts.some((a) => a.pulse);
  return { status: 'alerting', color: top.color, pulse, ...base };
}

module.exports = { AlertEngine };
