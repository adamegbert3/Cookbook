const CACHE_NAME = 'cookbook-v3-offline';

// Core app shell files to cache immediately on install
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/homepage.html',
  '/recipe.html',
  '/edit-recipe.html',
  '/admin.html',
  '/leaderboard.html',
  '/print.html',
  '/shopping-list.html',
  '/profile.html',
  '/submit.html',
  '/settings.html',
  '/suggestions.html',
  '/terms.html',
  '/styles/recipes.css',
  '/scripts/main.js',
  '/scripts/recipePage.js',
  '/scripts/dashboard.js',
  '/scripts/profile.js',
  '/scripts/submit.js',
  '/scripts/leaderboard.js',
  '/scripts/print.js',
  '/scripts/firebase-config.js',
  '/images/logo.jpg',
  '/images/favicon.png',
  '/images/apple-touch-icon.png',
  'https://fonts.googleapis.com/css2?family=Amatic+SC:wght@400;700&display=swap',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap'
];

// Install Event: Cache the app shell
self.addEventListener('install', (event) => {
  self.skipWaiting(); // Force this new service worker to activate immediately
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching app shell');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// Activate Event: Clean up old caches from previous versions
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[Service Worker] Deleting old cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    })
  );
});

// Fetch Event: Stale-While-Revalidate Strategy
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // CRITICAL BYPASS: Ignore all Firebase/Google API traffic (Auth + Firestore).
  // Firestore's own offline persistence handles caching recipe data; the
  // Service Worker only needs to own the app shell (HTML/CSS/JS/images).
  if (
    event.request.method !== 'GET' ||
    url.includes('googleapis.com') ||
    url.includes('firebaseio.com') ||
    url.includes('identitytoolkit') ||
    url.includes('securetoken') ||
    url.includes('gstatic.com')
  ) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => {
        console.log('[Service Worker] Offline: serving from cache for', event.request.url);
      });

      return cachedResponse || fetchPromise;
    })
  );
});
