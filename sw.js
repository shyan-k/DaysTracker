var CACHE_NAME = 'dtp-v5';
var ASSETS = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', function(event) {
  event.waitUntil(caches.open(CACHE_NAME).then(function(cache) { return cache.addAll(ASSETS); }));
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(caches.keys().then(function(keys) { 
    return Promise.all(keys.filter(function(k) { return k !== CACHE_NAME; }).map(function(k) { return caches.delete(k); })); 
  }));
  self.clients.claim();
});

self.addEventListener('fetch', function(event) {
  var url = event.request.url;
  // Bypassing cache for external tools and Firebase databases
  if (url.includes('googleapis.com') || url.includes('gstatic.com') || url.includes('formspree.io') || url.includes('cdn.jsdelivr.net')) {
    event.respondWith(fetch(event.request));
    return;
  }
  event.respondWith(
    fetch(event.request).then(function(response) { 
      var clone = response.clone(); 
      caches.open(CACHE_NAME).then(function(cache) { cache.put(event.request, clone); }); 
      return response; 
    }).catch(function() { 
      return caches.match(event.request); 
    })
  );
});

self.addEventListener('message', function(event) {
  if (event.data.action === 'skipWaiting') self.skipWaiting();
});
