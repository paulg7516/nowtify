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

/* ---------------- Display > Pulse target ----------------
   The radio writes through to store immediately on change. The main
   process re-broadcasts the live state after the save so overlays
   light/clear without a delay. Per-radio listeners attached once at
   module load; load() handles the initial checked state. */
for (const radio of document.querySelectorAll('input[name="pulseTarget"]')) {
  radio.addEventListener('change', async (e) => {
    if (!e.target.checked) return;
    const value = e.target.value;
    try {
      workingConfig = await api.saveConfig({ pulseTarget: value });
    } catch (err) {
      console.warn('[display] failed to save pulseTarget', err);
    }
  });
}

function applyPulseTargetFromConfig() {
  const current = (workingConfig && workingConfig.pulseTarget) || 'both';
  for (const radio of document.querySelectorAll('input[name="pulseTarget"]')) {
    radio.checked = radio.value === current;
  }
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
  renderTriggers();
  applyPulseTargetFromConfig();

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
  renderTeamsState();
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

const TEAMS_PRESETS = [
  { label: 'Any unread message', ageThresholdMinutes: 0 },
  { label: 'Unread 15+ min', ageThresholdMinutes: 15 },
  { label: 'Unread 1+ hour', ageThresholdMinutes: 60 },
  { label: 'Unread 4+ hours', ageThresholdMinutes: 240 },
];

const EMAIL_PRESETS = [
  { label: 'Any unread email', ageThresholdMinutes: 0 },
  { label: 'Unread 30+ min', ageThresholdMinutes: 30 },
  { label: 'Unread 2+ hours', ageThresholdMinutes: 120 },
  { label: 'Unread 8+ hours', ageThresholdMinutes: 480 },
];

function renderTriggers() {
  const triggers = workingConfig.triggers || [];
  const groups = {
    major: { list: el('triggers-major'), emptyMessage: 'No Major Incident trigger configured.' },
    sla: { list: el('triggers-sla'), emptyMessage: 'No SLA triggers yet - click Add SLA trigger above.' },
    approval: { list: el('triggers-approval'), emptyMessage: 'No approval triggers yet - click Add approval trigger above.' },
    teams: { list: el('triggers-teams'), emptyMessage: 'No Teams trigger configured.' },
    email: { list: el('triggers-email'), emptyMessage: 'No Email trigger configured.' },
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
  card.style.setProperty('--trigger-color', trig.color);

  // Status dot: colored circle on the left, doubles as color picker
  // affordance. Hidden native <input type=color> overlays it so click
  // anywhere on the dot opens the OS picker.
  const status = document.createElement('label');
  status.className = 'trigger-status';
  status.title = 'Change color';
  const dot = document.createElement('span');
  dot.className = 'trigger-status-dot';
  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.value = trig.color;
  colorInput.onchange = async () => {
    trig.color = colorInput.value;
    card.style.setProperty('--trigger-color', colorInput.value);
    const next = await api.updateTrigger(trig.id, { color: trig.color });
    workingConfig.triggers = next;
  };
  status.append(dot, colorInput);

  // Enable/disable switch (right side of the card)
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

  // Body: title (with inline dropdown for SLA/Approval/Teams types) on top,
  // small meta row below with the pulse control.
  const body = document.createElement('div');
  body.className = 'trigger-body';

  const titleEl = buildTriggerTitle(trig);
  body.appendChild(titleEl);

  const meta = document.createElement('div');
  meta.className = 'trigger-meta';

  const pulseWrap = document.createElement('span');
  pulseWrap.className = 'trigger-meta-item';
  pulseWrap.title = trig.pulse
    ? 'Pulse is on - alerts flash the border'
    : 'Pulse is off - border stays solid';
  pulseWrap.appendChild(buildPulsePill(trig));
  meta.appendChild(pulseWrap);

  // Scope summary + click-to-expand picker (for SLA/Teams). Major + Approval
  // get a read-only label since their scope is implicit (instance-wide vs
  // the authenticated user).
  meta.appendChild(buildScopeMetaItem(trig, card));

  body.appendChild(meta);

  // Column 3: delete (only for deletable triggers). The default Major
  // Incident, Pending Approvals, and Teams Messages triggers are locked -
  // users can disable but not delete them, since they're the headline use
  // cases for each integration.
  const isLocked =
    (trig.type === 'major' && trig.id === 'major-incident') ||
    (trig.type === 'approval' && trig.id === 'pending-approvals') ||
    (trig.type === 'teams' && trig.id === 'teams-vip-message') ||
    (trig.type === 'email' && trig.id === 'email-from-watched');
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

  // Layout (left to right): status dot, body (title + meta), toggle,
  // hover-revealed delete. DOM order matches visual order for tab nav.
  card.append(status, body, switchEl, trailing);

  // Inline expansion area for the scope picker (appears below the card
  // when the user clicks the scope label in the meta line).
  const expansion = document.createElement('div');
  expansion.className = 'trigger-scope-picker';
  expansion.hidden = true;
  card.appendChild(expansion);

  return card;
}

/* ---------------- Scope summary + inline picker ---------------- */

function buildScopeMetaItem(trig, card) {
  const item = document.createElement('span');
  item.className = 'trigger-meta-item';

  if (trig.type === 'major') {
    item.textContent = 'Instance-wide';
    item.style.cursor = 'default';
    item.title = 'Fires for any open ticket in JSM flagged as a Major Incident';
    return item;
  }
  if (trig.type === 'approval') {
    item.textContent = 'Just me';
    item.style.cursor = 'default';
    item.title = 'Fires for pending approvals where the connected JSM user is the approver';
    return item;
  }

  // SLA / Teams / Email - clickable
  const scope = trig.scope || {};
  const label = document.createElement('span');
  label.textContent = formatScopeSummary(trig.type, scope);
  const chev = document.createElement('span');
  chev.className = 'scope-chevron';
  chev.innerHTML = '▾'; // small down arrow
  item.append(label, chev);
  item.title = 'Click to manage who this trigger watches';

  item.onclick = () => {
    const expansion = card.querySelector('.trigger-scope-picker');
    if (!expansion) return;
    const opening = expansion.hidden;
    expansion.hidden = !opening;
    card.classList.toggle('scope-open', opening);
    chev.style.transform = opening ? 'rotate(180deg)' : '';
    if (opening) {
      buildScopePickerInto(expansion, trig, card, label);
    }
  };
  return item;
}

function formatScopeSummary(type, scope) {
  if (type === 'sla') {
    const userCount = (scope.users || []).length;
    const groupCount = (scope.groups || []).length;
    if (userCount === 0 && groupCount === 0) return 'No one watched';
    const parts = [];
    if (userCount > 0) parts.push(`${userCount} ${userCount === 1 ? 'person' : 'people'}`);
    if (groupCount > 0) parts.push(`${groupCount} ${groupCount === 1 ? 'group' : 'groups'}`);
    return parts.join(', ');
  }
  if (type === 'teams' || type === 'email') {
    const userCount = (scope.users || []).length;
    if (userCount === 0) return 'No one watched';
    return `${userCount} ${userCount === 1 ? 'person' : 'people'}`;
  }
  return '';
}

async function persistScopeUpdate(trig, newScope, summaryLabelEl) {
  trig.scope = newScope;
  const next = await api.updateTrigger(trig.id, { scope: newScope });
  workingConfig.triggers = next;
  if (summaryLabelEl) {
    summaryLabelEl.textContent = formatScopeSummary(trig.type, newScope);
  }
  await api.pokeEngine();
}

function buildScopePickerInto(container, trig, card, summaryLabelEl) {
  container.innerHTML = '';

  const currentList = document.createElement('div');
  currentList.className = 'scope-current';
  const renderCurrent = () => {
    currentList.innerHTML = '';
    const scope = trig.scope || {};
    const users = scope.users || [];
    const groups = scope.groups || [];
    if (users.length === 0 && groups.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'scope-empty';
      if (trig.type === 'sla') {
        empty.textContent = 'Search below to add people or groups whose tickets you want to watch.';
      } else if (trig.type === 'email') {
        empty.textContent = 'Search below to add senders whose unread emails should fire alerts.';
      } else {
        empty.textContent = 'Search below to add Teams users whose messages you want to be alerted about.';
      }
      currentList.appendChild(empty);
      return;
    }
    for (const u of users) {
      currentList.appendChild(
        buildScopeRow(u.displayName || '(unknown)', u.emailAddress || u.mail || u.address || '', async () => {
          // Each integration keys its scope users differently:
          //   sla:   by accountId (JSM user GUID)
          //   teams: by id (Graph user GUID)
          //   email: by mail/address (email string)
          const nextScope = {
            ...(trig.scope || {}),
            users: (trig.scope.users || []).filter((x) => {
              if (trig.type === 'teams') return x.id !== u.id;
              if (trig.type === 'email') {
                const a = (u.mail || u.address || '').toLowerCase();
                const b = (x.mail || x.address || '').toLowerCase();
                return a !== b;
              }
              return x.accountId !== u.accountId;
            }),
          };
          await persistScopeUpdate(trig, nextScope, summaryLabelEl);
          renderCurrent();
        }),
      );
    }
    for (const g of groups) {
      currentList.appendChild(
        buildScopeRow(g.name, 'group', async () => {
          const nextScope = {
            ...(trig.scope || {}),
            groups: (trig.scope.groups || []).filter((x) => x.name !== g.name),
          };
          await persistScopeUpdate(trig, nextScope, summaryLabelEl);
          renderCurrent();
        }),
      );
    }
  };
  renderCurrent();

  // Search section
  const search = document.createElement('div');
  search.className = 'scope-search';
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  if (trig.type === 'teams') searchInput.placeholder = 'Search Teams users...';
  else if (trig.type === 'email') searchInput.placeholder = 'Search Outlook users...';
  else searchInput.placeholder = 'Search Jira users or groups...';
  const searchBtn = document.createElement('button');
  searchBtn.className = 'btn btn-ghost btn-sm';
  searchBtn.textContent = 'Search';
  search.append(searchInput, searchBtn);

  const searchResults = document.createElement('div');
  searchResults.className = 'scope-search-results';

  const doSearch = async () => {
    const q = searchInput.value.trim();
    if (!q) return;
    searchResults.innerHTML = '<div class="scope-empty">Searching...</div>';
    try {
      if (trig.type === 'teams') {
        const users = await api.teamsSearchUsers(q);
        renderSearchResults(searchResults, users, 'user', async (u) => {
          const exists = (trig.scope.users || []).some((x) => x.id === u.id);
          if (exists) return;
          const nextScope = {
            users: [
              ...(trig.scope.users || []),
              { id: u.id, displayName: u.displayName, mail: u.mail || '' },
            ],
          };
          await persistScopeUpdate(trig, nextScope, summaryLabelEl);
          renderCurrent();
        });
      } else if (trig.type === 'email') {
        // Email scope uses the same Graph user search as Teams. We store
        // the email address (not user id) since Graph mail filter is by
        // sender address.
        const users = await api.teamsSearchUsers(q);
        renderSearchResults(searchResults, users, 'user', async (u) => {
          const addr = (u.mail || '').toLowerCase();
          if (!addr) return; // need an email address to watch
          const exists = (trig.scope.users || []).some(
            (x) => (x.mail || x.address || '').toLowerCase() === addr,
          );
          if (exists) return;
          const nextScope = {
            users: [
              ...(trig.scope.users || []),
              { id: u.id, displayName: u.displayName, mail: addr },
            ],
          };
          await persistScopeUpdate(trig, nextScope, summaryLabelEl);
          renderCurrent();
        });
      } else {
        // SLA: search BOTH users + groups, show grouped
        const [users, groups] = await Promise.all([
          api.searchUsers(q),
          api.searchGroups(q),
        ]);
        searchResults.innerHTML = '';
        if (users.length > 0) {
          const head = document.createElement('div');
          head.className = 'scope-results-head';
          head.textContent = 'People';
          searchResults.appendChild(head);
          for (const u of users) {
            searchResults.appendChild(
              buildAddRow(u.displayName, u.emailAddress || u.accountId, async () => {
                const exists = (trig.scope.users || []).some((x) => x.accountId === u.accountId);
                if (exists) return;
                const nextScope = {
                  ...(trig.scope || {}),
                  users: [
                    ...(trig.scope.users || []),
                    {
                      accountId: u.accountId,
                      displayName: u.displayName,
                      emailAddress: u.emailAddress || '',
                    },
                  ],
                  groups: trig.scope.groups || [],
                };
                await persistScopeUpdate(trig, nextScope, summaryLabelEl);
                renderCurrent();
              }),
            );
          }
        }
        if (groups.length > 0) {
          const head = document.createElement('div');
          head.className = 'scope-results-head';
          head.textContent = 'Groups';
          searchResults.appendChild(head);
          for (const g of groups) {
            searchResults.appendChild(
              buildAddRow(g.name, 'group', async () => {
                const exists = (trig.scope.groups || []).some((x) => x.name === g.name);
                if (exists) return;
                const nextScope = {
                  ...(trig.scope || {}),
                  users: trig.scope.users || [],
                  groups: [...(trig.scope.groups || []), { name: g.name }],
                };
                await persistScopeUpdate(trig, nextScope, summaryLabelEl);
                renderCurrent();
              }),
            );
          }
        }
        if (users.length === 0 && groups.length === 0) {
          searchResults.innerHTML = '<div class="scope-empty">No matches.</div>';
        }
      }
    } catch (err) {
      searchResults.innerHTML = '';
      const errEl = document.createElement('div');
      errEl.className = 'scope-empty';
      errEl.textContent = String(err && err.message ? err.message : err);
      searchResults.appendChild(errEl);
    }
  };
  searchBtn.onclick = doSearch;
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch();
  });

  const currentHead = document.createElement('div');
  currentHead.className = 'scope-section-head';
  currentHead.textContent = 'Currently watching';

  const searchHead = document.createElement('div');
  searchHead.className = 'scope-section-head';
  searchHead.textContent = 'Add more';

  container.append(currentHead, currentList, searchHead, search, searchResults);
}

function buildScopeRow(name, sub, onRemove) {
  const row = document.createElement('div');
  row.className = 'scope-row';
  const meta = document.createElement('div');
  meta.className = 'user-meta';
  const n = document.createElement('span');
  n.className = 'name';
  n.textContent = name;
  const s = document.createElement('span');
  s.className = 'email';
  s.textContent = sub;
  meta.append(n, s);
  const remove = document.createElement('button');
  remove.className = 'btn btn-ghost btn-sm';
  remove.textContent = 'Remove';
  remove.onclick = onRemove;
  row.append(meta, remove);
  return row;
}

function buildAddRow(name, sub, onAdd) {
  const row = document.createElement('div');
  row.className = 'scope-row';
  const meta = document.createElement('div');
  meta.className = 'user-meta';
  const n = document.createElement('span');
  n.className = 'name';
  n.textContent = name;
  const s = document.createElement('span');
  s.className = 'email';
  s.textContent = sub;
  meta.append(n, s);
  const add = document.createElement('button');
  add.className = 'btn btn-sm';
  add.textContent = 'Add';
  add.onclick = async () => {
    add.disabled = true;
    add.textContent = 'Added';
    await onAdd();
  };
  row.append(meta, add);
  return row;
}

function renderSearchResults(container, items, kind, onAdd) {
  container.innerHTML = '';
  if (!items.length) {
    container.innerHTML = '<div class="scope-empty">No matches.</div>';
    return;
  }
  for (const item of items) {
    container.appendChild(
      buildAddRow(
        item.displayName || item.name || '(unnamed)',
        item.mail || item.email || item.emailAddress || '',
        () => onAdd(item),
      ),
    );
  }
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
  if (trig.type === 'teams') {
    return buildPresetSelect({
      trig,
      presets: TEAMS_PRESETS,
      valueKey: 'ageThresholdMinutes',
      ariaLabel: 'Teams message age threshold',
    });
  }
  if (trig.type === 'email') {
    return buildPresetSelect({
      trig,
      presets: EMAIL_PRESETS,
      valueKey: 'ageThresholdMinutes',
      ariaLabel: 'Email age threshold',
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

function buildPulsePill(trig) {
  // Inline-text pulse control: dot + "Pulse on/off" text. No border, no
  // pill chrome - it reads as part of the meta line.
  const pill = document.createElement('button');
  pill.type = 'button';
  pill.className = 'pulse-pill' + (trig.pulse ? ' active' : '');
  const dot = document.createElement('span');
  dot.className = 'pulse-dot';
  const label = document.createElement('span');
  label.textContent = trig.pulse ? 'Pulse on' : 'Pulse off';
  pill.append(dot, label);
  pill.onclick = async (e) => {
    e.preventDefault();
    trig.pulse = !trig.pulse;
    pill.classList.toggle('active', trig.pulse);
    label.textContent = trig.pulse ? 'Pulse on' : 'Pulse off';
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
    // Clear any prior status text - the top-right pill already conveys
    // "Not connected" so a second readout next to the button is redundant.
    setStatus(el('testResult'), true, '');
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
    // Top-right pill shows "Connected as <name>" - no need to repeat it
    // next to the button. Clear any prior status text.
    setStatus(el('testResult'), true, '');
    setConnectionState('ok', `Connected as ${result.user.displayName}`);
    // Re-pull config so hasApiToken reflects the just-saved token.
    workingConfig = await api.getConfig();
    // Belt-and-suspenders: the test succeeded so we know we're connected.
    // Force hasApiToken true here so the button + lock state always flip
    // regardless of any IPC/refresh edge case.
    if (workingConfig && workingConfig.jsm) {
      workingConfig.jsm.hasApiToken = true;
      workingConfig.jsm.userDisplayName = result.user.displayName || workingConfig.jsm.userDisplayName;
    }
    el('apiToken').value = SAVED_TOKEN_BULLETS;
    renderConnectionButton();
    applyConnectionLockState();
  } else {
    setStatus(el('testResult'), false, `Failed: ${result.error}`);
    setConnectionState('error', 'Connection failed');
  }
};

/* ---------------- Microsoft Teams connection ---------------- */

function renderTeamsState() {
  if (!workingConfig) return;
  const teams = workingConfig.teams || {};
  const block = el('teamsStatusBlock');
  const title = el('teamsStatusTitle');
  const sub = el('teamsStatusSub');
  const btn = el('teamsConnectBtn');
  if (!block || !btn) return;

  if (teams.isConnected) {
    block.dataset.connected = 'true';
    title.textContent = `Connected as ${teams.userDisplayName || 'unknown'}`;
    sub.textContent =
      'Nowtify will use this account to watch for unread Teams messages and Outlook emails.';
    btn.textContent = 'Disconnect';
    btn.className = 'btn btn-ghost btn-danger';
  } else {
    block.dataset.connected = 'false';
    title.textContent = 'Not connected';
    sub.textContent =
      'Sign in with your Xolv account to enable Teams chat and Outlook email alerts. ' +
      'A browser tab will open for Microsoft sign-in.';
    btn.textContent = 'Connect Microsoft 365';
    btn.className = 'btn btn-primary';
  }
}

el('teamsConnectBtn').onclick = async () => {
  const teams = (workingConfig && workingConfig.teams) || {};
  if (teams.isConnected) {
    const ok = await customConfirm({
      title: 'Disconnect Microsoft 365',
      message:
        'Your Microsoft sign-in will be removed from this Mac. Teams and Outlook alerts will stop firing until you reconnect. Watched-users lists for both stay intact.',
      confirmLabel: 'Disconnect',
      confirmDanger: true,
    });
    if (!ok) return;
    workingConfig = await api.teamsDisconnect();
    setStatus(el('teamsResult'), true, '');
    renderTeamsState();
    return;
  }
  // Connect path
  setStatus(el('teamsResult'), true, 'Opening browser for sign-in…');
  el('teamsConnectBtn').disabled = true;
  const result = await api.teamsBeginAuth();
  el('teamsConnectBtn').disabled = false;
  if (!result.ok) {
    setStatus(el('teamsResult'), false, `Failed: ${result.error}`);
  }
  // The actual "connected" event arrives async via the open-url handler
  // in main, which sends settings:teams-connected to this renderer.
};

api.onTeamsConnected(async (_info) => {
  workingConfig = await api.getConfig();
  setStatus(el('teamsResult'), true, '');
  renderTeamsState();
});

api.onTeamsError((msg) => {
  setStatus(el('teamsResult'), false, `Sign-in failed: ${msg}`);
});

/* ---------------- Updates diagnostic panel ---------------- */

// Translate raw electron-updater error messages into a short, human-readable
// title + explanation. The raw stack trace is preserved in a collapsible
// "Show full error" details block for when actual debugging is needed.
function formatUpdaterError(raw) {
  const msg = String(raw || '');
  if (!msg) return { title: 'Unknown error', detail: '' };

  // 404 on the manifest file - happens when a release was just created but
  // GitHub hasn't finished uploading all artifacts yet (typically <60s).
  if (/Cannot find latest-mac\.yml|404.*latest-mac\.yml/i.test(msg)) {
    return {
      title: 'Latest release is still uploading',
      detail:
        'GitHub finishes uploading release artifacts within a minute or two of publishing. Wait a moment and try again.',
    };
  }
  // Network unreachable
  if (/ENOTFOUND|ECONNREFUSED|getaddrinfo|ETIMEDOUT|net::ERR_/i.test(msg)) {
    return {
      title: 'Cannot reach GitHub',
      detail: 'Check your network connection and try again.',
    };
  }
  // GitHub auth failure (rare for public repo, but possible)
  if (/401|403|unauthorized/i.test(msg)) {
    return {
      title: 'GitHub authentication issue',
      detail: 'The update server rejected the request. Contact the maintainer if this persists.',
    };
  }
  // GitHub 5xx
  if (/HttpError: 5\d\d/i.test(msg)) {
    return {
      title: 'GitHub is having issues',
      detail: 'The update server returned an error. Try again in a few minutes.',
    };
  }
  // Generic fallback
  const firstLine = msg.split('\n')[0].slice(0, 200);
  return { title: 'Update check failed', detail: firstLine };
}

function formatRelativeTime(ms) {
  if (!ms) return 'never this session';
  const delta = Date.now() - ms;
  if (delta < 5_000) return 'just now';
  if (delta < 60_000) return `${Math.floor(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  const h = Math.floor(delta / 3_600_000);
  return `${h}h ago`;
}

function renderUpdaterStatus(status) {
  if (!status) return;
  el('updaterCurrentVersion').textContent = status.currentVersion
    ? `v${status.currentVersion}`
    : 'unknown';
  el('updaterLastCheck').textContent = formatRelativeTime(status.lastCheckedAt);

  const dot = el('updaterDot');
  const type = status.result && status.result.type;
  dot.dataset.state = type || 'never';

  const statusText = el('updaterStatusText');
  statusText.innerHTML = '';
  if (type === 'error') {
    const { title, detail } = formatUpdaterError(status.result.message);
    const titleEl = document.createElement('div');
    titleEl.className = 'updater-error-title';
    titleEl.textContent = title;
    statusText.appendChild(titleEl);
    if (detail) {
      const detailEl = document.createElement('div');
      detailEl.className = 'updater-error-detail';
      detailEl.textContent = detail;
      statusText.appendChild(detailEl);
    }
    if (status.result.message && status.result.message.length > 80) {
      const block = document.createElement('details');
      block.className = 'updater-error-raw';
      const summary = document.createElement('summary');
      summary.textContent = 'Show full error';
      const pre = document.createElement('pre');
      pre.textContent = status.result.message;
      block.appendChild(summary);
      block.appendChild(pre);
      statusText.appendChild(block);
    }
  } else {
    statusText.textContent = (status.result && status.result.message) || '-';
  }

  // Show "Restart + install now" only when an update has been downloaded
  // and is ready to apply. Hidden in all other states.
  el('updaterInstallBtn').hidden = type !== 'downloaded';

  // Disable Check button while a check or download is in flight to avoid
  // racing requests.
  const checkBtn = el('updaterCheckBtn');
  if (type === 'checking' || type === 'downloading' || type === 'available') {
    checkBtn.disabled = true;
    checkBtn.textContent =
      type === 'downloading' ? 'Downloading…' : type === 'available' ? 'Found update…' : 'Checking…';
  } else {
    checkBtn.disabled = false;
    checkBtn.textContent = 'Check for updates';
  }
}

el('updaterCheckBtn').onclick = async () => {
  const status = await api.checkForUpdates();
  renderUpdaterStatus(status);
};

el('updaterInstallBtn').onclick = async () => {
  el('updaterInstallBtn').disabled = true;
  el('updaterInstallBtn').textContent = 'Installing…';
  await api.installUpdateNow();
  // The app will quit shortly after this; if it doesn't, re-enable the
  // button so the user can retry.
  setTimeout(() => {
    el('updaterInstallBtn').disabled = false;
    el('updaterInstallBtn').textContent = 'Install now';
  }, 5000);
};

// Initial fetch + subscribe to live status updates from main.
api.getUpdateStatus().then(renderUpdaterStatus).catch(() => {});
if (api.onUpdaterStatus) {
  api.onUpdaterStatus(renderUpdaterStatus);
}

// Refresh the relative "Last check" timestamp every 30s so it stays accurate
// without requiring a manual reload.
setInterval(() => {
  api.getUpdateStatus().then(renderUpdaterStatus).catch(() => {});
}, 30_000);

/* ---------------- Engine health panel ---------------- */

// Map an internal poller step key to a plain-language name users recognise,
// so a degraded status reads "Degraded - SLA, Teams" instead of leaking
// internal step ids.
const STEP_LABELS = {
  fields: 'Jira',
  major: 'Major Incidents',
  sla: 'SLA',
  approval: 'Approvals',
  teams: 'Teams',
  email: 'Outlook',
  fatal: 'engine',
};

function renderEngineHealth(health) {
  if (!health) return;
  const dot = el('engineDot');
  const text = el('engineHealthText');
  const lastTick = el('engineLastTick');
  const errorsRow = el('engineErrorsRow');
  const errorsBox = el('engineErrors');
  if (!dot || !text) return;

  const stepErrors = health.stepErrors || {};
  const errorKeys = Object.keys(stepErrors);
  const healthy = health.isHealthy && errorKeys.length === 0;
  dot.dataset.state = healthy ? 'up-to-date' : 'error';
  if (healthy) {
    text.textContent = 'Working';
  } else {
    const names = [...new Set(errorKeys.map((k) => STEP_LABELS[k] || k))];
    text.textContent = `Degraded - ${names.join(', ')}`;
  }

  // Lead with "actively checking"; keep the raw tick duration in the tooltip
  // for when someone is actually debugging performance.
  if (health.lastTickAt) {
    lastTick.textContent = formatRelativeTime(health.lastTickAt);
    lastTick.title =
      typeof health.lastTickDurationMs === 'number'
        ? `Last check took ${health.lastTickDurationMs}ms`
        : '';
  } else {
    lastTick.textContent = 'Not checked yet';
    lastTick.title = '';
  }

  if (errorKeys.length > 0) {
    errorsRow.hidden = false;
    errorsBox.innerHTML = '';
    for (const k of errorKeys) {
      const line = document.createElement('div');
      line.textContent = `${STEP_LABELS[k] || k}: ${stepErrors[k].message}`;
      line.style.fontSize = '11.5px';
      line.style.color = 'var(--danger)';
      line.style.marginBottom = '2px';
      errorsBox.appendChild(line);
    }
  } else {
    errorsRow.hidden = true;
  }
}

if (api.getEngineHealth) {
  api.getEngineHealth().then(renderEngineHealth).catch(() => {});
  setInterval(() => {
    api.getEngineHealth().then(renderEngineHealth).catch(() => {});
  }, 5_000);
}

/* ---------------- Auto-save creds + polling ---------------- */
for (const id of ['siteUrl', 'email', 'apiToken']) {
  el(id).addEventListener('blur', () => {
    persistCredsOnly().catch(() => {});
  });
}
/* ---------------- Live updates from tray ---------------- */
api.onTriggersUpdated((triggers) => {
  if (!workingConfig) return;
  workingConfig.triggers = triggers;
  renderTriggers();
});

load();
