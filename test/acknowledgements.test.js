/**
 * Tests for the acknowledge helpers: which alerts can be acknowledged,
 * how they're keyed, and when a stale ack expires.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const {
  ACK_MAX_AGE_MS,
  isAckable,
  ackIdFor,
  buildAck,
  isExpired,
} = require('../src/main/acknowledgements');

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

describe('buildAck', () => {
  test('records when and which ticket', () => {
    assert.deepEqual(buildAck({ ticketKey: 'INC-1' }, 5), { at: 5, ticketKey: 'INC-1' });
  });
});

describe('isExpired', () => {
  test('drops acks older than the max age', () => {
    assert.equal(isExpired({ at: 1000 }, 1000 + ACK_MAX_AGE_MS + 1), true);
    assert.equal(isExpired({ at: 1000 }, 2000), false);
    assert.equal(isExpired(null), true);
  });
});
