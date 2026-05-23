const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayApi', {
  onState: (cb) => {
    ipcRenderer.on('overlay:state', (_event, state) => cb(state));
  },
  onResolved: (cb) => {
    ipcRenderer.on('overlay:resolved', (_event, payload) => cb(payload));
  },
  requestInitialState: () => ipcRenderer.invoke('overlay:get-state'),
});
