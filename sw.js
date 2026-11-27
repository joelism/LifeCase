const PREFIX = 'lifecase-shell-';
const CACHE = 'lifecase-shell-247582cd55f06884';
const SHELL = ["./","./index.html","./manifest.webmanifest","./icon-192.png","./icon-512.png","./site-assets/health-worker-B78SgD7n.js","./site-assets/html2canvas-saIJPa4Z.js","./site-assets/index-CpB11P7T.js","./site-assets/index-wpLcTmde.css","./site-assets/index.es-CUAmcuPQ.js","./site-assets/mail-file-DsKdyCgR.js","./site-assets/model-CUZOM7Mw.js","./site-assets/ocr-CJmArlkM.js","./site-assets/pdf-BMACD8v5.js","./site-assets/preload-helper-DUTjbZNf.js","./site-assets/purify.es-BQJV6A36.js","./site-assets/rolldown-runtime-DUjHZjTj.js","./site-assets/scan-layout-CufvVUw0.js","./site-assets/typeof-B5XbjTb1.js","./site-assets/worker.min-B9Bty8gg.js"];
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
