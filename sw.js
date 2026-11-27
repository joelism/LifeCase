const PREFIX = 'lifecase-shell-';
const CACHE = 'lifecase-shell-624eadbbcdd3852d';
const SHELL = ["./","./index.html","./manifest.webmanifest","./icon-192.png","./icon-512.png","./site-assets/health-worker-Br50-MRN.js","./site-assets/html2canvas-m4xE4pCi.js","./site-assets/index-Djl2E3qN.css","./site-assets/index-WnNFR5xB.js","./site-assets/index.es-BLk4B4bZ.js","./site-assets/mail-file-DvgKVVgn.js","./site-assets/model-CO2EnlrM.js","./site-assets/pdf-CbKxDWWu.js","./site-assets/preload-helper-DUTjbZNf.js","./site-assets/purify.es-BQJV6A36.js","./site-assets/rolldown-runtime-Dl_DZoUm.js","./site-assets/typeof-B5XbjTb1.js"];
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
