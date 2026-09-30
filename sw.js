// Service worker : l'app s'ouvre même sans réseau.
// Fichiers de l'app : réseau d'abord (toujours la dernière version), cache si hors ligne.
// Bibliothèques (versions figées) : cache d'abord.
const VERSION = 'frigo-v6';
const APP_FILES = [
  './', './index.html', './styles.css', './app.js', './ui.js', './store.js', './services.js',
  './config.js', './manifest.json', './icon-180.png', './icon-192.png', './icon-512.png'
];
const LIBRARY_HOSTS = ['www.gstatic.com', 'cdn.jsdelivr.net'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => (await caches.match(request, { ignoreSearch: true }))
          ?? (request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))
    );
    return;
  }

  if (LIBRARY_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.match(request).then((cached) => cached ?? fetch(request).then((response) => {
        if (response.ok || response.type === 'opaque') {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      }))
    );
  }
  // Tout le reste (Firebase, Claude, Open Food Facts) passe directement par le réseau.
});
