const CACHE_NAME = "ekast-v17";
const ASSETS = [
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./ekast-icon.svg",
  "./apple-touch-icon.png",
  "./icon-512.png"
];

self.addEventListener("install", function(e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(ASSETS);
    }).catch(function(err) {
      console.warn("SW install cache fout:", err);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; })
            .map(function(k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function(e) {
  if (e.request.url.includes("script.google.com")) return;

  e.respondWith(
    fetch(e.request).then(function(response) {
      if (response && response.ok) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(e.request, clone);
        });
      }
      return response;
    }).catch(function() {
      return caches.match(e.request).then(function(cached) {
        if (cached) return cached;
        if (e.request.mode === "navigate") {
          return caches.match("./index.html");
        }
      });
    })
  );
});
