/* Concierge Collector offline authoring shell */
const CACHE_NAME = 'concierge-collector-shell-v1';
const MANIFEST_URL = './.manifest.json';
const INDEX_URL = './index.html';

// These URLs are render-critical/runtime-critical because index.html currently
// references them directly. They are copied into Cache Storage on the first
// successful online install so a later reload can execute with no network.
const CRITICAL_EXTERNAL_ASSETS = [
  'https://cdn.jsdelivr.net/npm/dexie@3.2.2/dist/dexie.min.js',
  'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
  'https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js',
  'https://cdn.jsdelivr.net/npm/toastify-js',
  'https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css',
  'https://cdn.jsdelivr.net/npm/toastify-js/src/toastify.min.css',
  'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',
  'https://fonts.googleapis.com/icon?family=Material+Icons'
];

async function fetchAndCache(cache, url, { required = false } = {}) {
  try {
    let response;
    try {
      response = await fetch(url, { cache: 'reload' });
    } catch (_) {
      // Cross-origin CDN resources may require an opaque response in a
      // Service Worker. Opaque responses are still valid Cache entries.
      response = await fetch(url, { mode: 'no-cors', cache: 'reload' });
    }
    if (!response || (response.type !== 'opaque' && !response.ok)) {
      throw new Error(`Could not cache ${url}`);
    }
    await cache.put(url, response.clone());
    return response;
  } catch (error) {
    if (required) throw error;
    return null;
  }
}

async function cacheStylesheetDependencies(cache, stylesheetUrl) {
  try {
    const response = await fetch(stylesheetUrl, { cache: 'reload' });
    if (!response.ok) return;
    const clone = response.clone();
    await cache.put(stylesheetUrl, clone);
    const css = await response.text();
    const urls = [...css.matchAll(/url\((['"]?)(https?:\/\/[^)'"\s]+)\1\)/g)]
      .map((match) => match[2]);
    await Promise.all(urls.map((url) => fetchAndCache(cache, url)));
  } catch (_) {
    // Fonts/icons are cosmetic. Their stylesheet itself is attempted above;
    // failure must not prevent the durable authoring shell from installing.
  }
}

async function precacheLocalBuild(cache) {
  const manifestResponse = await fetch(MANIFEST_URL, { cache: 'no-store' });
  if (!manifestResponse.ok) {
    throw new Error('Collector build manifest unavailable; refusing partial offline shell');
  }
  const manifest = await manifestResponse.json();
  const localUrls = [...new Set([
    './',
    INDEX_URL,
    ...manifest.map((entry) => `./${entry.path}`)
  ])];
  await cache.addAll(localUrls);
  await cache.put(MANIFEST_URL, manifestResponse.clone());
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await precacheLocalBuild(cache);

    // Dexie is mandatory for offline authoring. The other externals are
    // best-effort because the app has UI fallbacks for their absence.
    await fetchAndCache(cache, CRITICAL_EXTERNAL_ASSETS[0], { required: true });
    await Promise.all(CRITICAL_EXTERNAL_ASSETS.slice(1, 6).map((url) => fetchAndCache(cache, url)));
    await Promise.all(CRITICAL_EXTERNAL_ASSETS.slice(6).map((url) => cacheStylesheetDependencies(cache, url)));

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith('concierge-collector-shell-') && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

function isNetworkOnly(url, request) {
  if (request.method !== 'GET') return true;
  if (url.origin !== self.location.origin) return false;
  return url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/auth/') ||
    url.pathname.startsWith('/places/') ||
    url.pathname.startsWith('/capture/');
}

async function navigationResponse(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response?.ok) await cache.put(INDEX_URL, response.clone());
    return response;
  } catch (_) {
    return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request, { ignoreSearch: false });
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response && (response.ok || response.type === 'opaque')) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch (_) {
    return Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (isNetworkOnly(url, request)) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(navigationResponse(request));
    return;
  }

  // Same-origin static shell files and exact external dependencies that were
  // cached during install are served cache-first. Arbitrary remote/API data is
  // never manufactured from stale cache.
  if (url.origin === self.location.origin || CRITICAL_EXTERNAL_ASSETS.includes(request.url) || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(request));
  }
});
