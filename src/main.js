const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const Config = require('./core/config');
const detect = require('./core/detect');
const proxy = require('./core/proxy');
const launch = require('./core/launch');

let win = null;
let cfg = null;

const APP_NAME = { en: 'Antigravity Launcher', zh: '反重力代理启动器' };

const emit = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };
// Logs travel as {k, p} so the renderer can translate them — and re-translate
// them if the language changes after they were written.
const log = (level, k, p) => emit('log', { level, k, p, ts: Date.now() });

function resolveTarget() {
  const saved = cfg.data.targetPath && detect.exists(cfg.data.targetPath) ? cfg.data.targetPath : null;
  return saved ? detect.pack(saved, 'saved') : detect.detect();
}

const winState = () => ({
  maximized: win.isMaximized(),
  fullscreen: win.isFullScreen(),
  minimized: win.isMinimized(),
  visible: !win.isMinimized() && win.isVisible() && !win.isDestroyed(),
});

// Windows only lets the process that received the last input event take the
// foreground, so a double-clicked launcher — or the portable build's child
// process, which the stub spawns and never owns — can come up behind. The
// always-on-top toggle is the usual way to claim it without staying on top.
function bringToForeground() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  if (process.platform === 'win32') {
    win.setAlwaysOnTop(true);
    win.setAlwaysOnTop(false);
    win.moveTop();
  }
  win.focus();
}

function createWindow() {
  const isMac = process.platform === 'darwin';
  win = new BrowserWindow({
    width: 1300,
    height: 840,
    minWidth: 900,
    minHeight: 620,
    show: false,
    backgroundColor: '#0a0c0d',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    title: `${APP_NAME.en} · ${APP_NAME.zh}`,
    resizable: true,
    maximizable: true,
    fullscreenable: true,
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
  win.once('ready-to-show', () => {
    win.show();
    bringToForeground();
  });

  const pushState = () => emit('win-state', winState());
  const pushVisible = () => emit('visibility', winState());
  for (const ev of ['minimize', 'restore', 'show', 'hide', 'focus', 'blur']) win.on(ev, pushVisible);
  for (const ev of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) win.on(ev, pushState);

  // F11 toggles fullscreen; the menu bar is absent so nothing else claims it.
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { e.preventDefault(); win.setFullScreen(!win.isFullScreen()); }
  });
}

ipcMain.handle('boot', () => ({
  platform: process.platform,
  appVersion: app.getVersion(),
  config: cfg.data,
  name: APP_NAME,
  state: win ? winState() : { maximized: false, fullscreen: false, minimized: false, visible: true },
}));

ipcMain.handle('probe', async () => {
  const out = { target: null, proxyBest: null, results: [], running: [] };

  out.target = resolveTarget();
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
  const target = resolveTarget();
  if (!target.found) return { ok: false, errKey: 'err.noTarget' };

  const running = launch.listRunning(target.path);
  if (running.length) {
    return { ok: false, needsQuit: true, running, errKey: 'err.stale' };
  }

  const best = await proxy.scan(cfg.data.proxyUrl).then(r => r.best);
  if (!best) return { ok: false, errKey: 'err.noProxy' };

  const res = await launch.launch(best, target.path);
  log(res.spawnError ? 'err' : 'ok', res.spawnError ? 'log.spawnFail' : 'log.launched',
    res.spawnError ? { msg: res.spawnError.message } : { pid: res.pid, ep: launch.redact(best) });
  return { ok: !res.spawnError, pid: res.pid, endpoint: launch.redact(best), kind: best.kind };
});

ipcMain.handle('quit-instances', (e, pids) => {
  launch.killInstances(pids || []);
  log('warn', 'log.killed', { pids: (pids || []).join(', ') });
  return launch.listRunning(resolveTarget().path);
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
  else if (action === 'close') win.close();
  else if (action === 'maximize') {
    if (win.isMaximized()) win.unmaximize(); else win.maximize();
  }
  else if (action === 'fullscreen') win.setFullScreen(!win.isFullScreen());
});

// Without this, a second double-click starts a second instance whose window
// can land behind the first, which reads as "it opened in the background".
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => bringToForeground());
}

app.whenReady().then(() => {
  cfg = new Config(app.getPath('userData'));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else bringToForeground();
  });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
