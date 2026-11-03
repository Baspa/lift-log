// Bump on every deploy: a changed sw.js installs fresh files and the page reloads into them.
const CACHE = 'lift-log-v2';

const APP_SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/program.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  const freshShell = APP_SHELL.map((url) => new Request(url, { cache: 'reload' }));
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(freshShell)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Serve from cache for instant, offline starts; refresh the cache in the background so the next launch gets updates.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  const refreshed = fetch(request).then(async (response) => {
    if (response.ok) await caches.open(CACHE).then((cache) => cache.put(request, response.clone()));
    return response;
  });
  event.waitUntil(refreshed.catch(() => {}));
  event.respondWith(caches.match(request, { ignoreSearch: true }).then((cached) => cached ?? refreshed));
});
