/* global document, window, setInterval */
const api = window.popoverApi;

const el = (id) => document.getElementById(id);
const list = el('alerts');
const stateBar = el('stateBar');
const stateText = el('stateText');
const title = el('titleText');
const versionEl = el('appVersion');
const syncTimeEl = el('syncTime');

// Stamp the app version into the header so users + support can immediately
// see which build is running. Fire-and-forget; falls back to blank if the
// IPC fails (very old preload, dev runtime, etc).
if (api && api.getVersion) {
  api.getVersion()
    .then((v) => {
      if (v) versionEl.textContent = `v${v}`;
    })
    .catch(() => {});
}
const tabsEl = el('tabs');
const tabCountIncidents = el('tabCountIncidents');
const tabCountApprovals = el('tabCountApprovals');
const tabCountMessages = el('tabCountMessages');

let currentState = { alerts: [], status: 'idle', snoozed: false };
let lastSyncAt = null;
let snoozeUntilMs = 0;
let activeTab = 'incidents'; // 'incidents' | 'approvals' | 'messages'

// Route each alert to a tab based on trigType:
//   - major/sla -> incidents (shared "something is on fire" urgency)
//   - approval  -> approvals (grooming queue)
//   - teams     -> messages (relational urgency from a specific person)
function tabFor(alert) {
  if (!alert) return 'incidents';
  if (alert.trigType === 'approval') return 'approvals';
  if (alert.trigType === 'teams') return 'messages';
  return 'incidents';
}

for (const btn of tabsEl.querySelectorAll('button[data-tab]')) {
  btn.onclick = () => {
    activeTab = btn.dataset.tab;
    for (const b of tabsEl.querySelectorAll('button[data-tab]')) {
      b.classList.toggle('active', b.dataset.tab === activeTab);
    }
    renderList(currentState);
  };
}

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

  // Update tab counts (always visible) and auto-select the tab with
  // content on first non-empty render so the user doesn't land on an empty
  // tab while another has alerts.
  const counts = {
    incidents: alerts.filter((a) => tabFor(a) === 'incidents').length,
    approvals: alerts.filter((a) => tabFor(a) === 'approvals').length,
    messages: alerts.filter((a) => tabFor(a) === 'messages').length,
  };
  tabCountIncidents.textContent = String(counts.incidents);
  tabCountApprovals.textContent = String(counts.approvals);
  tabCountMessages.textContent = String(counts.messages);

  // Auto-switch: if active tab is empty but another has alerts, jump to
  // the first non-empty tab in priority order (incidents > messages >
  // approvals - urgent first, then relationship-time, then grooming).
  if (counts[activeTab] === 0) {
    const priority = ['incidents', 'messages', 'approvals'];
    const nextTab = priority.find((t) => counts[t] > 0);
    if (nextTab) {
      activeTab = nextTab;
      for (const b of tabsEl.querySelectorAll('button[data-tab]')) {
        b.classList.toggle('active', b.dataset.tab === activeTab);
      }
    }
  }

  renderList(state);
}

function renderList(state) {
  const alerts = state.alerts || [];
  const visible = alerts.filter((a) => tabFor(a) === activeTab);

  list.innerHTML = '';
  if (visible.length === 0) {
    renderEmpty(state);
    return;
  }
  for (const a of visible) {
    list.appendChild(renderAlertRow(a));
  }
}

function renderEmpty(state) {
  // Empty state describes what's in the active tab. The snoozed/paused
  // status is already shown in the banner at the top, so we don't repeat
  // it here.
  let titleText;
  let message;
  if (state.status === 'paused') {
    // No triggers enabled at all - nothing is being polled. Different from
    // snoozed (which still polls, just doesn't pulse the border).
    titleText = 'All triggers off';
    message = 'Turn one on in Settings to start watching.';
  } else if (activeTab === 'approvals') {
    titleText = 'No approvals';
    message = 'No pending approvals assigned to you have been identified.';
  } else if (activeTab === 'messages') {
    titleText = 'No new messages';
    message = 'No unread Teams messages from your watched users.';
  } else {
    titleText = 'No incidents';
    message = 'No tickets are currently triggering an incident alert.';
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

  // Teams meeting / chat button (only for MI alerts with a connection).
  // Layout: [Teams logo] [video|chat icon] Join/Chat
  // - Teams logo always present (brand mark, makes the integration obvious)
  // - second icon flips on conversationType to show video vs chat at a glance
  if (a.meetingUrl) {
    const t = (a.meetingType || '').toLowerCase();
    const isChat = t.includes('chat') || t.includes('channel');
    const meetingBtn = document.createElement('button');
    meetingBtn.className = 'meeting-btn';
    meetingBtn.type = 'button';
    meetingBtn.title = isChat
      ? 'Open the Microsoft Teams chat for this incident'
      : 'Join the Microsoft Teams meeting for this incident';

    // Official Microsoft Teams brand SVG (sourced from Iconify's `logos:microsoft-teams`).
    // Simple Icons removed Microsoft brand marks over licensing, so we inline it here
    // instead of CDN-loading - works offline + no external request per popover.
    const teamsLogoSvg = `<svg class="teams-logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 239" aria-hidden="true"><defs><linearGradient id="nowtify-teams-grad" x1="17.372%" x2="82.628%" y1="-6.51%" y2="106.51%"><stop offset="0%" stop-color="#5a62c3"/><stop offset="50%" stop-color="#4d55bd"/><stop offset="100%" stop-color="#3940ab"/></linearGradient><path id="nowtify-teams-clip" d="M136.93 64.476v12.8a32.7 32.7 0 0 1-5.953-.952a38.7 38.7 0 0 1-26.79-22.742h21.848c6.008.022 10.872 4.887 10.895 10.894"/></defs><path fill="#5059c9" d="M178.563 89.302h66.125c6.248 0 11.312 5.065 11.312 11.312v60.231c0 22.96-18.613 41.574-41.573 41.574h-.197c-22.96.003-41.576-18.607-41.579-41.568V95.215a5.91 5.91 0 0 1 5.912-5.913"/><circle cx="223.256" cy="50.605" r="26.791" fill="#5059c9"/><circle cx="139.907" cy="38.698" r="38.698" fill="#7b83eb"/><path fill="#7b83eb" d="M191.506 89.302H82.355c-6.173.153-11.056 5.276-10.913 11.449v68.697c-.862 37.044 28.445 67.785 65.488 68.692c37.043-.907 66.35-31.648 65.489-68.692v-68.697c.143-6.173-4.74-11.296-10.913-11.449"/><path d="M142.884 89.302v96.268a10.96 10.96 0 0 1-6.787 10.062c-1.3.55-2.697.833-4.108.833H76.68c-.774-1.965-1.488-3.93-2.084-5.953a72.5 72.5 0 0 1-3.155-21.076v-68.703c-.143-6.163 4.732-11.278 10.895-11.43z" opacity=".1"/><path d="M136.93 89.302v102.222c0 1.411-.283 2.808-.833 4.108a10.96 10.96 0 0 1-10.062 6.787H79.48c-1.012-1.965-1.965-3.93-2.798-5.954a59 59 0 0 1-2.084-5.953a72.5 72.5 0 0 1-3.155-21.076v-68.703c-.143-6.163 4.732-11.278 10.895-11.43z" opacity=".2"/><path d="M136.93 89.302v90.315c-.045 5.998-4.896 10.85-10.895 10.895H74.597a72.5 72.5 0 0 1-3.155-21.076v-68.703c-.143-6.163 4.732-11.278 10.895-11.43z" opacity=".2"/><path d="M130.977 89.302v90.315c-.046 5.998-4.897 10.85-10.895 10.895H74.597a72.5 72.5 0 0 1-3.155-21.076v-68.703c-.143-6.163 4.732-11.278 10.895-11.43z" opacity=".2"/><path d="M142.884 58.523v18.753c-1.012.06-1.965.12-2.977.12s-1.965-.06-2.977-.12a32.7 32.7 0 0 1-5.953-.952a38.7 38.7 0 0 1-26.791-22.742a33 33 0 0 1-1.905-5.954h29.708c6.007.023 10.872 4.887 10.895 10.895" opacity=".1"/><use href="#nowtify-teams-clip" opacity=".2"/><use href="#nowtify-teams-clip" opacity=".2"/><path d="M130.977 64.476v11.848a38.7 38.7 0 0 1-26.791-22.743h15.896c6.008.023 10.872 4.888 10.895 10.895" opacity=".2"/><path fill="url(#nowtify-teams-grad)" d="M10.913 53.581h109.15c6.028 0 10.914 4.886 10.914 10.913v109.151c0 6.027-4.886 10.913-10.913 10.913H10.913C4.886 184.558 0 179.672 0 173.645V64.495C0 58.466 4.886 53.58 10.913 53.58"/><path fill="#fff" d="M94.208 95.125h-21.82v59.416H58.487V95.125H36.769V83.599h57.439z"/></svg>`;
    const videoIconSvg = `
      <svg class="action-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="2" y="5" width="9" height="6" rx="1.3"/>
        <path d="M 11 7 L 14 5.4 L 14 10.6 L 11 9 Z"/>
      </svg>`;
    const chatIconSvg = `
      <svg class="action-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M 2.5 4.5 a 2 2 0 0 1 2 -2 h 7 a 2 2 0 0 1 2 2 v 5 a 2 2 0 0 1 -2 2 H 7 l -3 2.2 V 11.5 a 2 2 0 0 1 -1.5 -2 z"/>
      </svg>`;

    meetingBtn.innerHTML = `${teamsLogoSvg}${isChat ? chatIconSvg : videoIconSvg}<span>${isChat ? 'Chat' : 'Join'}</span>`;
    meetingBtn.onclick = (e) => {
      e.stopPropagation();
      api.openTicket(a.meetingUrl);
    };
    li.appendChild(meetingBtn);
  }

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
