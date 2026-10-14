/**
 * Acknowledge: per-alert "I've seen this, stop pulsing it."
 *
 * A long-running Major Incident (or a breached SLA that sits for days)
 * otherwise pulses the whole time and, because it wins the color pick,
 * hides every other alert behind it. Acknowledging takes the alert out of
 * the pulse + color pick on BOTH surfaces (screen edge and tray); it stays
 * listed in the popover until the ticket resolves or the user undoes it.
 *
 * Pure functions only - the engine owns store reads/writes.
 */

const ACKABLE_TYPES = new Set(['major', 'sla']);

// Acks for tickets Nowtify never sees resolve (e.g. Major Incident flag
// cleared while the ticket stays open) are dropped after this long.
const ACK_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function isAckable(alert) {
  return Boolean(alert && ACKABLE_TYPES.has(alert.trigType));
}

function ackIdFor(alert) {
  return `${alert.ticketKey}|${alert.conditionId}`;
}

function buildAck(alert, now = Date.now()) {
  return { at: now, ticketKey: alert.ticketKey };
}

function isExpired(ack, now = Date.now()) {
  return !ack || !ack.at || now - ack.at > ACK_MAX_AGE_MS;
}

module.exports = {
  ACK_MAX_AGE_MS,
  isAckable,
  ackIdFor,
  buildAck,
  isExpired,
};
