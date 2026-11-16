importScripts("./version.js");
const CACHE_NAME = "ekast-" + APP_VERSION;
// Aparte cache voor de scan-bibliotheek (~16 MB). Die bestanden wijzigen
// niet per app-versie; in de versie-cache werden ze bij elke update gewist,
// zodat de eerstvolgende scan alles opnieuw moest downloaden (en zonder
// bereik mislukte). Naam enkel ophogen als vendor/tesseract/ zelf wijzigt.
const VENDOR_CACHE = "ekast-vendor-tesseract-1";
// Zo lang wachten we op het netwerk voor we de offline kopie tonen.
const NET_TIMEOUT_MS = 3000;
// Na een time-out zo lang direct uit de cache serveren.
const SLOW_NET_MS = 60000;
let _slowUntil = 0;
const ASSETS = [
  "./index.html",
  "./style.css",
  "./app.js",
  "./version.js",
  "./manifest.json",
  "./ekast-icon.svg",
  "./ekast-icon-maskable.svg",
  "./apple-touch-icon.png",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-192.png",
  "./icon-maskable-512.png",
  "./sappi-skyline.svg"
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
        keys.filter(function(k) { return k !== CACHE_NAME && k !== VENDOR_CACHE; })
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
            caches.open(VENDOR_CACHE).then(function(cache) {
              return cache.put(e.request, clone);
            }).catch(function(err) { console.warn("Vendor-cache fout:", err); });
          }
          return response;
        });
      })
    );
    return;
  }

  // Same-origin: network-first met cache-fallback. Het netwerk krijgt
  // NET_TIMEOUT_MS de tijd: bij zwak signaal ("wel streepjes, geen data")
  // bleef het opstarten anders hangen tot de browser het zelf opgaf, terwijl
  // de offline versie klaarstond. Het netwerk-antwoord dat later toch
  // binnenkomt ververst nog steeds de cache voor de volgende start.
  if (e.request.method !== "GET") return;
  const fromCache = function() {
    return caches.match(e.request).then(function(cached) {
      if (cached) return cached;
      if (e.request.mode === "navigate") return caches.match("./index.html");
    });
  };
  const net = fetch(e.request, fetchOpts).then(function(response) {
    if (response && response.ok) {
      const clone = response.clone();
      return caches.open(CACHE_NAME).then(function(cache) {
        return cache.put(e.request, clone);
      }).catch(function(err) {
        console.warn("Cache bijwerken mislukt:", err);
      }).then(function() { return response; });
    }
    return response;
  });
  // Houd de SW in leven tot de cache is bijgewerkt, ook na een time-out.
  e.waitUntil(net.catch(function() {}));
  e.respondWith(new Promise(function(resolve, reject) {
    let settled = false;
    // Liep een vorig verzoek al in de time-out, dan is het netwerk traag:
    // de volgende bestanden meteen uit de cache i.p.v. per bestand opnieuw
    // te wachten (index.html, style.css, app.js … = elk 3 s).
    const timer = setTimeout(function() {
      _slowUntil = Date.now() + SLOW_NET_MS;
      fromCache().then(function(cached) {
        if (cached && !settled) { settled = true; resolve(cached); }
      });
    }, Date.now() < _slowUntil ? 0 : NET_TIMEOUT_MS);
    net.then(function(response) {
      clearTimeout(timer);
      if (!settled) { settled = true; _slowUntil = 0; resolve(response); }
    }, function(err) {
      clearTimeout(timer);
      if (settled) return;
      fromCache().then(function(cached) {
        if (settled) return;
        settled = true;
        if (cached) resolve(cached); else reject(err);
      });
    });
  }));
});
