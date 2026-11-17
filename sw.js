// Sube el número cuando publiques una versión nueva (no es obligatorio: index.html siempre se busca primero en internet).
const VERSION = 'arena-chispa-v26';
const FILES = ['./', './index.html', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png',
  './icons/apple-touch-icon.png', './icons/favicon-32.png', './icons/splash.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (new URL(req.url).pathname.startsWith('/api/')) return;   // la clasificación siempre en vivo
  const isPage = req.mode === 'navigate' || req.destination === 'document';
  if (isPage) {
    // Primero internet (así se actualiza solo); sin internet, usa la copia guardada.
    e.respondWith(
      fetch(req).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put('./index.html', copy)); return r; })
        .catch(() => caches.match('./index.html'))
    );
  } else {
    // Íconos y demás: primero la copia guardada, y se refresca en segundo plano.
    e.respondWith(
      caches.match(req).then(hit => {
        const net = fetch(req).then(r => { if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy)); } return r; }).catch(() => hit);
        return hit || net;
      })
    );
  }
});
