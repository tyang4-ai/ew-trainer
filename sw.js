// Keeps the trainer working offline. Bump CACHE when you upload a new version.
const CACHE = 'ew-trainer-v1';
const ASSETS = ["./", "./index.html", "./manifest.webmanifest", "./fonts/archivo.woff2", "./fonts/bodoni-moda.woff2", "./fonts/bodoni-moda-italic.woff2", "./icons/icon-180.png", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png"];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Answer from the cache right away, and refresh the cached copy in the background when online.
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  const network = fetch(req).then(async res => {
    if (res && res.ok) { const cache = await caches.open(CACHE); await cache.put(req, res.clone()); }
    return res;
  }).catch(() => null);
  event.waitUntil(network);
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = (await cache.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? await cache.match('./') : undefined);
    if (hit) return hit;
    const res = await network;
    return res || new Response('Offline, and this file is not saved yet.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  })());
});
