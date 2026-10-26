const { contextBridge, ipcRenderer } = require('electron');

const on = (channel, fn) => {
  const listener = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('launcher', {
  boot: () => ipcRenderer.invoke('boot'),
  probe: () => ipcRenderer.invoke('probe'),
  launch: () => ipcRenderer.invoke('launch'),
  quitInstances: pids => ipcRenderer.invoke('quit-instances', pids),
  chooseTarget: () => ipcRenderer.invoke('choose-target'),
  setProxy: url => ipcRenderer.invoke('set-proxy', url),
  openExternal: url => ipcRenderer.invoke('open-external', url),
  win: action => ipcRenderer.send('win', action),
  onLog: fn => on('log', fn),
  onCandidate: fn => on('probe:candidate', fn),
  onPhase: fn => on('probe:phase', fn),
});
