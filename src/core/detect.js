const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const EXE = process.platform === 'win32' ? 'Antigravity.exe' : 'Antigravity';

function exists(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

// Depth-limited walk: a full recursive scan of LOCALAPPDATA\Programs can hit
// node_modules trees with hundreds of thousands of entries.
function findFile(root, name, maxDepth) {
  if (!root || !fs.existsSync(root)) return null;
  const stack = [[root, 0]];
  while (stack.length) {
    const [dir, depth] = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isFile() && e.name.toLowerCase() === name.toLowerCase()) return full;
      if (e.isDirectory() && depth + 1 < maxDepth && !/node_modules|\.git$/.test(e.name)) {
        stack.push([full, depth + 1]);
      }
    }
  }
  return null;
}

// The language server ships next to the binary; its presence is what proves this
// is a real Antigravity install rather than an unrelated same-named exe.
function languageServerFor(exePath) {
  const root = process.platform === 'darwin'
    ? path.join(path.dirname(path.dirname(exePath)), 'Resources', 'app')
    : path.join(path.dirname(exePath), 'resources');
  const ls = path.join(root, 'bin', process.platform === 'win32' ? 'language_server.exe' : 'language_server');
  return exists(ls) ? ls : null;
}

function readMacBundleExec(appDir) {
  try {
    const plist = fs.readFileSync(path.join(appDir, 'Contents', 'Info.plist'), 'utf8');
    const m = plist.match(/CFBundleExecutable[\s\S]{0,80}?<string>([^<]+)<\/string>/);
    if (m) return m[1].trim();
  } catch { /* fall through to default name */ }
  return EXE;
}

function macCandidates() {
  const dirs = ['/Applications', path.join(process.env.HOME || '', 'Applications')];
  const out = [];
  for (const d of dirs) {
    if (!fs.existsSync(d)) continue;
    for (const name of fs.readdirSync(d)) {
      if (!/antigrav/i.test(name)) continue;
      const app = path.join(d, name);
      const exec = path.join(app, 'Contents', 'MacOS', readMacBundleExec(app));
      if (exists(exec)) out.push(exec);
    }
  }
  return out;
}

function winCandidates() {
  const la = process.env.LOCALAPPDATA || '';
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  return [
    path.join(la, 'Programs', 'antigravity', EXE),
    path.join(la, 'Programs', 'Antigravity', EXE),
    path.join(pf, 'Antigravity', EXE),
    path.join(pf86, 'Antigravity', EXE),
  ];
}

function linuxCandidates() {
  const out = [
    '/opt/Antigravity/antigravity', '/opt/Antigravity/Antigravity',
    '/usr/local/bin/antigravity', '/usr/bin/antigravity',
    path.join(process.env.HOME || '', '.local', 'bin', 'antigravity'),
  ];
  // .desktop Exec= lines are the most reliable pointer on Linux — packagers put
  // the real path there and nothing else does.
  for (const dir of [path.join(process.env.HOME || '', '.local', 'share', 'applications'), '/usr/share/applications']) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!/antigrav/i.test(f) || !f.endsWith('.desktop')) continue;
      try {
        const exec = fs.readFileSync(path.join(dir, f), 'utf8').match(/^Exec=(.+)$/m);
        if (exec) out.push(exec[1].trim().replace(/"%?"$/g, '').replace(/ %u$/, '').trim());
      } catch { /* skip unreadable desktop file */ }
    }
  }
  return out;
}

function detect() {
  const candidates = process.platform === 'darwin'
    ? macCandidates()
    : process.platform === 'win32' ? winCandidates() : linuxCandidates();

  for (const c of candidates) {
    if (c && exists(c)) return pack(c, 'auto:known-location');
  }

  if (process.platform === 'win32') {
    const hit = findFile(path.join(process.env.LOCALAPPDATA || '', 'Programs'), EXE, 3);
    if (hit) return pack(hit, 'auto:scan');
  }
  if (process.platform === 'darwin') {
    const hit = spawnSync('mdfind', ['kMDItemFSName == "Antigravity.app"'], { encoding: 'utf8', timeout: 4000 });
    const app = (hit.stdout || '').split('\n').map(s => s.trim()).find(Boolean);
    if (app) {
      const exec = path.join(app, 'Contents', 'MacOS', readMacBundleExec(app));
      if (exists(exec)) return pack(exec, 'auto:mdfind');
    }
  }

  return { found: false, path: null, candidates };
}

function pack(exePath, source) {
  return {
    found: true,
    path: fs.realpathSync(exePath),
    source,
    languageServer: languageServerFor(exePath),
    processName: process.platform === 'win32' ? 'Antigravity.exe' : 'Antigravity',
  };
}

module.exports = { detect, exists, pack };
