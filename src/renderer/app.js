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
  btnKill: $('btnKill'), btnProxyManual: $('btnProxyManual'),
  copyBar: $('copyBar'),
  proxyForm: $('proxyForm'), proxyInput: $('proxyInput'),
  proxyApply: $('proxyApply'), proxyClear: $('proxyClear'),
  launchBar: $('launchBar'), lbKey: $('lbKey'), lbCn: $('lbCn'), lbTarget: $('lbTarget'),
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

/* Single source of truth so a language switch can repaint everything. */
const state = {
  platform: 'win32',
  best: null, target: null, running: [],
  ipInfo: { direct: null, proxy: null },
  pings: [],
  diagnosing: false,
  ipMasked: localStorage.getItem('agy.ipMasked') !== 'false', // 默认隐藏，防截图泄露
  bar: { phase: 'idle', params: {} },
  probing: false,
  logs: [],
};

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
  const { phase, params } = state.bar;
  const map = {
    idle: ['idle', 'idle.key', 'idle.cn', 'idle.target'],
    probing: ['probing', 'scanning.key', 'scanning.cn', 'scanning.target'],
    armed: ['armed', 'armed.key', 'armed.cn', null],
    launching: ['probing', 'launching.key', 'launching.cn', null],
    launched: ['ok', 'launched.key', 'launched.cn', null],
    stale: ['blocked', 'stale.key', 'stale.cn', null],
    noproxy: ['blocked', 'noproxy.key', 'noproxy.cn', null],
    failed: ['blocked', 'failed.key', 'failed.cn', null],
  };
  const [ds, kKey, kCn, kTarget] = map[phase] || map.idle;
  setState(els.launchBar, ds);
  els.lbKey.textContent = t(kKey);
  els.lbCn.textContent = phase === 'launched' ? `${t(kCn)} PID ${params.pid}` : t(kCn);
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
  const tg = state.target;
  if (!tg) { setState(els.ch02, 'idle'); els.ch02Value.textContent = t('ch02.searching'); return; }
  if (!tg.found) {
    setState(els.ch02, 'fail');
    els.ch02Value.textContent = t('ch02.none');
    els.ch02Meta.textContent = t('ch02.noneMeta');
    return;
  }
  setState(els.ch02, 'ok');
  els.ch02Value.textContent = tg.path;
  els.ch02Meta.textContent = t(tg.languageServer ? 'ch02.okMetaLs' : 'ch02.okMetaNoLs', { source: tg.source });
}

function renderRunning() {
  const list = state.running;
  els.btnKill.hidden = !list.length;
  if (!list.length) {
    setState(els.ch03, 'ok');
    els.ch03Value.textContent = t('ch03.clean');
    els.ch03Meta.textContent = t('ch03.cleanMeta');
    return;
  }
  setState(els.ch03, 'fail');
  els.ch03Value.textContent = t('ch03.stale', { n: list.length, pids: list.map(r => r.pid).join(', ') });
  els.ch03Meta.textContent = t('ch03.staleMeta');
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
  const rows = [
    ['HTTPS_PROXY', http], ['HTTP_PROXY', http], ['ALL_PROXY', socks],
    ['https_proxy', http], ['http_proxy', http], ['all_proxy', socks],
    ['NO_PROXY', 'localhost,127.0.0.1,::1'], ['no_proxy', 'localhost,127.0.0.1,::1'],
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
  renderTunnel(); renderProxy(); renderTarget(); renderRunning(); renderBar(); renderEnv();
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
  state.best = null; state.running = []; state.probing = true;
  state.target = null;
  els.proxyForm.hidden = true;
  repaint();
  pushLog('sys', 'log.startProbe');

  const res = await window.launcher.probe();
  state.probing = false;
  state.target = res.target;
  state.running = res.running;
  state.best = res.proxyBest;
  state.bar = state.best
    ? { phase: 'armed', params: { target: `:${state.best.port} ${state.best.kind}` } }
    : { phase: 'noproxy', params: {} };
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
  if (state.running.length) {
    state.bar = { phase: 'stale', params: { target: t('err.blockedStale') } };
    pushLog('err', 'err.blockedStale');
    renderBar();
    return;
  }
  if (!state.best) {
    state.bar = { phase: 'noproxy', params: { target: t('err.blockedProxy') } };
    pushLog('err', 'err.blockedProxy');
    renderBar();
    return;
  }
  launchNow();
}

async function launchNow() {
  state.bar = { phase: 'launching', params: { target: `:${state.best.port} ${state.best.kind}` } };
  renderBar();
  const r = await window.launcher.launch();
  if (r.ok) {
    state.bar = { phase: 'launched', params: { pid: r.pid, target: `${r.endpoint} · ${r.kind}` } };
    renderBar();
  } else if (r.needsQuit) {
    state.running = r.running;
    state.bar = { phase: 'stale', params: { target: t(r.errKey) } };
    renderRunning();
  } else {
    state.bar = { phase: 'failed', params: { target: t(r.errKey || 'err.noProxy') } };
  }
  renderBar();
}

els.launchBar.addEventListener('click', doLaunch);
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.activeElement === document.body) doLaunch();
});

$('btnRetarget').addEventListener('click', doProbe);
$('btnChoose').addEventListener('click', async () => {
  const p = await window.launcher.chooseTarget();
  if (p) { state.target = { found: true, path: p, source: 'manual', languageServer: null }; renderTarget(); }
});
els.btnKill.addEventListener('click', async () => {
  state.running = (await window.launcher.quitInstances(state.running.map(r => r.pid))) || [];
  renderRunning();
});

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
  renderAdaptiveButtons();
  pushLog('sys', 'log.ready');
  pushLog('sys', 'log.viewport', { w: innerWidth, h: innerHeight, dpr: devicePixelRatio, scrollW: document.documentElement.scrollWidth });
  if (info.platform === 'win32') pushLog('sys', 'log.whyGo');
  doProbe();
})();
