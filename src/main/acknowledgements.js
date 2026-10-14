/**
 * Acknowledge: per-alert "I've seen this, stop pulsing it."
 *
 * A long-running Major Incident (or a breached SLA that sits for days)
 * otherwise pulses the whole time and, because it wins the color pick,
 * hides every other alert behind it. Acknowledging takes the alert out of
 * the pulse + color pick on BOTH surfaces (screen edge and tray); it stays
 * listed in the popover.
 *
 * An acknowledged alert re-arms (pulses again) only when the ticket gets
 * worse:
 *   - priority goes UP (e.g. P2 -> P1), or
 *   - status moves BACKWARDS (e.g. Monitoring -> In Progress).
 * Forward progress (Investigating -> Monitoring) stays quiet.
 *
 * "Backwards" is workflow-agnostic: a status counts as a regression if the
 * ticket has already been in it before (from the JSM changelog captured at
 * acknowledge time, plus every status Nowtify sees afterwards), or if the
 * status category drops (In Progress -> To Do).
 *
 * Pure functions only - the engine owns store reads/writes.
 */

const ACKABLE_TYPES = new Set(['major', 'sla']);

// Acks for tickets Nowtify never sees resolve (e.g. Major Incident flag
// cleared while the ticket stays open) are dropped after this long.
const ACK_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const CATEGORY_RANK = { new: 0, indeterminate: 1, done: 2 };

function isAckable(alert) {
  return Boolean(alert && ACKABLE_TYPES.has(alert.trigType));
}

function ackIdFor(alert) {
  return `${alert.ticketKey}|${alert.conditionId}`;
}

// Ticket state we compare against, pulled off the raw JSM issue fields.
function snapshotFromFields(fmap) {
  const f = fmap || {};
  const status = f.status || {};
  const cat = status.statusCategory || {};
  return {
    status: status.name || '',
    statusCategory: String(cat.key || '').toLowerCase(),
    priority: (f.priority && f.priority.name) || '',
  };
}

/**
 * Rank a priority name; LOWER number = MORE urgent. Uses the JSM
 * instance's own priority order when we have it (index in the list,
 * most urgent first). Otherwise falls back to common naming schemes.
 * Returns null when the name can't be ranked.
 */
function priorityRank(name, priorityOrder) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return null;
  if (Array.isArray(priorityOrder) && priorityOrder.length) {
    const idx = priorityOrder.findIndex((p) => String(p).toLowerCase() === n);
    if (idx !== -1) return idx;
  }
  const num = n.match(/^(?:p|sev(?:erity)?\s?)(\d)\b/);
  if (num) return Number(num[1]);
  const words = ['blocker', 'critical', 'highest', 'high', 'medium', 'low', 'lowest'];
  const idx = words.indexOf(n);
  return idx === -1 ? null : idx;
}

function buildAck(alert, { statusHistory = [], now = Date.now() } = {}) {
  const snap = alert.ackSnapshot || {};
  const seen = [...new Set([...statusHistory, snap.status].filter(Boolean))];
  return {
    at: now,
    ticketKey: alert.ticketKey,
    status: snap.status || '',
    statusCategory: snap.statusCategory || '',
    priority: snap.priority || '',
    statusesSeen: seen,
  };
}

/**
 * Compare the current ticket snapshot against an ack.
 * Returns { rearm: boolean, reason?: string, next?: ack }
 *   rearm=true  -> drop the ack, alert pulses again
 *   next        -> updated ack to persist (forward progress / priority
 *                  lowered moves the baseline so a later regression or
 *                  re-raise is still caught)
 */
function evaluateAck(ack, snap, priorityOrder) {
  if (!ack || !snap) return { rearm: false };

  const was = priorityRank(ack.priority, priorityOrder);
  const now = priorityRank(snap.priority, priorityOrder);
  if (was !== null && now !== null && now < was) {
    return { rearm: true, reason: `priority ${ack.priority} -> ${snap.priority}` };
  }

  const statusChanged = snap.status && snap.status !== ack.status;
  if (statusChanged) {
    const seen = ack.statusesSeen || [];
    if (seen.includes(snap.status)) {
      return { rearm: true, reason: `status back to ${snap.status}` };
    }
    const prevCat = CATEGORY_RANK[ack.statusCategory];
    const curCat = CATEGORY_RANK[snap.statusCategory];
    if (prevCat !== undefined && curCat !== undefined && curCat < prevCat) {
      return { rearm: true, reason: `status category ${ack.statusCategory} -> ${snap.statusCategory}` };
    }
  }

  const priorityChanged = snap.priority && snap.priority !== ack.priority;
  if (!statusChanged && !priorityChanged) return { rearm: false };
  return {
    rearm: false,
    next: {
      ...ack,
      status: snap.status || ack.status,
      statusCategory: snap.statusCategory || ack.statusCategory,
      priority: snap.priority || ack.priority,
      statusesSeen: statusChanged
        ? [...(ack.statusesSeen || []), snap.status]
        : ack.statusesSeen || [],
    },
  };
}

function isExpired(ack, now = Date.now()) {
  return !ack || !ack.at || now - ack.at > ACK_MAX_AGE_MS;
}

module.exports = {
  ACK_MAX_AGE_MS,
  isAckable,
  ackIdFor,
  snapshotFromFields,
  priorityRank,
  buildAck,
  evaluateAck,
  isExpired,
};
