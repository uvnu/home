const CACHE = 'uvnu-v3';
const APP_SHELL = [
  '/', '/index.html', '/styles.css', '/app.js', '/manifest.json', '/icon.svg', '/sweden-search.js',
  '/sweden-places.json', '/sweden-local-areas-seed.json', '/sweden-local-areas-backlog.json', '/place-aliases.json', '/places-abroad-seed.json', '/city-pages.json'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = event.request.url;
  if (url.includes('open-meteo.com')) {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
    return;
  }
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then(response => {
      const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy)); return response;
    }).catch(() => caches.match(event.request).then(match => match || caches.match('/index.html'))));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    if (response && response.status === 200 && response.type !== 'opaque') {
      const clone = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, clone));
    }
    return response;
  })));
});
