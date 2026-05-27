/**
 * Tests for the trigger-scope migration logic.
 *
 * Migrations are the riskiest piece of code in the app: they run once,
 * silently, on user data. If they're wrong, users lose state. This test
 * suite mirrors the pure portion of `migrateTriggerScopes` from store.js
 * so we can exercise it in plain node without electron.
 *
 * When src/main/store.js's migration logic changes, update both this test
 * AND the real code. The duplication is the cost of keeping the migration
 * unit-testable; the alternative (testing electron-store directly) needs
 * a full Electron env and is not worth it.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');

// Pure migration: same shape as src/main/store.js#migrateTriggerScopes.
function computeMigratedTriggers({ triggers, watchList, watchGroups, teamsWatched }) {
  return triggers.map((t) => {
    if (t.scope) return t; // already migrated
    if (t.type === 'sla') {
      return {
        ...t,
        scope: {
          users: (watchList || []).map((u) => ({
            accountId: u.accountId,
            displayName: u.displayName,
            emailAddress: u.emailAddress || '',
          })),
          groups: (watchGroups || []).map((g) => ({ name: g.name })),
        },
      };
    }
    if (t.type === 'teams') {
      return {
        ...t,
        scope: {
          users: (teamsWatched || []).map((u) => ({
            id: u.id,
            displayName: u.displayName,
            mail: u.mail || '',
          })),
        },
      };
    }
    return t;
  });
}

describe('migrateTriggerScopes', () => {
  test('copies watchList into all SLA triggers', () => {
    const input = {
      triggers: [
        { id: 'sla-1', type: 'sla', enabled: true },
        { id: 'sla-2', type: 'sla', enabled: false },
      ],
      watchList: [
        { accountId: 'a1', displayName: 'Alice', emailAddress: 'alice@x.com' },
        { accountId: 'a2', displayName: 'Bob' },
      ],
      watchGroups: [],
      teamsWatched: [],
    };
    const out = computeMigratedTriggers(input);
    assert.equal(out.length, 2);
    assert.equal(out[0].scope.users.length, 2);
    assert.equal(out[0].scope.users[0].accountId, 'a1');
    assert.equal(out[0].scope.users[1].emailAddress, ''); // defaults to empty
    assert.equal(out[1].scope.users.length, 2); // both SLA triggers get the same scope
  });

  test('copies watchGroups into SLA triggers', () => {
    const input = {
      triggers: [{ id: 'sla-1', type: 'sla', enabled: true }],
      watchList: [],
      watchGroups: [{ name: 'jira-admins' }, { name: 'on-call' }],
      teamsWatched: [],
    };
    const out = computeMigratedTriggers(input);
    assert.equal(out[0].scope.groups.length, 2);
    assert.equal(out[0].scope.groups[0].name, 'jira-admins');
  });

  test('copies teamsWatched into Teams triggers only', () => {
    const input = {
      triggers: [
        { id: 'sla-1', type: 'sla', enabled: true },
        { id: 'teams-1', type: 'teams', enabled: true },
      ],
      watchList: [],
      watchGroups: [],
      teamsWatched: [{ id: 'u1', displayName: 'Kiran', mail: 'kiran@x.com' }],
    };
    const out = computeMigratedTriggers(input);
    // SLA trigger gets empty scope (no watchList provided)
    assert.equal(out[0].scope.users.length, 0);
    assert.equal(out[0].scope.groups.length, 0);
    // Teams trigger gets the watched user
    assert.equal(out[1].scope.users.length, 1);
    assert.equal(out[1].scope.users[0].id, 'u1');
    assert.equal(out[1].scope.users[0].displayName, 'Kiran');
  });

  test('idempotent: triggers with existing scope are left alone', () => {
    const input = {
      triggers: [
        {
          id: 'sla-1',
          type: 'sla',
          scope: { users: [{ accountId: 'existing' }], groups: [] },
        },
      ],
      watchList: [{ accountId: 'a1', displayName: 'Alice' }],
      watchGroups: [],
      teamsWatched: [],
    };
    const out = computeMigratedTriggers(input);
    // The pre-existing scope is preserved - watchList is NOT re-injected
    assert.equal(out[0].scope.users.length, 1);
    assert.equal(out[0].scope.users[0].accountId, 'existing');
  });

  test('Major Incident triggers are passed through untouched', () => {
    const input = {
      triggers: [{ id: 'major-incident', type: 'major', enabled: true }],
      watchList: [{ accountId: 'a1' }],
      watchGroups: [],
      teamsWatched: [],
    };
    const out = computeMigratedTriggers(input);
    assert.equal(out[0].scope, undefined); // MI triggers don't get a scope
    assert.equal(out[0].type, 'major');
  });

  test('Approval triggers are passed through untouched', () => {
    const input = {
      triggers: [{ id: 'pending-approvals', type: 'approval', enabled: false }],
      watchList: [{ accountId: 'a1' }],
      watchGroups: [],
      teamsWatched: [],
    };
    const out = computeMigratedTriggers(input);
    assert.equal(out[0].scope, undefined);
    assert.equal(out[0].enabled, false); // existing fields preserved
  });

  test('empty input produces empty migrated triggers', () => {
    const out = computeMigratedTriggers({
      triggers: [],
      watchList: [],
      watchGroups: [],
      teamsWatched: [],
    });
    assert.deepEqual(out, []);
  });
});
