const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('popoverApi', {
  getState: () => ipcRenderer.invoke('popover:get-state'),
  onState: (cb) => {
    ipcRenderer.on('popover:state', (_event, state) => cb(state));
  },
  openTicket: (url) => ipcRenderer.invoke('popover:open-ticket', url),
  dismissAlert: (ticketKey, conditionId) =>
    ipcRenderer.invoke('popover:dismiss-alert', { ticketKey, conditionId }),
  undismissAlert: (ticketKey, conditionId) =>
    ipcRenderer.invoke('popover:undismiss-alert', { ticketKey, conditionId }),
  snooze: (minutes) => ipcRenderer.invoke('popover:snooze', minutes),
  clearDismissals: () => ipcRenderer.invoke('popover:clear-dismissals'),
  pokeEngine: () => ipcRenderer.invoke('popover:poke-engine'),
});
