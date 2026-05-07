// Tests voor de zoek-/match-logica (_scoreItem, _codeExistsInData).
// Dekt o.a. de "label vs DB heeft meer/minder info" situatie en
// OCR-ruis aan het eind van een gescande tag-code.

const { eq, ok, summary, sliceBlock, APP_SRC } = require("./_helpers");

// Stub data — _codeExistsInData en _scoreItem lezen `data` uit scope.
let data = [];
global.data = data;

// Slice het zoek-blok (bevat _normCode/_normText/_lev/_scoreItem).
const searchBlock = sliceBlock("// Strip alles behalve a-z/0-9", "let _searchTimer");
eval(searchBlock);

// _codeExistsInData zit verderop in app.js, los van het zoek-blok.
const existsBlock = sliceBlock("function _codeExistsInData", "function _searchFromScan");
eval(existsBlock);

function setData(arr) {
  data.length = 0;
  for (let i = 0; i < arr.length; i++) data.push(arr[i]);
}

// Helper: scoor één item en geef -1 terug bij geen match.
function score(d, query) {
  return _scoreItem(d, _normCode(query), _normText(query));
}

// ---------- 1. Exact match ----------
{
  const d = { code: "K822", location: "" };
  eq(score(d, "K822"), 1000, "Exact match krijgt 1000");
  eq(score(d, "k 822"), 1000, "Genormaliseerd exact match");
}

// ---------- 2. Prefix match ----------
{
  const d = { code: "K822", location: "" };
  ok(score(d, "K8") >= 800 && score(d, "K8") < 1000, "Prefix scoort tussen 800 en 1000");
}

// ---------- 3. Forward substring (DB-code bevat query) ----------
{
  // Label heeft minder info dan DB. Bv. label "K822", DB "106.2/K822".
  const d = { code: "106.2/K822", location: "" };
  ok(score(d, "K822") > 0, "Label-met-minder-info: forward substring matcht");
  ok(score(d, "K822") < 1000, "Forward substring < exact");
}

// ---------- 4. Reverse substring: label heeft méér info dan DB ----------
{
  // Label "106.2/K822" maar DB-entry is alleen "K822".
  const d = { code: "K822", location: "" };
  const s = score(d, "106.2/K822");
  ok(s > 0, "Label-met-meer-info: reverse substring matcht");
  ok(s < 800, "Reverse substring scoort lager dan forward substring");
}

// ---------- 5. Reverse substring: OCR-ruis aan het eind ----------
{
  // OCR leest "K822i" terwijl label "K822" toont.
  const d = { code: "K822", location: "" };
  ok(score(d, "K822i") > 0, "OCR-ruis 'i' achter K822: matcht via reverse substring");
}

// ---------- 6. Reverse substring: lengte-drempel voorkomt triviale matches ----------
{
  // Code "K1" is te kort (genormaliseerd 2 chars) → mag niet reverse-matchen
  // op willekeurige langere queries.
  const d = { code: "K1", location: "" };
  eq(score(d, "106A88V1.K1"), -1, "Code 'K1' is te kort voor reverse substring");
}

// ---------- 7. Reverse substring: lengte-penalty ----------
{
  const d = { code: "K822", location: "" };
  const close = score(d, "K822i");          // 1 extra char
  const farther = score(d, "1062K822");     // 4 extra chars
  ok(close > farther, "Minder OCR-ruis krijgt hogere score dan langer prefix");
}

// ---------- 8. Forward substring scoort hoger dan reverse substring ----------
{
  // Twee items, query "K822":
  //  - DB "K822X" → forward substring (codeNorm bevat query)
  //  - DB "K8"    → te kort voor reverse, geen match
  // Daarom kunstmatig: DB "K822" en DB "ABCK822DEF". Beide forward-match.
  // Voor de directe vergelijking forward vs reverse:
  const fwd = { code: "K822X", location: "" };       // codeNorm bevat "k822"
  const rev = { code: "K822", location: "" };        // qNormCode bevat "k822"
  const sFwd = score(fwd, "K822");
  const sRev = score(rev, "K822longer");
  ok(sFwd > sRev, "Forward substring rankt hoger dan reverse substring");
}

// ---------- 9. _codeExistsInData: exact match ----------
{
  setData([{ id: "1", code: "K822", location: "L1" }]);
  ok(_codeExistsInData("K822"), "Exact match bestaat");
  ok(_codeExistsInData("k 822"), "Genormaliseerd match bestaat");
  eq(_codeExistsInData("Z999"), false, "Niet-bestaande code → false");
}

// ---------- 10. _codeExistsInData: forward partial (DB heeft meer info) ----------
{
  setData([{ id: "1", code: "106.2/K822", location: "L1" }]);
  ok(_codeExistsInData("K822"), "Label-minder-info: 'K822' bestaat in DB '106.2/K822'");
}

// ---------- 11. _codeExistsInData: reverse partial (label heeft meer info) ----------
{
  setData([{ id: "1", code: "K822", location: "L1" }]);
  ok(_codeExistsInData("106.2/K822"), "Label-meer-info: '106.2/K822' bestaat in DB 'K822'");
  ok(_codeExistsInData("K822i"), "OCR-ruis 'K822i': bestaat via reverse partial");
}

// ---------- 12. _codeExistsInData: lengte-drempel ----------
{
  setData([{ id: "1", code: "K1", location: "L1" }]);
  // 'K1' is te kort om reverse-partial-match te triggeren op willekeurige queries.
  eq(_codeExistsInData("106A88V1.K1foo"), false, "Code 'K1' te kort voor reverse partial");
}

// ---------- 13. _codeExistsInData: lege/null/undefined input ----------
{
  setData([{ id: "1", code: "K822", location: "L1" }]);
  eq(_codeExistsInData(""), false, "Lege string → false");
  eq(_codeExistsInData(null), false, "null → false");
  eq(_codeExistsInData(undefined), false, "undefined → false");
}

// ---------- 14. Realistisch scenario uit gebruikerstest ----------
{
  // Zoals gerapporteerd: label toont "106.2/K822", OCR leest "106.2/K822i",
  // DB heeft alleen "K822". De zoekfunctie moet dit toch vinden.
  setData([{ id: "kast42", code: "K822", location: "Hal X" }]);
  ok(_codeExistsInData("106.2/K822i"), "User-test: 'bestaat' check moet slagen");
  const s = score(data[0], "106.2/K822i");
  ok(s > 0, "User-test: _scoreItem geeft positieve score");
}

console.log("Search-tests voltooid.");
summary();
