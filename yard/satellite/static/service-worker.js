// Rover Code Service Worker
/**
 * Bumped whenever the asset list changes, so an install with the old list is
 * discarded rather than reused. v2 dropped a CDN URL no page ever requested;
 * v3 added yard-theme.css.
 */
const CACHE_NAME = 'rover-code-v3';

/**
 * Everything /code/ needs to open with no connection.
 *
 * The previous list cached `https://unpkg.com/blockly/blockly.min.js` while the
 * page asked for `https://unpkg.com/blockly@13.2.0/blockly.min.js`. Those are
 * different URLs, so the entry never matched a request and the offline support
 * had never actually worked. Blockly is served from this origin now, which
 * removes the mismatch along with the CDN.
 */
const STATIC_ASSETS = [
    '/code/',
    '/static/yard-base.css',
    // yard-base.css imports the palette from here. Without it an offline
    // tablet gets the layout with none of the colours.
    '/static/yard-theme.css',
    '/static/vendor/blockly/blockly.min.js',
    '/static/roversim/roverBlockly.js',
    '/static/roversim/parseRoverCode.js',
    '/static/roversim/rover-physics.js',
    '/static/roversim/simulateCommands.js',
    '/static/roversim/roverSimRender.js'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                // Individually, not addAll: one missing asset would reject the
                // whole install and leave the page with no cache at all.
                return Promise.all(
                    STATIC_ASSETS.map((url) =>
                        cache.add(url).catch((err) => {
                            console.warn('Could not cache', url, err);
                        })
                    )
                );
            })
            .then(() => self.skipWaiting())
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames
                        .filter((name) => name !== CACHE_NAME)
                        .map((name) => caches.delete(name))
                );
            })
            .then(() => self.clients.claim())
    );
});

// Fetch event - network first, fallback to cache
self.addEventListener('fetch', (event) => {
    // Only cache GET requests
    if (event.request.method !== 'GET') {
        return;
    }

    // Skip API calls - always go to network
    if (event.request.url.includes('/api/')) {
        return;
    }

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // Clone the response for caching
                const responseClone = response.clone();
                caches.open(CACHE_NAME)
                    .then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                return response;
            })
            .catch(() => {
                // Network failed, try cache
                return caches.match(event.request);
            })
    );
});
