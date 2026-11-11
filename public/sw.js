// Offline support: the app itself is cached so it opens without signal,
// and map tiles you have already viewed are kept for use on site.
const APP = 'utility-mapper-app-v1';
const TILES = 'utility-mapper-tiles-v1';
const TILE_HOSTS = ['tile.openstreetmap.org', 'server.arcgisonline.com'];
const MAX_TILES = 3000;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

async function trim(cache) {
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_TILES))) await cache.delete(k);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (TILE_HOSTS.includes(url.hostname)) {
    // Tiles: cache first.
    event.respondWith(
      caches.open(TILES).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') {
          cache.put(req, res.clone());
          trim(cache);
        }
        return res;
      }),
    );
    return;
  }

  if (url.origin === self.location.origin) {
    // App files: network first so updates arrive, cache when offline.
    event.respondWith(
      caches.open(APP).then(async (cache) => {
        try {
          const res = await fetch(req);
          if (res.ok) cache.put(req, res.clone());
          return res;
        } catch (err) {
          const hit = (await cache.match(req)) || (req.mode === 'navigate' && (await cache.match('./')));
          if (hit) return hit;
          throw err;
        }
      }),
    );
  }
});
