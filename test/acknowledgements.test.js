/**
 * Tests for the acknowledge re-arm rules: an acknowledged alert stays quiet
 * on forward progress and pulses again only when the ticket gets worse
 * (priority up, or status moves backwards).
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const {
  ACK_MAX_AGE_MS,
  isAckable,
  ackIdFor,
  snapshotFromFields,
  priorityRank,
  buildAck,
  evaluateAck,
  isExpired,
} = require('../src/main/acknowledgements');

const ack = (over = {}) => ({
  at: 1,
  ticketKey: 'INC-1',
  status: 'In Progress',
  statusCategory: 'indeterminate',
  priority: 'P2',
  statusesSeen: ['Investigating', 'In Progress'],
  ...over,
});
const snap = (over = {}) => ({
  status: 'In Progress',
  statusCategory: 'indeterminate',
  priority: 'P2',
  ...over,
});

describe('isAckable / ackIdFor', () => {
  test('only JSM ticket alerts (major, sla) can be acknowledged', () => {
    assert.equal(isAckable({ trigType: 'major' }), true);
    assert.equal(isAckable({ trigType: 'sla' }), true);
    assert.equal(isAckable({ trigType: 'approval' }), false);
    assert.equal(isAckable({ trigType: 'teams' }), false);
    assert.equal(isAckable(null), false);
  });
  test('id is ticket + condition, so one ticket can have separate acks', () => {
    assert.equal(ackIdFor({ ticketKey: 'INC-1', conditionId: 'major' }), 'INC-1|major');
  });
});

describe('snapshotFromFields', () => {
  test('pulls status, category and priority names', () => {
    const s = snapshotFromFields({
      status: { name: 'Monitoring', statusCategory: { key: 'Indeterminate' } },
      priority: { name: 'P1' },
    });
    assert.deepEqual(s, { status: 'Monitoring', statusCategory: 'indeterminate', priority: 'P1' });
  });
  test('safe on missing fields', () => {
    assert.deepEqual(snapshotFromFields(undefined), { status: '', statusCategory: '', priority: '' });
  });
});

describe('priorityRank', () => {
  test('uses the instance order when known (most urgent first)', () => {
    const order = ['Emergency', 'Urgent', 'Routine'];
    assert.equal(priorityRank('Emergency', order), 0);
    assert.equal(priorityRank('routine', order), 2);
  });
  test('falls back to P#/Sev# and common words', () => {
    assert.ok(priorityRank('P1') < priorityRank('P2'));
    assert.ok(priorityRank('Sev 1') < priorityRank('Sev 3'));
    assert.ok(priorityRank('Highest') < priorityRank('Medium'));
  });
  test('unknown names are unranked', () => {
    assert.equal(priorityRank('Whatever'), null);
    assert.equal(priorityRank(''), null);
  });
});

describe('buildAck', () => {
  test('seeds statusesSeen from changelog history plus current status', () => {
    const a = buildAck(
      { ticketKey: 'INC-1', ackSnapshot: snap({ status: 'Monitoring' }) },
      { statusHistory: ['Investigating', 'In Progress'], now: 5 },
    );
    assert.deepEqual(a.statusesSeen, ['Investigating', 'In Progress', 'Monitoring']);
    assert.equal(a.at, 5);
    assert.equal(a.status, 'Monitoring');
  });
});

describe('evaluateAck', () => {
  test('nothing changed: stays acknowledged, no write', () => {
    assert.deepEqual(evaluateAck(ack(), snap()), { rearm: false });
  });
  test('priority raised re-arms', () => {
    const r = evaluateAck(ack(), snap({ priority: 'P1' }));
    assert.equal(r.rearm, true);
  });
  test('priority lowered stays quiet but moves the baseline', () => {
    const r = evaluateAck(ack(), snap({ priority: 'P3' }));
    assert.equal(r.rearm, false);
    assert.equal(r.next.priority, 'P3');
    // ...so raising it back to P2 later re-arms.
    assert.equal(evaluateAck(r.next, snap({ priority: 'P2' })).rearm, true);
  });
  test('forward to a new status stays quiet and is remembered', () => {
    const r = evaluateAck(ack(), snap({ status: 'Monitoring' }));
    assert.equal(r.rearm, false);
    assert.deepEqual(r.next.statusesSeen, ['Investigating', 'In Progress', 'Monitoring']);
    // Monitoring -> In Progress is now a regression.
    assert.equal(evaluateAck(r.next, snap({ status: 'In Progress' })).rearm, true);
  });
  test('back to a status the ticket has been in re-arms', () => {
    const r = evaluateAck(ack({ status: 'Monitoring' }), snap({ status: 'Investigating' }));
    assert.equal(r.rearm, true);
  });
  test('status category dropping re-arms even for an unseen status', () => {
    const r = evaluateAck(ack(), snap({ status: 'Reopened', statusCategory: 'new' }));
    assert.equal(r.rearm, true);
  });
  test('unrankable priorities never re-arm on priority alone', () => {
    const r = evaluateAck(ack({ priority: 'Odd' }), snap({ priority: 'Weird' }));
    assert.equal(r.rearm, false);
  });
});

describe('isExpired', () => {
  test('drops acks older than the max age', () => {
    assert.equal(isExpired({ at: 1000 }, 1000 + ACK_MAX_AGE_MS + 1), true);
    assert.equal(isExpired({ at: 1000 }, 2000), false);
    assert.equal(isExpired(null), true);
  });
});
