const CACHE_NAME = 'cookbook-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/styles/recipes.css',
  '/scripts/login.js',
  'https://cdn.tailwindcss.com', 
  'https://fonts.googleapis.com/css2?family=Amatic+SC:wght@400;700&display=swap'
];

// 1. Install Event: Caches core files immediately
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching all: app shell and content');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// 2. Fetch Event: Serve from Cache first, then Network
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      // If found in cache, return it (OFFLINE MODE)
      if (response) {
        return response;
      }
      // If not, fetch from internet
      return fetch(event.request);
    })
  );
});