// Gemeenschappelijke test-utilities. Geen extern test-framework — we
// houden het bewust licht zodat tests draaien met gewoon `node tests/<file>`.

const fs = require("fs");
const path = require("path");

const APP_PATH = path.join(__dirname, "..", "app.js");
const APP_SRC = fs.readFileSync(APP_PATH, "utf8");

// Eenvoudige assert helpers met duidelijke output.
let _passed = 0;
let _failed = 0;
const _failures = [];

function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { _passed++; return; }
  _failed++;
  _failures.push({ label: label, actual: actual, expected: expected });
}

function ok(cond, label) {
  if (cond) { _passed++; return; }
  _failed++;
  _failures.push({ label: label, actual: cond, expected: true });
}

function summary() {
  console.log("\n" + "=".repeat(60));
  console.log("Geslaagd: " + _passed + "   Gefaald: " + _failed);
  if (_failures.length > 0) {
    console.log("\nFOUTEN:");
    for (let i = 0; i < _failures.length; i++) {
      const f = _failures[i];
      console.log("  ✗ " + f.label);
      console.log("    verwacht: " + JSON.stringify(f.expected));
      console.log("    kreeg:    " + JSON.stringify(f.actual));
    }
  }
  console.log("=".repeat(60));
  process.exit(_failed === 0 ? 0 : 1);
}

// Slice een blok code uit app.js tussen twee herkenningspunten.
// Vervangt const/let door var zodat de declaraties uit de eval-scope
// lekken naar de buitenste functie-scope (anders kunnen tests ze niet
// bereiken). Geen impact op gedrag voor onze tests.
function sliceBlock(startMarker, endMarker) {
  const s = APP_SRC.indexOf(startMarker);
  if (s === -1) throw new Error("Startmarker niet gevonden: " + startMarker);
  const e = endMarker ? APP_SRC.indexOf(endMarker, s) : APP_SRC.length;
  if (e === -1) throw new Error("Eindmarker niet gevonden: " + endMarker);
  let block = APP_SRC.slice(s, e);
  // Op nieuwe regel beginnende const/let declaraties -> var.
  block = block.replace(/(^|\n)([ \t]*)const /g, "$1$2var ");
  block = block.replace(/(^|\n)([ \t]*)let /g, "$1$2var ");
  return block;
}

module.exports = { APP_SRC, eq, ok, summary, sliceBlock };
