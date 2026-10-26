const { contextBridge, ipcRenderer } = require('electron');

const on = (channel, fn) => {
  const listener = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('launcher', {
  boot: () => ipcRenderer.invoke('boot'),
  probe: () => ipcRenderer.invoke('probe'),
  diagnoseNetwork: () => ipcRenderer.invoke('diagnose-network'),
  launch: () => ipcRenderer.invoke('launch'),
  quitInstances: pids => ipcRenderer.invoke('quit-instances', pids),
  chooseTarget: () => ipcRenderer.invoke('choose-target'),
  chooseWorkDir: () => ipcRenderer.invoke('choose-work-dir'),
  openTerminal: type => ipcRenderer.invoke('open-terminal', { type }),
  getProxyCommands: () => ipcRenderer.invoke('get-proxy-commands'),
  setProxy: url => ipcRenderer.invoke('set-proxy', url),
  openExternal: url => ipcRenderer.invoke('open-external', url),
  win: action => ipcRenderer.send('win', action),
  onLog: fn => on('log', fn),
  onCandidate: fn => on('probe:candidate', fn),
  onVisibility: fn => on('visibility', fn),
  onWinState: fn => on('win-state', fn),
});
