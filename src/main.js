const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const os = require('os');
const Config = require('./core/config');
const detect = require('./core/detect');
const proxy = require('./core/proxy');
const launch = require('./core/launch');

let win = null;
let cfg = null;
let lastBestProxy = null;
// The desktop client this launcher started: { pid, at, bootAt, verified }.
let launchedDesktop = null;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const bootTime = () => Date.now() - os.uptime() * 1000;

function forgetLaunched() {
  launchedDesktop = null;
  if (cfg.data.launchedDesktop) cfg.set({ launchedDesktop: null });
}

// Is the running client the one this launcher started? A PID on its own is no
// proof — Windows reuses them readily — so a record restored from an earlier
// run is checked against the process's real start time before it is trusted.
// Elsewhere there is no cheap way to read that time, so the check falls back
// to "same boot", which at least rules out everything before a restart.
async function launchedPidAmong(running) {
  const rec = launchedDesktop;
  if (!rec) return null;
  if (!running.some(r => r.pid === rec.pid)) { forgetLaunched(); return null; }
  if (!rec.verified) {
    let mine = false;
    if (process.platform === 'win32') {
      const startedAt = await launch.processStartEpoch(rec.pid);
      mine = launchedDesktop === rec && startedAt !== null && Math.abs(startedAt - rec.at) < 15000;
    } else {
      mine = Math.abs(bootTime() - rec.bootAt) < 3600 * 1000;
    }
    if (!mine) { forgetLaunched(); return null; }
    rec.verified = true;
  }
  return rec.pid;
}

// One snapshot of "what is running", shared by the probe and the status poll
// so overlapping callers never read the process table twice at once.
let statusInFlight = null;
function processStatus() {
  if (!statusInFlight) {
    statusInFlight = (async () => {
      const list = await launch.listProcesses();
      const running = launch.pickRunning(list, resolveTarget().path);
      return {
        running,
        sessions: launch.pickCliSessions(list),
        launchedPid: await launchedPidAmong(running),
      };
    })().finally(() => { statusInFlight = null; });
  }
  return statusInFlight;
}

const APP_NAME = { en: 'Antigravity Launcher', zh: '反重力代理启动器' };

const emit = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };
// Logs travel as {k, p} so the renderer can translate them — and re-translate
// them if the language changes after they were written.
const log = (level, k, p) => emit('log', { level, k, p, ts: Date.now() });

function resolveTarget() {
  const saved = cfg.data.targetPath && detect.exists(cfg.data.targetPath)
    && detect.isTargetCandidate(cfg.data.targetPath) ? cfg.data.targetPath : null;
  return saved ? detect.pack(saved, 'saved') : detect.detect();
}

function resolveCliTarget() {
  const saved = cfg.data.cliPath && detect.exists(cfg.data.cliPath) ? cfg.data.cliPath : null;
  return saved ? detect.packCli(saved, 'saved') : detect.detectCli();
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
  cliTarget: resolveCliTarget(),
  state: win ? winState() : { maximized: false, fullscreen: false, minimized: false, visible: true },
}));

ipcMain.handle('probe', async () => {
  const out = { target: null, cliTarget: null, proxyBest: null, results: [], running: [], cliSessions: [], launchedPid: null };

  out.target = resolveTarget();
  log(out.target.found ? 'ok' : 'warn',
    out.target.found ? 'log.foundTarget' : 'log.noTarget',
    out.target.found ? { path: out.target.path, source: out.target.source } : undefined);

  out.cliTarget = resolveCliTarget();
  log(out.cliTarget.found ? 'ok' : 'warn',
    out.cliTarget.found ? 'log.foundCli' : 'log.noCli',
    out.cliTarget.found ? { path: out.cliTarget.path, source: out.cliTarget.source } : undefined);

  const best = await proxy.scan(cfg.data.proxyUrl, r => {
    emit('probe:candidate', {
      host: r.host, port: r.port, scheme: r.scheme,
      endpoint: `${r.scheme}://${r.host}:${r.port}`,
      origin: r.origin, kind: r.kind, loginOk: r.loginOk, modelOk: r.modelOk, detail: r.detail,
    });
  });
  out.proxyBest = best.best;
  lastBestProxy = best.best;
  out.results = best.results;
  log(best.best ? 'ok' : 'err', best.best ? 'log.proxyOk' : 'log.proxyNone',
    best.best && {
      ep: launch.redact(best.best), kind: best.best.kind,
      model: best.best.modelOk ? 'log.proxyOk.yes' : 'log.proxyOk.no',
    });

  Object.assign(out, await processStatus());
  if (out.launchedPid) {
    log('ok', 'log.runningLaunched', { pid: out.launchedPid });
  } else {
    log(out.running.length ? 'warn' : 'ok', out.running.length ? 'log.running' : 'log.clean',
      out.running.length && { n: out.running.length, pids: out.running.map(r => r.pid).join(', ') });
  }

  return out;
});

// The pre-flight gate runs for both launch targets, so the scan → check →
// report sequence lives here once.
async function runPreflight(best) {
  emit('launch:stage', 'preflight');
  const check = await proxy.checkGoogle(best, {
    onAttempt: a => { if (!a.ok) log('warn', 'log.preflightTry', { n: a.attempt, reason: a.reason }); },
  });
  log(check.ok ? 'ok' : 'err', check.ok ? 'log.preflightOk' : 'log.preflightFail',
    check.ok ? { ep: launch.redact(best), status: check.status, ms: check.ms }
      : { ep: launch.redact(best), reason: check.reason });
  return check.ok;
}

ipcMain.handle('launch', async (e, { targetKind = 'desktop' } = {}) => {
  const cli = targetKind === 'cli';
  const target = cli ? resolveCliTarget() : resolveTarget();
  if (!target.found) return { ok: false, errKey: cli ? 'err.noCli' : 'err.noTarget' };

  // Refusals that need no network come first, so a client that is already up
  // is reported at once instead of after a scan and a Google round trip.
  if (!cli) {
    const running = launch.pickRunning(await launch.listProcesses(), target.path);
    if (running.length) {
      return { ok: false, needsQuit: true, running, launchedPid: await launchedPidAmong(running), errKey: 'err.stale' };
    }
  }

  const best = await proxy.scan(cfg.data.proxyUrl).then(r => r.best);
  if (!best) return { ok: false, errKey: 'err.noProxy' };
  lastBestProxy = best;

  if (cfg.data.preflight) {
    if (!(await runPreflight(best))) return { ok: false, errKey: 'err.googleUnreachable', reason: 'preflight' };
  } else {
    log('sys', 'log.preflightSkip');
  }
  emit('launch:stage', 'spawning');

  if (cli) {
    log('ok', 'log.foundCli', { path: target.path, source: target.source });
    const before = new Set(launch.pickCliSessions(await launch.listProcesses()).map(s => s.pid));
    const res = launch.launchCli(best, target.path, { workDir: cfg.data.workDir });
    log('ok', 'log.launchedCli', { dir: res.dir, ep: launch.redact(best) });
    const { sessions, own } = await waitForNewSession(before);
    if (!own.length) log('warn', 'log.cliNotSeen');
    return { ok: true, cli: true, sessions, own, endpoint: launch.redact(best), kind: best.kind };
  }

  const res = await launch.launch(best, target.path,
    msg => log('sys', 'log.raised', { msg }),
    pid => { launchedDesktop = { pid, at: Date.now(), bootAt: bootTime(), verified: true }; });
  if (res.spawnError) {
    forgetLaunched();
    log('err', 'log.spawnFail', { msg: res.spawnError.message });
    return { ok: false, errKey: 'err.noProxy' };
  }
  if (res.earlyExit) {
    forgetLaunched();
    log('err', 'log.earlyExit', { code: res.earlyExit.code });
    const running = launch.pickRunning(await launch.listProcesses(), target.path);
    return { ok: false, errKey: 'err.earlyExit', earlyExit: res.earlyExit, running };
  }
  log('ok', 'log.launched', { pid: res.pid, ep: launch.redact(best) });
  // Kept across restarts: a launcher reopened later still knows this client is
  // the proxied one, and does not offer to kill it as a stale instance.
  const { pid, at, bootAt } = launchedDesktop;
  cfg.set({ launchedDesktop: { pid, at, bootAt } });
  return {
    ok: true, pid: res.pid, launchedPid: res.pid,
    running: launch.pickRunning(await launch.listProcesses(), target.path),
    endpoint: launch.redact(best), kind: best.kind,
  };
});

// agy comes up a moment after its terminal opens. Wait for the new session so
// CH03 can report it rather than "none running", and say which process it is
// so the bar can follow that session and not some other agy the user runs.
async function waitForNewSession(before) {
  let own = [];
  for (let i = 0; i < 15 && !own.length; i++) {
    await sleep(400);
    own = launch.pickCliSessions(await launch.listProcesses()).filter(s => !before.has(s.pid));
  }
  return { sessions: launch.pickCliSessions(await launch.listProcesses()), own: own.map(s => s.pid) };
}

ipcMain.handle('status', () => processStatus());

ipcMain.handle('quit-instances', async (e, pids) => {
  launch.killInstances(pids || []);
  log('warn', 'log.killed', { pids: (pids || []).join(', ') });
  await sleep(500);
  return (await processStatus()).running;
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

ipcMain.handle('choose-work-dir', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Select Working Directory / 选择工作目录',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: cfg.data.workDir || app.getPath('home'),
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const chosen = r.filePaths[0];
  cfg.set({ workDir: chosen });
  log('ok', 'log.workDirSet', { path: chosen });
  return chosen;
});

ipcMain.handle('open-terminal', async (e, { type }) => {
  let best = lastBestProxy;
  if (!best) {
    const scanRes = await proxy.scan(cfg.data.proxyUrl);
    best = scanRes.best;
    lastBestProxy = best;
  }
  const res = launch.openTerminal({
    type: type || 'powershell',
    workDir: cfg.data.workDir,
    ep: best,
  });
  log('ok', 'log.terminalOpened', {
    type: (type || 'powershell').toUpperCase(),
    dir: res.dir,
    ep: best ? launch.redact(best) : 'DIRECT',
  });
  return res;
});

ipcMain.handle('diagnose-network', async () => {
  let best = lastBestProxy;
  if (!best) {
    const scanRes = await proxy.scan(cfg.data.proxyUrl);
    best = scanRes.best;
    lastBestProxy = best;
  }
  const [pings, ipInfo] = await Promise.all([
    proxy.pingTargets(best),
    proxy.fetchIpInfo(best),
  ]);

  if (ipInfo.direct) {
    log('ok', 'log.directIp', { ip: ipInfo.direct.ip, country: ipInfo.direct.country || '' });
  }
  if (ipInfo.proxy) {
    log('ok', 'log.proxyIp', { ip: ipInfo.proxy.ip, country: ipInfo.proxy.country || '' });
  }
  for (const p of pings) {
    if (p.ok) {
      log('ok', 'log.pingOk', { label: p.label, rtt: `${p.rtt}ms` });
    } else {
      log('warn', 'log.pingFail', { label: p.label, reason: p.reason });
    }
  }

  return { pings, ipInfo, proxy: best };
});

ipcMain.handle('get-proxy-commands', async () => {
  let best = lastBestProxy;
  if (!best) {
    const scanRes = await proxy.scan(cfg.data.proxyUrl);
    best = scanRes.best;
    lastBestProxy = best;
  }
  return launch.buildProxyCommands(best);
});

ipcMain.handle('set-proxy', (e, url) => {
  cfg.set({ proxyUrl: url || null });
  lastBestProxy = null;
  log('ok', url ? 'log.manualProxy' : 'log.clearedProxy', url && { url });
  return cfg.data;
});

ipcMain.handle('choose-cli', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'agy executable',
    properties: ['openFile'],
    filters: process.platform === 'win32'
      ? [{ name: 'agy.exe', extensions: ['exe'] }]
      : [{ name: 'All files', extensions: ['*'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  cfg.set({ cliPath: r.filePaths[0] });
  log('ok', 'log.manualCli', { path: r.filePaths[0] });
  return r.filePaths[0];
});

ipcMain.handle('set-preflight', (e, on) => {
  cfg.set({ preflight: !!on });
  log('ok', on ? 'log.preflightOn' : 'log.preflightOff');
  return cfg.data.preflight;
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
  // A client left running by an earlier launcher run: trusted only after its
  // start time is checked, which launchedPidAmong does on first sight.
  const saved = cfg.data.launchedDesktop;
  launchedDesktop = saved && Number.isInteger(saved.pid) ? { ...saved, verified: false } : null;
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else bringToForeground();
  });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
