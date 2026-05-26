const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsApi', {
  getConfig: () => ipcRenderer.invoke('settings:get'),
  saveConfig: (patch) => ipcRenderer.invoke('settings:save', patch),
  testConnection: (creds) => ipcRenderer.invoke('settings:test-connection', creds),
  disconnect: () => ipcRenderer.invoke('settings:disconnect'),
  searchUsers: (query) => ipcRenderer.invoke('settings:search-users', query),
  addWatchee: (user) => ipcRenderer.invoke('settings:add-watchee', user),
  removeWatchee: (accountId) => ipcRenderer.invoke('settings:remove-watchee', accountId),
  searchGroups: (query) => ipcRenderer.invoke('settings:search-groups', query),
  addGroup: (group) => ipcRenderer.invoke('settings:add-group', group),
  removeGroup: (groupName) => ipcRenderer.invoke('settings:remove-group', groupName),
  resolveFields: () => ipcRenderer.invoke('settings:resolve-fields'),
  pokeEngine: () => ipcRenderer.invoke('settings:poke-engine'),
  setTriggerEnabled: (triggerId, enabled) =>
    ipcRenderer.invoke('settings:set-trigger-enabled', { triggerId, enabled }),
  updateTrigger: (triggerId, patch) =>
    ipcRenderer.invoke('settings:update-trigger', { triggerId, patch }),
  addTrigger: (trigger) => ipcRenderer.invoke('settings:add-trigger', trigger),
  removeTrigger: (triggerId) => ipcRenderer.invoke('settings:remove-trigger', triggerId),
  onTriggersUpdated: (cb) => {
    ipcRenderer.on('settings:triggers-updated', (_event, triggers) => cb(triggers));
  },
  openExternal: (url) => ipcRenderer.invoke('settings:open-external', url),
});
