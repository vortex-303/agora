import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function startDashboard(port, store, node, startTime, dhtPublisher) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (url.pathname === '/api/stats') {
      const stats = node.getStats();
      const uptime = Math.floor((Date.now() - startTime) / 1000);
      const storageBytes = store.getStorageSize();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        uptime,
        peers: stats.peers,
        swarms: stats.swarms,
        objects: store.count(),
        authors: store.getAuthorCount(),
        served: stats.served,
        received: stats.received,
        storageMB: Math.round(storageBytes / 1024 / 1024 * 10) / 10,
        topics: node.getTopics(),
        neighborhood: store.getNeighborhoodStats(),
        dht: dhtPublisher ? dhtPublisher.getStats() : null,
      }));
      return;
    }

    if (url.pathname === '/api/objects') {
      const type = url.searchParams.get('type');
      const author = url.searchParams.get('author');
      const limit = parseInt(url.searchParams.get('limit') || '50');
      const objects = store.query({ type, author, limit });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(objects));
      return;
    }

    if (url.pathname === '/api/authors') {
      const authors = store.getAuthorStats();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(authors));
      return;
    }

    // Dashboard HTML
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(getDashboardHTML());
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`[dashboard] http://localhost:${port}`);
  });

  return server;
}

function getDashboardHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>agora seed — dashboard</title>
<style>
  :root { --accent: #f97316; --bg: #07070a; --surface: #0e0e12; --raised: #141418; --text: #f0f0f0; --dim: #a0a0a8; --muted: #606068; --mono: 'SF Mono', 'JetBrains Mono', monospace; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', -apple-system, sans-serif; background: var(--bg); color: var(--text); padding: 32px; max-width: 900px; margin: 0 auto; }
  h1 { font-size: 1.4rem; font-weight: 700; margin-bottom: 24px; }
  h1 span { color: var(--accent); }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
  .card { background: var(--surface); border: 1px solid rgba(255,255,255,0.04); border-radius: 12px; padding: 18px; }
  .stat-val { font-size: 1.8rem; font-weight: 700; color: var(--accent); font-family: var(--mono); }
  .stat-label { font-size: 0.7rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; margin-top: 4px; }
  .section { margin-bottom: 24px; }
  .section-title { font-size: 0.75rem; font-weight: 600; color: var(--dim); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 10px; }
  .table { width: 100%; border-collapse: collapse; }
  .table th { text-align: left; font-size: 0.7rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,0.04); }
  .table td { font-size: 0.8rem; padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,0.02); }
  .table td.mono { font-family: var(--mono); font-size: 0.7rem; color: var(--accent); }
  .topic-list { display: flex; flex-direction: column; gap: 4px; }
  .topic { font-family: var(--mono); font-size: 0.75rem; padding: 8px 12px; background: var(--raised); border-radius: 6px; color: var(--dim); }
  .dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 6px; }
  .dot-green { background: #4ade80; }
  .dot-yellow { background: #facc15; }
  .uptime { font-family: var(--mono); font-size: 0.8rem; color: var(--dim); }
  .refresh { color: var(--muted); font-size: 0.7rem; margin-top: 16px; }
  @media (max-width: 640px) { .grid { grid-template-columns: repeat(2, 1fr); } body { padding: 16px; } }
</style>
</head>
<body>
<h1>agora<span>.</span> seed</h1>

<div class="grid">
  <div class="card"><div class="stat-val" id="peers">-</div><div class="stat-label">peers</div></div>
  <div class="card"><div class="stat-val" id="objects">-</div><div class="stat-label">objects</div></div>
  <div class="card"><div class="stat-val" id="storage">-</div><div class="stat-label">MB stored</div></div>
  <div class="card"><div class="stat-val" id="served">-</div><div class="stat-label">served</div></div>
</div>

<div class="grid" style="grid-template-columns: repeat(4, 1fr);">
  <div class="card"><div class="stat-val" id="authors">-</div><div class="stat-label">authors hosted</div></div>
  <div class="card"><div class="stat-val" id="received">-</div><div class="stat-label">received</div></div>
  <div class="card"><div class="stat-val" id="uptime">-</div><div class="stat-label">uptime</div></div>
  <div class="card"><div class="stat-val" id="dhtNodes">-</div><div class="stat-label">DHT nodes</div></div>
</div>

<div class="section">
  <div class="section-title">Active swarms</div>
  <div class="topic-list" id="topics"></div>
</div>

<div class="section">
  <div class="section-title">Authors hosted</div>
  <table class="table" id="authorTable">
    <thead><tr><th>Author</th><th>Objects</th><th>Latest seq</th></tr></thead>
    <tbody></tbody>
  </table>
</div>

<div class="refresh">Auto-refreshes every 5s</div>

<script>
function fmt(s) {
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s/60) + 'm ' + (s%60) + 's';
  if (s < 86400) return Math.floor(s/3600) + 'h ' + Math.floor((s%3600)/60) + 'm';
  return Math.floor(s/86400) + 'd ' + Math.floor((s%86400)/3600) + 'h';
}

async function refresh() {
  try {
    const [stats, authors] = await Promise.all([
      fetch('/api/stats').then(r => r.json()),
      fetch('/api/authors').then(r => r.json()),
    ]);

    document.getElementById('peers').textContent = stats.peers;
    document.getElementById('objects').textContent = stats.objects.toLocaleString();
    document.getElementById('storage').textContent = stats.storageMB;
    document.getElementById('served').textContent = stats.served.toLocaleString();
    document.getElementById('received').textContent = stats.received.toLocaleString();
    document.getElementById('authors').textContent = stats.authors;
    document.getElementById('uptime').textContent = fmt(stats.uptime);
    document.getElementById('dhtNodes').textContent = stats.dht ? stats.dht.dhtNodes : '-';

    const topicsEl = document.getElementById('topics');
    topicsEl.innerHTML = stats.topics.map(t =>
      '<div class="topic"><span class="dot dot-green"></span>' + t.slice(0, 50) + (t.length > 50 ? '...' : '') + '</div>'
    ).join('');

    const tbody = document.querySelector('#authorTable tbody');
    tbody.innerHTML = authors.map(a =>
      '<tr><td class="mono">' + a.author.slice(0,16) + '...</td><td>' + a.count + '</td><td>' + a.maxSeq + '</td></tr>'
    ).join('');
  } catch {}
}

refresh();
setInterval(refresh, 5000);
</script>
</body>
</html>`;
}
