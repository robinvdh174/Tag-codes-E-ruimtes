// Tests voor de verdeler-overzichten: opbouw uit sheet-rijen
// (_bouwVerdelers) en de koppeling kasten ↔ uitgangen (_findUitgang,
// _scoreUitgang, _matchVerdelers).
// LET OP: enkel verzonnen testdata — echte verdelergegevens horen niet
// in deze openbare repo (ze staan in het tabblad "Verdelers" van de sheet).

const { eq, ok, summary, sliceBlock } = require("./_helpers");

eval(sliceBlock("// Strip alles behalve a-z/0-9", "let _searchTimer"));

// Verzonnen verdeler "MCC 12X3": ladeveld +03, enkele velden, dubbel veld +18.
const ROWS = [
  { verdeler: "MCC 12X3", ruimte: "Testruimte", tekening: "T-000-0001", veld: "+03", nr: "2",  tag: "=900A01P1.P1", omschrijving: "TESTPOMP EEN",      schema: "T-000-0002" },
  { verdeler: "MCC 12X3", ruimte: "",           tekening: "",           veld: "+03", nr: "5",  tag: "",             omschrijving: "Spare",             schema: "T-000-0003" },
  { verdeler: "MCC 12X3", ruimte: "",           tekening: "",           veld: "+03", nr: "9",  tag: "900A01P2.P1",  omschrijving: "TESTPOMP TWEE",     schema: "T-000-0004" },
  { verdeler: "MCC 12X3", veld: "+01", nr: "31", tag: "", omschrijving: "Voeding", schema: "" },
  { verdeler: "MCC 12X3", veld: "+02", nr: "31", tag: "900A02P1.M1", omschrijving: "TESTMOTOR MACHINEKIST", schema: "T-000-0005" },
  { verdeler: "MCC 12X3", veld: "+18", nr: "31A", tag: "900A03P1.M1", omschrijving: "MEETLIJN A", schema: "T-000-0006" },
  { verdeler: "MCC 12X3", veld: "+18", nr: "31B", tag: "900A03P2.M1", omschrijving: "MEETLIJN B", schema: "T-000-0007" },
  { verdeler: "", veld: "+01", tag: "X" },          // ongeldig: geen verdeler
  { verdeler: "VD 7Y", ruimte: "Andere", veld: "+01", nr: "1", tag: "900B01P1.M1", omschrijving: "ANDERE", schema: "" }
];

// ---------- 1. Opbouw uit sheet-rijen ----------
var VERDELERS = _bouwVerdelers(ROWS);
{
  eq(VERDELERS.map(function(v) { return v.naam; }), ["MCC 12X3", "VD 7Y"], "Twee verdelers, in rij-volgorde; ongeldige rij genegeerd");
  const v = VERDELERS[0];
  eq(v.ruimte, "Testruimte", "Ruimte van de eerste rij met ruimte");
  eq(v.tekening, "T-000-0001", "Tekeningnummer overgenomen");
  eq(v.velden.map(function(f) { return f.veld; }), ["+03", "+01", "+02", "+18"], "Velden in volgorde van de rijen");
  eq(v.velden[0].uitgangen.map(function(u) { return u.nr; }), ["2", "5", "9"], "Laden van +03 in volgorde");
  eq(v.velden[0].uitgangen[0].tag, "900A01P1.P1", "Leidend '=' van de tag weggehaald");
  ok(!("_veld" in v), "Hulpveld _veld opgeruimd");
  eq(_bouwVerdelers(null), [], "Geen rijen → lege lijst");
  eq(_bouwVerdelers([{ verdeler: "X", veld: 3 }, { verdeler: "X", veld: "12" }])[0].velden.map(function(f) { return f.veld; }),
     ["+03", "+12"], "Veld als getal uit Sheets (3, \"12\") → \"+03\", \"+12\"");
  eq(_verdelerUitgangen().length, 8, "8 uitgangen in totaal");
}

function sc(e, q) { return _scoreUitgang(e, _normCode(q), _normText(q)); }
function uitVoorTag(tag) {
  return _verdelerUitgangen().find(function(e) { return e.uitgang.tag === tag; });
}

// ---------- 2. Kastcode → uitgang ----------
{
  const e = _findUitgang("900A02P1.M1");
  ok(e && e.veld === "+02" && e.uitgang.schema === "T-000-0005", "Exacte tag vindt veld +02");
  ok(_findUitgang("900a02p1 m1") === e, "Genormaliseerd matchen (hoofdletters/spaties/punt)");
  ok(_findUitgang("900A02P1.M1-M1") === e, "Kastcode met achtervoegsel matcht op de tag");
  eq(_findUitgang("900A02P1"), null, "Onvolledige code koppelt niet aan een uitgang");
  eq(_findUitgang(""), null, "Lege code → null");
  eq(_findUitgang("K822"), null, "Onbekende code → null");
  ok(_findUitgang("900B01P1.M1").verdeler.naam === "VD 7Y", "Tag van tweede verdeler");
}

// ---------- 3. Zoekscore uitgangen ----------
{
  const e = uitVoorTag("900A02P1.M1");
  eq(sc(e, "900A02P1.M1"), 1000, "Exacte tag = 1000");
  ok(sc(e, "900A02") >= 800 && sc(e, "900A02") < 1000, "Prefix op tag");
  eq(sc(e, "12X3+02"), 850, "Veldcode 12X3+02 vindt de uitgang");
  eq(sc(e, "12X3"), -1, "Alleen verdelernaam geeft geen uitgangen (verdelerkaart)");
  eq(sc(e, "T-000-0005"), 600, "Zoeken op schemanummer");
  eq(sc(e, "machinekist"), 300, "Zoeken op omschrijving");
  eq(sc(e, "K822"), -1, "Geen match");
  const spare = _verdelerUitgangen().find(function(x) { return x.uitgang.omschrijving === "Spare"; });
  eq(sc(spare, "spare"), 300, "Spare-lade vindbaar op omschrijving");
}

// ---------- 4. Verdeler zelf ----------
{
  eq(_matchVerdelers(_normCode("MCC 12X3")).length, 1, "Volledige naam");
  eq(_matchVerdelers(_normCode("12x3")).length, 1, "Korte naam");
  eq(_matchVerdelers(_normCode("12")).length, 0, "Te korte zoekterm");
}

// ---------- 5. Geen verdelers geladen ----------
{
  VERDELERS = [];
  _verdelerIdx = null;
  eq(_findUitgang("900A02P1.M1"), null, "Zonder verdelers: geen koppeling, geen fout");
  eq(_matchVerdelers(_normCode("MCC")).length, 0, "Zonder verdelers: geen verdelerkaart");
}

summary();
