import { createServer } from 'node:http';
import { config } from './config.js';
import { RelayServer } from './server.js';

const server = createServer((req, res) => {
  if (req.url === '/health') {
    const relay = (server as any).__relay as RelayServer;
    const stats = relay?.getStats() || {};
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', ...stats }));
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
