// Network-first, cache as fallback.
//
// There is no build step to hash filenames, so a cache-first worker would pin
// visitors to whatever was cached on their first visit and no deploy would ever
// reach them. Going to the network first keeps the app current; the cache only
// takes over when the network fails, which is what makes it work
// offline.
const CACHE = 'ict';
const SHELL = [
  './',
  'index.html',
  'style.css',
  'core.js',
  'loading.js',
  'native.js',
  'app.js',
  'icon.png',
  'manifest.webmanifest',
  'clips.json',
];
// The pictures are a few megabytes and only fetched once the detail levels want
// them, so they are left to the runtime cache rather than forced on every install.

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then(async response => {
        if (!response.ok) return await caches.match(request) || response;
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE)
          .then(cache => cache.put(request, copy))
          .catch(() => {}));
        return response;
      })
      .catch(() => caches.match(request).then(hit =>
        hit || (request.mode === 'navigate' ? caches.match('index.html') : Promise.reject(new Error('offline')))
      ))
  );
});
