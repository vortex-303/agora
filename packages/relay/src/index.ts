import { createServer } from 'node:http';
import { config } from './config.js';
import { RelayServer } from './server.js';

const startTime = Date.now();

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function dashboard(stats: any): string {
  const upStr = formatUptime(stats.uptime);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Agora Relay</title>
<meta http-equiv="refresh" content="15">
<style>
:root { --accent: #f97316; --bg: #07070a; --surface: #0e0e12; --raised: #141418; --text: #f0f0f0; --dim: #a0a0a8; --muted: #606068; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Inter', -apple-system, sans-serif; background: var(--bg); color: var(--text); -webkit-font-smoothing: antialiased; }
.container { max-width: 640px; margin: 0 auto; padding: 40px 24px; }
.header { display: flex; align-items: center; gap: 12px; margin-bottom: 32px; }
.logo { font-size: 1.4rem; font-weight: 800; letter-spacing: -0.03em; }
.logo span { color: var(--accent); }
.badge { display: inline-flex; align-items: center; gap: 6px; padding: 3px 12px; border-radius: 20px; font-size: 0.75rem; font-weight: 500; background: rgba(74,222,128,0.1); color: #4ade80; }
.badge .dot { width: 6px; height: 6px; border-radius: 50%; background: #4ade80; animation: pulse 2s infinite; }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
.stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 32px; }
.stat { background: var(--surface); border: 1px solid rgba(255,255,255,0.04); border-radius: 12px; padding: 18px 16px; }
.stat .value { font-size: 1.8rem; font-weight: 700; color: var(--accent); font-family: 'JetBrains Mono', monospace; }
.stat .label { font-size: 0.75rem; color: var(--muted); margin-top: 4px; text-transform: uppercase; letter-spacing: 0.05em; }
.section { margin-bottom: 24px; }
.section h3 { font-size: 0.8rem; font-weight: 600; color: var(--dim); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; }
.info-card { background: var(--surface); border: 1px solid rgba(255,255,255,0.04); border-radius: 12px; padding: 16px; }
.info-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.03); font-size: 0.85rem; }
.info-row:last-child { border-bottom: none; }
.info-label { color: var(--dim); }
.info-value { color: var(--text); font-family: 'JetBrains Mono', monospace; font-size: 0.8rem; }
.info-value.accent { color: var(--accent); }
.connect-box { background: var(--raised); border: 1px solid rgba(249,115,22,0.15); border-radius: 12px; padding: 18px; text-align: center; margin-bottom: 24px; }
.connect-label { font-size: 0.8rem; color: var(--dim); margin-bottom: 8px; }
.connect-url { font-family: 'JetBrains Mono', monospace; font-size: 0.85rem; color: var(--accent); word-break: break-all; padding: 10px; background: var(--bg); border-radius: 6px; cursor: pointer; border: 1px solid rgba(255,255,255,0.04); }
.connect-url:hover { border-color: var(--accent); }
.connect-hint { font-size: 0.7rem; color: var(--muted); margin-top: 8px; }
.links { display: flex; gap: 16px; justify-content: center; font-size: 0.8rem; margin-top: 32px; }
.links a { color: var(--muted); text-decoration: none; }
.links a:hover { color: var(--accent); }
@media (max-width: 480px) { .stats { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div class="logo">agora<span>.</span> relay</div>
    <div class="badge"><span class="dot"></span> live</div>
  </div>

  <div class="stats">
    <div class="stat">
      <div class="value">${stats.authenticated}</div>
      <div class="label">Connected Users</div>
    </div>
    <div class="stat">
      <div class="value">${stats.objects.toLocaleString()}</div>
      <div class="label">Objects Stored</div>
    </div>
    <div class="stat">
      <div class="value">${stats.countries}</div>
      <div class="label">Countries</div>
    </div>
    <div class="stat">
      <div class="value">${upStr}</div>
      <div class="label">Uptime</div>
    </div>
  </div>

  <div class="connect-box">
    <div class="connect-label">Connect your Agora client to this relay</div>
    <div class="connect-url" onclick="navigator.clipboard.writeText(this.textContent.trim()).then(()=>this.style.borderColor='#4ade80')" title="Click to copy">wss://${stats.hostname || 'your-relay-url'}</div>
    <div class="connect-hint">Settings → Relays → Paste this URL</div>
  </div>

  <div class="section">
    <h3>Network</h3>
    <div class="info-card">
      <div class="info-row">
        <span class="info-label">Region</span>
        <span class="info-value">${stats.region}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Peer Relays</span>
        <span class="info-value">${stats.peerRelays} configured</span>
      </div>
      <div class="info-row">
        <span class="info-label">Sync Peers</span>
        <span class="info-value accent">${stats.syncPeers} connected</span>
      </div>
      <div class="info-row">
        <span class="info-label">Total Clients</span>
        <span class="info-value">${stats.clients} (${stats.authenticated} authenticated)</span>
      </div>
    </div>
  </div>

  <div class="section">
    <h3>About</h3>
    <div class="info-card">
      <div class="info-row">
        <span class="info-label">Software</span>
        <span class="info-value">@agora/relay</span>
      </div>
      <div class="info-row">
        <span class="info-label">Protocol</span>
        <span class="info-value">WebSocket + JSON</span>
      </div>
      <div class="info-row">
        <span class="info-label">Encryption</span>
        <span class="info-value">Ed25519 auth, E2E DMs</span>
      </div>
      <div class="info-row">
        <span class="info-label">Storage</span>
        <span class="info-value">JSONL on disk</span>
      </div>
    </div>
  </div>

  <div class="links">
    <a href="https://agorap2p.com">agorap2p.com</a>
    <a href="https://app.agorap2p.com">Open Agora</a>
    <a href="https://github.com/vortex-303/agora">GitHub</a>
    <a href="/health">API</a>
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

  if (req.url === '/' || req.url === '') {
    const hostname = req.headers.host || 'localhost:9800';
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(dashboard({ ...stats, hostname }));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

const relay = new RelayServer(server);
(server as any).__relay = relay;

server.listen(config.port, () => {
  console.log(`[Agora Relay] Listening on port ${config.port}`);
});
