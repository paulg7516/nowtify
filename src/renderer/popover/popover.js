/* global document, window */
const api = window.popoverApi;

const el = (id) => document.getElementById(id);
const list = el('alerts');
const banner = el('snoozedBanner');
const pausedBanner = el('pausedBanner');
const title = el('title');

let currentTab = 'active';
let currentState = { alerts: [], status: 'idle', snoozed: false };

for (const tab of document.querySelectorAll('.tab')) {
  tab.onclick = () => {
    currentTab = tab.dataset.tab;
    for (const t of document.querySelectorAll('.tab')) {
      t.classList.toggle('active', t.dataset.tab === currentTab);
    }
    render(currentState);
  };
}

function render(state) {
  currentState = state;
  banner.hidden = !state.snoozed;
  pausedBanner.hidden = state.status !== 'paused';

  const allAlerts = state.alerts || [];
  const active = allAlerts.filter((a) => !a.dismissed);
  const previous = allAlerts.filter((a) => a.dismissed);
  el('activeCount').textContent = active.length;
  el('previousCount').textContent = previous.length;
  title.textContent = 'Triggering tickets';

  const visible = currentTab === 'active' ? active : previous;
  list.innerHTML = '';
  if (!visible.length) {
    let msg = 'No active alerts.';
    if (currentTab === 'previous') msg = 'Nothing dismissed.';
    else if (state.status === 'paused') msg = 'No triggers enabled.';
    list.innerHTML = `<li class="empty">${msg}</li>`;
    return;
  }
  for (const a of visible) {
    const li = document.createElement('li');

    const swatch = document.createElement('div');
    swatch.className = 'swatch';
    swatch.style.background = a.color;

    const meta = document.createElement('div');
    meta.className = 'meta';
    const key = document.createElement('a');
    key.className = 'key';
    key.textContent = a.ticketKey;
    key.onclick = () => api.openTicket(a.jsmUrl);
    const summary = document.createElement('div');
    summary.className = 'summary';
    summary.textContent = a.ticketSummary;
    const sub = document.createElement('div');
    sub.className = 'sub';
    const remaining =
      a.remainingMinutes !== undefined && a.remainingMinutes !== null
        ? ` · ${a.remainingMinutes}m remaining`
        : '';
    sub.textContent = `${a.assigneeName} · ${a.conditionLabel}${remaining}`;
    meta.appendChild(key);
    meta.appendChild(summary);
    meta.appendChild(sub);

    const actions = document.createElement('div');
    actions.className = 'row-actions';
    const btn = document.createElement('button');
    if (a.dismissed) {
      btn.textContent = 'Un-dismiss';
      btn.onclick = async () => {
        await api.undismissAlert(a.ticketKey, a.conditionId);
        await api.pokeEngine();
      };
    } else {
      btn.textContent = 'Dismiss';
      btn.onclick = async () => {
        await api.dismissAlert(a.ticketKey, a.conditionId);
        await api.pokeEngine();
      };
    }
    actions.appendChild(btn);

    li.appendChild(swatch);
    li.appendChild(meta);
    li.appendChild(actions);
    list.appendChild(li);
  }
}

el('refresh').onclick = () => api.pokeEngine();
el('clearDismissals').onclick = async () => {
  await api.clearDismissals();
  await api.pokeEngine();
};

for (const btn of document.querySelectorAll('[data-snooze]')) {
  btn.onclick = async () => {
    await api.snooze(Number(btn.dataset.snooze));
    await api.pokeEngine();
  };
}

api.onState(render);
api.getState().then(render).catch(() => {});
