// IMPORTANT: Bump this version string every time you update static assets.
// This forces the Service Worker to re-cache all files on the next visit.
const CACHE_NAME = 'pablito-leans-v2'; // Updated: 2026-06-06

const STATIC_ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/scanner.js',
  './js/corners.js',
  './assets/favicon.svg',
  './manifest.json'
];

// Instalar Service Worker y cachear archivos estáticos
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[ServiceWorker] Pre-caching offline page');
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activar y limpiar cachés antiguos
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keyList => {
      return Promise.all(keyList.map(key => {
        if (key !== CACHE_NAME) {
          console.log('[ServiceWorker] Removing old cache', key);
          return caches.delete(key);
        }
      }));
    })
  );
  self.clients.claim();
});

// Estrategia de Fetch: Cache First con Network Fallback para recursos estáticos,
// y Stale-While-Revalidate para librerías externas pesadas (como OpenCV).
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Solicitudes a CDNs externos (OpenCV, PDF.js, Google Fonts)
  if (url.origin !== location.origin) {
    event.respondWith(
      caches.match(event.request).then(cachedResponse => {
        const fetchPromise = fetch(event.request).then(networkResponse => {
          // Si la respuesta es válida, actualizar el caché de manera silenciosa
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        }).catch(() => {
          // Si falla la red, el usuario simplemente usará la versión en caché
        });

        // Retornar la versión en caché de inmediato si existe, sino esperar la red
        return cachedResponse || fetchPromise;
      })
    );
    return;
  }

  // Solicitudes locales (archivos del proyecto) -> Network First (para asegurar siempre la última versión si hay internet)
  event.respondWith(
    fetch(event.request).then(response => {
      if (response && response.status === 200) {
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, responseClone);
        });
      }
      return response;
    }).catch(() => {
      // Si falla la red, usar el caché
      return caches.match(event.request);
    })
  );
});
