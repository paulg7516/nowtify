const Store = require('electron-store');

const defaults = {
  jsm: {
    siteUrl: '',
    email: '',
    apiToken: '',
    majorIncidentFieldId: '',
  },
  watchList: [],
  watchGroups: [],
  triggers: [
    {
      id: 'major-incident',
      type: 'major',
      label: 'Major Incident = true',
      enabled: true,
      color: '#ff0033',
      pulse: true,
    },
    {
      id: 'sla-breach-imminent',
      type: 'sla',
      label: 'SLA breach < 30 min',
      enabled: true,
      color: '#ff8800',
      pulse: true,
      thresholdMinutes: 30,
    },
    {
      id: 'sla-breached',
      type: 'sla',
      label: 'SLA already breached',
      enabled: true,
      color: '#ff0033',
      pulse: true,
      thresholdMinutes: 0,
    },
  ],
  pollIntervalSeconds: 30,
  snoozeUntil: 0,
  dismissedTickets: {},
};

const store = new Store({
  name: 'sla-overlay-config',
  defaults,
});

function get(key) {
  return store.get(key);
}

function set(key, value) {
  store.set(key, value);
}

function getAll() {
  return store.store;
}

function addWatchee(user) {
  const list = store.get('watchList') || [];
  if (list.some((u) => u.accountId === user.accountId)) return list;
  const next = [...list, user];
  store.set('watchList', next);
  return next;
}

function removeWatchee(accountId) {
  const list = store.get('watchList') || [];
  const next = list.filter((u) => u.accountId !== accountId);
  store.set('watchList', next);
  return next;
}

function addGroup(group) {
  const list = store.get('watchGroups') || [];
  if (list.some((g) => g.name === group.name)) return list;
  const next = [...list, group];
  store.set('watchGroups', next);
  return next;
}

function removeGroup(groupName) {
  const list = store.get('watchGroups') || [];
  const next = list.filter((g) => g.name !== groupName);
  store.set('watchGroups', next);
  return next;
}

function setSnooze(minutes) {
  const until = minutes > 0 ? Date.now() + minutes * 60_000 : 0;
  store.set('snoozeUntil', until);
  return until;
}

function isSnoozed() {
  const until = store.get('snoozeUntil') || 0;
  return until > Date.now();
}

function dismissTicket(ticketKey, conditionId) {
  const dismissed = store.get('dismissedTickets') || {};
  dismissed[`${ticketKey}:${conditionId}`] = Date.now();
  store.set('dismissedTickets', dismissed);
}

function undismissTicket(ticketKey, conditionId) {
  const dismissed = store.get('dismissedTickets') || {};
  delete dismissed[`${ticketKey}:${conditionId}`];
  store.set('dismissedTickets', dismissed);
}

function isDismissed(ticketKey, conditionId) {
  const dismissed = store.get('dismissedTickets') || {};
  return Boolean(dismissed[`${ticketKey}:${conditionId}`]);
}

function clearDismissals() {
  store.set('dismissedTickets', {});
}

function setTriggerEnabled(triggerId, enabled) {
  const list = store.get('triggers') || [];
  const next = list.map((t) => (t.id === triggerId ? { ...t, enabled: Boolean(enabled) } : t));
  store.set('triggers', next);
  return next;
}

function updateTrigger(triggerId, patch) {
  const list = store.get('triggers') || [];
  const next = list.map((t) => (t.id === triggerId ? { ...t, ...patch } : t));
  store.set('triggers', next);
  return next;
}

function addTrigger(trigger) {
  const list = store.get('triggers') || [];
  const id = trigger.id || `trigger-${Date.now()}`;
  const next = [...list, { ...trigger, id }];
  store.set('triggers', next);
  return next;
}

function removeTrigger(triggerId) {
  const list = store.get('triggers') || [];
  const next = list.filter((t) => t.id !== triggerId);
  store.set('triggers', next);
  return next;
}

module.exports = {
  get,
  set,
  getAll,
  addWatchee,
  removeWatchee,
  addGroup,
  removeGroup,
  setSnooze,
  isSnoozed,
  dismissTicket,
  undismissTicket,
  isDismissed,
  clearDismissals,
  setTriggerEnabled,
  updateTrigger,
  addTrigger,
  removeTrigger,
};
