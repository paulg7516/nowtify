const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('popoverApi', {
  getState: () => ipcRenderer.invoke('popover:get-state'),
  onState: (cb) => {
    ipcRenderer.on('popover:state', (_event, state) => cb(state));
  },
  openTicket: (url) => ipcRenderer.invoke('popover:open-ticket', url),
  snooze: (minutes) => ipcRenderer.invoke('popover:snooze', minutes),
  pokeEngine: () => ipcRenderer.invoke('popover:poke-engine'),
  openSettings: () => ipcRenderer.invoke('popover:open-settings'),
  getVersion: () => ipcRenderer.invoke('popover:get-version'),
  getEngineHealth: () => ipcRenderer.invoke('popover:get-engine-health'),
});
