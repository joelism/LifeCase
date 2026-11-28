const PREFIX = 'lifecase-shell-';
const CACHE = '__LIFECASE_CACHE__';
const SHELL = __LIFECASE_FILES__;
const root = new URL('./', self.location.href);
const urls = new Set(SHELL.map(path => new URL(path, root).href));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll([...urls].map(url => new Request(url, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== root.origin) return;
  if (event.request.mode === 'navigate' && (url.pathname === root.pathname || url.pathname === root.pathname + 'index.html')) {
    event.respondWith((async () => {
      let response;
      try {
        response = await fetch(event.request);
        if (response.ok || response.status < 500) return response;
      } catch { /* Offline navigation uses the previously installed app shell. */ }
      const cached = await (await caches.open(CACHE)).match(root.href);
      return cached || response || Response.error();
    })());
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
