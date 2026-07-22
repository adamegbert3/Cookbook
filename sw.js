const CACHE_NAME = 'cookbook-v5-offline';

// Core app shell files to pre-cache on install so the site opens offline
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
  '/scripts/ingredient-utils.js',
  '/scripts/firebase-config.js',
  '/images/logo.jpg',
  '/images/favicon.png',
  '/images/apple-touch-icon.png'
];

// Install Event: Cache the app shell. Each asset is cached individually so
// one bad URL can't fail the whole install (cache.addAll is all-or-nothing,
// and a failed install would leave an old service worker in charge forever).
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        ASSETS_TO_CACHE.map((url) =>
          cache.add(url).catch((err) => console.warn('[Service Worker] Could not pre-cache', url, err))
        )
      )
    )
  );
});

// Activate Event: Clean up old caches and take control of open tabs
// immediately (without clients.claim(), an already-open tab keeps being
// served by the OLD service worker until it's fully closed and reopened).
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
    }).then(() => self.clients.claim())
  );
});

// Fetch Event: NETWORK-FIRST, cache as offline fallback.
//
// This replaced the old stale-while-revalidate strategy on purpose: that
// strategy serves the cached (old) copy instantly and only refreshes the
// cache in the background, which meant every deploy showed up one visit
// late — and different files could come from different deploys at once,
// producing impossible-to-reproduce bugs on the live site that never
// happened locally. Network-first guarantees fresh code whenever online;
// the cache only steps in when the network is actually unreachable
// (camping mode), which is the only time we want it.
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // CRITICAL BYPASS: never touch Firebase/Google API traffic (Auth + Firestore).
  // Firestore's own offline persistence handles recipe data; the Service
  // Worker only owns the app shell (HTML/CSS/JS/images).
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
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
        }
        return networkResponse;
      })
      .catch(() => {
        console.log('[Service Worker] Offline: serving from cache for', url);
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          // Offline navigation to an uncached page: fall back to the homepage shell
          if (event.request.mode === 'navigate') return caches.match('/homepage.html');
          return Response.error();
        });
      })
  );
});
