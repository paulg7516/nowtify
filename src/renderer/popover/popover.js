/* global document, window, setInterval */
const api = window.popoverApi;

const el = (id) => document.getElementById(id);
const list = el('alerts');
const stateBar = el('stateBar');
const stateText = el('stateText');
const title = el('title');
const syncTimeEl = el('syncTime');

let currentState = { alerts: [], status: 'idle', snoozed: false };
let lastSyncAt = null;
let snoozeUntilMs = 0;

/* ----------- Footer actions ----------- */
el('refresh').onclick = () => api.pokeEngine();
el('openSettings').onclick = () => api.openSettings();

/* ----------- Pause / Resume toggle ----------- */
// When NOT paused, the button is "Pause ▾" and opens a dropdown of durations.
// When paused, the button becomes "Resume" with no chevron - a single click
// immediately resumes (no menu).
const pauseBtn = el('pauseBtn');
const pauseMenu = el('pauseMenu');
const pauseBtnLabel = el('pauseBtnLabel');
const pauseBtnChevron = el('pauseBtnChevron');
pauseBtn.onclick = async (e) => {
  e.stopPropagation();
  if (currentState.snoozed) {
    // Resume mode - single click resumes immediately
    pauseMenu.hidden = true;
    await api.snooze(0);
    await api.pokeEngine();
  } else {
    // Pause mode - open dropdown to pick duration
    pauseMenu.hidden = !pauseMenu.hidden;
  }
};
document.addEventListener('click', () => {
  pauseMenu.hidden = true;
});
pauseMenu.onclick = (e) => e.stopPropagation();
for (const btn of pauseMenu.querySelectorAll('button[data-pause]')) {
  btn.onclick = async () => {
    const raw = btn.dataset.pause;
    pauseMenu.hidden = true;
    await api.snooze(raw === 'indefinite' ? 'indefinite' : Number(raw));
    await api.pokeEngine();
  };
}

/* ----------- Render ----------- */
function render(state) {
  currentState = state;
  lastSyncAt = Date.now();
  snoozeUntilMs = state.snoozeUntilMs || 0;

  const alerts = state.alerts || [];

  // Paused banner: snoozed = "border alerts paused" in user-facing language.
  // Note: even while paused, alerts still appear in the list below - we just
  // stop the screen-border flash and tray-icon pulse. The popover content
  // is unaffected.
  // State bar: always visible. Class flips between default (running) and
  // 'snoozed' (paused, amber).
  if (state.snoozed) {
    stateBar.classList.add('snoozed');
    // Indefinite pauses are stored as a far-future timestamp (>1yr out).
    const isIndefinite = snoozeUntilMs > Date.now() + 365 * 24 * 60 * 60 * 1000;
    if (isIndefinite) {
      stateText.textContent = 'Pulse alerts paused - until you resume';
    } else if (snoozeUntilMs) {
      const minutesLeft = Math.max(0, Math.ceil((snoozeUntilMs - Date.now()) / 60_000));
      stateText.textContent = `Pulse alerts paused - ${minutesLeft}m left`;
    } else {
      stateText.textContent = 'Pulse alerts paused';
    }
  } else {
    stateBar.classList.remove('snoozed');
    stateText.textContent = 'Pulse alerts active';
  }
  pauseBtnLabel.textContent = state.snoozed ? 'Resume' : 'Pause';
  pauseBtnChevron.style.display = state.snoozed ? 'none' : '';

  // Title
  if (alerts.length > 0) {
    title.textContent = `${alerts.length} ${alerts.length === 1 ? 'alert' : 'alerts'}`;
  } else {
    title.textContent = 'Nowtify';
  }

  // List body
  list.innerHTML = '';
  if (alerts.length === 0) {
    renderEmpty(state);
    return;
  }
  for (const a of alerts) {
    list.appendChild(renderAlertRow(a));
  }
}

function renderEmpty(state) {
  let titleText = 'All quiet';
  let message = 'No tickets matching your triggers right now.';
  if (state.status === 'paused') {
    titleText = 'All triggers off';
    message = 'Turn one on in Settings to start watching.';
  } else if (state.snoozed) {
    titleText = 'Pulse alerts paused';
    message = 'Polling continues in the background. Click Resume above to bring the pulse back.';
  }
  list.innerHTML = `
    <div class="empty">
      <svg class="empty-mark" viewBox="0 0 120 120" aria-hidden="true">
        <rect x="32" y="34" width="56" height="11" rx="3" fill="#a5b4fc" opacity="0.35"/>
        <rect x="26" y="52" width="68" height="14" rx="3.5" fill="#a5b4fc" opacity="0.65"/>
        <rect x="20" y="72" width="80" height="20" rx="5" fill="#a5b4fc"/>
      </svg>
      <div class="empty-title"></div>
      <div class="empty-message"></div>
    </div>`;
  list.querySelector('.empty-title').textContent = titleText;
  list.querySelector('.empty-message').textContent = message;
}

function renderAlertRow(a) {
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
  meta.append(key, summary, sub);

  li.append(swatch, meta);
  return li;
}

/* ----------- Sync time ticker ----------- */
function formatAgo(ms) {
  if (ms < 5_000) return 'Synced just now';
  if (ms < 60_000) return `Synced ${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `Synced ${Math.floor(ms / 60_000)}m ago`;
  return `Synced ${Math.floor(ms / 3_600_000)}h ago`;
}
function updateSyncTime() {
  if (!lastSyncAt) {
    syncTimeEl.textContent = 'Not synced yet';
    return;
  }
  syncTimeEl.textContent = formatAgo(Date.now() - lastSyncAt);
}
setInterval(updateSyncTime, 1000);
updateSyncTime();

api.onState(render);
api.getState().then(render).catch(() => {});
