/* global document, window */
const api = window.settingsApi;

const el = (id) => document.getElementById(id);
let workingConfig = null;

/* ---------------- External links ---------------- */
const apiTokenLink = el('apiTokenLink');
if (apiTokenLink) {
  apiTokenLink.onclick = (e) => {
    e.preventDefault();
    api.openExternal(apiTokenLink.href || apiTokenLink.textContent.trim());
  };
}

/* ---------------- Custom modal (replaces native confirm for branding) ---------------- */
function customConfirm({ title, message, confirmLabel = 'Confirm', confirmDanger = false }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const card = document.createElement('div');
    card.className = 'modal-card';
    card.innerHTML = `
      <div class="modal-header">
        <div class="modal-brand" aria-hidden="true">
          <svg viewBox="0 0 120 120">
            <rect x="32" y="34" width="56" height="11" rx="3" fill="#4f46e5" opacity="0.32"/>
            <rect x="26" y="52" width="68" height="14" rx="3.5" fill="#4f46e5" opacity="0.62"/>
            <rect x="20" y="72" width="80" height="20" rx="5" fill="#4f46e5"/>
          </svg>
        </div>
        <h3 class="modal-title"></h3>
      </div>
      <p class="modal-message"></p>
      <div class="modal-actions">
        <button class="btn btn-ghost modal-cancel" type="button">Cancel</button>
        <button class="btn modal-confirm" type="button"></button>
      </div>
    `;
    card.querySelector('.modal-title').textContent = title;
    card.querySelector('.modal-message').textContent = message;
    const confirmBtn = card.querySelector('.modal-confirm');
    confirmBtn.textContent = confirmLabel;
    if (confirmDanger) confirmBtn.classList.add('btn-danger');
    else confirmBtn.classList.add('btn-primary');
    overlay.appendChild(card);

    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', keyHandler);
      overlay.remove();
      resolve(value);
    };
    const keyHandler = (e) => {
      if (e.key === 'Escape') settle(false);
      if (e.key === 'Enter') settle(true);
    };
    overlay.onclick = (e) => {
      if (e.target === overlay) settle(false);
    };
    card.querySelector('.modal-cancel').onclick = () => settle(false);
    confirmBtn.onclick = () => settle(true);
    document.addEventListener('keydown', keyHandler);
    document.body.appendChild(overlay);
    setTimeout(() => confirmBtn.focus(), 50);
  });
}

/* ---------------- Sidebar nav ---------------- */
for (const btn of document.querySelectorAll('.nav-item')) {
  btn.onclick = () => {
    const target = btn.dataset.section;
    for (const b of document.querySelectorAll('.nav-item')) {
      b.classList.toggle('active', b === btn);
    }
    for (const sec of document.querySelectorAll('.panel')) {
      sec.hidden = sec.id !== `section-${target}`;
    }
  };
}

/* ---------------- Connection pill ---------------- */
function setConnectionState(state, label) {
  const pill = el('connectionPill');
  pill.dataset.state = state;
  el('connectionLabel').textContent = label;
}

/* ---------------- Load + save ---------------- */

// Sentinel value displayed in the API token field when a token is stored.
// The real token never leaves the main process; this just gives the field
// a visually "filled" appearance so users see at a glance that the token
// is persisted. On save, a value matching this sentinel (or any pure-bullet
// string) is treated as "keep existing" rather than overwriting.
const SAVED_TOKEN_BULLETS = '••••••••••••';
const isJustBullets = (s) => /^•+$/.test(s || '');

async function load() {
  workingConfig = await api.getConfig();
  el('siteUrl').value = workingConfig.jsm.siteUrl || '';
  el('email').value = workingConfig.jsm.email || '';
  // Prefill bullets when a token is saved so the field looks populated.
  // The real token value never round-trips through the renderer.
  if (workingConfig.jsm.hasApiToken) {
    el('apiToken').value = SAVED_TOKEN_BULLETS;
    el('apiToken').placeholder = 'Atlassian API token';
  } else {
    el('apiToken').value = '';
    el('apiToken').placeholder = 'Atlassian API token';
  }
  el('pollIntervalSeconds').value = workingConfig.pollIntervalSeconds || 30;
  renderWatchList();
  renderWatchGroups();
  renderTriggers();

  if (workingConfig.jsm.siteUrl && workingConfig.jsm.email && workingConfig.jsm.hasApiToken) {
    // Restore "Connected as <name>" if we have the cached display name from
    // a prior session's Connect; otherwise fall back to a neutral state.
    const cachedName = workingConfig.jsm.userDisplayName;
    if (cachedName) {
      setConnectionState('ok', `Connected as ${cachedName}`);
    } else {
      setConnectionState('unknown', 'Configured');
    }
  } else {
    setConnectionState('unknown', 'Not connected');
  }
  renderConnectionButton();
  applyConnectionLockState();
}

// Lock the connection inputs when a token is stored so the user has to
// explicitly Disconnect before changing site/email/token. This makes the
// "connected" state feel solid and prevents accidental clobbering of a
// working config.
function applyConnectionLockState() {
  const locked = Boolean(workingConfig && workingConfig.jsm && workingConfig.jsm.hasApiToken);
  for (const id of ['siteUrl', 'email', 'apiToken']) {
    const input = el(id);
    if (!input) continue;
    input.disabled = locked;
    input.classList.toggle('locked', locked);
  }
}

async function persistCredsOnly() {
  // If the field still shows the saved-bullets sentinel, send empty string
  // so the main process keeps the existing encrypted token rather than
  // overwriting it with bullets.
  const raw = el('apiToken').value;
  const apiTokenForSave = isJustBullets(raw) ? '' : raw.trim();
  workingConfig.jsm = {
    ...workingConfig.jsm,
    siteUrl: el('siteUrl').value.trim(),
    email: el('email').value.trim(),
    apiToken: apiTokenForSave,
  };
  await api.saveConfig({ jsm: workingConfig.jsm });
}

/* ---------------- Watch list ---------------- */
function renderWatchList() {
  const list = el('watchList');
  list.innerHTML = '';
  const users = workingConfig.watchList || [];
  if (users.length === 0) {
    list.innerHTML = '<li class="muted">No users yet - search above to add.</li>';
    return;
  }
  for (const u of users) {
    const li = document.createElement('li');
    const meta = document.createElement('div');
    meta.className = 'user-meta';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = u.displayName || '(unknown)';
    const email = document.createElement('span');
    email.className = 'email';
    email.textContent = u.emailAddress || u.accountId;
    meta.append(name, email);
    const btn = document.createElement('button');
    btn.className = 'btn btn-ghost btn-sm';
    btn.textContent = 'Remove';
    btn.onclick = async () => {
      const next = await api.removeWatchee(u.accountId);
      workingConfig.watchList = next;
      renderWatchList();
    };
    li.append(meta, btn);
    list.appendChild(li);
  }
}

function renderWatchGroups() {
  const list = el('watchGroups');
  list.innerHTML = '';
  const groups = workingConfig.watchGroups || [];
  if (groups.length === 0) {
    list.innerHTML = '<li class="muted">No groups yet - search above to add.</li>';
    return;
  }
  for (const g of groups) {
    const li = document.createElement('li');
    const meta = document.createElement('div');
    meta.className = 'user-meta';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = g.name;
    const sub = document.createElement('span');
    sub.className = 'email';
    sub.textContent = 'group';
    meta.append(name, sub);
    const btn = document.createElement('button');
    btn.className = 'btn btn-ghost btn-sm';
    btn.textContent = 'Remove';
    btn.onclick = async () => {
      const next = await api.removeGroup(g.name);
      workingConfig.watchGroups = next;
      renderWatchGroups();
    };
    li.append(meta, btn);
    list.appendChild(li);
  }
}

/* ---------------- Triggers ---------------- */
const SLA_PRESETS = [
  { label: 'SLA already breached', thresholdMinutes: 0 },
  { label: 'SLA breach in 5 min', thresholdMinutes: 5 },
  { label: 'SLA breach in 15 min', thresholdMinutes: 15 },
  { label: 'SLA breach in 30 min', thresholdMinutes: 30 },
  { label: 'SLA breach in 1 hour', thresholdMinutes: 60 },
  { label: 'SLA breach in 2 hours', thresholdMinutes: 120 },
  { label: 'SLA breach in 4 hours', thresholdMinutes: 240 },
  { label: 'SLA breach in 8 hours', thresholdMinutes: 480 },
  { label: 'SLA breach in 24 hours', thresholdMinutes: 1440 },
];

const APPROVAL_PRESETS = [
  { label: 'Any pending approval', ageThresholdHours: 0 },
  { label: 'Pending 2+ hours', ageThresholdHours: 2 },
  { label: 'Pending 4+ hours', ageThresholdHours: 4 },
  { label: 'Pending 24+ hours', ageThresholdHours: 24 },
];

function renderTriggers() {
  const triggers = workingConfig.triggers || [];
  const groups = {
    major: { list: el('triggers-major'), emptyMessage: 'No Major Incident trigger configured.' },
    sla: { list: el('triggers-sla'), emptyMessage: 'No SLA triggers yet - click Add SLA trigger above.' },
    approval: { list: el('triggers-approval'), emptyMessage: 'No approval triggers yet - click Add approval trigger above.' },
  };
  for (const g of Object.values(groups)) g.list.innerHTML = '';

  for (const trig of triggers) {
    const group = groups[trig.type];
    if (!group) continue;
    group.list.appendChild(renderTriggerCard(trig));
  }

  // Per-group empty states so a section without triggers still reads clearly.
  for (const g of Object.values(groups)) {
    if (g.list.children.length === 0) {
      const emptyLi = document.createElement('li');
      emptyLi.className = 'muted trigger-group-empty';
      emptyLi.textContent = g.emptyMessage;
      g.list.appendChild(emptyLi);
    }
  }
}

function renderTriggerCard(trig) {
  const card = document.createElement('li');
  card.className = 'trigger-card';
  if (!trig.enabled) card.classList.add('disabled');

  // Column 1: iOS-style enable/disable switch
  const switchEl = document.createElement('label');
  switchEl.className = 'switch';
  switchEl.title = trig.enabled ? 'Disable this trigger' : 'Enable this trigger';
  const switchInput = document.createElement('input');
  switchInput.type = 'checkbox';
  switchInput.checked = Boolean(trig.enabled);
  switchInput.onchange = async () => {
    trig.enabled = switchInput.checked;
    card.classList.toggle('disabled', !trig.enabled);
    switchEl.title = trig.enabled ? 'Disable this trigger' : 'Enable this trigger';
    const next = await api.setTriggerEnabled(trig.id, trig.enabled);
    workingConfig.triggers = next;
    await api.pokeEngine();
  };
  const slider = document.createElement('span');
  slider.className = 'slider';
  switchEl.append(switchInput, slider);

  // Column 2: title + metadata pills
  const body = document.createElement('div');
  body.className = 'trigger-body';

  const titleEl = buildTriggerTitle(trig);
  body.appendChild(titleEl);

  const pills = document.createElement('div');
  pills.className = 'trigger-pills';

  // No type badge: the section header already conveys the trigger type.

  // Color chip (whole pill is the picker affordance)
  pills.appendChild(buildColorChip(trig));

  // Pulse toggle pill
  pills.appendChild(buildPulsePill(trig));

  body.appendChild(pills);

  // Column 3: delete (only for deletable triggers). The default Major
  // Incident and Pending Approvals triggers are locked - users can disable
  // but not delete them, since they're the headline use cases.
  const isLocked =
    (trig.type === 'major' && trig.id === 'major-incident') ||
    (trig.type === 'approval' && trig.id === 'pending-approvals');
  let trailing;
  if (isLocked) {
    trailing = document.createElement('span');
    trailing.style.width = '32px';
  } else {
    trailing = document.createElement('button');
    trailing.className = 'trigger-delete';
    trailing.title = 'Delete this trigger';
    trailing.setAttribute('aria-label', 'Delete trigger');
    trailing.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
      <line x1="4" y1="4" x2="12" y2="12"/>
      <line x1="12" y1="4" x2="4" y2="12"/>
    </svg>`;
    trailing.onclick = async () => {
      const ok = await customConfirm({
        title: 'Delete trigger',
        message: `"${trig.label}" will be removed. Tickets it was matching will no longer fire alerts.`,
        confirmLabel: 'Delete',
        confirmDanger: true,
      });
      if (!ok) return;
      const next = await api.removeTrigger(trig.id);
      workingConfig.triggers = next;
      renderTriggers();
      await api.pokeEngine();
    };
  }

  card.append(switchEl, body, trailing);
  return card;
}

function buildTriggerTitle(trig) {
  if (trig.type === 'major') {
    const span = document.createElement('div');
    span.className = 'trigger-title';
    span.textContent = trig.label || 'Major Incident = true';
    return span;
  }
  if (trig.type === 'approval') {
    return buildPresetSelect({
      trig,
      presets: APPROVAL_PRESETS,
      valueKey: 'ageThresholdHours',
      ariaLabel: 'Approval age threshold',
    });
  }
  return buildPresetSelect({
    trig,
    presets: SLA_PRESETS,
    valueKey: 'thresholdMinutes',
    ariaLabel: 'SLA condition',
  });
}

function buildPresetSelect({ trig, presets, valueKey, ariaLabel }) {
  const select = document.createElement('select');
  select.className = 'trigger-title-select';
  select.setAttribute('aria-label', ariaLabel);
  const matched = presets.find((p) => p[valueKey] === trig[valueKey]);
  if (!matched) {
    const opt = document.createElement('option');
    opt.value = '__custom__';
    opt.textContent = `${trig.label} (custom)`;
    opt.selected = true;
    select.appendChild(opt);
  }
  for (const preset of presets) {
    const opt = document.createElement('option');
    opt.value = String(preset[valueKey]);
    opt.textContent = preset.label;
    if (matched && preset[valueKey] === matched[valueKey]) opt.selected = true;
    select.appendChild(opt);
  }
  select.onchange = async () => {
    if (select.value === '__custom__') return;
    const preset = presets.find((p) => String(p[valueKey]) === select.value);
    if (!preset) return;
    trig.label = preset.label;
    trig[valueKey] = preset[valueKey];
    const next = await api.updateTrigger(trig.id, {
      label: preset.label,
      [valueKey]: preset[valueKey],
    });
    workingConfig.triggers = next;
    await api.pokeEngine();
  };
  return select;
}

function buildColorChip(trig) {
  const chip = document.createElement('label');
  chip.className = 'color-chip';
  chip.title = 'Border flash color';
  const swatch = document.createElement('span');
  swatch.className = 'swatch';
  swatch.style.background = trig.color;
  const input = document.createElement('input');
  input.type = 'color';
  input.value = trig.color;
  input.onchange = async () => {
    trig.color = input.value;
    swatch.style.background = input.value;
    const next = await api.updateTrigger(trig.id, { color: trig.color });
    workingConfig.triggers = next;
  };
  const label = document.createElement('span');
  label.textContent = 'Color';
  chip.append(swatch, label, input);
  return chip;
}

function buildPulsePill(trig) {
  const pill = document.createElement('button');
  pill.type = 'button';
  pill.className = 'pulse-pill' + (trig.pulse ? ' active' : '');
  pill.title = trig.pulse ? 'Pulse is on - alerts flash the border' : 'Pulse is off - border is solid';
  const dot = document.createElement('span');
  dot.className = 'pulse-dot';
  const label = document.createElement('span');
  label.textContent = trig.pulse ? 'Pulse on' : 'Pulse off';
  pill.append(dot, label);
  pill.onclick = async () => {
    trig.pulse = !trig.pulse;
    pill.classList.toggle('active', trig.pulse);
    label.textContent = trig.pulse ? 'Pulse on' : 'Pulse off';
    pill.title = trig.pulse ? 'Pulse is on - alerts flash the border' : 'Pulse is off - border is solid';
    const next = await api.updateTrigger(trig.id, { pulse: trig.pulse });
    workingConfig.triggers = next;
  };
  return pill;
}

el('addSlaTrigger').onclick = async () => {
  const preset = SLA_PRESETS.find((p) => p.thresholdMinutes === 60) || SLA_PRESETS[0];
  const trigger = {
    id: `sla-${Date.now()}`,
    type: 'sla',
    label: preset.label,
    enabled: true,
    color: '#ffaa00',
    pulse: true,
    thresholdMinutes: preset.thresholdMinutes,
  };
  const next = await api.addTrigger(trigger);
  workingConfig.triggers = next;
  renderTriggers();
  await api.pokeEngine();
};

el('addApprovalTrigger').onclick = async () => {
  const preset = APPROVAL_PRESETS.find((p) => p.ageThresholdHours === 4) || APPROVAL_PRESETS[0];
  const trigger = {
    id: `approval-${Date.now()}`,
    type: 'approval',
    label: preset.label,
    enabled: true,
    color: '#a855f7',
    pulse: true,
    ageThresholdHours: preset.ageThresholdHours,
  };
  const next = await api.addTrigger(trigger);
  workingConfig.triggers = next;
  renderTriggers();
  await api.pokeEngine();
};

/* ---------------- Connection actions ---------------- */
function setStatus(node, ok, msg) {
  node.className = `status ${ok ? 'ok' : 'error'}`;
  node.textContent = msg;
}

// Toggle the Connect/Disconnect button based on whether a token is stored.
// When connected, the button is destructive (clears token). When not, the
// button is primary (validates + saves).
function renderConnectionButton() {
  const btn = el('connectionBtn');
  if (!btn) return;
  if (workingConfig && workingConfig.jsm && workingConfig.jsm.hasApiToken) {
    btn.textContent = 'Disconnect';
    btn.className = 'btn btn-ghost btn-danger';
  } else {
    btn.textContent = 'Connect';
    btn.className = 'btn btn-primary';
  }
}

el('connectionBtn').onclick = async () => {
  const isConnected = workingConfig && workingConfig.jsm && workingConfig.jsm.hasApiToken;

  if (isConnected) {
    // Disconnect path - confirm, then clear the token. Site URL and email
    // stay so reconnecting is just a paste away.
    const ok = await customConfirm({
      title: 'Disconnect from JSM',
      message:
        'Your API token will be removed from this Mac. Site URL and email stay so ' +
        'you can reconnect quickly by pasting a fresh token.',
      confirmLabel: 'Disconnect',
      confirmDanger: true,
    });
    if (!ok) return;
    workingConfig = await api.disconnect();
    el('apiToken').value = '';
    el('apiToken').placeholder = 'Atlassian API token';
    setStatus(el('testResult'), false, 'Disconnected');
    setConnectionState('unknown', 'Not connected');
    renderConnectionButton();
    applyConnectionLockState();
    return;
  }

  // Connect path - validate creds with /myself. On success, persistCredsOnly
  // (which already ran inside the test handler upstream) ensures the token
  // is encrypted and saved. Then reload config so hasApiToken flips true.
  await persistCredsOnly();
  setConnectionState('unknown', 'Connecting…');
  const raw = el('apiToken').value;
  const apiTokenForTest = isJustBullets(raw) ? '' : raw.trim();
  const result = await api.testConnection({
    siteUrl: el('siteUrl').value.trim(),
    email: el('email').value.trim(),
    apiToken: apiTokenForTest,
  });
  if (result.ok) {
    setStatus(el('testResult'), true, `Connected as ${result.user.displayName}`);
    setConnectionState('ok', `Connected as ${result.user.displayName}`);
    // Re-pull config so hasApiToken reflects the just-saved token and the
    // button flips to Disconnect.
    workingConfig = await api.getConfig();
    if (workingConfig.jsm.hasApiToken) {
      el('apiToken').value = SAVED_TOKEN_BULLETS;
    }
    renderConnectionButton();
    applyConnectionLockState();
  } else {
    setStatus(el('testResult'), false, `Failed: ${result.error}`);
    setConnectionState('error', 'Connection failed');
  }
};

/* ---------------- Watch list / Group search ---------------- */
el('userSearchBtn').onclick = doUserSearch;
el('userSearch').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doUserSearch();
});
el('groupSearchBtn').onclick = doGroupSearch;
el('groupSearch').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doGroupSearch();
});

async function doUserSearch() {
  const query = el('userSearch').value.trim();
  if (!query) return;
  await persistCredsOnly();
  const target = el('searchResults');
  target.innerHTML = '<li class="muted">Searching…</li>';
  try {
    const users = await api.searchUsers(query);
    target.innerHTML = '';
    if (!users.length) {
      target.innerHTML = '<li class="muted">No users matched.</li>';
      return;
    }
    for (const u of users) {
      const li = document.createElement('li');
      const meta = document.createElement('div');
      meta.className = 'user-meta';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = u.displayName;
      const email = document.createElement('span');
      email.className = 'email';
      email.textContent = u.emailAddress || u.accountId;
      meta.append(name, email);
      const btn = document.createElement('button');
      btn.className = 'btn btn-sm';
      btn.textContent = 'Add';
      btn.onclick = async () => {
        const next = await api.addWatchee(u);
        workingConfig.watchList = next;
        renderWatchList();
        btn.textContent = 'Added';
        btn.disabled = true;
      };
      li.append(meta, btn);
      target.appendChild(li);
    }
  } catch (err) {
    target.innerHTML = '';
    const errLi = document.createElement('li');
    errLi.className = 'muted';
    errLi.textContent = String(err && err.message ? err.message : err);
    target.appendChild(errLi);
  }
}

async function doGroupSearch() {
  const query = el('groupSearch').value.trim();
  if (!query) return;
  await persistCredsOnly();
  const target = el('groupResults');
  target.innerHTML = '<li class="muted">Searching…</li>';
  try {
    const groups = await api.searchGroups(query);
    target.innerHTML = '';
    if (!groups.length) {
      target.innerHTML = '<li class="muted">No groups matched.</li>';
      return;
    }
    for (const g of groups) {
      const li = document.createElement('li');
      const meta = document.createElement('div');
      meta.className = 'user-meta';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = g.name;
      const sub = document.createElement('span');
      sub.className = 'email';
      sub.textContent = 'group';
      meta.append(name, sub);
      const btn = document.createElement('button');
      btn.className = 'btn btn-sm';
      btn.textContent = 'Add';
      btn.onclick = async () => {
        const next = await api.addGroup(g);
        workingConfig.watchGroups = next;
        renderWatchGroups();
        btn.textContent = 'Added';
        btn.disabled = true;
      };
      li.append(meta, btn);
      target.appendChild(li);
    }
  } catch (err) {
    target.innerHTML = '';
    const errLi = document.createElement('li');
    errLi.className = 'muted';
    errLi.textContent = String(err && err.message ? err.message : err);
    target.appendChild(errLi);
  }
}

/* ---------------- Auto-save creds + polling ---------------- */
for (const id of ['siteUrl', 'email', 'apiToken']) {
  el(id).addEventListener('blur', () => {
    persistCredsOnly().catch(() => {});
  });
}
el('pollIntervalSeconds').addEventListener('change', async () => {
  workingConfig.pollIntervalSeconds = Number(el('pollIntervalSeconds').value) || 30;
  await api.saveConfig({ pollIntervalSeconds: workingConfig.pollIntervalSeconds });
});

/* ---------------- Live updates from tray ---------------- */
api.onTriggersUpdated((triggers) => {
  if (!workingConfig) return;
  workingConfig.triggers = triggers;
  renderTriggers();
});

load();
