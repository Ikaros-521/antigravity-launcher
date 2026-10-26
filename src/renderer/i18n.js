/* Two dictionaries, zh is the default. Main process sends {k, p} and the
   renderer translates, so switching language also re-renders past log lines.
   Wrapped in an IIFE: classic scripts share one global lexical scope, so a
   top-level name here would collide with app.js. */
(function () {
'use strict';

const DICT = {
  zh: {
    subtitle: '进程级代理注入器',
    'g.tunnel': '隧道与网络诊断', 'g.channels': '通道', 'g.console': '日志', 'g.env': '将写入子进程环境',
    'node.proxyIdle': '未探测',
    'role.ch01': '代理端点', 'role.ch02': '客户端二进制', 'role.ch03': '进程树',
    'reprobe': '重新探测', 'manual': '手动指定', 'choose': '手动选择',
    'openPwsh': 'PowerShell', 'openCmd': 'CMD', 'openTerminalApp': '打开终端',
    'copyPwsh': 'PowerShell', 'copyCmd': 'CMD', 'copyShell': 'Shell export', 'copyGit': 'Git 代理', 'copyGitUnset': '清除 Git',
    'copySysProxy': '系统代理', 'copySysProxyUnset': '清除系统代理', 'copyLaunchTerm': '启动终端命令',
    'tip.openPwsh': '在当前工作目录下启动已注入代理环境变量的 PowerShell 窗口',
    'tip.openCmd': '在当前工作目录下启动已注入代理环境变量的 CMD 窗口',
    'tip.openTerminalApp': '在当前工作目录下启动已注入代理环境变量的原生终端窗口',
    'tip.copyPwsh': '复制 PowerShell 会话级临时代理设置命令（$env:HTTP_PROXY=...）',
    'tip.copyCmd': '复制 CMD 会话级临时代理设置命令（set "HTTP_PROXY=..."）',
    'tip.copyShell': '复制 Shell (bash/zsh) 临时代理设置命令（export HTTP_PROXY=...）',
    'tip.copyGit': '复制 Git 全局代理配置命令（git config --global http.proxy ...）',
    'tip.copyGitUnset': '复制清除 Git 全局代理配置的命令',
    'tip.copySysProxy': '复制操作系统全局系统代理开启命令（不影响本软件纯净性）',
    'tip.copySysProxyUnset': '复制关闭操作系统全局系统代理的命令',
    'tip.copyLaunchTerm': '复制一条可在 Win+R 或别处直接拉起带代理终端的完整运行命令',
    'reDiagnose': '测速 / 刷新 IP',
    'toggleIp': '显示 / 隐藏 IP（防截图泄露）',
    'copied': '已复制 ✓',
    'kill': '终止残留实例', 'apply': '写入', 'clear': '清除',
    'proxyPlaceholder': 'http://127.0.0.1:10808 或 socks5://127.0.0.1:7891',
    'foot1': '仅向 Antigravity 进程树注入代理', 'foot2': '不开 TUN · 不改系统代理',
    'win.min': '最小化', 'win.max': '最大化', 'win.restore': '还原窗口',
    'win.full': '全屏', 'win.unfull': '退出全屏', 'win.close': '关闭',
    'footKeys': 'F11 全屏 · 双击标题栏最大化 · 边缘可拖拽拉伸',
    'hintMacA': 'macOS 首次打开若被拦截：右键图标 → 打开；或终端执行 ',
    'hintMacB': ' 后重试。本工具未做签名与公证。',
    'envNote': 'Go 的 net/http 完全不读 ALL_PROXY，也读不到 Windows 注册表代理；所以 HTTP(S)_PROXY 才是 language_server 唯一认的那一组，大小写各写一份是因为部分库只认小写。',

    'idle.key': 'READY', 'idle.cn': '探测通道', 'idle.target': '按 Enter 或点击开始',
    'scanning.key': 'SCANNING', 'scanning.cn': '通道探测中', 'scanning.target': '正在验证代理与安装路径',
    'armed.key': 'ARMED', 'armed.cn': '可以启动',
    'launching.key': 'LAUNCHING', 'launching.cn': '注入并启动中',
    'launched.key': 'LAUNCHED', 'launched.cn': '已启动',
    'blocked.key': 'BLOCKED', 'failed.key': 'FAILED', 'failed.cn': '启动失败',
    'stale.key': 'STALE', 'stale.cn': '先退出旧实例',
    'noproxy.key': 'NO PROXY', 'noproxy.cn': '代理不可用',

    'log.ready': 'Antigravity Launcher 就绪 — 只向进程树注入代理，不开 TUN，不改系统代理',
    'log.whyGo': '提示：Go 写的 language_server 只读环境变量，不读 Windows 注册表代理，这正是本工具存在的原因',
    'log.viewport': '视口 {w}×{h} CSS px · DPR {dpr} · 文档宽 {scrollW}',
    'log.startProbe': '开始探测 — 系统代理优先，其后扫描常见本地端口',
    'log.foundTarget': 'CH02 已定位 {path}（{source}）',
    'log.noTarget': 'CH02 未找到 Antigravity，请手动指定',
    'log.proxyOk': 'CH01 代理可用：{ep}（类型 {kind}，登录端点已验证，模型端点{model}）',
    'log.proxyOk.yes': '已验证', 'log.proxyOk.no': '未验证',
    'log.proxyNone': 'CH01 没有任何候选端口通过 CONNECT / SOCKS5 握手',
    'log.running': 'CH03 检测到 {n} 个未注入代理的实例：PID {pids}',
    'log.clean': 'CH03 无残留实例，可以干净启动',
    'log.launched': '已启动 PID {pid}，注入 {ep}',
    'log.raised': 'CH03 抬窗结果：{msg}',
    'log.spawnFail': '启动失败：{msg}',
    'log.killed': '已终止残留实例 PID {pids}',
    'log.manualTarget': 'CH02 手动指定：{path}',
    'log.manualProxy': 'CH01 写入手动代理：{url}',
    'log.clearedProxy': 'CH01 已清除手动代理，恢复自动探测',
    'log.workDirSet': 'CH04 工作目录已设置为：{path}',
    'log.terminalOpened': 'CH04 已启动 {type} 终端，工作目录：{dir}，代理：{ep}',
    'log.copied': '已复制命令到剪贴板：{type}',
    'log.directIp': '直连公网出口：{ip}（{country}）',
    'log.proxyIp': '代理出口端点：{ip}（{country}）',
    'log.pingOk': '外网测速 {label}：{rtt} · 连接通畅',
    'log.pingFail': '外网测速 {label} 失败：{reason}',
    'log.candidateOk': 'CH01 候选 {ep} [{origin}] → {kind} · LOGIN 通 · MODELS {model}',
    'log.candidateFail': 'CH01 候选 {ep} [{origin}] → {kind} · {detail}',
    'log.candPass.yes': '通', 'log.candPass.no': '不通',

    'ch01.probing': '读取系统代理并逐个握手验证…',
    'ch01.probeMeta': 'HTTP CONNECT 与 SOCKS5 双模探测，目标域名不预解析',
    'ch01.none': '没有任何候选端口通过握手',
    'ch01.noneMeta': '确认代理客户端已启动；若端口非典型，请用「手动指定」',
    'ch01.okMeta': '类型 {kind} · 来源 {origin} · 已用 CONNECT / SOCKS5 握手验证',
    'ch02.searching': '搜索安装目录…',
    'ch02.none': '未定位到 Antigravity 可执行文件',
    'ch02.noneMeta': '点「手动选择」指到 exe / .app 内层二进制，选择结果会记住',
    'ch02.okMetaLs': '来源 {source} · 已确认 resources/bin/language_server',
    'ch02.okMetaNoLs': '来源 {source} · 未确认 language_server，可能不是标准安装',
    'ch03.waiting': '等待前两条通道',
    'ch03.clean': '无残留实例',
    'ch03.cleanMeta': '干净状态，新进程会正确继承代理环境变量',
    'ch03.stale': '检测到 {n} 个实例 · PID {pids}',
    'ch03.staleMeta': '环境变量无法注入已运行进程，必须完全退出后再启动',
    'ch03.launchedMeta': '子进程（language_server）继承同一份代理环境变量',

    'err.noTarget': '未定位到 Antigravity 可执行文件',
    'err.noProxy': '没有可用的本地代理端点',
    'err.stale': '必须先完全退出旧实例，环境变量无法注入已运行的进程',
    'err.blockedStale': 'CH03 阻塞：检测到残留实例，请先「终止残留实例」或手动完全退出',
    'err.blockedProxy': 'CH01 阻塞：没有可用代理端点，启动只会复现直连失败',
  },
  en: {
    subtitle: 'PROCESS-LOCAL PROXY INJECTOR',
    'g.tunnel': 'TUNNEL & DIAGNOSTICS', 'g.channels': '', 'g.console': '', 'g.env': '',
    'node.proxyIdle': 'not probed',
    'role.ch01': 'PROXY ENDPOINT', 'role.ch02': 'CLIENT BINARY', 'role.ch03': 'PROCESS TREE',
    'reprobe': 'Re-probe', 'manual': 'Set manually', 'choose': 'Choose file',
    'openPwsh': 'PowerShell', 'openCmd': 'CMD', 'openTerminalApp': 'Terminal',
    'copyPwsh': 'PowerShell', 'copyCmd': 'CMD', 'copyShell': 'Shell export', 'copyGit': 'Git Proxy', 'copyGitUnset': 'Unset Git',
    'copySysProxy': 'Sys Proxy', 'copySysProxyUnset': 'Unset Sys Proxy', 'copyLaunchTerm': 'Launch Term Cmd',
    'tip.openPwsh': 'Launch PowerShell terminal with proxy environment injected',
    'tip.openCmd': 'Launch CMD terminal with proxy environment injected',
    'tip.openTerminalApp': 'Launch native terminal with proxy environment injected',
    'tip.copyPwsh': 'Copy PowerShell session proxy setup command ($env:HTTP_PROXY=...)',
    'tip.copyCmd': 'Copy CMD session proxy setup command (set "HTTP_PROXY=...")',
    'tip.copyShell': 'Copy Shell (bash/zsh) proxy setup command (export HTTP_PROXY=...)',
    'tip.copyGit': 'Copy Git global proxy setup command (git config --global http.proxy ...)',
    'tip.copyGitUnset': 'Copy command to unset Git global proxy',
    'tip.copySysProxy': 'Copy command to enable OS system proxy',
    'tip.copySysProxyUnset': 'Copy command to disable OS system proxy',
    'tip.copyLaunchTerm': 'Copy single command line to launch proxy-injected terminal anywhere',
    'reDiagnose': 'Test Ping / IP',
    'toggleIp': 'Toggle IP Visibility (Anti-Leak)',
    'copied': 'Copied ✓',
    'kill': 'Quit stale instances', 'apply': 'Apply', 'clear': 'Clear',
    'proxyPlaceholder': 'http://127.0.0.1:10808 or socks5://127.0.0.1:7891',
    'foot1': 'Proxy env goes to the Antigravity tree only', 'foot2': 'No TUN · no system proxy change',
    'win.min': 'Minimize', 'win.max': 'Maximize', 'win.restore': 'Restore window',
    'win.full': 'Fullscreen', 'win.unfull': 'Exit fullscreen', 'win.close': 'Close',
    'footKeys': 'F11 fullscreen · double-click the title bar to maximise · drag any edge to resize',
    'hintMacA': 'If macOS blocks the first launch: right-click the icon → Open, or run ',
    'hintMacB': ' in Terminal. This build is unsigned and not notarized.',
    'envNote': 'Go net/http ignores ALL_PROXY entirely and never reads the Windows registry proxy — HTTP(S)_PROXY is the only pair language_server honours, and both spellings exist because some libraries read lowercase only.',

    'idle.key': 'READY', 'idle.cn': 'probe channels', 'idle.target': 'press Enter or click to start',
    'scanning.key': 'SCANNING', 'scanning.cn': 'probing', 'scanning.target': 'verifying proxy and install path',
    'armed.key': 'ARMED', 'armed.cn': 'ready to launch',
    'launching.key': 'LAUNCHING', 'launching.cn': 'injecting',
    'launched.key': 'LAUNCHED', 'launched.cn': 'started',
    'blocked.key': 'BLOCKED', 'failed.key': 'FAILED', 'failed.cn': 'launch failed',
    'stale.key': 'STALE', 'stale.cn': 'quit old instance',
    'noproxy.key': 'NO PROXY', 'noproxy.cn': 'proxy unavailable',

    'log.ready': 'Antigravity Launcher ready — env goes to the process tree only, no TUN, no system proxy change',
    'log.whyGo': 'Note: the Go language_server reads env vars only, never the Windows registry proxy — that is why this tool exists',
    'log.viewport': 'viewport {w}×{h} CSS px · DPR {dpr} · doc width {scrollW}',
    'log.startProbe': 'Probing — system proxy first, then common local ports',
    'log.foundTarget': 'CH02 located {path} ({source})',
    'log.noTarget': 'CH02 Antigravity not found, set it manually',
    'log.proxyOk': 'CH01 proxy usable: {ep} (kind {kind}, login verified, models {model})',
    'log.proxyOk.yes': 'verified', 'log.proxyOk.no': 'not verified',
    'log.proxyNone': 'CH01 no candidate passed the CONNECT / SOCKS5 handshake',
    'log.running': 'CH03 {n} unproxied instance(s): PID {pids}',
    'log.clean': 'CH03 no stale instance, clean start possible',
    'log.launched': 'Started PID {pid} via {ep}',
    'log.raised': 'CH03 raise result: {msg}',
    'log.spawnFail': 'Launch failed: {msg}',
    'log.killed': 'Terminated stale instances PID {pids}',
    'log.manualTarget': 'CH02 set manually: {path}',
    'log.manualProxy': 'CH01 manual proxy set: {url}',
    'log.clearedProxy': 'CH01 manual proxy cleared, back to auto-detect',
    'log.workDirSet': 'CH04 Working directory set to: {path}',
    'log.terminalOpened': 'CH04 Opened {type} in {dir} with proxy {ep}',
    'log.copied': 'Copied {type} command to clipboard',
    'log.directIp': 'Direct public IP: {ip} ({country})',
    'log.proxyIp': 'Proxy exit IP: {ip} ({country})',
    'log.pingOk': 'Ping {label}: {rtt} ok',
    'log.pingFail': 'Ping {label} failed: {reason}',
    'log.candidateOk': 'CH01 candidate {ep} [{origin}] → {kind} · LOGIN ok · MODELS {model}',
    'log.candidateFail': 'CH01 candidate {ep} [{origin}] → {kind} · {detail}',
    'log.candPass.yes': 'ok', 'log.candPass.no': 'blocked',

    'ch01.probing': 'reading system proxy and handshaking…',
    'ch01.probeMeta': 'HTTP CONNECT and SOCKS5 both tried, target domains resolved by the proxy',
    'ch01.none': 'no candidate passed the handshake',
    'ch01.noneMeta': 'check the proxy client is running; for an unusual port use "Set manually"',
    'ch01.okMeta': 'kind {kind} · from {origin} · verified by CONNECT / SOCKS5',
    'ch02.searching': 'searching install locations…',
    'ch02.none': 'Antigravity executable not found',
    'ch02.noneMeta': 'use "Choose file" to point at the exe / inner .app binary; the choice is remembered',
    'ch02.okMetaLs': 'from {source} · resources/bin/language_server confirmed',
    'ch02.okMetaNoLs': 'from {source} · language_server not found, may be a non-standard install',
    'ch03.waiting': 'waiting for the first two channels',
    'ch03.clean': 'no stale instance',
    'ch03.cleanMeta': 'clean state, a new process will inherit the proxy env',
    'ch03.stale': '{n} instance(s) running · PID {pids}',
    'ch03.staleMeta': 'env vars cannot be injected into a running process, quit it first',
    'ch03.launchedMeta': 'children (language_server) inherit the same proxy env',

    'err.noTarget': 'Antigravity executable not located',
    'err.noProxy': 'no usable local proxy endpoint',
    'err.stale': 'quit the old instance first — env vars cannot be injected into a running process',
    'err.blockedStale': 'CH03 blocked: stale instance detected, quit it first',
    'err.blockedProxy': 'CH01 blocked: no usable proxy, launching would only reproduce direct-connection failure',
  },
};

let lang = localStorage.getItem('agy.lang') || 'zh';

function t(key, params) {
  let s = (DICT[lang] && DICT[lang][key]) ?? DICT.zh[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      // A param may itself be a dictionary key (e.g. a yes/no suffix), so that
      // the main process can stay language-agnostic.
      const val = typeof v === 'string' && DICT[lang][v] !== undefined ? DICT[lang][v] : v;
      s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), val);
    }
  }
  return s;
}

function applyStatic(root) {
  root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
  root.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  document.body.classList.toggle('lang-zh', lang === 'zh');
}

window.I18N = {
  t,
  get lang() { return lang; },
  setLang(l) { lang = l; localStorage.setItem('agy.lang', l); },
  applyStatic,
};
})();
