const CACHE_NAME = 'currencyflow-v7';
const API_CACHE = 'currencyflow-api-v7';

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './custom-select.js',
  './script.js',
  './config.js',
  './manifest.json',
  './icons/favicon.ico',
  './icons/favicon.svg',
  './icons/favicon-16.png',
  './icons/favicon-32.png',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names.filter((n) => n !== CACHE_NAME && n !== API_CACHE).map((n) => caches.delete(n))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { hostname } = new URL(e.request.url);

  if (
    hostname === 'api.exchangerate.fun' ||
    hostname === 'v6.exchangerate-api.com' ||
    hostname === 'open.er-api.com'
  ) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const clone = res.clone();
          caches.open(API_CACHE).then((c) => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
