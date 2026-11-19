// LensIQ service worker (#35). Makes the app installable and quick to open.
// - Never touches /api: data always comes live from the server (and Cloudflare Access).
// - Pages: network first, falling back to the cached shell when offline.
// - Built assets (hashed file names): cache first.
const CACHE = 'lensiq-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Only cache real app pages, not a Cloudflare Access sign-in redirect.
          if (res.ok && !res.redirected) caches.open(CACHE).then((c) => c.put('shell', res.clone()));
          return res;
        })
        .catch(() => caches.open(CACHE).then((c) => c.match('shell')).then((r) => r ?? Response.error())),
    );
    return;
  }

  if (url.pathname.includes('/assets/')) {
    event.respondWith(
      caches.open(CACHE).then((c) =>
        c.match(req).then(
          (hit) =>
            hit ??
            fetch(req).then((res) => {
              if (res.ok) c.put(req, res.clone());
              return res;
            }),
        ),
      ),
    );
  }
});
