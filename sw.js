const CACHE_NAME = 'currencyflow-app-v1';
const API_CACHE = 'currencyflow-api-v1';

const ASSETS = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './manifest.json'
];

// Install and cache core assets
self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

// Smart Fetch Strategy
self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);
    
    // Network-first for API calls, fallback to cache if offline
    if (url.origin === 'https://api.exchangerate-api.com') {
        e.respondWith(
            fetch(e.request)
                .then((res) => {
                    const clonedRes = res.clone();
                    caches.open(API_CACHE).then((cache) => cache.put(e.request, clonedRes));
                    return res;
                })
                .catch(() => caches.match(e.request))
        );
        return;
    }

    // Cache-first for static assets
    e.respondWith(
        caches.match(e.request).then((res) => res || fetch(e.request))
    );
});