const CACHE_NAME = 'agora-v2';

// Install: immediately take over
self.addEventListener('install', () => {
  self.skipWaiting();
});

// Activate: clean old caches, claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: only cache immutable hashed assets, everything else goes to network
self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Never intercept WebSocket upgrade or relay requests
  if (url.protocol === 'ws:' || url.protocol === 'wss:') return;
  if (url.hostname.includes('relay')) return;

  // Immutable hashed assets (SvelteKit fingerprinted files): cache-first
  if (url.pathname.includes('/_app/immutable/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Everything else: network only (no caching HTML — always get fresh)
  // This avoids stale app shell issues
});
