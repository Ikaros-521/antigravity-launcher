const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const Config = require('./core/config');
const detect = require('./core/detect');
const proxy = require('./core/proxy');
const launch = require('./core/launch');

let win = null;
let cfg = null;

const emit = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };
// Logs travel as {k, p} so the renderer can translate them — and re-translate
// them if the language changes after they were written.
const log = (level, k, p) => emit('log', { level, k, p, ts: Date.now() });

function createWindow() {
  const isMac = process.platform === 'darwin';
  win = new BrowserWindow({
    width: 1300,
    height: 840,
    minWidth: 900,
    minHeight: 620,
    show: false,
    backgroundColor: '#0a0c0d',
    title: 'Antigravity Launcher',
    ...(isMac
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 20, y: 20 } }
      : { frame: false }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  const pushVisible = () => emit('visibility', { visible: !win.isMinimized() && win.isVisible() && !win.isDestroyed() });
  for (const ev of ['minimize', 'restore', 'show', 'hide', 'focus', 'blur']) win.on(ev, pushVisible);
}

ipcMain.handle('boot', () => ({
  platform: process.platform,
  appVersion: app.getVersion(),
  config: cfg.data,
}));

ipcMain.handle('probe', async () => {
  const out = { target: null, proxyBest: null, results: [], running: [] };

  const saved = cfg.data.targetPath && detect.exists(cfg.data.targetPath) ? cfg.data.targetPath : null;
  out.target = saved ? detect.pack(saved, 'saved') : detect.detect();
  log(out.target.found ? 'ok' : 'warn',
    out.target.found ? 'log.foundTarget' : 'log.noTarget',
    out.target.found ? { path: out.target.path, source: out.target.source } : undefined);

  const best = await proxy.scan(cfg.data.proxyUrl, r => {
    emit('probe:candidate', {
      host: r.host, port: r.port, scheme: r.scheme,
      endpoint: `${r.scheme}://${r.host}:${r.port}`,
      origin: r.origin, kind: r.kind, loginOk: r.loginOk, modelOk: r.modelOk, detail: r.detail,
    });
  });
  out.proxyBest = best.best;
  out.results = best.results;
  log(best.best ? 'ok' : 'err', best.best ? 'log.proxyOk' : 'log.proxyNone',
    best.best && {
      ep: launch.redact(best.best), kind: best.best.kind,
      model: best.best.modelOk ? 'log.proxyOk.yes' : 'log.proxyOk.no',
    });

  out.running = launch.listRunning(out.target.path);
  log(out.running.length ? 'warn' : 'ok', out.running.length ? 'log.running' : 'log.clean',
    out.running.length && { n: out.running.length, pids: out.running.map(r => r.pid).join(', ') });

  return out;
});

ipcMain.handle('launch', async () => {
  const saved = cfg.data.targetPath && detect.exists(cfg.data.targetPath) ? cfg.data.targetPath : null;
  const target = saved ? detect.pack(saved, 'saved') : detect.detect();
  if (!target.found) return { ok: false, errKey: 'err.noTarget' };

  const running = launch.listRunning(target.path);
  if (running.length) {
    return { ok: false, needsQuit: true, running, errKey: 'err.stale' };
  }

  const best = await proxy.scan(cfg.data.proxyUrl).then(r => r.best);
  if (!best) return { ok: false, errKey: 'err.noProxy' };

  const res = launch.launch(best, target.path);
  log(res.spawnError ? 'err' : 'ok', res.spawnError ? 'log.spawnFail' : 'log.launched',
    res.spawnError ? { msg: res.spawnError.message } : { pid: res.pid, ep: launch.redact(best) });
  return { ok: !res.spawnError, pid: res.pid, endpoint: launch.redact(best), kind: best.kind };
});

ipcMain.handle('quit-instances', (e, pids) => {
  launch.killInstances(pids || []);
  log('warn', 'log.killed', { pids: (pids || []).join(', ') });
  return launch.listRunning(null);
});

ipcMain.handle('choose-target', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Antigravity executable',
    properties: ['openFile'],
    filters: process.platform === 'win32'
      ? [{ name: 'Antigravity.exe', extensions: ['exe'] }]
      : [{ name: 'All files', extensions: ['*'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  cfg.set({ targetPath: r.filePaths[0] });
  log('ok', 'log.manualTarget', { path: r.filePaths[0] });
  return r.filePaths[0];
});

ipcMain.handle('set-proxy', (e, url) => {
  cfg.set({ proxyUrl: url || null });
  log('ok', url ? 'log.manualProxy' : 'log.clearedProxy', url && { url });
  return cfg.data;
});

ipcMain.handle('open-external', (e, url) => {
  if (/^https?:\/\//.test(url)) shell.openExternal(url);
});

ipcMain.on('win', (e, action) => {
  if (!win) return;
  if (action === 'minimize') win.minimize();
  if (action === 'close') win.close();
});

app.whenReady().then(() => {
  cfg = new Config(app.getPath('userData'));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
