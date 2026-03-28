import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { config } from './config.js';
import { RelayServer } from './server.js';
import type { RelayEntry } from './registry.js';

// Static web app serving at /
const WEB_BUILD_DIR = join(import.meta.dirname, '../../web/build');
const HAS_WEB_APP = existsSync(WEB_BUILD_DIR);

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(urlPath: string, res: import('node:http').ServerResponse): boolean {
  if (!HAS_WEB_APP) return false;

  let filePath = urlPath;

  // Try exact file, then index.html, then SPA fallback
  let fullPath = join(WEB_BUILD_DIR, filePath);

  if (existsSync(fullPath) && statSync(fullPath).isFile()) {
    const ext = extname(fullPath);
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable' });
    res.end(readFileSync(fullPath));
    return true;
  }

  // SPA fallback — serve index.html for all non-file routes
  const fallback = join(WEB_BUILD_DIR, 'index.html');
  if (existsSync(fallback)) {
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' });
    res.end(readFileSync(fallback));
    return true;
  }

  return false;
}

const startTime = Date.now();

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function dashboard(d: any): string {
  const upStr = formatUptime(d.uptime);
  const relayName = d.relayName ? escapeHtml(d.relayName) : 'agora<span>.</span> relay';
  const onlineRelays = (d.relays || []).filter((r: any) => r.online);
  const offlineRelays = (d.relays || []).filter((r: any) => !r.online);

  const peerRows = (d.peers || []).map((p: any) => {
    const key = escapeHtml(p.publicKey.slice(0, 12) + '...');
    const loc = p.geo ? escapeHtml([p.geo.city, p.geo.country].filter(Boolean).join(', ') || '—') : '—';
    return `<div class="peer-row"><span class="peer-key">${key}</span><span class="peer-loc">${loc}</span></div>`;
  }).join('');

  const relayRows = [...onlineRelays, ...offlineRelays].map((r: any) => {
    const name = escapeHtml(r.name || r.url);
    const dot = r.online
      ? '<span class="rdot on"></span>'
      : '<span class="rdot off"></span>';
    const region = escapeHtml(r.region || '—');
    const users = r.authenticated != null ? r.authenticated : '—';
    const objs = r.objects != null ? r.objects.toLocaleString() : '—';
    return `<div class="relay-row${r.online ? '' : ' dim'}">
      <div class="relay-row-left">${dot}<span class="relay-row-name">${name}</span></div>
      <div class="relay-row-meta"><span>${region}</span><span>${users} users</span><span>${objs} obj</span></div>
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Agora Relay — Operator Dashboard</title>
<style>
:root { --accent: #f97316; --bg: #07070a; --surface: #0e0e12; --raised: #141418; --text: #f0f0f0; --dim: #a0a0a8; --muted: #606068; --green: #4ade80; --red: #f87171; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Inter', -apple-system, sans-serif; background: var(--bg); color: var(--text); -webkit-font-smoothing: antialiased; }
.container { max-width: 900px; margin: 0 auto; padding: 32px 24px; }
.top-bar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 28px; }
.logo { font-size: 1.3rem; font-weight: 800; letter-spacing: -0.03em; }
.logo span { color: var(--accent); }
.live-badge { display: inline-flex; align-items: center; gap: 6px; padding: 3px 12px; border-radius: 20px; font-size: 0.72rem; font-weight: 500; background: rgba(74,222,128,0.1); color: var(--green); }
.live-badge .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--green); animation: pulse 2s infinite; }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
.top-links { display: flex; gap: 14px; font-size: 0.78rem; }
.top-links a { color: var(--muted); text-decoration: none; }
.top-links a:hover { color: var(--accent); }

/* Stats grid */
.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 24px; }
.stat { background: var(--surface); border: 1px solid rgba(255,255,255,0.04); border-radius: 10px; padding: 16px 14px; }
.stat .value { font-size: 1.6rem; font-weight: 700; color: var(--accent); font-family: 'JetBrains Mono', monospace; }
.stat .label { font-size: 0.68rem; color: var(--muted); margin-top: 3px; text-transform: uppercase; letter-spacing: 0.05em; }
.stat.network .value { color: var(--green); }

/* Two-column layout */
.columns { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }

/* Section cards */
.card { background: var(--surface); border: 1px solid rgba(255,255,255,0.04); border-radius: 12px; padding: 16px; }
.card h3 { font-size: 0.75rem; font-weight: 600; color: var(--dim); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; }
.card .empty-msg { font-size: 0.8rem; color: var(--muted); padding: 12px 0; text-align: center; }

/* Peer rows */
.peer-row { display: flex; justify-content: space-between; align-items: center; padding: 7px 0; border-bottom: 1px solid rgba(255,255,255,0.03); font-size: 0.82rem; }
.peer-row:last-child { border-bottom: none; }
.peer-key { font-family: 'JetBrains Mono', monospace; font-size: 0.78rem; color: var(--accent); }
.peer-loc { color: var(--dim); font-size: 0.78rem; }

/* Relay rows */
.relay-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.03); font-size: 0.82rem; }
.relay-row:last-child { border-bottom: none; }
.relay-row.dim { opacity: 0.45; }
.relay-row-left { display: flex; align-items: center; gap: 8px; min-width: 0; }
.relay-row-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 220px; }
.relay-row-meta { display: flex; gap: 12px; font-size: 0.72rem; color: var(--dim); font-family: 'JetBrains Mono', monospace; white-space: nowrap; }
.rdot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.rdot.on { background: var(--green); }
.rdot.off { background: var(--red); }

/* Info rows */
.info-row { display: flex; justify-content: space-between; align-items: center; padding: 7px 0; border-bottom: 1px solid rgba(255,255,255,0.03); font-size: 0.82rem; }
.info-row:last-child { border-bottom: none; }
.info-label { color: var(--dim); }
.info-value { color: var(--text); font-family: 'JetBrains Mono', monospace; font-size: 0.78rem; }
.info-value.accent { color: var(--accent); }

/* Connect box */
.connect-box { background: var(--raised); border: 1px solid rgba(249,115,22,0.15); border-radius: 12px; padding: 16px; text-align: center; margin-bottom: 24px; }
.connect-label { font-size: 0.78rem; color: var(--dim); margin-bottom: 6px; }
.connect-url { font-family: 'JetBrains Mono', monospace; font-size: 0.82rem; color: var(--accent); word-break: break-all; padding: 8px; background: var(--bg); border-radius: 6px; cursor: pointer; border: 1px solid rgba(255,255,255,0.04); transition: border-color 0.2s; }
.connect-url:hover { border-color: var(--accent); }
.connect-hint { font-size: 0.68rem; color: var(--muted); margin-top: 6px; }

.footer { text-align: center; font-size: 0.7rem; color: var(--muted); margin-top: 24px; }
.footer a { color: var(--muted); text-decoration: none; }
.footer a:hover { color: var(--accent); }

@media (max-width: 640px) {
  .stats { grid-template-columns: repeat(2, 1fr); }
  .columns { grid-template-columns: 1fr; }
}
</style>
</head>
<body>
<div class="container">
  <div class="top-bar">
    <div style="display:flex;align-items:center;gap:10px;">
      <div class="logo">${relayName}</div>
      <div class="live-badge"><span class="dot"></span> live</div>
    </div>
    <div class="top-links">
      <a href="/">Open Agora</a>
      <a href="/network">Network</a>
      <a href="/health">API</a>
      <a href="https://github.com/vortex-303/agora">GitHub</a>
    </div>
  </div>

  <!-- This Relay Stats -->
  <div class="stats">
    <div class="stat">
      <div class="value">${d.authenticated}</div>
      <div class="label">Connected Users</div>
    </div>
    <div class="stat">
      <div class="value">${d.objects.toLocaleString()}</div>
      <div class="label">Objects Stored</div>
    </div>
    <div class="stat">
      <div class="value">${upStr}</div>
      <div class="label">Uptime</div>
    </div>
    <div class="stat">
      <div class="value">${d.countries}</div>
      <div class="label">Countries</div>
    </div>
  </div>

  <!-- Network-wide totals -->
  <div class="stats">
    <div class="stat network">
      <div class="value">${(d.relays || []).filter((r: any) => r.online).length}</div>
      <div class="label">Relays Online</div>
    </div>
    <div class="stat network">
      <div class="value">${d.networkUsers}</div>
      <div class="label">Network Users</div>
    </div>
    <div class="stat network">
      <div class="value">${d.networkObjects.toLocaleString()}</div>
      <div class="label">Network Objects</div>
    </div>
    <div class="stat network">
      <div class="value">${d.syncPeers}</div>
      <div class="label">Sync Peers</div>
    </div>
  </div>

  <!-- Two-column: Connected Peers | Known Relays -->
  <div class="columns">
    <div class="card">
      <h3>Connected Peers (${(d.peers || []).length})</h3>
      ${(d.peers || []).length > 0 ? peerRows : '<div class="empty-msg">No peers connected</div>'}
    </div>
    <div class="card">
      <h3>Known Relays (${(d.relays || []).length})</h3>
      ${(d.relays || []).length > 0 ? relayRows : '<div class="empty-msg">No other relays discovered</div>'}
    </div>
  </div>

  <!-- Relay info -->
  <div class="columns">
    <div class="card">
      <h3>This Relay</h3>
      <div class="info-row">
        <span class="info-label">Region</span>
        <span class="info-value">${escapeHtml(d.region)}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Peer Relays</span>
        <span class="info-value">${d.peerRelays} configured</span>
      </div>
      <div class="info-row">
        <span class="info-label">Sync Peers</span>
        <span class="info-value accent">${d.syncPeers} connected</span>
      </div>
      <div class="info-row">
        <span class="info-label">Total Clients</span>
        <span class="info-value">${d.clients} (${d.authenticated} auth)</span>
      </div>
    </div>
    <div class="card">
      <h3>Software</h3>
      <div class="info-row">
        <span class="info-label">Software</span>
        <span class="info-value">@agora/relay v0.2.0</span>
      </div>
      <div class="info-row">
        <span class="info-label">Protocol</span>
        <span class="info-value">WebSocket + JSON</span>
      </div>
      <div class="info-row">
        <span class="info-label">Auth</span>
        <span class="info-value">Ed25519 challenge</span>
      </div>
      <div class="info-row">
        <span class="info-label">Storage</span>
        <span class="info-value">JSONL on disk</span>
      </div>
    </div>
  </div>

  <div class="connect-box">
    <div class="connect-label">Connect your Agora client to this relay</div>
    <div class="connect-url" onclick="navigator.clipboard.writeText(this.textContent.trim()).then(()=>this.style.borderColor='#4ade80')" title="Click to copy">wss://${d.hostname || 'your-relay-url'}</div>
    <div class="connect-hint">Settings → Relays → Paste this URL</div>
  </div>

  <div class="footer">
    <a href="https://agorap2p.com">agorap2p.com</a> · <a href="https://app.agorap2p.com">Open Agora</a> · Auto-refreshes every 10s
  </div>
</div>
<script>setTimeout(()=>location.reload(), 10000);</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function networkPage(relays: RelayEntry[]): string {
  const onlineCount = relays.filter(r => r.online).length;
  const totalObjects = relays.reduce((sum, r) => sum + (r.objects || 0), 0);
  const totalUsers = relays.reduce((sum, r) => sum + (r.authenticated || 0), 0);

  const relayRows = relays.map(r => {
    const name = escapeHtml(r.name || r.url);
    const status = r.online
      ? '<span class="status on"><span class="dot"></span> online</span>'
      : '<span class="status off">offline</span>';
    const region = escapeHtml(r.region || '—');
    const up = r.online && r.uptime ? formatUptime(r.uptime) : '—';
    const objs = r.objects != null ? r.objects.toLocaleString() : '—';
    const users = r.authenticated != null ? String(r.authenticated) : '—';
    const desc = r.description ? `<div class="relay-desc">${escapeHtml(r.description)}</div>` : '';
    const contact = r.contact ? `<div class="relay-contact">${escapeHtml(r.contact)}</div>` : '';
    const url = escapeHtml(r.url);

    return `<div class="relay-card${r.online ? '' : ' offline'}">
      <div class="relay-header">
        <div class="relay-name">${name}</div>
        ${status}
      </div>
      ${desc}
      <div class="relay-url" onclick="navigator.clipboard.writeText('${url}').then(()=>this.style.borderColor='#4ade80')" title="Click to copy">${url}</div>
      ${contact}
      <div class="relay-stats">
        <div class="rs"><span class="rs-val">${region}</span><span class="rs-lbl">Region</span></div>
        <div class="rs"><span class="rs-val">${up}</span><span class="rs-lbl">Uptime</span></div>
        <div class="rs"><span class="rs-val">${objs}</span><span class="rs-lbl">Objects</span></div>
        <div class="rs"><span class="rs-val">${users}</span><span class="rs-lbl">Users</span></div>
      </div>
    </div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Agora Network — Relay Nodes</title>
<meta http-equiv="refresh" content="30">
<style>
:root { --accent: #f97316; --bg: #07070a; --surface: #0e0e12; --raised: #141418; --text: #f0f0f0; --dim: #a0a0a8; --muted: #606068; --green: #4ade80; --red: #f87171; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Inter', -apple-system, sans-serif; background: var(--bg); color: var(--text); -webkit-font-smoothing: antialiased; }
.container { max-width: 800px; margin: 0 auto; padding: 40px 24px; }
.header { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
.logo { font-size: 1.4rem; font-weight: 800; letter-spacing: -0.03em; }
.logo span { color: var(--accent); }
.subtitle { font-size: 0.85rem; color: var(--dim); margin-bottom: 32px; }
.summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 32px; }
.summary .stat { background: var(--surface); border: 1px solid rgba(255,255,255,0.04); border-radius: 12px; padding: 18px 16px; text-align: center; }
.summary .stat .value { font-size: 2rem; font-weight: 700; color: var(--accent); font-family: 'JetBrains Mono', monospace; }
.summary .stat .label { font-size: 0.75rem; color: var(--muted); margin-top: 4px; text-transform: uppercase; letter-spacing: 0.05em; }
.relay-card { background: var(--surface); border: 1px solid rgba(255,255,255,0.04); border-radius: 12px; padding: 20px; margin-bottom: 12px; transition: border-color 0.2s; }
.relay-card:hover { border-color: rgba(249,115,22,0.2); }
.relay-card.offline { opacity: 0.5; }
.relay-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.relay-name { font-size: 1.1rem; font-weight: 700; }
.status { display: inline-flex; align-items: center; gap: 6px; padding: 2px 10px; border-radius: 20px; font-size: 0.7rem; font-weight: 500; }
.status.on { background: rgba(74,222,128,0.1); color: var(--green); }
.status.off { background: rgba(248,113,113,0.1); color: var(--red); }
.status .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--green); animation: pulse 2s infinite; }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
.relay-desc { font-size: 0.8rem; color: var(--dim); margin-bottom: 8px; }
.relay-url { font-family: 'JetBrains Mono', monospace; font-size: 0.8rem; color: var(--accent); padding: 8px 12px; background: var(--bg); border-radius: 6px; cursor: pointer; border: 1px solid rgba(255,255,255,0.04); margin-bottom: 8px; transition: border-color 0.2s; }
.relay-url:hover { border-color: var(--accent); }
.relay-contact { font-size: 0.7rem; color: var(--muted); margin-bottom: 8px; }
.relay-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.rs { text-align: center; }
.rs-val { display: block; font-size: 0.95rem; font-weight: 600; color: var(--text); font-family: 'JetBrains Mono', monospace; }
.rs-lbl { display: block; font-size: 0.65rem; color: var(--muted); text-transform: uppercase; margin-top: 2px; }
.empty { text-align: center; padding: 60px 20px; color: var(--dim); }
.empty p { margin-bottom: 16px; }
.run-relay { background: var(--raised); border: 1px solid rgba(249,115,22,0.15); border-radius: 12px; padding: 24px; margin-top: 32px; }
.run-relay h3 { font-size: 0.9rem; font-weight: 700; margin-bottom: 12px; color: var(--text); }
.run-relay code { display: block; font-family: 'JetBrains Mono', monospace; font-size: 0.8rem; color: var(--accent); padding: 12px 16px; background: var(--bg); border-radius: 6px; border: 1px solid rgba(255,255,255,0.04); margin-bottom: 8px; cursor: pointer; overflow-x: auto; white-space: pre; }
.run-relay code:hover { border-color: var(--accent); }
.run-relay .hint { font-size: 0.75rem; color: var(--muted); }
.links { display: flex; gap: 16px; justify-content: center; font-size: 0.8rem; margin-top: 32px; }
.links a { color: var(--muted); text-decoration: none; }
.links a:hover { color: var(--accent); }
@media (max-width: 480px) { .summary { grid-template-columns: 1fr; } .relay-stats { grid-template-columns: repeat(2, 1fr); } }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div class="logo">agora<span>.</span> network</div>
  </div>
  <div class="subtitle">Public relay nodes powering the Agora network</div>

  <div class="summary">
    <div class="stat">
      <div class="value">${onlineCount}</div>
      <div class="label">Relays Online</div>
    </div>
    <div class="stat">
      <div class="value">${totalObjects.toLocaleString()}</div>
      <div class="label">Total Objects</div>
    </div>
    <div class="stat">
      <div class="value">${totalUsers}</div>
      <div class="label">Connected Users</div>
    </div>
  </div>

  ${relays.length > 0 ? relayRows : '<div class="empty"><p>No relays registered yet.</p><p>Be the first to run one!</p></div>'}

  <div class="run-relay">
    <h3>Run a relay node</h3>
    <code onclick="navigator.clipboard.writeText(this.textContent.trim()).then(()=>this.style.borderColor='#4ade80')">curl -sL https://raw.githubusercontent.com/vortex-303/agora/main/deploy/docker-compose.community.yml -o docker-compose.yml && docker compose up -d</code>
    <div class="hint">Requires Docker. Your relay will auto-sync with the network. <a href="https://github.com/vortex-303/agora#run-a-relay" style="color:var(--accent)">Full docs</a></div>
  </div>

  <div class="links">
    <a href="/dashboard">This Relay</a>
    <a href="https://agorap2p.com">agorap2p.com</a>
    <a href="https://app.agorap2p.com">Open Agora</a>
    <a href="https://github.com/vortex-303/agora">GitHub</a>
    <a href="/relays">API</a>
  </div>
</div>
</body>
</html>`;
}

const server = createServer((req, res) => {
  const relay = (server as any).__relay as RelayServer;
  const stats = relay?.getStats() || {};

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ status: 'ok', ...stats }));
    return;
  }

  if (req.url === '/info') {
    const info = relay?.getInfo() || {};
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(info));
    return;
  }

  if (req.url === '/announce' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        relay?.getRegistry().handleAnnounce(data);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  if (req.url === '/relays') {
    const registry = relay?.getRegistry();
    const relays = registry?.getAll() || [];
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ relays, count: relays.length }));
    return;
  }

  if (req.url === '/network') {
    const registry = relay?.getRegistry();
    const relays = registry?.getAll() || [];
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(networkPage(relays));
    return;
  }

  if (req.url === '/dashboard') {
    const hostname = req.headers.host || 'localhost:9800';
    const dashData = relay?.getDashboardData() || {};
    const relayName = config.relayName || '';
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(dashboard({ ...dashData, hostname, relayName }));
    return;
  }

  // Serve web app SPA (fallback for all other routes)
  if (HAS_WEB_APP && serveStatic(req.url || '/', res)) return;

  res.writeHead(404);
  res.end('Not found');
});

const relay = new RelayServer(server);
(server as any).__relay = relay;

server.listen(config.port, () => {
  console.log(`[Agora Relay] Listening on port ${config.port}`);
  if (HAS_WEB_APP) {
    console.log(`[Agora Relay] Web app served at /`);
  }
  console.log(`[Agora Relay] Dashboard at /dashboard`);
});
