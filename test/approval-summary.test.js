/**
 * Approvals from the servicedesk API come back untitled when the request
 * type's portal form has no Summary field. backfillSummaries fills them
 * from the issue with one JQL lookup.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const { JsmClient } = require('../src/main/jsm-client');

function clientWith(fakeRequest) {
  const c = new JsmClient({});
  c.request = fakeRequest;
  return c;
}

test('fills only the untitled approvals, in one request', async () => {
  const calls = [];
  const c = clientWith(async (path, opts) => {
    calls.push({ path, opts });
    return { issues: [{ key: 'CASE-1', fields: { summary: 'Laptop request' } }] };
  });
  const issues = [
    { key: 'CASE-1', fields: { summary: '' } },
    { key: 'CASE-2', fields: { summary: 'Already titled' } },
  ];
  await c.backfillSummaries(issues);
  assert.equal(issues[0].fields.summary, 'Laptop request');
  assert.equal(issues[1].fields.summary, 'Already titled');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.body.jql, 'key in ("CASE-1")');
});

test('no request when nothing is missing', async () => {
  let called = false;
  const c = clientWith(async () => {
    called = true;
  });
  await c.backfillSummaries([{ key: 'CASE-2', fields: { summary: 'x' } }]);
  assert.equal(called, false);
});

test('API error leaves rows as they were', async () => {
  const c = clientWith(async () => {
    throw new Error('boom');
  });
  const issues = [{ key: 'CASE-1', fields: { summary: '' } }];
  await c.backfillSummaries(issues);
  assert.equal(issues[0].fields.summary, '');
});
