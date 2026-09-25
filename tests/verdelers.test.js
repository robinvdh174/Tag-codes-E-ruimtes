// Tests voor de koppeling kasten ↔ verdeler-overzichten (verdelers.js):
// _findUitgang, _scoreUitgang, _matchVerdelers en de data zelf.

const fs = require("fs");
const path = require("path");
const { eq, ok, summary, sliceBlock } = require("./_helpers");

// verdelers.js laden (const → var zodat VERDELERS in deze scope komt).
eval(fs.readFileSync(path.join(__dirname, "..", "verdelers.js"), "utf8").replace(/^const /m, "var "));
eval(sliceBlock("// Strip alles behalve a-z/0-9", "let _searchTimer"));

function sc(e, q) { return _scoreUitgang(e, _normCode(q), _normText(q)); }
function uitVoorTag(tag) {
  return _verdelerUitgangen().find(function(e) { return e.uitgang.tag === tag; });
}

// ---------- 1. Data MCC 21B4 ----------
{
  const v = VERDELERS.find(function(x) { return x.naam === "MCC 21B4"; });
  ok(!!v, "MCC 21B4 staat in verdelers.js");
  eq(v.ruimte, "3KV", "MCC 21B4 staat in de 3KV");
  eq(v.velden.map(function(f) { return f.veld; }),
     ["+03", "+01", "+02", "+04", "+06", "+08", "+10", "+12", "+14", "+16", "+18"],
     "Velden in volgorde van de tekening");
  eq(_verdelerUitgangen().length, 17, "17 uitgangen in totaal");
  eq(v.velden[0].uitgangen.map(function(u) { return u.nr; }), ["2", "5", "9", "13", "17", "22"],
     "Ladenummers van veld +03");
}

// ---------- 2. Kastcode → uitgang ----------
{
  const e = _findUitgang("106A09P1.M1");
  ok(e && e.veld === "+02" && e.uitgang.schema === "E-070-1596", "Exacte tag vindt veld +02");
  ok(_findUitgang("106a09p1 m1") === e, "Genormaliseerd matchen (hoofdletters/spaties/punt)");
  ok(_findUitgang("106A09P1.M1-M1") === e, "Kastcode met achtervoegsel matcht op de tag");
  eq(_findUitgang("106A09P1"), null, "Onvolledige code koppelt niet aan een uitgang");
  eq(_findUitgang(""), null, "Lege code → null");
  eq(_findUitgang("K822"), null, "Onbekende code → null");
}

// ---------- 3. Zoekscore uitgangen ----------
{
  const e = uitVoorTag("106A09P1.M1");
  eq(sc(e, "106A09P1.M1"), 1000, "Exacte tag = 1000");
  ok(sc(e, "106A09") >= 800 && sc(e, "106A09") < 1000, "Prefix op tag");
  eq(sc(e, "21B4+02"), 850, "Veldcode 21B4+02 vindt de uitgang");
  eq(sc(e, "21B4"), -1, "Alleen verdelernaam geeft geen uitgangen (verdelerkaart)");
  eq(sc(e, "E-070-1596"), 600, "Zoeken op schemanummer");
  eq(sc(e, "machinekist 7"), 300, "Zoeken op omschrijving");
  eq(sc(e, "K822"), -1, "Geen match");
  const spare = _verdelerUitgangen().find(function(x) { return x.veld === "+16"; });
  eq(sc(spare, "spare"), 300, "Spare-veld vindbaar op omschrijving");
}

// ---------- 4. Verdeler zelf ----------
{
  eq(_matchVerdelers(_normCode("MCC 21B4")).length, 1, "Volledige naam");
  eq(_matchVerdelers(_normCode("21b4")).length, 1, "Korte naam 21B4");
  eq(_matchVerdelers(_normCode("21")).length, 0, "Te korte zoekterm");
}

summary();
