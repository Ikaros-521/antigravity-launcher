const { spawn, spawnSync, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

// The launcher's own executable is named "Antigravity Launcher.exe" /
// "Antigravity.Launcher-*.exe", so only an exact name match keeps the launcher
// from being reported as a stale Antigravity instance — and then killed.

const isCliName = name => /^agy(\.exe)?$/i.test(name);

function parseProcessList(text) {
  if (process.platform === 'win32') {
    return text.split('\n').map(line => {
      const m = line.match(/^"([^"]+)","(\d+)"/);
      return m ? { name: m[1], pid: Number(m[2]) } : null;
    }).filter(Boolean);
  }
  return text.split('\n').map(line => {
    const m = line.trim().match(/^(\d+)\s+(.+)$/);
    return m ? { name: path.basename(m[2]), pid: Number(m[1]) } : null;
  }).filter(Boolean);
}

// One read of the process table answers every "is it running" question. It is
// async because CH03 polls it: a synchronous tasklist would stall the main
// thread, and with it the window, on every tick.
function listProcesses() {
  const [cmd, args] = process.platform === 'win32'
    ? ['tasklist', ['/FO', 'CSV', '/NH']]
    : ['ps', ['-axo', 'pid=,comm=']];
  return new Promise(resolve => {
    execFile(cmd, args, { windowsHide: true, timeout: 8000, maxBuffer: 8 * 1024 * 1024 }, (_err, stdout) => {
      resolve(parseProcessList(String(stdout || '')));
    });
  });
}

// Instances of the desktop client. A CLI path has nothing to report here: its
// sessions belong to the user's terminals and are never stale instances.
function pickRunning(list, targetPath) {
  const base = (targetPath ? path.basename(targetPath) : 'Antigravity').toLowerCase();
  if (isCliName(base)) return [];
  const isTarget = name => name.toLowerCase() === base;
  return list.filter(p => isTarget(p.name) && p.pid !== process.pid);
}

// agy sessions are plain information for the CLI tab, never something to quit.
const pickCliSessions = list => list.filter(p => isCliName(p.name));

// Windows hands out process IDs again readily, so a recorded PID only counts
// as "the client this launcher started" once its start time matches the
// record. Resolves to epoch milliseconds, or null when it cannot be read.
function processStartEpoch(pid) {
  if (process.platform !== 'win32' || !Number.isInteger(pid) || pid <= 0) return Promise.resolve(null);
  const script = `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) { ([DateTimeOffset]$p.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds() }`;
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 15000 }, (_err, stdout) => {
        const ms = Number(String(stdout || '').trim());
        resolve(ms > 0 ? ms : null);
      });
  });
}

function killInstances(pids) {
  // Never act on our own process, whatever the caller passed in.
  const targets = (pids || []).map(Number).filter(p => p && p !== process.pid);
  if (!targets.length) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/F', '/T', '/PID', String(targets[0])], { encoding: 'utf8' });
  } else {
    for (const pid of targets) { try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ } }
  }
}

// Go's net/http ignores ALL_PROXY entirely, and several CLI-side libs only read
// the lowercase spelling, so each value has to be written twice in two names.
// Credentials go into the env vars (Go and Node honour them there) but NOT into
// --proxy-server, which Chromium cannot authenticate through.
function urlFor(ep, scheme) {
  const auth = ep.user ? `${encodeURIComponent(ep.user)}:${encodeURIComponent(ep.pass || '')}@` : '';
  return `${scheme}://${auth}${ep.host}:${ep.port}`;
}

function redact(ep) {
  return ep && ep.user ? `${ep.scheme}://***:***@${ep.host}:${ep.port}` : `${ep.scheme}://${ep.host}:${ep.port}`;
}

function buildEnv(ep) {
  const http = urlFor(ep, 'http');
  const socks = urlFor(ep, 'socks5');
  return {
    HTTP_PROXY: http, HTTPS_PROXY: http,
    http_proxy: http, https_proxy: http,
    ALL_PROXY: socks, all_proxy: socks,
    NO_PROXY: 'localhost,127.0.0.1,::1',
    no_proxy: 'localhost,127.0.0.1,::1',
  };
}

function buildProxyCommands(ep) {
  const isWin = process.platform === 'win32';
  const isMac = process.platform === 'darwin';
  const isLinux = process.platform === 'linux';

  const http = ep ? urlFor(ep, 'http') : '';
  const socks = ep ? urlFor(ep, 'socks5') : '';
  const hostPort = ep ? `${ep.host}:${ep.port}` : '';

  // 1. Unix 通用 shell (bash/zsh) export 命令
  const shellExport = ep
    ? `export HTTP_PROXY="${http}" && export HTTPS_PROXY="${http}" && export ALL_PROXY="${socks}" && export NO_PROXY="localhost,127.0.0.1,::1"`
    : '';
  const shellUnset = 'unset HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy';

  // 2. Windows PowerShell 命令
  const powershell = ep
    ? `$env:HTTP_PROXY="${http}"; $env:HTTPS_PROXY="${http}"; $env:ALL_PROXY="${socks}"; $env:NO_PROXY="localhost,127.0.0.1,::1"`
    : '';
  const powershellUnset = 'Remove-Item env:HTTP_PROXY, env:HTTPS_PROXY, env:ALL_PROXY, env:NO_PROXY -ErrorAction SilentlyContinue';

  // 3. Windows CMD 命令
  const cmd = ep
    ? `set "HTTP_PROXY=${http}" && set "HTTPS_PROXY=${http}" && set "ALL_PROXY=${socks}" && set "NO_PROXY=localhost,127.0.0.1,::1"`
    : '';
  const cmdUnset = 'set "HTTP_PROXY=" && set "HTTPS_PROXY=" && set "ALL_PROXY=" && set "NO_PROXY="';

  // 4. Git 代理命令
  const git = ep
    ? `git config --global http.proxy ${http} && git config --global https.proxy ${http}`
    : '';
  const gitUnset = 'git config --global --unset http.proxy && git config --global --unset https.proxy';

  // 5. 操作系统全局代理设置/清除命令
  let sysProxy = '';
  let sysProxyUnset = '';
  if (isWin) {
    sysProxy = ep
      ? `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 1 /f && reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer /t REG_SZ /d "${hostPort}" /f`
      : '';
    sysProxyUnset = 'reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f';
  } else if (isMac) {
    sysProxy = ep
      ? `networksetup -setwebproxy "Wi-Fi" ${ep.host} ${ep.port} && networksetup -setsecurewebproxy "Wi-Fi" ${ep.host} ${ep.port}`
      : '';
    sysProxyUnset = 'networksetup -setwebproxystate "Wi-Fi" off && networksetup -setsecurewebproxystate "Wi-Fi" off';
  } else if (isLinux) {
    sysProxy = ep
      ? `gsettings set org.gnome.system.proxy mode 'manual' && gsettings set org.gnome.system.proxy.http host '${ep.host}' && gsettings set org.gnome.system.proxy.http port ${ep.port}`
      : '';
    sysProxyUnset = `gsettings set org.gnome.system.proxy mode 'none'`;
  }

  // 6. 带启动终端的完整单行快捷命令
  let launchTerminalCmd = '';
  if (isWin) {
    launchTerminalCmd = ep
      ? `powershell -NoExit -Command "$env:HTTP_PROXY='${http}'; $env:HTTPS_PROXY='${http}'; $env:ALL_PROXY='${socks}'; Write-Host '[AGY] Proxy environment set -> ${http}'"`
      : `powershell -NoExit`;
  } else {
    launchTerminalCmd = ep
      ? `bash -c "export HTTP_PROXY='${http}' && export HTTPS_PROXY='${http}' && export ALL_PROXY='${socks}' && echo '[AGY] Proxy environment set' && exec bash"`
      : `bash`;
  }

  return {
    platform: process.platform,
    shell: shellExport,
    shellUnset,
    powershell,
    powershellUnset,
    cmd,
    cmdUnset,
    git,
    gitUnset,
    sysProxy,
    sysProxyUnset,
    launchTerminalCmd,
  };
}

// Antigravity does not always activate its own window when it is started by
// another process, so it can come up behind the launcher. The launcher still
// holds foreground rights (the user just clicked it), so it raises the new
// process's window explicitly instead of hoping the target does it.
const RAISE_PS = `
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Collections.Generic;
public class AggyRaiseW {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern uint GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f);
  [DllImport("user32.dll")] public static extern bool AllowSetForegroundWindow(uint pid);
  [DllImport("user32.dll")] public static extern bool SystemParametersInfo(uint a, uint b, IntPtr c, uint d);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
$want = [uint32]__PID__
$best = $null
$bestArea = 0
$hits = New-Object System.Collections.Generic.List[IntPtr]
$cb = [AggyRaiseW+EnumProc]{
  param($h, $l)
  $p = [uint32]0
  [void][AggyRaiseW]::GetWindowThreadProcessId($h, [ref]$p)
  if ($p -ne $want) { return $true }
  if (-not [AggyRaiseW]::IsWindowVisible($h)) { return $true }
  # Skip tool windows: they are never the main UI.
  if (([AggyRaiseW]::GetWindowLong($h, -20) -band 0x80) -ne 0) { return $true }
  $r = New-Object AggyRaiseW+RECT
  [void][AggyRaiseW]::GetWindowRect($h, [ref]$r)
  $area = [math]::Abs(($r.Right - $r.Left) * ($r.Bottom - $r.Top))
  if ($area -gt $script:bestArea) { $script:bestArea = $area; $script:best = $h }
  return $true
}
$deadline = (Get-Date).AddSeconds(75)
while ((Get-Date) -lt $deadline) {
  $script:best = $null; $script:bestArea = 0
  [void][AggyRaiseW]::EnumWindows($cb, [IntPtr]::Zero)
  if ($null -ne $script:best) { break }
  Start-Sleep -Milliseconds 500
}
if ($null -eq $script:best) { 'RAISE timeout: no visible window for pid ' + $want; exit }
$h = $script:best
[void][AggyRaiseW]::AllowSetForegroundWindow([uint32]0)
# Zeroing the lock timeout is what lets a process that did not receive the last
# input event still take the foreground.
[void][AggyRaiseW]::SystemParametersInfo(0x2000, 0, [IntPtr]::Zero, 2)
[void][AggyRaiseW]::ShowWindow($h, 9)
$fp = [uint32]0
[void][AggyRaiseW]::GetWindowThreadProcessId([AggyRaiseW]::GetForegroundWindow(), [ref]$fp)
$mine = [AggyRaiseW]::GetCurrentThreadId()
$other = [AggyRaiseW]::GetWindowThreadProcessId([AggyRaiseW]::GetForegroundWindow(), [ref]$fp)
# Defeat the foreground lock: share the input queue with the current foreground
# thread and tap ALT, without which SetForegroundWindow often only flashes the
# taskbar button.
[void][AggyRaiseW]::AttachThreadInput($mine, $other, $true)
[void][AggyRaiseW]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
[void][AggyRaiseW]::BringWindowToTop($h)
$ok = [AggyRaiseW]::SetForegroundWindow($h)
[void][AggyRaiseW]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
if (-not $ok) {
  # Last resort: minimising then restoring makes the shell pick a new
  # foreground window, and the restore lands on top.
  [void][AggyRaiseW]::ShowWindow($h, 6)
  Start-Sleep -Milliseconds 200
  [void][AggyRaiseW]::ShowWindow($h, 9)
  $ok = [AggyRaiseW]::SetForegroundWindow($h)
}
[void][AggyRaiseW]::AttachThreadInput($mine, $other, $false)
Start-Sleep -Milliseconds 300
$nowp = [uint32]0
[void][AggyRaiseW]::GetWindowThreadProcessId([AggyRaiseW]::GetForegroundWindow(), [ref]$nowp)
'RAISE hwnd=' + $h + ' area=' + $script:bestArea + ' setFG=' + $ok + ' foregroundIsTarget=' + ($nowp -eq $want)
`;

function raiseWindow(pid, appName, onResult) {
  const p = Number(pid);
  if (!Number.isInteger(p) || p <= 0) return;
  const done = typeof appName === 'function' ? appName : onResult;
  let cmd, args;
  if (process.platform === 'win32') {
    cmd = 'powershell.exe';
    // -Command does not populate $args from trailing tokens (only -File does),
    // so the pid has to be substituted into the script itself.
    args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', RAISE_PS.replace('__PID__', String(p))];
  } else if (process.platform === 'darwin') {
    cmd = 'osascript';
    args = ['-e', `tell application "${(appName || 'Antigravity')}" to activate`];
  } else {
    cmd = 'wmctrl';
    args = ['-a', 'Antigravity'];
  }
  try {
    const p = spawn(cmd, args, { detached: false, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    let out = '';
    p.stdout.on('data', d => { out += d.toString(); });
    p.on('error', err => { if (done) done('raise helper unavailable: ' + err.message); });
    p.on('close', () => { if (done) done(out.trim() || 'raise helper returned nothing'); });
    p.unref();
  } catch (err) {
    if (done) done('raise failed: ' + err.message);
  }
}

async function launch(ep, targetPath, onRaise, onSpawn) {
  const env = { ...process.env, ...buildEnv(ep) };
  const args = [
    `--proxy-server=http://${ep.host}:${ep.port}`,
    '--proxy-bypass-list=localhost;127.0.0.1;[::1]',
  ];
  const child = spawn(targetPath, args, {
    env,
    cwd: path.dirname(targetPath),
    detached: true,
    stdio: 'ignore',
    // Must stay false: windowsHide passes SW_HIDE to the child, and Antigravity
    // inherits it for its first window, so the UI never appears at all.
    windowsHide: false,
  });
  // The caller learns the pid at once, so CH03 can show the instance from the
  // moment it exists rather than after the settle delays below.
  if (onSpawn && child.pid) onSpawn(child.pid);
  let spawnError = null;
  let exitInfo = null;
  child.on('error', err => { spawnError = err; });
  child.on('exit', (code, signal) => { exitInfo = { code, signal }; });
  child.unref();
  // spawn() reports ENOENT etc. on the next tick, so read it after a short
  // settle instead of claiming success before the event can land.
  await new Promise(r => setTimeout(r, 400));
  if (spawnError) return { pid: child.pid, spawnError };
  // A client that quits within a second never drew a window. In practice that is
  // Electron's single-instance lock — another copy still owns the profile, so the
  // new one forwards its argv and exits 0. Report it instead of calling it a
  // successful launch, which otherwise leaves the user staring at a green UI and
  // no window.
  await new Promise(r => setTimeout(r, 900));
  if (exitInfo) return { pid: child.pid, spawnError: null, earlyExit: exitInfo };
  const appName = path.basename(path.dirname(path.dirname(targetPath)), '.app');
  raiseWindow(child.pid, appName, msg => { if (onRaise) onRaise(msg); });
  return { pid: child.pid, spawnError: null };
}

function openTerminal({ type = 'powershell', workDir, ep, runCommand }) {
  const validDir = workDir && fs.existsSync(workDir) ? workDir : (process.env.USERPROFILE || process.env.HOME || process.cwd());
  const env = { ...process.env, ...(ep ? buildEnv(ep) : {}) };
  // An optional command runs after the env is set, so the terminal opens
  // straight into e.g. the agy CLI instead of a bare prompt.
  const run = cmd => (runCommand ? `${cmd} && ` : '');

  if (process.platform === 'win32') {
    if (type === 'cmd') {
      const http = ep ? urlFor(ep, 'http') : '';
      const socks = ep ? urlFor(ep, 'socks5') : '';
      const tail = runCommand ? ` && "${runCommand}"` : '';
      const cmdScript = ep
        ? `cd /d "${validDir}" && set "HTTP_PROXY=${http}" && set "HTTPS_PROXY=${http}" && set "ALL_PROXY=${socks}" && set "NO_PROXY=localhost,127.0.0.1,::1" && echo [AGY] Proxy environment set -> ${http}${tail}`
        : `cd /d "${validDir}" && echo [AGY] Terminal ready${tail}`;
      const child = spawn('cmd.exe', ['/c', 'start', '""', 'cmd.exe', '/K', cmdScript], {
        cwd: validDir,
        env,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
      return { ok: true, dir: validDir };
    } else {
      // powershell
      const http = ep ? urlFor(ep, 'http') : '';
      const socks = ep ? urlFor(ep, 'socks5') : '';
      const tail = runCommand ? `; & '${runCommand}'` : '';
      const psScript = ep
        ? `Set-Location '${validDir}'; $env:HTTP_PROXY='${http}'; $env:HTTPS_PROXY='${http}'; $env:ALL_PROXY='${socks}'; $env:NO_PROXY='localhost,127.0.0.1,::1'; Write-Host '[AGY] Proxy environment set -> ${http}' -ForegroundColor Cyan${tail}`
        : `Set-Location '${validDir}'; Write-Host '[AGY] Terminal ready' -ForegroundColor Yellow${tail}`;
      const child = spawn('cmd.exe', ['/c', 'start', '""', 'powershell.exe', '-NoExit', '-Command', psScript], {
        cwd: validDir,
        env,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
      return { ok: true, dir: validDir };
    }
  } else if (process.platform === 'darwin') {
    // macOS
    const http = ep ? urlFor(ep, 'http') : '';
    const socks = ep ? urlFor(ep, 'socks5') : '';
    const envExports = ep
      ? `export HTTP_PROXY="${http}" && export HTTPS_PROXY="${http}" && export ALL_PROXY="${socks}" && export NO_PROXY="localhost,127.0.0.1,::1" && `
      : '';
    const tail = runCommand ? ` && '${runCommand}'` : '';
    const script = `tell application "Terminal" to do script "cd '${validDir}' && ${envExports}echo '[AGY] Proxy environment set'${tail}"` ;
    spawn('osascript', ['-e', script], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true, dir: validDir };
  } else {
    // Linux
    const http = ep ? urlFor(ep, 'http') : '';
    const socks = ep ? urlFor(ep, 'socks5') : '';
    const envExports = ep
      ? `export HTTP_PROXY="${http}"; export HTTPS_PROXY="${http}"; export ALL_PROXY="${socks}"; `
      : '';
    const tail = runCommand ? `; '${runCommand}'` : '';
    const child = spawn('x-terminal-emulator', ['-e', `bash -c "cd '${validDir}'; ${envExports}echo '[AGY] Proxy environment set'${tail}; exec bash"`], {
      cwd: validDir,
      env,
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', () => {
      spawn('gnome-terminal', ['--', 'bash', '-c', `cd '${validDir}'; ${envExports}echo '[AGY] Proxy environment set'${tail}; exec bash`], {
        cwd: validDir,
        env,
        detached: true,
        stdio: 'ignore',
      }).unref();
    });
    child.unref();
    return { ok: true, dir: validDir };
  }
}

// The CLI cannot be spawned headlessly: it is an interactive session and its
// output belongs in the user's terminal. Launching it therefore means opening
// a proxy-injected terminal that drops straight into agy.
function launchCli(ep, cliPath, { type, workDir } = {}) {
  const t = type || (process.platform === 'win32' ? 'powershell' : 'terminal');
  return openTerminal({ type: t, workDir, ep, runCommand: cliPath });
}

module.exports = {
  listProcesses, pickRunning, pickCliSessions, processStartEpoch,
  killInstances, buildEnv, buildProxyCommands, openTerminal, launchCli, launch, urlFor, redact, raiseWindow,
};
