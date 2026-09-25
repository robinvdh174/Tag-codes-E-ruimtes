// Eén bron voor de app-versie. Wordt geladen door zowel index.html
// (via <script>) als door sw.js (via importScripts) zodat CACHE_NAME
// en APP_VERSION nooit uit de pas kunnen lopen.
// Bump dit bij elke release: nieuw onderwerp = volgend heel nummer (v48),
// vervolgaanpassing aan hetzelfde onderwerp = subnummer (v48.1, v48.2).
// Zie CLAUDE.md "Versienummering".
const APP_VERSION = "v47.1";
