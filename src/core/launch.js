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
param()
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Collections.Generic;
public class AggyRaise {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
}
"@
$want = [uint32]$args[0]
$hits = New-Object System.Collections.Generic.List[IntPtr]
$cb = [AggyRaise+EnumProc]{
  param($h, $l)
  $p = [uint32]0
  [void][AggyRaise]::GetWindowThreadProcessId($h, [ref]$p)
  if ($p -eq $want -and [AggyRaise]::IsWindowVisible($h)) { $hits.Add($h) }
  return $true
}
$deadline = (Get-Date).AddSeconds(12)
while ((Get-Date) -lt $deadline) {
  $hits.Clear()
  [void][AggyRaise]::EnumWindows($cb, [IntPtr]::Zero)
  if ($hits.Count -gt 0) {
    $h = $hits[0]
    [void][AggyRaise]::ShowWindow($h, 9)
    [void][AggyRaise]::BringWindowToTop($h)
    [void][AggyRaise]::SetForegroundWindow($h)
    break
  }
  Start-Sleep -Milliseconds 400
}
`;

function raiseWindow(pid, appName) {
  if (!pid) return;
  let cmd, args;
  if (process.platform === 'win32') {
    cmd = 'powershell.exe';
    args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', RAISE_PS, String(pid)];
  } else if (process.platform === 'darwin') {
    cmd = 'osascript';
    args = ['-e', `tell application "${appName || 'Antigravity'}" to activate`];
  } else {
    cmd = 'wmctrl';
    args = ['-a', 'Antigravity'];
  }
  try {
    const p = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
    p.on('error', () => { /* raising is best effort; never fail a launch over it */ });
    p.unref();
  } catch { /* same */ }
}

async function launch(ep, targetPath) {
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
    windowsHide: true,
  });
  let spawnError = null;
  child.on('error', err => { spawnError = err; });
  child.unref();
  // spawn() reports ENOENT etc. on the next tick, so read it after a short
  // settle instead of claiming success before the event can land.
  await new Promise(r => setTimeout(r, 400));
  if (!spawnError) raiseWindow(child.pid, path.basename(path.dirname(path.dirname(targetPath)), '.app'));
  return { pid: child.pid, spawnError };
}

module.exports = { listRunning, killInstances, buildEnv, launch, urlFor, redact, raiseWindow };
