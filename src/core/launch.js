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

function launch(ep, targetPath) {
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
  child.unref();
  return { pid: child.pid, spawnError: child.spawnerr || null };
}

module.exports = { listRunning, killInstances, buildEnv, launch, urlFor, redact };
