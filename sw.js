var CACHE_NAME = "ekast-v7";
var ASSETS = [
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./ekast-icon.svg",
  "./apple-touch-icon.png"
];

self.addEventListener("install", function(e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(ASSETS.filter(function(url) {
        return true; // probeer alles te cachen, fouten worden genegeerd
      }));
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
  // API-calls naar Google Apps Script nooit cachen
  if (e.request.url.includes("script.google.com")) return;

  e.respondWith(
    fetch(e.request).then(function(response) {
      // Netwerk succesvol — cache updaten en response teruggeven
      if (response && response.ok) {
        var clone = response.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(e.request, clone);
        });
      }
      return response;
    }).catch(function() {
      // Netwerk mislukt — probeer uit cache te serveren
      return caches.match(e.request).then(function(cached) {
        if (cached) return cached;
        // Offline fallback: stuur de gecachete app terug
        if (e.request.mode === "navigate") {
          return caches.match("./index.html");
        }
      });
    })
  );
});
