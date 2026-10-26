const net = require('net');
const http = require('http');
const { spawnSync } = require('child_process');

const LOGIN_TARGET = { host: 'accounts.google.com', port: 443 };
const MODEL_TARGET = { host: 'daily-cloudcode-pa.googleapis.com', port: 443 };

const PING_TARGETS = [
  { host: 'accounts.google.com', port: 443, id: 'google', label: 'Google' },
  { host: 'github.com', port: 443, id: 'github', label: 'GitHub' },
  { host: '1.1.1.1', port: 443, id: 'cloudflare', label: 'Cloudflare' },
];

const DEFAULT_CANDIDATES = [
  { port: 10808, label: 'v2rayN mixed' },
  { port: 10809, label: 'v2rayN http' },
  { port: 7890, label: 'Clash' },
  { port: 7897, label: 'Clash Verge' },
  { port: 7891, label: 'Clash socks' },
  { port: 1080, label: 'socks default' },
  { port: 20171, label: 'sing-box' },
  { port: 8118, label: 'Privoxy' },
];

function parseProxyUrl(input, fallbackScheme) {
  if (!input) return null;
  const raw = String(input).trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `${fallbackScheme}://${raw}`;
  try {
    const u = new URL(withScheme);
    const port = Number(u.port) || (u.protocol === 'socks5:' ? 1080 : 80);
    return {
      host: u.hostname,
      port,
      scheme: u.protocol.replace(':','').toLowerCase(),
      user: decodeURIComponent(u.username || '') || undefined,
      pass: decodeURIComponent(u.password || '') || undefined,
      raw: withScheme,
    };
  } catch { return null; }
}

// --- probes -----------------------------------------------------------------

function httpConnect(ep, target, timeout = 3500) {
  const t0 = Date.now();
  return new Promise(resolve => {
    const sock = net.connect({ host: ep.host, port: ep.port, timeout });
    let buf = '';
    const done = ok => {
      sock.destroy();
      resolve({ ...ok, rtt: Date.now() - t0 });
    };
    sock.on('error', () => done({ ok: false, reason: 'socket error' }));
    sock.on('timeout', () => done({ ok: false, reason: 'timeout' }));
    sock.on('data', chunk => {
      buf += chunk.toString('latin1');
      if (!buf.includes('\r\n\r\n') && !buf.includes('\n\n')) return;
      const status = buf.match(/HTTP\/\d(?:\.\d)?\s+(\d{3})/i);
      done(status
        ? { ok: status[1] === '200', reason: `CONNECT ${status[1]}` }
        : { ok: false, reason: 'non-HTTP response (not an HTTP proxy?)' });
    });
    const auth = ep.user ? `\r\nProxy-Authorization: Basic ${Buffer.from(`${ep.user}:${ep.pass || ''}`).toString('base64')}` : '';
    sock.write(`CONNECT ${target.host}:${target.port} HTTP/1.1\r\nHost: ${target.host}:${target.port}${auth}\r\n\r\n`);
  });
}

// Sends the domain, not a resolved IP: local DNS is exactly what is poisoned here.
function socks5Connect(ep, target, timeout = 3500) {
  const t0 = Date.now();
  return new Promise(resolve => {
    const sock = net.connect({ host: ep.host, port: ep.port, timeout });
    const done = ok => {
      sock.destroy();
      resolve({ ...ok, rtt: Date.now() - t0 });
    };
    sock.on('error', () => done({ ok: false, reason: 'socket error' }));
    sock.on('timeout', () => done({ ok: false, reason: 'timeout' }));
    const greeting = Buffer.from([0x05, 0x01, 0x00]);
    const hostBuf = Buffer.from(target.host, 'utf8');
    const req = Buffer.concat([
      Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]),
      hostBuf,
      Buffer.from([(target.port >> 8) & 0xff, target.port & 0xff]),
    ]);
    let phase = 0;
    let acc = Buffer.alloc(0);
    sock.on('data', chunk => {
      acc = Buffer.concat([acc, chunk]);
      if (phase === 0) {
        if (acc.length < 2) return;
        if (acc[0] !== 0x05 || acc[1] !== 0x00) {
          const isHttpReply = acc[0] === 0x48 /* H */;
          return done({
            ok: false,
            reason: isHttpReply ? 'answered HTTP, not SOCKS5' : `SOCKS5 greeting rejected (05 ${acc[1]})`,
          });
        }
        phase = 1; acc = Buffer.alloc(0); sock.write(req); return;
      }
      if (acc.length < 4) return;
      const rep = acc[1];
      done(rep === 0x00
        ? { ok: true, reason: 'SOCKS5 CONNECT 00' }
        : { ok: false, reason: `SOCKS5 reply code ${rep}` });
    });
    sock.write(greeting);
  });
}

async function classify(ep, timeout = 2500) {
  const [httpLogin, socksLogin] = await Promise.all([
    httpConnect(ep, LOGIN_TARGET, timeout),
    socks5Connect(ep, LOGIN_TARGET, timeout),
  ]);
  const kind = httpLogin.ok && socksLogin.ok ? 'mixed'
    : httpLogin.ok ? 'http'
    : socksLogin.ok ? 'socks5'
    : 'dead';
  const usable = kind === 'mixed' || kind === 'http' ? httpLogin
    : kind === 'socks5' ? socksLogin
    : { ok: false, reason: httpLogin.reason || socksLogin.reason || 'unreachable' };
  const model = kind === 'dead'
    ? { ok: false, reason: 'proxy unreachable' }
    : kind === 'socks5'
      ? await socks5Connect(ep, MODEL_TARGET, timeout)
      : await httpConnect(ep, MODEL_TARGET, timeout);
  return {
    ...ep, kind,
    loginOk: kind !== 'dead' && usable.ok,
    modelOk: model.ok,
    detail: kind === 'dead' ? (httpLogin.reason || 'no reply') : `${kind} verified`,
    modelDetail: model.reason,
  };
}

// --- system proxy readers ---------------------------------------------------

function winSystemProxy() {
  const r = spawnSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'], { encoding: 'utf8', timeout: 4000 });
  const text = r.stdout || '';
  const enabled = /ProxyEnable\s+REG_DWORD\s+0x1/.test(text);
  if (!enabled) return [];
  const m = text.match(/ProxyServer\s+REG_SZ\s+(.+)/);
  if (!m) return [];
  const out = [];
  for (const part of m[1].trim().split(';')) {
    const kv = part.includes('=') ? part.split('=') : ['http', part];
    const key = (kv[0] || '').trim().toLowerCase();
    const val = (kv[1] || '').trim();
    if (!val) continue;
    const ep = parseProxyUrl(val, key === 'socks' ? 'socks5' : 'http');
    if (ep && !out.some(o => o.host === ep.host && o.port === ep.port)) out.push({ ...ep, origin: 'system proxy' });
  }
  if (!out.length) {
    const ep = parseProxyUrl(m[1].trim(), 'http');
    if (ep) out.push({ ...ep, origin: 'system proxy' });
  }
  return out;
}

function macSystemProxy() {
  const r = spawnSync('scutil', ['--proxy'], { encoding: 'utf8', timeout: 4000 });
  const text = r.stdout || '';
  const get = k => (text.match(new RegExp(`${k}\\s*:\\s*(.+)`)) || [])[1]?.trim();
  const out = [];
  const push = (scheme, hostKey, portKey) => {
    if (get(`${scheme.toUpperCase()}Enable`) !== '1') return;
    const host = get(hostKey), port = get(portKey);
    if (!host || !port) return;
    const ep = parseProxyUrl(`${scheme}://${host}:${port}`, scheme);
    if (ep) out.push({ ...ep, origin: 'system proxy' });
  };
  push('http', 'HTTPProxy', 'HTTPPort');
  push('http', 'HTTPSProxy', 'HTTPSPort');
  push('socks5', 'SOCKSProxy', 'SOCKSPort');
  return out;
}

function linuxSystemProxy() {
  const out = [];
  const gs = (schema, key) => {
    const r = spawnSync('gsettings', ['get', schema, key], { encoding: 'utf8', timeout: 3000 });
    return r.status === 0 ? (r.stdout || '').replace(/[']:|'/g, '').trim() : '';
  };
  const mode = gs('org.gnome.system.proxy', 'mode');
  if (mode && mode !== 'none') {
    const host = gs('org.gnome.system.proxy.http', 'host');
    const port = gs('org.gnome.system.proxy.http', 'port');
    if (host && port && port !== '0') out.push({ ...parseProxyUrl(`http://${host}:${port}`, 'http'), origin: 'GNOME settings' });
    const sh = gs('org.gnome.system.proxy.socks', 'host');
    const sp = gs('org.gnome.system.proxy.socks', 'port');
    if (sh && sp && sp !== '0') out.push({ ...parseProxyUrl(`socks5://${sh}:${sp}`, 'socks5'), origin: 'GNOME settings' });
  }
  for (const v of [process.env.HTTPS_PROXY, process.env.https_proxy, process.env.HTTP_PROXY, process.env.http_proxy, process.env.ALL_PROXY]) {
    const ep = parseProxyUrl(v, 'http');
    if (ep) out.push({ ...ep, origin: 'environment' });
  }
  return out;
}

function systemProxies() {
  if (process.platform === 'win32') return winSystemProxy();
  if (process.platform === 'darwin') return macSystemProxy();
  return linuxSystemProxy();
}

function dedupe(list) {
  const seen = new Set();
  return list.filter(ep => {
    const k = `${ep.host}:${ep.port}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Candidates ordered so that whatever the OS reports is verified first, then the
// common local ports. Every entry still has to pass a real handshake.
function buildCandidates(manual) {
  const manualEp = parseProxyUrl(manual, 'http');
  const head = [];
  if (manualEp) head.push({ ...manualEp, origin: 'manual' });
  head.push(...systemProxies());
  const tail = DEFAULT_CANDIDATES.map(c => ({ host: '127.0.0.1', port: c.port, scheme: 'http', raw: `http://127.0.0.1:${c.port}`, origin: c.label }));
  return dedupe([...head, ...tail]);
}

async function scan(manual, onEach) {
  const candidates = buildCandidates(manual);
  const results = await Promise.all(candidates.map(async ep => {
    const r = await classify(ep);
    if (onEach) onEach(r);
    return r;
  }));
  const usable = results.filter(r => r.loginOk);
  return { results, best: usable.sort((a, b) => (b.modelOk - a.modelOk))[0] || null };
}

// --- ping & latency diagnostics ---------------------------------------------

async function pingTargets(ep, timeout = 3500) {
  if (!ep) {
    return Promise.all(PING_TARGETS.map(target => new Promise(resolve => {
      const t0 = Date.now();
      const sock = net.connect({ host: target.host, port: target.port, timeout });
      sock.on('connect', () => { sock.destroy(); resolve({ ...target, ok: true, rtt: Date.now() - t0 }); });
      sock.on('error', err => { sock.destroy(); resolve({ ...target, ok: false, reason: err.code || 'error', rtt: Date.now() - t0 }); });
      sock.on('timeout', () => { sock.destroy(); resolve({ ...target, ok: false, reason: 'timeout', rtt: timeout }); });
    })));
  }

  const connectFn = ep.kind === 'socks5' ? socks5Connect : httpConnect;
  return Promise.all(PING_TARGETS.map(async target => {
    const res = await connectFn(ep, target, timeout);
    return {
      ...target,
      ok: res.ok,
      rtt: res.rtt,
      reason: res.reason,
    };
  }));
}

// --- IP queries -------------------------------------------------------------

function queryJsonOverHttp(options, timeout = 4000) {
  return new Promise(resolve => {
    const req = http.get(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ ok: true, data: json });
        } catch {
          resolve({ ok: false, reason: 'parse error' });
        }
      });
    });
    req.on('error', err => resolve({ ok: false, reason: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, reason: 'timeout' }); });
    req.setTimeout(timeout);
  });
}

async function fetchIpInfo(ep) {
  const directPromise = queryJsonOverHttp('http://ip-api.com/json?fields=status,message,country,countryCode,city,query');

  let proxyPromise = Promise.resolve(null);
  if (ep) {
    if (ep.kind === 'socks5') {
      proxyPromise = new Promise(resolve => {
        const sock = net.connect({ host: ep.host, port: ep.port, timeout: 4000 });
        let resolved = false;
        const done = r => { if (!resolved) { resolved = true; sock.destroy(); resolve(r); } };
        sock.on('error', err => done({ ok: false, reason: err.message }));
        sock.on('timeout', () => done({ ok: false, reason: 'timeout' }));

        const greeting = Buffer.from([0x05, 0x01, 0x00]);
        const hostBuf = Buffer.from('ip-api.com', 'utf8');
        const req = Buffer.concat([
          Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]),
          hostBuf,
          Buffer.from([(80 >> 8) & 0xff, 80 & 0xff]),
        ]);

        let phase = 0;
        let acc = Buffer.alloc(0);
        let httpBuf = '';

        sock.on('data', chunk => {
          if (phase === 0) {
            acc = Buffer.concat([acc, chunk]);
            if (acc.length < 2) return;
            if (acc[0] !== 0x05 || acc[1] !== 0x00) return done({ ok: false, reason: 'socks greeting reject' });
            phase = 1; acc = Buffer.alloc(0); sock.write(req); return;
          }
          if (phase === 1) {
            acc = Buffer.concat([acc, chunk]);
            if (acc.length < 4) return;
            if (acc[1] !== 0x00) return done({ ok: false, reason: `socks connect fail: ${acc[1]}` });
            phase = 2;
            sock.write('GET /json?fields=status,message,country,countryCode,city,query HTTP/1.1\r\nHost: ip-api.com\r\nConnection: close\r\n\r\n');
            return;
          }
          httpBuf += chunk.toString('utf8');
          const bodyIndex = httpBuf.indexOf('\r\n\r\n');
          if (bodyIndex !== -1) {
            const body = httpBuf.slice(bodyIndex + 4);
            try {
              const json = JSON.parse(body);
              done({ ok: true, data: json });
            } catch { /* wait for more */ }
          }
        });
        sock.write(greeting);
      });
    } else {
      proxyPromise = queryJsonOverHttp({
        host: ep.host,
        port: ep.port,
        path: 'http://ip-api.com/json?fields=status,message,country,countryCode,city,query',
        headers: { Host: 'ip-api.com' },
      });
    }
  }

  const [directRes, proxyRes] = await Promise.all([directPromise, proxyPromise]);

  return {
    direct: directRes && directRes.ok && directRes.data.status === 'success' ? {
      ip: directRes.data.query,
      country: directRes.data.country,
      city: directRes.data.city,
      countryCode: directRes.data.countryCode,
    } : null,
    proxy: proxyRes && proxyRes.ok && proxyRes.data.status === 'success' ? {
      ip: proxyRes.data.query,
      country: proxyRes.data.country,
      city: proxyRes.data.city,
      countryCode: proxyRes.data.countryCode,
    } : null,
  };
}

module.exports = {
  scan, classify, buildCandidates, parseProxyUrl,
  httpConnect, socks5Connect, pingTargets, fetchIpInfo,
  LOGIN_TARGET, MODEL_TARGET, PING_TARGETS, DEFAULT_CANDIDATES,
};
