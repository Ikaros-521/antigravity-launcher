const $ = id => document.getElementById(id);
const t = (k, p) => window.I18N.t(k, p);
const tunnel = document.querySelector('.tunnel');

const els = {
  root: document.documentElement,
  osChip: $('osChip'), revChip: $('revChip'), langSeg: $('langSeg'), themeSeg: $('themeSeg'),
  nodeLocal: $('nodeLocal'), nodeProxy: $('nodeProxy'),
  localIpReadout: $('localIpReadout'),
  proxyReadout: $('proxyReadout'), proxyKindReadout: $('proxyKindReadout'),
  laneLogin: $('laneLogin'), laneGithub: $('laneGithub'), laneCloudflare: $('laneCloudflare'), laneModel: $('laneModel'),
  rttGoogle: $('rttGoogle'), rttGithub: $('rttGithub'), rttCloudflare: $('rttCloudflare'),
  btnToggleIp: $('btnToggleIp'), btnDiagnose: $('btnDiagnose'),
  ch01: $('ch01'), ch01Value: $('ch01Value'), ch01Meta: $('ch01Meta'),
  ch02: $('ch02'), ch02Value: $('ch02Value'), ch02Meta: $('ch02Meta'),
  ch03: $('ch03'), ch03Value: $('ch03Value'), ch03Meta: $('ch03Meta'),
  btnChoose: $('btnChoose'), btnChooseCli: $('btnChooseCli'), targetSeg: $('targetSeg'),
  btnKill: $('btnKill'), btnProxyManual: $('btnProxyManual'),
  copyBar: $('copyBar'),
  proxyForm: $('proxyForm'), proxyInput: $('proxyInput'),
  proxyApply: $('proxyApply'), proxyClear: $('proxyClear'),
  launchBar: $('launchBar'), lbKey: $('lbKey'), lbCn: $('lbCn'), lbTarget: $('lbTarget'),
  preflightToggle: $('preflightToggle'),
  consoleBody: $('consoleBody'), envGrid: $('envGrid'),
  plateCn: $('plateCn'), btnMax: $('btnMax'), btnFull: $('btnFull'),
};

let appName = { en: 'Antigravity Launcher', zh: '反重力代理启动器' };

const EYE_ICONS = {
  show: `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
  hide: `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`,
};

function maskIp(ip) {
  if (!ip) return '—';
  const parts = String(ip).trim().split('.');
  if (parts.length === 4) {
    return `${parts[0]}.***.***.${parts[3]}`;
  }
  return ip.length > 7 ? `${ip.slice(0, 3)}****${ip.slice(-3)}` : '****';
}

/* Two parallel launch targets, desktop client and terminal CLI. CH01 (the
   proxy endpoint) is a fact about the machine and shared by both; everything
   else — binary, process tree, launch state — is per target, so each side can
   be started and relaunched without disturbing the other. */
const idleBar = { phase: 'idle', params: {} };
const state = {
  platform: 'win32',
  best: null,
  profiles: {
    desktop: { target: null, running: [], launchedPid: null, bar: { ...idleBar, params: {} } },
    cli: { target: null, sessions: [], own: [], bar: { ...idleBar, params: {} } },
  },
  tab: 'desktop',
  ipInfo: { direct: null, proxy: null },
  pings: [],
  diagnosing: false,
  ipMasked: localStorage.getItem('agy.ipMasked') !== 'false', // 默认隐藏，防截图泄露
  probing: false,
  logs: [],
};
const cur = () => state.profiles[state.tab];
let statusBusy = false;

const OS_LABEL = { win32: 'WINDOWS', darwin: 'MACOS', linux: 'LINUX' };
const url = ep => ep && `${ep.scheme}://${ep.host}:${ep.port}`;

/* --- theme & language ---------------------------------------------------- */

const THEME_KEY = 'agy.theme';
function applyTheme(mode) {
  els.root.dataset.theme = mode;
  localStorage.setItem(THEME_KEY, mode);
  els.themeSeg.querySelectorAll('button').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.theme === mode)));
}
function applyLang(lang) {
  window.I18N.setLang(lang);
  document.body.classList.toggle('lang-zh', lang === 'zh');
  window.I18N.applyStatic(document);
  els.langSeg.querySelectorAll('button').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
  repaint();
}
els.themeSeg.addEventListener('click', e => {
  const b = e.target.closest('button[data-theme]');
  if (b) applyTheme(b.dataset.theme);
});
els.langSeg.addEventListener('click', e => {
  const b = e.target.closest('button[data-lang]');
  if (b) applyLang(b.dataset.lang);
});

/* --- spotlight tracking --------------------------------------------------- */

let rafId = null;
const pending = new Map();
function flushSpotlight() {
  rafId = null;
  for (const [el, ev] of pending) {
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${Math.round(ev.clientX - r.left)}px`);
    el.style.setProperty('--my', `${Math.round(ev.clientY - r.top)}px`);
  }
  pending.clear();
}
function trackSpotlight(e) {
  if (paused) return;
  pending.set(e.currentTarget, e);
  if (rafId === null) rafId = requestAnimationFrame(flushSpotlight);
}
for (const el of document.querySelectorAll('.glass')) el.addEventListener('pointermove', trackSpotlight);

/* --- window chrome -------------------------------------------------------- */

let winFlags = { maximized: false, fullscreen: false };
function applyWinState(s) {
  winFlags = { maximized: !!s.maximized, fullscreen: !!s.fullscreen };
  els.btnMax.textContent = winFlags.maximized ? '❏' : '▢';
  els.btnMax.title = t(winFlags.maximized ? 'win.restore' : 'win.max');
  els.btnFull.textContent = winFlags.fullscreen ? '⤡' : '⤢';
  els.btnFull.title = t(winFlags.fullscreen ? 'win.unfull' : 'win.full');
  els.btnFull.classList.toggle('on', winFlags.fullscreen);
  els.btnMax.classList.toggle('on', winFlags.maximized);
}
window.launcher.onWinState(applyWinState);

/* --- cost control while hidden -------------------------------------------- */

let paused = false;
function setPaused(v) {
  const next = !!v;
  if (next === paused) return;
  paused = next;
  els.root.classList.toggle('paused', paused);
  if (paused) {
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    pending.clear();
  } else {
    refreshStatus(); // a hidden window skips the poll, so catch up on return
  }
}
window.launcher.onVisibility(({ visible }) => setPaused(!visible));
document.addEventListener('visibilitychange', () => setPaused(document.hidden));

/* --- console -------------------------------------------------------------- */

function stamp(ts) {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function pushLog(level, k, p) {
  state.logs.push({ level, k, p, ts: Date.now() });
  if (state.logs.length > 400) state.logs.splice(0, state.logs.length - 400);
  appendLogLine(state.logs[state.logs.length - 1]);
  els.consoleBody.scrollTop = els.consoleBody.scrollHeight;
}

function appendLogLine(entry) {
  const row = document.createElement('div');
  row.className = 'line';
  row.dataset.lvl = entry.level;
  const time = document.createElement('time');
  time.textContent = stamp(entry.ts);
  const msg = document.createElement('span');
  msg.className = 'msg';
  msg.textContent = t(entry.k, entry.p);
  row.append(time, msg);
  els.consoleBody.appendChild(row);
}

function repaintLogs() {
  els.consoleBody.replaceChildren();
  state.logs.forEach(appendLogLine);
  els.consoleBody.scrollTop = els.consoleBody.scrollHeight;
}

window.launcher.onLog(e => pushLog(e.level, e.k, e.p));

/* --- painting ------------------------------------------------------------- */

function setState(el, s) { if (el) el.dataset.state = s; }

function renderBar() {
  const { phase, params } = cur().bar;
  const cli = state.tab === 'cli';
  const map = {
    idle: ['idle', 'idle.key', 'idle.cn', 'idle.target'],
    probing: ['probing', 'scanning.key', 'scanning.cn', 'scanning.target'],
    armed: ['armed', 'armed.key', 'armed.cn', null],
    launching: ['probing', 'launching.key', cli ? 'launching.cli.cn' : 'launching.cn', null],
    launched: ['ok', 'launched.key', cli ? 'launched.cli.cn' : 'launched.cn', null],
    stale: ['blocked', 'stale.key', 'stale.cn', null],
    noproxy: ['blocked', 'noproxy.key', 'noproxy.cn', null],
    failed: ['blocked', 'failed.key', 'failed.cn', null],
  };
  const [ds, kKey, kCn, kTarget] = map[phase] || map.idle;
  setState(els.launchBar, ds);
  els.lbKey.textContent = t(kKey);
  els.lbCn.textContent = t(kCn) + (phase === 'launched' && !cli && params.pid ? ` PID ${params.pid}` : '');
  els.lbTarget.textContent = kTarget ? t(kTarget) : (params.target || '');
}

function renderProxy() {
  const b = state.best;
  if (state.probing) {
    setState(els.ch01, 'scan');
    els.ch01Value.textContent = t('ch01.probing');
    els.ch01Meta.textContent = t('ch01.probeMeta');
    return;
  }
  if (!b) {
    setState(els.ch01, 'fail');
    els.ch01Value.textContent = t('ch01.none');
    els.ch01Meta.textContent = t('ch01.noneMeta');
    return;
  }
  setState(els.ch01, 'ok');
  els.ch01Value.textContent = url(b);
  els.ch01Meta.textContent = t('ch01.okMeta', { kind: b.kind, origin: b.origin });
}

function renderTarget() {
  const tg = cur().target;
  const cli = state.tab === 'cli';
  // The card's buttons follow the tab: each target picks its own binary.
  els.btnChoose.hidden = cli;
  els.btnChooseCli.hidden = !cli;
  if (!tg) { setState(els.ch02, 'idle'); els.ch02Value.textContent = t('ch02.searching'); return; }
  if (!tg.found) {
    setState(els.ch02, 'fail');
    els.ch02Value.textContent = cli ? t('ch02.cliNone') : t('ch02.none');
    els.ch02Meta.textContent = cli ? t('ch02.cliNoneMeta') : t('ch02.noneMeta');
    return;
  }
  setState(els.ch02, 'ok');
  els.ch02Value.textContent = tg.path;
  els.ch02Meta.textContent = cli
    ? t('ch02.cliOkMeta', { source: tg.source })
    : t(tg.languageServer ? 'ch02.okMetaLs' : 'ch02.okMetaNoLs', { source: tg.source });
}

function renderRunning() {
  const p = cur();
  els.btnKill.hidden = true;
  if (p.bar.phase === 'launching') {
    setState(els.ch03, 'scan');
    els.ch03Value.textContent = t('ch03.starting');
    els.ch03Meta.textContent = '';
    return;
  }
  // The CLI tab shows sessions as information: they live in the user's own
  // terminals, so there is nothing stale to quit and nothing blocking launch.
  if (state.tab === 'cli') {
    const list = p.sessions || [];
    setState(els.ch03, 'ok');
    els.ch03Value.textContent = list.length
      ? t('ch03.cliSessions', { n: list.length, pids: list.map(r => r.pid).join(', ') })
      : t('ch03.cliClean');
    els.ch03Meta.textContent = t('ch03.cliCleanMeta');
    return;
  }
  const list = p.running;
  if (!list.length) {
    setState(els.ch03, 'ok');
    els.ch03Value.textContent = t('ch03.clean');
    els.ch03Meta.textContent = t('ch03.cleanMeta');
    return;
  }
  // Started through this launcher, so it already carries the proxy env.
  if (list.some(r => r.pid === p.launchedPid)) {
    setState(els.ch03, 'ok');
    els.ch03Value.textContent = t('ch03.launched', { pid: p.launchedPid });
    els.ch03Meta.textContent = t('ch03.launchedMeta');
    return;
  }
  setState(els.ch03, 'fail');
  els.btnKill.hidden = false;
  els.ch03Value.textContent = t('ch03.stale', { n: list.length, pids: list.map(r => r.pid).join(', ') });
  els.ch03Meta.textContent = t('ch03.staleMeta');
}

const epLabel = () => state.best ? `${url(state.best)} · ${state.best.kind}` : '';
const readyBar = () => state.best
  ? { phase: 'armed', params: { target: `:${state.best.port} ${state.best.kind}` } }
  : { phase: 'noproxy', params: {} };
function launchedBar(kind) {
  return kind === 'desktop'
    ? { phase: 'launched', params: { pid: state.profiles.desktop.launchedPid, target: epLabel() } }
    : { phase: 'launched', params: { target: `${epLabel()} · ${t('launched.cli.dir')}` } };
}

// The launch bar follows what is actually up: a target that is running reads
// as launched, and once it is gone the bar goes back to ready.
function settleProfile(kind) {
  const p = state.profiles[kind];
  if (p.bar.phase === 'launching') return;
  // For the CLI only the session this launcher opened counts: agy sessions
  // the user starts in their own terminals say nothing about the launch bar.
  const up = kind === 'cli' ? p.own.length > 0 : !!p.launchedPid;
  if (up) { p.bar = launchedBar(kind); return; }
  const blocked = kind === 'cli' ? false : p.running.length > 0;
  if (p.bar.phase === 'launched' || (p.bar.phase === 'stale' && !blocked)) p.bar = readyBar();
}

// What is running changes without the user touching this window — they close
// Antigravity, end an agy session — so CH03 is repainted from a fresh reading
// of the process table rather than from what the launcher last started.
function applyStatus(s, render = true) {
  const d = state.profiles.desktop;
  d.running = s.running || [];
  d.launchedPid = s.launchedPid || null;
  const c = state.profiles.cli;
  c.sessions = s.sessions || [];
  c.own = c.own.filter(pid => c.sessions.some(r => r.pid === pid));
  settleProfile('desktop'); settleProfile('cli');
  if (render) { renderRunning(); renderBar(); }
}

async function refreshStatus() {
  if (statusBusy || state.probing) return;
  statusBusy = true;
  try { applyStatus(await window.launcher.status()); }
  catch (e) { console.error('Status failed:', e); }
  finally { statusBusy = false; }
}

function syncTargetSeg() {
  els.targetSeg.querySelectorAll('[data-target]').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.target === state.tab)));
}

function renderTunnel() {
  const b = state.best;
  tunnel.classList.toggle('scanning', state.probing || state.diagnosing);
  tunnel.classList.toggle('live', !!b && !state.probing);
  setState(els.nodeLocal, state.probing ? 'scan' : 'live');

  // Eye toggle button icon
  if (els.btnToggleIp) {
    els.btnToggleIp.innerHTML = state.ipMasked ? EYE_ICONS.hide : EYE_ICONS.show;
    els.btnToggleIp.classList.toggle('on', !state.ipMasked);
  }

  // Direct IP display
  if (state.ipInfo && state.ipInfo.direct) {
    const d = state.ipInfo.direct;
    const ipStr = state.ipMasked ? maskIp(d.ip) : d.ip;
    els.localIpReadout.textContent = `${ipStr} · ${d.city || d.country || ''}`;
  } else {
    els.localIpReadout.textContent = '127.0.0.1';
  }

  if (!b) {
    setState(els.nodeProxy, state.probing ? 'scan' : 'dead');
    els.proxyKindReadout.textContent = state.probing ? t('node.proxyIdle') : '—';
    if (!state.probing) els.proxyReadout.textContent = ':—';
    setState(els.laneLogin, 'idle');
    setState(els.laneGithub, 'idle');
    setState(els.laneCloudflare, 'idle');
    setState(els.laneModel, 'idle');
    return;
  }

  setState(els.nodeProxy, 'live');
  els.proxyReadout.textContent = `:${b.port}`;

  // Proxy IP display
  if (state.ipInfo && state.ipInfo.proxy) {
    const p = state.ipInfo.proxy;
    const ipStr = state.ipMasked ? maskIp(p.ip) : p.ip;
    els.proxyKindReadout.textContent = `${b.kind.toUpperCase()} · ${ipStr} (${p.country || ''})`;
  } else {
    els.proxyKindReadout.textContent = b.kind.toUpperCase();
  }

  // Pings & Lanes
  setState(els.laneLogin, 'open');
  setState(els.laneGithub, 'open');
  setState(els.laneCloudflare, 'open');
  setState(els.laneModel, b.modelOk ? 'open' : 'blocked');

  if (state.pings && state.pings.length) {
    const g = state.pings.find(x => x.id === 'google');
    const gh = state.pings.find(x => x.id === 'github');
    const cf = state.pings.find(x => x.id === 'cloudflare');
    if (g && els.rttGoogle) els.rttGoogle.textContent = g.ok ? `${g.rtt}ms` : 'FAIL';
    if (gh && els.rttGithub) els.rttGithub.textContent = gh.ok ? `${gh.rtt}ms` : 'FAIL';
    if (cf && els.rttCloudflare) els.rttCloudflare.textContent = cf.ok ? `${cf.rtt}ms` : 'FAIL';
  }
}

function renderEnv() {
  const b = state.best;
  const http = b && `http://${b.host}:${b.port}`;
  const socks = b && `socks5://${b.host}:${b.port}`;
  const noProxy = state.noProxy || 'localhost,127.0.0.1,::1';
  const rows = [
    ['HTTPS_PROXY', http], ['HTTP_PROXY', http], ['ALL_PROXY', socks],
    ['https_proxy', http], ['http_proxy', http], ['all_proxy', socks],
    ['NO_PROXY', noProxy], ['no_proxy', noProxy],
  ];
  els.envGrid.replaceChildren(...rows.map(([k, v]) => {
    const cell = document.createElement('div');
    cell.className = 'env-cell' + (v ? '' : ' off');
    const key = document.createElement('b');
    key.textContent = k;
    const val = document.createElement('span');
    val.textContent = v || '—';
    cell.append(key, val);
    return cell;
  }));
}

/* --- adaptive buttons (system-aware tools) -------------------------------- */

function renderAdaptiveButtons() {
  const isWin = state.platform === 'win32';

  // 复制与快捷操作工具条 (自适应)
  els.copyBar.replaceChildren();

  const createActionBtn = (labelKey, tipKey, onClick, extraClass = '') => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-copy ' + extraClass;
    btn.textContent = t(labelKey);
    btn.title = t(tipKey);
    btn.onclick = onClick;
    return btn;
  };

  const createCopyBtn = (labelKey, tipKey, commandGetter, typeDesc) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-copy';
    btn.textContent = t(labelKey);
    btn.title = t(tipKey);
    btn.onclick = async () => {
      const cmds = await window.launcher.getProxyCommands();
      const text = commandGetter(cmds);
      await copyText(text, btn, typeDesc);
    };
    return btn;
  };

  if (isWin) {
    // 快捷打开已注入代理的终端
    els.copyBar.appendChild(createActionBtn('openPwsh', 'tip.openPwsh', () => window.launcher.openTerminal('powershell'), 'btn-action'));
    els.copyBar.appendChild(createActionBtn('openCmd', 'tip.openCmd', () => window.launcher.openTerminal('cmd'), 'btn-action'));

    // 复制命令
    els.copyBar.appendChild(createCopyBtn('copyPwsh', 'tip.copyPwsh', c => c.powershell, 'PowerShell'));
    els.copyBar.appendChild(createCopyBtn('copyCmd', 'tip.copyCmd', c => c.cmd, 'CMD'));
    els.copyBar.appendChild(createCopyBtn('copyGit', 'tip.copyGit', c => c.git, 'Git'));
    els.copyBar.appendChild(createCopyBtn('copyGitUnset', 'tip.copyGitUnset', c => c.gitUnset, 'Git Unset'));
    els.copyBar.appendChild(createCopyBtn('copySysProxy', 'tip.copySysProxy', c => c.sysProxy, 'System Proxy'));
    els.copyBar.appendChild(createCopyBtn('copySysProxyUnset', 'tip.copySysProxyUnset', c => c.sysProxyUnset, 'Unset System Proxy'));
    els.copyBar.appendChild(createCopyBtn('copyLaunchTerm', 'tip.copyLaunchTerm', c => c.launchTerminalCmd, 'Launch Terminal Command'));
  } else {
    // 快捷打开已注入代理的终端
    els.copyBar.appendChild(createActionBtn('openTerminalApp', 'tip.openTerminalApp', () => window.launcher.openTerminal('terminal'), 'btn-action'));

    // 复制命令
    els.copyBar.appendChild(createCopyBtn('copyShell', 'tip.copyShell', c => c.shell, 'Shell export'));
    els.copyBar.appendChild(createCopyBtn('copyGit', 'tip.copyGit', c => c.git, 'Git'));
    els.copyBar.appendChild(createCopyBtn('copyGitUnset', 'tip.copyGitUnset', c => c.gitUnset, 'Git Unset'));
    els.copyBar.appendChild(createCopyBtn('copySysProxy', 'tip.copySysProxy', c => c.sysProxy, 'System Proxy'));
    els.copyBar.appendChild(createCopyBtn('copySysProxyUnset', 'tip.copySysProxyUnset', c => c.sysProxyUnset, 'Unset System Proxy'));
    els.copyBar.appendChild(createCopyBtn('copyLaunchTerm', 'tip.copyLaunchTerm', c => c.launchTerminalCmd, 'Launch Terminal Command'));
  }
}

function repaint() {
  renderTunnel(); renderProxy(); renderTarget(); renderRunning(); syncTargetSeg(); renderBar(); renderEnv();
  renderAdaptiveButtons();
  applyWinState(winFlags);
  repaintLogs();
}

/* --- copy helpers --------------------------------------------------------- */

async function copyText(text, btn, typeName) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    pushLog('ok', 'log.copied', { type: typeName });
    const originalText = btn.textContent;
    btn.textContent = t('copied');
    btn.classList.add('on');
    setTimeout(() => {
      btn.textContent = originalText;
      btn.classList.remove('on');
    }, 1500);
  } catch (err) {
    console.error('Clipboard copy failed:', err);
  }
}

/* --- probe & launch & diagnostics ----------------------------------------- */

async function doDiagnose() {
  if (state.diagnosing) return;
  state.diagnosing = true;
  els.btnDiagnose.classList.add('on');
  renderTunnel();
  try {
    const res = await window.launcher.diagnoseNetwork();
    state.ipInfo = res.ipInfo || state.ipInfo;
    state.pings = res.pings || state.pings;
  } catch (e) {
    console.error('Diagnosis failed:', e);
  } finally {
    state.diagnosing = false;
    els.btnDiagnose.classList.remove('on');
    renderTunnel();
  }
}

async function doProbe() {
  state.best = null; state.probing = true;
  for (const p of Object.values(state.profiles)) {
    p.target = null; p.running = []; p.sessions = [];
  }
  els.proxyForm.hidden = true;
  repaint();
  pushLog('sys', 'log.startProbe');

  const res = await window.launcher.probe();
  state.probing = false;
  state.best = res.proxyBest;
  state.noProxy = res.noProxy;
  // One endpoint arms both launch targets: the proxy scan is shared.
  for (const p of Object.values(state.profiles)) if (p.bar.phase !== 'launching') p.bar = readyBar();
  applyStatus(res, false);
  state.profiles.desktop.target = res.target;
  state.profiles.cli.target = res.cliTarget || null;
  repaint();

  // Trigger diagnostics after probing
  doDiagnose();
}

window.launcher.onCandidate(c => {
  pushLog(c.loginOk ? 'ok' : c.kind === 'dead' ? 'err' : 'warn',
    c.loginOk ? 'log.candidateOk' : 'log.candidateFail',
    {
      ep: c.endpoint, origin: c.origin, kind: c.kind,
      model: c.modelOk ? 'log.candPass.yes' : 'log.candPass.no',
      detail: c.detail,
    });
  if (c.loginOk && !state.best) {
    state.best = c;
    renderTunnel(); renderProxy(); renderEnv();
  }
});

function doLaunch() {
  const cli = state.tab === 'cli';
  const p = cur();
  if (cli && p.target && !p.target.found) {
    p.bar = { phase: 'failed', params: { target: t('err.blockedCli') } };
    pushLog('err', 'err.blockedCli');
    renderBar();
    return;
  }
  if (!state.best) {
    p.bar = { phase: 'noproxy', params: { target: t('err.blockedProxy') } };
    pushLog('err', 'err.blockedProxy');
    renderBar();
    return;
  }
  launchNow();
}

async function launchNow() {
  // The tab may be switched while the launch is in flight, so bind the
  // profile now rather than reading cur() after the await.
  const kind = state.tab;
  const p = state.profiles[kind];
  p.bar = { phase: 'launching', params: { target: `:${state.best.port} ${state.best.kind}` } };
  renderBar(); renderRunning();
  const r = await window.launcher.launch({ targetKind: kind });
  if (r.ok) {
    if (r.cli) { p.sessions = r.sessions || p.sessions; p.own = r.own || []; }
    else {
      p.launchedPid = r.launchedPid || r.pid || null;
      p.running = r.running || p.running;
    }
    p.bar = launchedBar(kind);
  } else if (r.needsQuit) {
    p.running = r.running || [];
    p.launchedPid = r.launchedPid || null;
    // Already up through this launcher: nothing to quit, so just show it.
    p.bar = p.launchedPid ? launchedBar(kind) : { phase: 'stale', params: { target: t(r.errKey) } };
  } else {
    p.bar = { phase: 'failed', params: { target: t(r.errKey || 'err.noProxy') } };
  }
  renderRunning(); renderBar();
}

// The main process walks the launch in stages; the bar narrates each one.
window.launcher.onLaunchStage(stage => {
  if (!state.best) return;
  cur().bar = { phase: 'launching', params: { target: stage === 'preflight' ? t('bar.preflight') : t('bar.spawning') } };
  renderBar(); renderRunning();
});

els.launchBar.addEventListener('click', doLaunch);
els.preflightToggle.addEventListener('click', async e => {
  e.stopPropagation();
  const next = els.preflightToggle.getAttribute('aria-checked') !== 'true';
  els.preflightToggle.setAttribute('aria-checked', String(next));
  await window.launcher.setPreflight(next);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.activeElement === document.body) doLaunch();
});

$('btnRetarget').addEventListener('click', doProbe);
$('btnChoose').addEventListener('click', async () => {
  const p = await window.launcher.chooseTarget();
  if (p) { state.profiles.desktop.target = { found: true, path: p, source: 'manual', languageServer: null }; state.tab = 'desktop'; syncTargetSeg(); renderTarget(); }
});
$('btnChooseCli').addEventListener('click', async () => {
  const p = await window.launcher.chooseCli();
  if (p) {
    state.profiles.cli.target = { found: true, path: p, source: 'manual', kind: 'cli' };
    state.tab = 'cli'; syncTargetSeg(); renderTarget();
  }
});
els.targetSeg.addEventListener('click', e => {
  // Channels header tab: switching profiles must never launch anything.
  const b = e.target.closest('[data-target]');
  if (!b || b.dataset.target === state.tab) return;
  state.tab = b.dataset.target;
  syncTargetSeg();
  renderTarget(); renderRunning(); renderBar();
  // The other tab may have been left a while ago; read its state afresh.
  refreshStatus();
});
els.btnKill.addEventListener('click', refreshStatus);

els.btnToggleIp.addEventListener('click', () => {
  state.ipMasked = !state.ipMasked;
  localStorage.setItem('agy.ipMasked', String(state.ipMasked));
  renderTunnel();
});

els.btnDiagnose.addEventListener('click', doDiagnose);

els.btnProxyManual.addEventListener('click', () => {
  els.proxyForm.hidden = !els.proxyForm.hidden;
  if (!els.proxyForm.hidden) els.proxyInput.focus();
});
els.proxyApply.addEventListener('click', async () => {
  const v = els.proxyInput.value.trim();
  if (!v) return;
  await window.launcher.setProxy(v);
  els.proxyForm.hidden = true;
  doProbe();
});
els.proxyClear.addEventListener('click', async () => {
  await window.launcher.setProxy(null);
  els.proxyInput.value = '';
  els.proxyForm.hidden = true;
  doProbe();
});
els.proxyInput.addEventListener('keydown', e => { if (e.key === 'Enter') els.proxyApply.click(); });

document.querySelectorAll('.winctl button').forEach(b =>
  b.addEventListener('click', () => window.launcher.win(b.dataset.act)));

/* --- boot ----------------------------------------------------------------- */

(async function boot() {
  applyTheme(localStorage.getItem(THEME_KEY) || 'auto');
  applyLang(window.I18N.lang);
  const info = await window.launcher.boot();
  state.platform = info.platform || 'win32';
  appName = info.name || appName;
  document.body.className = `platform-${info.platform} lang-${window.I18N.lang}`;
  els.plateCn.textContent = appName.zh;
  document.title = `${appName.en} · ${appName.zh}`;
  applyWinState(info.state || winFlags);
  els.osChip.textContent = OS_LABEL[info.platform] || info.platform.toUpperCase();
  els.revChip.textContent = `REV ${info.appVersion}`;
  if (info.config.proxyUrl) els.proxyInput.value = info.config.proxyUrl;
  els.preflightToggle.setAttribute('aria-checked', String(info.config.preflight !== false));
  state.profiles.cli.target = info.cliTarget || null;
  // Always opens on the desktop client; the tab is a per-session choice.
  syncTargetSeg();
  renderAdaptiveButtons();
  pushLog('sys', 'log.ready');
  pushLog('sys', 'log.viewport', { w: innerWidth, h: innerHeight, dpr: devicePixelRatio, scrollW: document.documentElement.scrollWidth });
  if (info.platform === 'win32') pushLog('sys', 'log.whyGo');
  setInterval(() => { if (!paused) refreshStatus(); }, 4000);
  doProbe();
})();
