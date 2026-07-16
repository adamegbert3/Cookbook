const CACHE_NAME = 'cookbook-v2-offline';

// 1. Expand the list of core files to cache immediately upon installing
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/homepage.html',
  '/recipe.html',
  '/shopping-list.html',
  '/profile.html',
  '/submit.html',
  '/settings.html',
  '/admin.html',
  '/styles/recipes.css',
  '/scripts/main.js',
  '/scripts/login.js',
  '/scripts/recipePage.js',
  '/scripts/dashboard.js',
  '/scripts/profile.js',
  '/scripts/submit.js',
  '/scripts/firebase-config.js',
  '/images/logo.jpg',
  '/images/favicon.png',
  '/images/apple-touch-icon.png',
  'https://fonts.googleapis.com/css2?family=Amatic+SC:wght@400;700&display=swap',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap'
];

// Install Event: Cache all core app shell files
self.addEventListener('install', (event) => {
  self.skipWaiting(); // Force this new service worker to activate immediately
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching complete app shell');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// Activate Event: Clean up old caches if you change CACHE_NAME in the future
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

  // 🚨 CRITICAL BYPASS: Ignore ALL Firebase and Google APIs.
  // If the Service Worker tries to cache Auth checks, it crashes Firebase Auth!
  if (
    event.request.method !== 'GET' || 
    url.includes('googleapis.com') || 
    url.includes('firebaseio.com') ||
    url.includes('identitytoolkit') ||
    url.includes('securetoken') ||
    url.includes('gstatic.com')
  ) {
    return; // Let Firebase SDK handle this directly!
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // 1. Fetch from network in the background to keep cache fresh
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch((err) => {
        // Network failed (user is offline) -> silently ignore fetch error
        console.log('[Service Worker] Offline mode: using cache for', event.request.url);
      });

      // 2. Return cached response instantly if we have it, otherwise wait for network
      return cachedResponse || fetchPromise;
    })
  );
});
// ==========================================
// 10. START THE SERVICE WORKER (OFFLINE ENGINE)
// ==========================================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then((registration) => {
                console.log('👷‍♂️ [SERVICE WORKER] Registered successfully with scope:', registration.scope);
            })
            .catch((error) => {
                console.error('❌ [SERVICE WORKER] Registration failed:', error);
            });
    });
}