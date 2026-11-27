const PREFIX = 'lifecase-shell-';
const CACHE = '__LIFECASE_CACHE__';
const SHELL = __LIFECASE_FILES__;
const root = new URL('./', self.location.href);
const urls = new Set(SHELL.map(path => new URL(path, root).href));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll([...urls])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== root.origin) return;
  if (event.request.mode === 'navigate' && (url.pathname === root.pathname || url.pathname === root.pathname + 'index.html')) {
    event.respondWith(fetch(event.request).catch(() => caches.open(CACHE).then(cache => cache.match(root.href))));
    return;
  }
  if (urls.has(url.href)) event.respondWith(caches.open(CACHE).then(cache => cache.match(event.request)).then(response => response || fetch(event.request)));
});
