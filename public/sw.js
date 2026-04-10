const CACHE_NAME = 'connectrip-v2';
const OFFLINE_URL = '/';

// Install
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([OFFLINE_URL]);
    })
  );
  self.skipWaiting();
});

// Activate
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch - network first, cache fallback (SPA routing support)
self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).then((response) => {
        // If the server returns 404 or error for SPA routes, serve cached index.html
        if (!response.ok && response.status !== 304) {
          return caches.match(OFFLINE_URL) || response;
        }
        return response;
      }).catch(() => {
        return caches.match(OFFLINE_URL);
      })
    );
  }
});

// Push Notifications
self.addEventListener('push', (event) => {
  const data = event.data?.json() || { title: 'ConnectTrip', body: '새로운 알림이 있습니다.' };
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192x192.png',
      badge: '/icon-192x192.png',
      data: data.url || '/',
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data));
});
