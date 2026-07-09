// Service Worker — PWA + Web Push Notifications
const CACHE_NAME = 'user-pwa-v6';          // shell precacheado (offline.html, iconos, manifest)
const RUNTIME_CACHE = 'user-runtime-v6';   // assets hasheados de Vite (js/css/fonts/img), con TOPE
const OFFLINE_URL = '/offline.html';

// Vite hashea el nombre de cada chunk (main-a1b2c3.js), así que cada deploy genera
// URLs nuevas y las viejas quedarían para siempre en el cache. Cap FIFO: al pasar el
// límite se borran las entradas más viejas (cache.keys() viene en orden de inserción).
const MAX_RUNTIME_ENTRIES = 80;
async function trimCache(cacheName, maxEntries) {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length > maxEntries) {
        await cache.delete(keys[0]);
        return trimCache(cacheName, maxEntries); // repetir hasta quedar en el tope
    }
}

// Assets to pre-cache on install
const PRECACHE_ASSETS = [
    // OJO: NO precachear '/' — serviría un index.html viejo que apunta a chunks
    // que ya no existen tras un deploy. La navegación va siempre a la red.
    '/offline.html',
    '/assets/images/pwa.svg',
    '/assets/images/pwa.png',
    '/manifest.json',
];

// ── Install: Pre-cache shell ─────────────────────────────────────────────────
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(PRECACHE_ASSETS).catch(err => {
                console.warn('[SW] Some assets failed to cache:', err);
            });
        })
    );
    self.skipWaiting();
});

// ── Activate: Clean old caches (conserva el shell y el runtime actuales) ─────
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys
                    .filter(key => key !== CACHE_NAME && key !== RUNTIME_CACHE)
                    .map(key => caches.delete(key))
            );
        })
    );
    self.clients.claim();
});

// ── Fetch: Network-first for navigations, cache-first for assets ─────────────
self.addEventListener('fetch', (event) => {
    const { request } = event;

    // Skip non-GET and API/socket requests
    if (request.method !== 'GET') return;
    if (request.url.includes('/api/') || request.url.includes('/socket.io')) return;

    // Navigation requests → network-first SIEMPRE. Nunca servir un index.html
    // cacheado (apuntaría a chunks muertos tras un deploy). Solo si no hay red
    // (el fetch lanza excepción) caemos a la página offline.
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request).catch(() => caches.match(OFFLINE_URL))
        );
        return;
    }

    // Static assets → cache-first, fallback a red, fallback a offline
    event.respondWith(
        caches.match(request).then((cached) => {
            if (cached) return cached;

            return fetch(request)
                .then((response) => {
                    // Guardar en cache solo assets estáticos exitosos (en el runtime con tope).
                    // Excluir chunks de Vite dev (node_modules/.vite) para no cachear React stale.
                    if (response.ok && request.url.match(/\.(css|js|woff2?|png|svg|jpg|ico)$/) && !request.url.includes('node_modules') && !request.url.includes('.vite')) {
                        const clone = response.clone();
                        caches.open(RUNTIME_CACHE).then(cache =>
                            cache.put(request, clone).then(() => trimCache(RUNTIME_CACHE, MAX_RUNTIME_ENTRIES))
                        );
                    }
                    return response;
                })
                .catch(() => {
                    // Red no disponible y no está en cache
                    if (request.destination === 'document') {
                        return caches.match(OFFLINE_URL);
                    }
                    // Para otros assets (imágenes, fonts, etc.) devolver respuesta vacía
                    return new Response('', {
                        status: 408,
                        statusText: 'Network timeout - recurso no disponible offline'
                    });
                });
        })
    );
});

// ── Push Notifications ───────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
    if (!event.data) return;

    try {
        const data = event.data.json();
        const options = {
            body: data.body || '',
            icon: data.icon || '/assets/images/pwa.png',
            badge: '/assets/images/pwa.png',
            // actionUrls: { [action]: url } — a dónde navega cada botón (ver notificationclick)
            data: { url: data.url || '/portal', actionUrls: data.actionUrls || {} },
            vibrate: [100, 50, 100],
            // Tag POR PEDIDO (lo manda el backend, ej. 'orden-SUB-4727'): las actualizaciones
            // del MISMO pedido se reemplazan entre sí, pero pedidos distintos conviven.
            // Antes el tag era fijo → cada push nueva borraba la anterior.
            tag: data.tag || `user-${Date.now()}`,
            renotify: !!data.tag,
            // Botones de acción (Chrome/Android muestran hasta 2)
            actions: Array.isArray(data.actions) ? data.actions.slice(0, 2) : [],
        };

        event.waitUntil(
            self.registration.showNotification(data.title || 'User', options)
        );
    } catch (err) {
        console.error('[SW] Error processing push:', err);
    }
});

// ── Notification Click ───────────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const nData = event.notification.data || {};
    // Si tocó un botón de acción con URL propia, esa manda; si no, la URL default de la notificación.
    const url = (event.action && nData.actionUrls && nData.actionUrls[event.action]) || nData.url || '/portal';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            for (const client of windowClients) {
                if (client.url.includes('/portal') && 'focus' in client) {
                    client.focus();
                    client.navigate(url);
                    return;
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(url);
            }
        })
    );
});
