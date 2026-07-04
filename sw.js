/**
 * Days Tracking Pro â€” Service Worker
 * Version: 6.0.0
 *
 * Strategy:
 *   - App shell (HTML, icons, manifest) â†’ cache-first, background refresh
 *   - Firebase / external APIs â†’ network-only (never cache auth or db calls)
 *   - Fonts â†’ cache-first with long TTL (they never change)
 *   - Everything else â†’ network-first, fallback to cache
 *
 * On activate: purges ALL old cache versions and cleans stale entries
 * from the current cache that haven't been touched in 7 days.
 */

const VERSION = 'dtp-v6';
const SHELL_CACHE = `${VERSION}-shell`;
const FONT_CACHE = `${VERSION}-fonts`;
const RUNTIME_CACHE = `${VERSION}-runtime`;

// App shell assets to precache on install
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Domains that should NEVER be cached (auth, database, analytics, forms)
const BYPASS_DOMAINS = [
  'firebaseapp.com',
  'googleapis.com',
  'firebasestorage.app',
  'firebaseinstallations.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firestore.googleapis.com',
  'formspree.io',
  'google-analytics.com',
  'googletagmanager.com'
];

// Domains whose responses get long-lived font caching
const FONT_DOMAINS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

// Firebase JS SDK from CDN: cache these, they're versioned and immutable
const IMMUTABLE_CDN = [
  'www.gstatic.com/firebasejs'
];

// Max age for runtime cache entries (7 days in ms)
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;

// â”€â”€â”€ INSTALL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

self.addEventListener('install', (event) => {
  console.log(`[SW] Installing ${VERSION}`);
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// â”€â”€â”€ ACTIVATE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

self.addEventListener('activate', (event) => {
  console.log(`[SW] Activating ${VERSION}, purging old caches`);
  const currentCaches = new Set([SHELL_CACHE, FONT_CACHE, RUNTIME_CACHE]);

  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => !currentCaches.has(name))
          .map((name) => {
            console.log(`[SW] Deleting old cache: ${name}`);
            return caches.delete(name);
          })
      );
    })
    .then(() => cleanStaleEntries())
    .then(() => self.clients.claim())
  );
});

// â”€â”€â”€ FETCH â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests; let POST/PUT/DELETE pass through
  if (request.method !== 'GET') return;

  // Network-only for auth, database, analytics, forms
  if (shouldBypass(url)) {
    event.respondWith(fetch(request));
    return;
  }

  // Cache-first for Google Fonts (they basically never change)
  if (isFontRequest(url)) {
    event.respondWith(cacheFirst(request, FONT_CACHE));
    return;
  }

  // Cache-first for Firebase SDK files (versioned, immutable)
  if (isImmutableCDN(url)) {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
    return;
  }

  // App shell: serve from cache, refresh in background (stale-while-revalidate)
  if (isShellRequest(url)) {
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
    return;
  }

  // Everything else: network-first, fallback to cache
  event.respondWith(networkFirst(request, RUNTIME_CACHE));
});

// â”€â”€â”€ MESSAGE HANDLER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

self.addEventListener('message', (event) => {
  if (!event.data) return;

  switch (event.data.action) {
    case 'skipWaiting':
      self.skipWaiting();
      break;

    case 'clearAll':
      // Nuclear option: wipe everything and unregister
      event.waitUntil(
        caches.keys()
          .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
          .then(() => {
            console.log('[SW] All caches cleared by user request');
            return self.clients.matchAll();
          })
          .then((clients) => {
            clients.forEach((client) => client.postMessage({ type: 'cacheCleared' }));
          })
      );
      break;

    case 'cleanStale':
      event.waitUntil(cleanStaleEntries());
      break;

    case 'getVersion':
      event.source.postMessage({ type: 'version', version: VERSION });
      break;
  }
});

// â”€â”€â”€ PERIODIC BACKGROUND SYNC (if supported) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'cache-cleanup') {
    event.waitUntil(cleanStaleEntries());
  }
});

// â”€â”€â”€ STRATEGIES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('', { status: 503, statusText: 'Offline' });
  }
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('', { status: 503, statusText: 'Offline' });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  // Fire off a background fetch to update the cache
  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);

  // Return cached immediately if available, otherwise wait for network
  return cached || fetchPromise || new Response('', { status: 503, statusText: 'Offline' });
}

// â”€â”€â”€ HELPERS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function shouldBypass(url) {
  return BYPASS_DOMAINS.some((domain) => url.hostname.includes(domain) || url.href.includes(domain));
}

function isFontRequest(url) {
  return FONT_DOMAINS.some((domain) => url.hostname.includes(domain));
}

function isImmutableCDN(url) {
  return IMMUTABLE_CDN.some((path) => url.href.includes(path));
}

function isShellRequest(url) {
  // Same-origin navigation requests or precached assets
  if (url.origin !== self.location.origin) return false;
  const path = url.pathname;
  return path === '/' || path.endsWith('.html') || path.endsWith('.json') || path.endsWith('.png');
}

/**
 * Cleans stale entries from the runtime cache.
 * Uses the Response date header to determine age.
 * Anything older than MAX_AGE gets evicted.
 */
async function cleanStaleEntries() {
  const cache = await caches.open(RUNTIME_CACHE);
  const requests = await cache.keys();
  const now = Date.now();
  let cleaned = 0;

  await Promise.all(
    requests.map(async (request) => {
      const response = await cache.match(request);
      if (!response) return;

      const dateHeader = response.headers.get('date');
      if (!dateHeader) return;

      const responseAge = now - new Date(dateHeader).getTime();
      if (responseAge > MAX_AGE) {
        await cache.delete(request);
        cleaned += 1;
      }
    })
  );

  if (cleaned > 0) {
    console.log(`[SW] Cleaned ${cleaned} stale cache entries`);
  }
}
