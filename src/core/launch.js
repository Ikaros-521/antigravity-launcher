const { spawn, spawnSync } = require('child_process');
const path = require('path');

// The launcher's own executable is named "Antigravity Launcher.exe" /
// "Antigravity.Launcher-*.exe", so a prefix match on "antigravity" would
// report the launcher as a stale Antigravity instance — and then kill it.
function listRunning(targetPath) {
  const base = (targetPath ? path.basename(targetPath) : 'Antigravity').toLowerCase();
  const isTarget = name => name.toLowerCase() === base;
  const self = process.pid;

  if (process.platform === 'win32') {
    const r = spawnSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8' });
    return (r.stdout || '').split('\n').map(line => {
      const m = line.match(/^"([^"]+)","(\d+)"/);
      if (!m) return null;
      const pid = Number(m[2]);
      return isTarget(m[1]) && pid !== self ? { name: m[1], pid } : null;
    }).filter(Boolean);
  }
  const r = spawnSync('ps', ['-axo', 'pid=,comm='], { encoding: 'utf8' });
  return (r.stdout || '').split('\n').map(line => {
    const m = line.trim().match(/^(\d+)\s+(.+)$/);
    if (!m) return null;
    const pid = Number(m[1]);
    const name = path.basename(m[2]);
    return isTarget(name) && pid !== self ? { name, pid } : null;
  }).filter(Boolean);
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

async function launch(ep, targetPath, onRaise) {
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
  let spawnError = null;
  child.on('error', err => { spawnError = err; });
  child.unref();
  // spawn() reports ENOENT etc. on the next tick, so read it after a short
  // settle instead of claiming success before the event can land.
  await new Promise(r => setTimeout(r, 400));
  if (!spawnError) {
    const appName = path.basename(path.dirname(path.dirname(targetPath)), '.app');
    raiseWindow(child.pid, appName, msg => { if (onRaise) onRaise(msg); });
  }
  return { pid: child.pid, spawnError };
}

module.exports = { listRunning, killInstances, buildEnv, launch, urlFor, redact, raiseWindow };
