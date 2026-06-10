importScripts("./version.js");
const CACHE_NAME = "ekast-" + APP_VERSION;
const ASSETS = [
  "./index.html",
  "./style.css",
  "./app.js",
  "./version.js",
  "./manifest.json",
  "./ekast-icon.svg",
  "./apple-touch-icon.png",
  "./icon-512.png"
];
// Tesseract.js assets worden NIET in de install-precache geplaatst
// (zou de install met ~16 MB belasten en op trage netwerken laten
// falen). Ze worden runtime-gecached bij de eerste scan via de
// fetch-handler en daarna offline beschikbaar.

self.addEventListener("install", function(e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(ASSETS);
    }).catch(function(err) {
      console.warn("SW install cache fout:", err);
    })
  );
  // Geen skipWaiting() hier: de nieuwe SW wacht tot de gebruiker via de
  // update-banner bevestigt (zie app.js). Direct activeren zou de pagina
  // midden in een formulier-invul-sessie herladen.
});

// De pagina stuurt dit bericht wanneer de gebruiker op "Vernieuwen" tikt.
self.addEventListener("message", function(e) {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
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

  // Voor de hoofd-app-bestanden (HTML/JS/CSS/manifest) bypassen we
  // de browser HTTP-cache zodat updates altijd doorkomen. Anders kan
  // iOS Safari een max-age=600 cache-versie blijven serveren waardoor
  // gebruikers urenlang op een oude app.js hangen na een nieuwe deploy.
  const path = url.pathname;
  const isAppFile = /\.(html|js|css|json)$/.test(path) || path === "/" || path.endsWith("/Tag-codes-E-ruimtes/");
  const fetchOpts = isAppFile ? { cache: "reload" } : {};

  // Tesseract.js (~16 MB aan vendor-assets, versie-vast in /vendor/tesseract/).
  // Cache-first: hit serveren we direct, miss vullen we de cache.
  // Network-first zou bij elke scan een netwerk-roundtrip forceren en op
  // trage verbindingen de OCR-start onnodig vertragen.
  if (path.indexOf("/vendor/tesseract/") !== -1) {
    e.respondWith(
      caches.match(e.request).then(function(cached) {
        if (cached) return cached;
        return fetch(e.request).then(function(response) {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(e.request, clone);
            });
          }
          return response;
        });
      })
    );
    return;
  }

  // Same-origin: network-first met cache-fallback.
  e.respondWith(
    fetch(e.request, fetchOpts).then(function(response) {
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
