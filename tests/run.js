#!/usr/bin/env node
// Voert alle test-files in deze map uit en geeft een totaalresultaat.
// Gebruik: `node tests/run.js`

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const here = __dirname;
const files = fs.readdirSync(here)
  .filter(function(f) { return f.endsWith(".test.js"); })
  .sort();

console.log("E-Kast Zoeker — testsuite");
console.log("=".repeat(60));

let allPassed = true;
for (let i = 0; i < files.length; i++) {
  const f = files[i];
  console.log("\n→ " + f);
  const r = spawnSync(process.execPath, [path.join(here, f)], { stdio: "inherit" });
  if (r.status !== 0) {
    allPassed = false;
    console.log("  (testbestand " + f + " faalde — exit " + r.status + ")");
  }
}

console.log("\n" + "=".repeat(60));
console.log(allPassed ? "✓ Alle test-bestanden geslaagd" : "✗ Eén of meer test-bestanden faalden");
process.exit(allPassed ? 0 : 1);
