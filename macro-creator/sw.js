/* Makro Studio – Service Worker: Offline-Cache (Stale-While-Revalidate) und Benachrichtigungsklicks. */
const CACHE = 'makrostudio-v4';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/fonts.css', 'css/style.css',
  'fonts/material-symbols-rounded.woff2', 'fonts/roboto-latin.woff2', 'fonts/roboto-latin-ext.woff2',
  'js/core.js', 'js/native.js', 'js/permissions.js', 'js/catalog.js', 'js/engine.js', 'js/ui.js', 'js/templates.js', 'js/views.js', 'js/app.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const cacheable = e.request.method === 'GET' && url.origin === location.origin;
  if (!cacheable) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(e.request, { ignoreSearch: url.origin === location.origin });
      const net = fetch(e.request)
        .then((res) => { if (res.ok || res.type === 'opaque') cache.put(e.request, res.clone()); return res; })
        .catch(() => hit);
      return hit || net;
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if ('focus' in c) return c.focus();
      return self.clients.openWindow('./');
    })
  );
});
