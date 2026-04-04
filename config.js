// ============================================================
// CONFIGURATIE — dit bestand staat NIET in git (.gitignore)
// Bevat gevoelige waarden: API-token, PIN-hash en Apps Script URL
// ============================================================

// ⚠️ VEREIST: Plak hier je Apps Script Web App URL
// Na het deployen van Code.gs kopieer je de URL hier
var SCRIPT_URL = "https://script.google.com/macros/s/AKfycbx95mvBsmpMxJn7c0cLDL_V63x7Bv9T3XQW_vfL0K2wRlSfxm4476rJ0qZDrFOZ0nF9kg/exec";

// 🔑 API TOKEN — voeg dit toe aan je Apps Script om ongeautoriseerde toegang te blokkeren
// Stel in je Apps Script in: if (e.parameter.token !== "JOUW_TOKEN") return ...
// Wijzig de waarde hieronder en zorg dat je Apps Script dezelfde waarde controleert.
var API_TOKEN = "ekast-2025";

// 🔒 GEDEELDE PIN — dit is de SHA-256 hash van de PIN
// Om de PIN te wijzigen: bereken de SHA-256 hash van je nieuwe PIN via https://emn178.github.io/online-tools/sha256.html
// en vervang de waarde hieronder. Kopieer daarna config.js opnieuw naar de server.
var DEVICE_PIN_HASH = "1299c06d517825c0529d69fe9f8bbf7b308b9db68289db3c9f844570deb1d621";
var DEVICE_PIN_LENGTH = 4; // Aantal cijfers van de PIN
