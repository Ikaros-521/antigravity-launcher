const $ = id => document.getElementById(id);
const tunnel = document.querySelector('.tunnel');
const els = {
  osChip: $('osChip'), revChip: $('revChip'),
  nodeLocal: $('nodeLocal'), nodeProxy: $('nodeProxy'),
  proxyReadout: $('proxyReadout'), proxyKindReadout: $('proxyKindReadout'),
  laneLogin: $('laneLogin'), laneModel: $('laneModel'),
  ch01: $('ch01'), ch01Value: $('ch01Value'), ch01Meta: $('ch01Meta'),
  ch02: $('ch02'), ch02Value: $('ch02Value'), ch02Meta: $('ch02Meta'),
  ch03: $('ch03'), ch03Value: $('ch03Value'), ch03Meta: $('ch03Meta'),
  btnKill: $('btnKill'), btnProxyManual: $('btnProxyManual'),
  proxyForm: $('proxyForm'), proxyInput: $('proxyInput'),
  proxyApply: $('proxyApply'), proxyClear: $('proxyClear'),
  launchBar: $('launchBar'), lbKey: $('lbKey'), lbCn: $('lbCn'), lbTarget: $('lbTarget'),
  consoleBody: $('consoleBody'), envGrid: $('envGrid'),
};

let best = null;
let running = [];

const OS_LABEL = { win32: 'WINDOWS', darwin: 'MACOS', linux: 'LINUX' };

function stamp(ts) {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function log(level, text) {
  const row = document.createElement('div');
  row.className = 'line';
  row.dataset.lvl = level;
  const t = document.createElement('time');
  t.textContent = stamp(Date.now());
  const m = document.createElement('span');
  m.className = 'msg';
  m.textContent = text;
  row.append(t, m);
  els.consoleBody.appendChild(row);
  els.consoleBody.scrollTop = els.consoleBody.scrollHeight;
  while (els.consoleBody.children.length > 400) els.consoleBody.firstChild.remove();
}

function renderEnv(ep) {
  const httpUrl = ep ? `http://${ep.host}:${ep.port}` : null;
  const rows = [
    ['HTTPS_PROXY', httpUrl], ['HTTP_PROXY', httpUrl], ['ALL_PROXY', ep ? `socks5://${ep.host}:${ep.port}` : null],
    ['https_proxy', httpUrl], ['http_proxy', httpUrl], ['all_proxy', ep ? `socks5://${ep.host}:${ep.port}` : null],
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

function setState(el, s) { el.dataset.state = s; }

function bar(state, key, cn, target) {
  els.launchBar.dataset.state = state;
  els.lbKey.textContent = key;
  els.lbCn.textContent = cn;
  els.lbTarget.textContent = target;
}

els.launchBar.addEventListener('click', doLaunch);
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.activeElement === document.body) doLaunch();
});

async function doProbe() {
  best = null; running = [];
  tunnel.classList.add('scanning');
  tunnel.classList.remove('live');
  setState(els.nodeLocal, 'scan');
  setState(els.nodeProxy, 'scan');
  for (const ch of [els.ch01, els.ch02, els.ch03]) setState(ch, 'scan');
  els.ch01Value.textContent = '读取系统代理并逐个握手验证…';
  els.ch01Meta.textContent = 'HTTP CONNECT 与 SOCKS5 双模探测，目标域名不预解析';
  els.ch02Value.textContent = '搜索安装目录…';
  setState(els.ch03, 'idle'); els.ch03Value.textContent = '等待前两条通道';
  els.btnKill.hidden = true;
  bar('probing', 'SCANNING', '通道探测中', '正在验证代理与安装路径');
  log('sys', '开始探测 — 系统代理优先，其后扫描常见本地端口');

  const res = await window.launcher.probe();

  tunnel.classList.remove('scanning');
  applyTarget(res.target);
  applyRunning(res.running);
  renderEnv(res.proxyBest);

  if (res.proxyBest) {
    best = res.proxyBest;
    tunnel.classList.add('live');
    setState(els.nodeLocal, 'live');
    setState(els.nodeProxy, 'live');
    els.proxyReadout.textContent = `:${best.port}`;
    els.proxyKindReadout.textContent = best.kind.toUpperCase();
    setState(els.ch01, 'ok');
    els.ch01Value.textContent = `${best.scheme}://${best.host}:${best.port}`;
    els.ch01Meta.textContent = `类型 ${best.kind} · 来源 ${best.origin} · 已用 CONNECT / SOCKS5 握手验证`;
    bar('armed', 'ARMED', '可以启动', `:${best.port} ${best.kind}`);
  } else {
    setState(els.nodeProxy, 'dead');
    els.proxyKindReadout.textContent = '无可用端点';
    setState(els.ch01, 'fail');
    els.ch01Value.textContent = '没有任何候选端口通过握手';
    els.ch01Meta.textContent = '确认代理客户端已启动；若端口非典型，请用「手动指定」';
    bar('blocked', 'NO PROXY', '代理不可用', 'CH01 未通过，启动无意义');
  }
}

function applyTarget(t) {
  if (t.found) {
    setState(els.ch02, 'ok');
    els.ch02Value.textContent = t.path;
    els.ch02Meta.textContent = `来源 ${t.source}${t.languageServer ? ' · 已确认 resources/bin/language_server' : ' · 未确认 language_server，可能不是标准安装'}`;
  } else {
    setState(els.ch02, 'fail');
    els.ch02Value.textContent = '未定位到 Antigravity 可执行文件';
    els.ch02Meta.textContent = '点「手动选择」指到 exe / .app 内层二进制，选择结果会记住';
  }
}

function applyRunning(list) {
  running = list || [];
  if (!running.length) {
    setState(els.ch03, 'ok');
    els.ch03Value.textContent = '无残留实例';
    els.ch03Meta.textContent = '干净状态，新进程会正确继承代理环境变量';
    els.btnKill.hidden = true;
    return;
  }
  setState(els.ch03, 'fail');
  els.ch03Value.textContent = `检测到 ${running.length} 个实例 · PID ${running.map(r => r.pid).join(', ')}`;
  els.ch03Meta.textContent = '环境变量无法注入已运行进程，必须完全退出后再启动';
  els.btnKill.hidden = false;
}

window.launcher.onCandidate(c => {
  const tag = c.loginOk ? 'ok' : c.kind === 'dead' ? 'err' : 'warn';
  log(tag, `CH01 候选 ${c.endpoint} [${c.origin}] → ${c.kind}${c.loginOk ? ` · LOGIN 通 · MODELS ${c.modelOk ? '通' : '不通'}` : ` · ${c.detail}`}`);
  if (c.loginOk && !best) {
    best = c;
    els.proxyReadout.textContent = `:${c.port}`;
    els.proxyKindReadout.textContent = c.kind.toUpperCase();
  }
});

els.btnKill.addEventListener('click', async () => {
  log('warn', `终止残留实例 PID ${running.map(r => r.pid).join(', ')}`);
  const left = await window.launcher.quitInstances(running.map(r => r.pid));
  applyRunning(left);
});

$('btnRetarget').addEventListener('click', doProbe);
$('btnChoose').addEventListener('click', async () => {
  const p = await window.launcher.chooseTarget();
  if (p) { log('ok', `CH02 手动指定：${p}`); setState(els.ch02, 'ok'); els.ch02Value.textContent = p; }
});

els.btnProxyManual.addEventListener('click', () => {
  els.proxyForm.hidden = !els.proxyForm.hidden;
  if (!els.proxyForm.hidden) els.proxyInput.focus();
});
els.proxyApply.addEventListener('click', async () => {
  const v = els.proxyInput.value.trim();
  if (!v) return;
  await window.launcher.setProxy(v);
  log('sys', `CH01 写入手动代理：${v}`);
  els.proxyForm.hidden = true;
  doProbe();
});
els.proxyClear.addEventListener('click', async () => {
  await window.launcher.setProxy(null);
  els.proxyInput.value = '';
  els.proxyForm.hidden = true;
  log('sys', 'CH01 已清除手动代理，恢复自动探测');
  doProbe();
});
els.proxyInput.addEventListener('keydown', e => { if (e.key === 'Enter') els.proxyApply.click(); });

function doLaunch() {
  if (running.length) {
    bar('blocked', 'STALE INSTANCE', '先退出旧实例', 'CH03 有未注入代理的实例在跑');
    log('err', 'CH03 阻塞：检测到残留实例，请先「终止残留实例」或手动完全退出');
    return;
  }
  if (!best) {
    bar('blocked', 'NO PROXY', '代理不可用', 'CH01 未通过握手验证');
    log('err', 'CH01 阻塞：没有可用代理端点，启动只会复现直连失败');
    return;
  }
  launchNow();
}

async function launchNow() {
  bar('probing', 'LAUNCHING', '注入并启动中', `:${best.port} ${best.kind}`);
  const r = await window.launcher.launch();
  if (r.ok) {
    bar('ok', 'LAUNCHED', `PID ${r.pid} 已启动`, `${r.endpoint} · ${r.kind}`);
    setState(els.ch03, 'ok');
    els.ch03Value.textContent = `已启动 PID ${r.pid}`;
    els.ch03Meta.textContent = '子进程（language_server）继承同一份代理环境变量';
    setTimeout(refreshProcessTree, 4000);
  } else if (r.needsQuit) {
    applyRunning(r.running);
    bar('blocked', 'STALE INSTANCE', '先退出旧实例', r.error);
  } else {
    bar('blocked', 'FAILED', '启动失败', r.error || '未知错误');
  }
}

async function refreshProcessTree() {
  const res = await window.launcher.probe();
  applyTarget(res.target);
  applyRunning(res.running);
  if (res.running.length) log('warn', `CH03 复查：PID ${res.running.map(x => x.pid).join(', ')}`);
}

(async function boot() {
  const info = await window.launcher.boot();
  document.body.className = `platform-${info.platform}`;
  els.osChip.textContent = `${OS_LABEL[info.platform] || info.platform.toUpperCase()}`;
  els.revChip.textContent = `REV ${info.appVersion}`;
  if (info.config.proxyUrl) els.proxyInput.value = info.config.proxyUrl;
  log('sys', `视口 ${window.innerWidth}×${window.innerHeight} CSS px · DPR ${window.devicePixelRatio} · 文档宽 ${document.documentElement.scrollWidth}`);
  log('sys', 'Antigravity Launcher 就绪 — 只向进程树注入代理，不开 TUN，不改系统代理');
  if (info.platform === 'win32') log('sys', '提示：Go 写的 language_server 只读环境变量，不读 Windows 注册表代理，这正是本工具存在的原因');
  doProbe();
})();

document.querySelectorAll('.winctl button').forEach(b =>
  b.addEventListener('click', () => window.launcher.win(b.dataset.act)));
