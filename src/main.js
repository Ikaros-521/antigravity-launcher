const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const Config = require('./core/config');
const detect = require('./core/detect');
const proxy = require('./core/proxy');
const launch = require('./core/launch');

let win = null;
let cfg = null;

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
}

const emit = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };

function log(level, text) {
  emit('log', { level, text, ts: Date.now() });
}

ipcMain.handle('boot', () => ({
  platform: process.platform,
  appVersion: app.getVersion(),
  config: cfg.data,
  home: app.getPath('home'),
}));

ipcMain.handle('probe', async () => {
  const out = { target: null, proxyBest: null, results: [], running: [] };

  const manualTarget = cfg.data.targetPath && detect.exists(cfg.data.targetPath) ? cfg.data.targetPath : null;
  out.target = manualTarget ? detect.pack(manualTarget, 'saved') : detect.detect();
  log(out.target.found ? 'ok' : 'warn',
    out.target.found
      ? `CH02 已定位 ${out.target.path}（${out.target.source}）`
      : 'CH02 未找到 Antigravity，请手动指定');

  emit('probe:phase', 'proxy');
  const best = await proxy.scan(cfg.data.proxyUrl, r => {
    emit('probe:candidate', {
      endpoint: `${r.scheme}://${r.host}:${r.port}`,
      origin: r.origin, kind: r.kind, loginOk: r.loginOk, modelOk: r.modelOk, detail: r.detail,
    });
  });
  out.proxyBest = best.best;
  out.results = best.results;
  log(best.best ? 'ok' : 'err',
    best.best
      ? `CH01 代理可用：${launch.redact(best.best)}（类型 ${best.best.kind}，登录端点已验证，模型端点${best.best.modelOk ? '已验证' : '未验证'}）`
      : 'CH01 没有任何候选端口通过 CONNECT / SOCKS5 握手');

  out.running = launch.listRunning(out.target.path);
  if (out.running.length) log('warn', `CH03 检测到 ${out.running.length} 个未注入代理的实例：PID ${out.running.map(r => r.pid).join(', ')}`);
  else log('ok', 'CH03 无残留实例，可以干净启动');

  cfg.set({ lastProbe: { at: Date.now(), best: out.proxyBest && { host: out.proxyBest.host, port: out.proxyBest.port, kind: out.proxyBest.kind } } });
  return out;
});

ipcMain.handle('launch', async () => {
  const target = cfg.data.targetPath && detect.exists(cfg.data.targetPath)
    ? detect.pack(cfg.data.targetPath, 'saved')
    : detect.detect();
  if (!target.found) return { ok: false, error: '未定位到 Antigravity 可执行文件' };

  const running = launch.listRunning(target.path);
  if (running.length) {
    return { ok: false, needsQuit: true, running, error: '必须先完全退出旧实例，环境变量无法注入已运行的进程' };
  }

  const best = await proxy.scan(cfg.data.proxyUrl).then(r => r.best);
  if (!best) return { ok: false, error: '没有可用的本地代理端点' };

  const res = launch.launch(best, target.path);
  log(res.spawnError ? 'err' : 'ok',
    res.spawnError ? `启动失败：${res.spawnError.message}` : `已启动 PID ${res.pid}，注入 ${launch.redact(best)}`);
  return { ok: !res.spawnError, pid: res.pid, endpoint: launch.redact(best), kind: best.kind };
});

ipcMain.handle('quit-instances', (e, pids) => {
  launch.killInstances(pids || []);
  log('warn', `已终止残留实例 PID ${(pids || []).join(', ')}`);
  return launch.listRunning(null);
});

ipcMain.handle('choose-target', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: '选择 Antigravity 可执行文件',
    properties: ['openFile'],
    filters: process.platform === 'win32'
      ? [{ name: 'Antigravity.exe', extensions: ['exe'] }]
      : [{ name: 'All files', extensions: ['*'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  cfg.set({ targetPath: r.filePaths[0] });
  log('ok', `CH02 手动指定：${r.filePaths[0]}`);
  return r.filePaths[0];
});

ipcMain.handle('set-proxy', (e, url) => {
  cfg.set({ proxyUrl: url || null });
  log('ok', url ? `CH01 手动指定代理：${url}` : 'CH01 已清除手动代理，恢复自动探测');
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
