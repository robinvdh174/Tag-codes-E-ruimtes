// Tests voor de locatiefoto-helpers (isPhotoDataUrl, photoDataUrlBytes).
// De upload-/ophaalfuncties zelf praten met canvas en netwerk en worden
// hier niet gedekt; de validatie- en groottelogica wél.

const { eq, ok, summary, sliceBlock } = require("./_helpers");

const photoBlock = sliceBlock("// --- begin foto-helpers", "// --- einde foto-helpers");
eval(photoBlock);

// Helper: bouw een data-URL met base64 van n bytes echte data.
function makeDataUrl(mime, bytes) {
  return "data:" + mime + ";base64," + Buffer.alloc(bytes, 7).toString("base64");
}

// ---------- 1. Geldige data-URL's ----------
{
  ok(isPhotoDataUrl(makeDataUrl("image/jpeg", 100)), "jpeg data-URL is geldig");
  ok(isPhotoDataUrl(makeDataUrl("image/png", 100)), "png data-URL is geldig");
  ok(isPhotoDataUrl(makeDataUrl("image/webp", 100)), "webp data-URL is geldig");
  ok(isPhotoDataUrl(makeDataUrl("image/jpeg", 99)), "base64 met '=' padding is geldig");
  ok(isPhotoDataUrl(makeDataUrl("image/jpeg", 98)), "base64 met '==' padding is geldig");
}

// ---------- 2. Ongeldige input ----------
{
  ok(!isPhotoDataUrl(null), "null is ongeldig");
  ok(!isPhotoDataUrl(undefined), "undefined is ongeldig");
  ok(!isPhotoDataUrl(""), "lege string is ongeldig");
  ok(!isPhotoDataUrl("hallo"), "gewone tekst is ongeldig");
  ok(!isPhotoDataUrl("data:image/gif;base64,AAAA"), "gif wordt geweigerd");
  ok(!isPhotoDataUrl("data:image/svg+xml;base64,AAAA"), "svg wordt geweigerd (XSS-risico)");
  ok(!isPhotoDataUrl("data:text/html;base64,AAAA"), "html wordt geweigerd");
  ok(!isPhotoDataUrl("data:image/jpeg;base64,"), "lege base64 is ongeldig");
  ok(!isPhotoDataUrl("data:image/jpeg;base64,AA"), "te korte base64 is ongeldig");
  ok(!isPhotoDataUrl("data:image/jpeg;base64,AAAAA"), "base64-lengte niet deelbaar door 4 is ongeldig");
  ok(!isPhotoDataUrl("data:image/jpeg;base64,AAA!"), "base64 met vreemde tekens is ongeldig");
  ok(!isPhotoDataUrl("https://example.com/foto.jpg"), "gewone URL is ongeldig");
}

// ---------- 3. Bestandsgrootte uit data-URL ----------
{
  eq(photoDataUrlBytes(makeDataUrl("image/jpeg", 300)), 300, "300 bytes zonder padding");
  eq(photoDataUrlBytes(makeDataUrl("image/jpeg", 299)), 299, "299 bytes met '=' padding");
  eq(photoDataUrlBytes(makeDataUrl("image/jpeg", 298)), 298, "298 bytes met '==' padding");
  eq(photoDataUrlBytes(makeDataUrl("image/png", 1)), 1, "1 byte");
  eq(photoDataUrlBytes(""), 0, "lege string geeft 0");
  eq(photoDataUrlBytes(null), 0, "null geeft 0");
  eq(photoDataUrlBytes("geen data-url"), 0, "tekst zonder base64-deel geeft 0");
}

summary();
