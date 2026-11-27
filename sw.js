const PREFIX = 'lifecase-shell-';
const CACHE = 'lifecase-shell-89982d3a7dd3f5c2';
const SHELL = ["./","./index.html","./manifest.webmanifest","./icon-192.png","./icon-512.png","./site-assets/health-worker-C-Y2IkGT.js","./site-assets/html2canvas-saIJPa4Z.js","./site-assets/index-BfOhjX1n.css","./site-assets/index-BqwJwGXE.js","./site-assets/index.es-CUAmcuPQ.js","./site-assets/mail-file-DN5sBaSs.js","./site-assets/model-DpnCGh3K.js","./site-assets/ocr-o4e5i9lt.js","./site-assets/pdf-DW2Cm6KI.js","./site-assets/preload-helper-DUTjbZNf.js","./site-assets/purify.es-BQJV6A36.js","./site-assets/rolldown-runtime-DUjHZjTj.js","./site-assets/scan-layout-WT8pvM8y.js","./site-assets/typeof-B5XbjTb1.js","./site-assets/worker.min-B9Bty8gg.js"];
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

self.addEventListener('push', event => {
  let kind;
  try { kind = event.data?.json()?.kind; } catch { return; }
  if (kind !== 'expiry') return;
  event.waitUntil(self.registration.showNotification('LifeCase · Ablauferinnerung', {
    body: 'Ein Dokument läuft demnächst ab. Öffne LifeCase für die Einzelheiten.',
    icon: new URL('icon-192.png', root).href,
    tag: 'lifecase-document-expiry',
  }));
});
self.addEventListener('notificationclick', event => {
  if (event.notification.tag !== 'lifecase-document-expiry') return;
  event.notification.close();
  event.waitUntil((async () => {
    const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const current = pages.find(page => new URL(page.url).pathname === root.pathname);
    if (current) {
      await current.focus();
      current.postMessage({ type: 'open-reminders' });
    } else {
      const url = new URL(root);
      url.searchParams.set('lcView', 'reminders');
      await self.clients.openWindow(url.href);
    }
  })());
});
