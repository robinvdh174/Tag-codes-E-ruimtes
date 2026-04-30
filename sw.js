const CACHE_NAME = "ekast-v18";
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
  // Apps Script sync-API: laat de browser zelf afhandelen (geen cache).
  if (e.request.url.indexOf("script.google.com") !== -1) return;
  if (e.request.url.indexOf("script.googleusercontent.com") !== -1) return;

  // Cross-origin scripts en data (Tesseract.js + tessdata) NIET via de
  // SW laten lopen. iOS Safari heeft known issues met cross-origin
  // opaque responses + cache.put waardoor 'Load failed' optreedt.
  // De browser-eigen HTTP-cache neemt het over voor herhaalde loads.
  let url;
  try { url = new URL(e.request.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;

  // Same-origin: network-first met cache-fallback (zoals voorheen).
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
