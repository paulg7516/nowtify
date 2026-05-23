/* global document, window */
const api = window.settingsApi;

const el = (id) => document.getElementById(id);
let workingConfig = null;

async function load() {
  workingConfig = await api.getConfig();
  el('siteUrl').value = workingConfig.jsm.siteUrl || '';
  el('email').value = workingConfig.jsm.email || '';
  el('apiToken').value = workingConfig.jsm.apiToken || '';
  el('majorIncidentFieldId').value = workingConfig.jsm.majorIncidentFieldId || '';
  el('pollIntervalSeconds').value = workingConfig.pollIntervalSeconds || 30;
  renderWatchList();
  renderWatchGroups();
  renderTriggers();
}

api.onTriggersUpdated((triggers) => {
  if (!workingConfig) return;
  workingConfig.triggers = triggers;
  renderTriggers();
});

function renderWatchList() {
  const list = el('watchList');
  list.innerHTML = '';
  for (const u of workingConfig.watchList || []) {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="user-meta">
        <span class="name"></span>
        <span class="email"></span>
      </div>
    `;
    li.querySelector('.name').textContent = u.displayName || '(unknown)';
    li.querySelector('.email').textContent = u.emailAddress || u.accountId;
    const btn = document.createElement('button');
    btn.textContent = 'Remove';
    btn.onclick = async () => {
      const next = await api.removeWatchee(u.accountId);
      workingConfig.watchList = next;
      renderWatchList();
    };
    li.appendChild(btn);
    list.appendChild(li);
  }
  if ((workingConfig.watchList || []).length === 0) {
    list.innerHTML = '<li class="muted">No one yet — search above to add.</li>';
  }
}

function renderWatchGroups() {
  const list = el('watchGroups');
  list.innerHTML = '';
  for (const g of workingConfig.watchGroups || []) {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="user-meta">
        <span class="name"></span>
        <span class="email">group</span>
      </div>
    `;
    li.querySelector('.name').textContent = g.name;
    const btn = document.createElement('button');
    btn.textContent = 'Remove';
    btn.onclick = async () => {
      const next = await api.removeGroup(g.name);
      workingConfig.watchGroups = next;
      renderWatchGroups();
    };
    li.appendChild(btn);
    list.appendChild(li);
  }
  if ((workingConfig.watchGroups || []).length === 0) {
    list.innerHTML = '<li class="muted">No groups yet — search above to add.</li>';
  }
}

function renderTriggers() {
  const list = el('triggers');
  list.innerHTML = '';
  const triggers = workingConfig.triggers || [];
  if (triggers.length === 0) {
    list.innerHTML = '<li class="muted">No triggers configured.</li>';
    return;
  }
  for (const trig of triggers) {
    const li = document.createElement('li');

    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = Boolean(trig.enabled);
    toggle.title = 'Enable / disable this trigger';
    toggle.onchange = async () => {
      trig.enabled = toggle.checked;
      const next = await api.setTriggerEnabled(trig.id, trig.enabled);
      workingConfig.triggers = next;
      await api.pokeEngine();
    };

    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.value = trig.label;
    labelInput.placeholder = 'Trigger label';
    labelInput.onchange = async () => {
      trig.label = labelInput.value;
      const next = await api.updateTrigger(trig.id, { label: trig.label });
      workingConfig.triggers = next;
    };

    const badge = document.createElement('span');
    badge.className = `type-badge ${trig.type === 'major' ? 'major' : ''}`;
    badge.textContent = trig.type === 'major' ? 'Major Inc.' : 'SLA';

    const threshold = document.createElement('input');
    threshold.type = 'number';
    threshold.min = '0';
    if (trig.type === 'sla') {
      threshold.value = trig.thresholdMinutes ?? 0;
      threshold.title = 'Minutes remaining threshold (0 = breached)';
      threshold.onchange = async () => {
        trig.thresholdMinutes = Number(threshold.value) || 0;
        const next = await api.updateTrigger(trig.id, {
          thresholdMinutes: trig.thresholdMinutes,
        });
        workingConfig.triggers = next;
      };
    } else {
      threshold.value = '';
      threshold.disabled = true;
      threshold.title = 'Major Incident triggers fire on field = true, no threshold';
      threshold.style.visibility = 'hidden';
    }

    const color = document.createElement('input');
    color.type = 'color';
    color.value = trig.color;
    color.onchange = async () => {
      trig.color = color.value;
      const next = await api.updateTrigger(trig.id, { color: trig.color });
      workingConfig.triggers = next;
    };

    const pulseLabel = document.createElement('label');
    pulseLabel.className = 'row-label';
    const pulseInput = document.createElement('input');
    pulseInput.type = 'checkbox';
    pulseInput.checked = Boolean(trig.pulse);
    pulseInput.onchange = async () => {
      trig.pulse = pulseInput.checked;
      const next = await api.updateTrigger(trig.id, { pulse: trig.pulse });
      workingConfig.triggers = next;
    };
    pulseLabel.appendChild(pulseInput);
    pulseLabel.appendChild(document.createTextNode('pulse'));

    const remove = document.createElement('button');
    if (trig.type === 'major' && trig.id === 'major-incident') {
      // Don't allow deleting the default Major Incident trigger
      remove.textContent = '';
      remove.style.visibility = 'hidden';
    } else {
      remove.textContent = 'Delete';
      remove.onclick = async () => {
        if (!confirm(`Delete trigger "${trig.label}"?`)) return;
        const next = await api.removeTrigger(trig.id);
        workingConfig.triggers = next;
        renderTriggers();
        await api.pokeEngine();
      };
    }

    li.appendChild(toggle);
    li.appendChild(labelInput);
    li.appendChild(badge);
    li.appendChild(threshold);
    li.appendChild(color);
    li.appendChild(pulseLabel);
    li.appendChild(remove);
    list.appendChild(li);
  }
}

el('addSlaTrigger').onclick = async () => {
  const trigger = {
    id: `sla-${Date.now()}`,
    type: 'sla',
    label: 'New SLA trigger',
    enabled: true,
    color: '#ffaa00',
    pulse: true,
    thresholdMinutes: 60,
  };
  const next = await api.addTrigger(trigger);
  workingConfig.triggers = next;
  renderTriggers();
  await api.pokeEngine();
};

function setStatus(node, ok, msg) {
  node.className = `status ${ok ? 'ok' : 'error'}`;
  node.textContent = msg;
}

el('testConnection').onclick = async () => {
  await persistCredsOnly();
  const result = await api.testConnection({
    siteUrl: el('siteUrl').value.trim(),
    email: el('email').value.trim(),
    apiToken: el('apiToken').value.trim(),
  });
  setStatus(
    el('testResult'),
    result.ok,
    result.ok ? `Connected as ${result.user.displayName}` : `Failed: ${result.error}`,
  );
};

// Auto-persist credential fields the moment focus leaves them — no manual save needed.
for (const id of ['siteUrl', 'email', 'apiToken', 'majorIncidentFieldId']) {
  el(id).addEventListener('blur', () => {
    persistCredsOnly().catch(() => {});
  });
}

el('resolveFields').onclick = async () => {
  await persistCredsOnly();
  try {
    const fields = await api.resolveFields();
    setStatus(
      el('fieldsResult'),
      true,
      `Major Incident: ${fields.majorIncidentFieldId || 'NOT FOUND'} · SLA fields: ${fields.slaFieldIds.length}`,
    );
    if (fields.majorIncidentFieldId && !el('majorIncidentFieldId').value) {
      el('majorIncidentFieldId').value = fields.majorIncidentFieldId;
    }
  } catch (err) {
    setStatus(el('fieldsResult'), false, err.message || String(err));
  }
};

el('userSearchBtn').onclick = doUserSearch;
el('userSearch').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doUserSearch();
});
el('groupSearchBtn').onclick = doGroupSearch;
el('groupSearch').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doGroupSearch();
});

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
      li.innerHTML = `
        <div class="user-meta">
          <span class="name"></span>
          <span class="email">group</span>
        </div>
      `;
      li.querySelector('.name').textContent = g.name;
      const btn = document.createElement('button');
      btn.textContent = 'Add';
      btn.onclick = async () => {
        const next = await api.addGroup(g);
        workingConfig.watchGroups = next;
        renderWatchGroups();
        btn.textContent = 'Added';
        btn.disabled = true;
      };
      li.appendChild(btn);
      target.appendChild(li);
    }
  } catch (err) {
    target.innerHTML = `<li class="status error">${err.message || err}</li>`;
  }
}

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
      li.innerHTML = `
        <div class="user-meta">
          <span class="name"></span>
          <span class="email"></span>
        </div>
      `;
      li.querySelector('.name').textContent = u.displayName;
      li.querySelector('.email').textContent = u.emailAddress || u.accountId;
      const btn = document.createElement('button');
      btn.textContent = 'Add';
      btn.onclick = async () => {
        const next = await api.addWatchee(u);
        workingConfig.watchList = next;
        renderWatchList();
        btn.textContent = 'Added';
        btn.disabled = true;
      };
      li.appendChild(btn);
      target.appendChild(li);
    }
  } catch (err) {
    target.innerHTML = `<li class="status error">${err.message || err}</li>`;
  }
}

async function persistCredsOnly() {
  workingConfig.jsm = {
    siteUrl: el('siteUrl').value.trim(),
    email: el('email').value.trim(),
    apiToken: el('apiToken').value.trim(),
    majorIncidentFieldId: el('majorIncidentFieldId').value.trim(),
  };
  await api.saveConfig({ jsm: workingConfig.jsm });
}

el('save').onclick = async () => {
  workingConfig.jsm = {
    siteUrl: el('siteUrl').value.trim(),
    email: el('email').value.trim(),
    apiToken: el('apiToken').value.trim(),
    majorIncidentFieldId: el('majorIncidentFieldId').value.trim(),
  };
  workingConfig.pollIntervalSeconds = Number(el('pollIntervalSeconds').value) || 30;
  await api.saveConfig({
    jsm: workingConfig.jsm,
    pollIntervalSeconds: workingConfig.pollIntervalSeconds,
  });
  await api.pokeEngine();
  setStatus(el('saveResult'), true, 'Saved.');
  setTimeout(() => (el('saveResult').textContent = ''), 2500);
};

load();
