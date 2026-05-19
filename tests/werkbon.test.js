// Tests voor de werkbon state-logica.
// We mocken localStorage, data en DOM zodat we de pure logica
// kunnen valideren zonder browser.

const { eq, ok, summary, sliceBlock, APP_SRC } = require("./_helpers");

// ---------- Mocks ----------
const _store = {};
global.localStorage = {
  getItem: function(k) { return _store[k] === undefined ? null : _store[k]; },
  setItem: function(k, v) { _store[k] = String(v); },
  removeItem: function(k) { delete _store[k]; },
  clear: function() { for (const k in _store) delete _store[k]; }
};

// Stub document — alleen wat onze functies aanraken (badge update, render)
const _stubElems = {};
global.document = {
  getElementById: function(id) {
    if (!_stubElems[id]) {
      _stubElems[id] = {
        id: id, _children: [], _value: "", _text: "",
        textContent: "",
        get value() { return this._value; },
        set value(v) { this._value = String(v); },
        style: {},
        classList: { add: function() {}, remove: function() {}, toggle: function() {}, contains: function() { return false; } },
        querySelectorAll: function() { return []; },
        querySelector: function() { return null; },
        appendChild: function(c) { this._children.push(c); },
        setAttribute: function() {},
        addEventListener: function() {},
        focus: function() {}, select: function() {},
        getAttribute: function() { return ""; }
      };
    }
    return _stubElems[id];
  },
  createElement: function() {
    return {
      _children: [], textContent: "", className: "", style: {},
      classList: { add: function() {}, remove: function() {}, toggle: function() {} },
      appendChild: function(c) { this._children.push(c); },
      addEventListener: function() {},
      setAttribute: function() {},
      onclick: null
    };
  },
  createTextNode: function(t) { return { textContent: t }; },
  // refreshAllLabelBtns en andere DOM-helpers gebruiken document.querySelectorAll;
  // we hebben geen echte DOM nodig, lege NodeList volstaat.
  querySelectorAll: function() { return []; },
  querySelector: function() { return null; },
  createDocumentFragment: function() {
    return {
      _children: [],
      appendChild: function(c) { this._children.push(c); }
    };
  }
};
// In tests willen we geen écht-async gedrag; voer callbacks meteen uit
// zodat flags zoals _werkbonFinalizing tussen tests netjes resetten.
global.setTimeout = function(fn) { try { fn(); } catch (e) {} return 0; };
global.clearTimeout = function() {};

// ---------- Stub data + helpers uit andere blokken ----------
let data = [];
global.data = data;

// _normCode is gedefinieerd in het zoek-blok; we evallen dat eerst
// (subset: alleen de helpers die we nodig hebben).
const searchBlock = sliceBlock("// Strip alles behalve a-z/0-9", "let _searchTimer");
eval(searchBlock);

// _scoreItem zit in hetzelfde blok. Pakken we mee.
// (sliceBlock pakt _normCode en _normText én _lev én _scoreItem)

// Stubs voor functies die we niet testen maar wel gerefereerd worden
global.showToast = function() {};
global.setStatus = function() { return Promise.resolve(); };
global.refreshUI = function() {};
global.refreshAllLabelBtns = function() {};
global.logAction = function() {};
global.safeGet = function(k, d) { return d; };
global.todayISO = function() { return "2026-04-29"; };
let _confirmAutoYes = true;
global.showConfirm = function(msg, cb) { if (_confirmAutoYes) cb(); };
global.switchTab = function() {};
global.doSearch = function() {};
global.openScan = function() {};
global.closeScan = function() {};
global.openWerkbon = function() {};
global.closeWerkbon = function() {};

// ROOM_INFO wordt buiten het werkbon-blok gedeclareerd in app.js maar wordt
// wel aangeroepen door renderLabelsTab. In de test gebruiken we een lege
// stub zodat geen enkele ruimte een ⓘ-info-knop opbouwt — het gaat ons hier
// puur om de werkbon-state-logica, niet om de UI-rendering.
global.ROOM_INFO = {};

// Onderdruk console.warn-spam tijdens negatieve tests (bijv. corrupte JSON).
const _origWarn = console.warn;
console.warn = function() {};

// ---------- Werkbon-blok evallen ----------
const wbBlock = sliceBlock("// WERKBON-STAPEL", "// ============================================================\n// START");
eval(wbBlock);

// Synchroniseren: het lokale 'data' uit eval is de globale; in node
// zijn `let`-declaraties block-scoped, dus we moeten via global.data
// aanpassen + de eval-scope-data ook bijwerken via een gerichte truc.
function setData(arr) {
  data.length = 0;
  for (let i = 0; i < arr.length; i++) data.push(arr[i]);
}

function resetWerkbon() {
  _store["ekast_werkbon"] = undefined;
  delete _store["ekast_werkbon"];
  _werkbon = _WB_DEFAULT();
  _wbSave();
}

// ====================================================================
// TESTS
// ====================================================================

// ---------- 1. _normCode normalisatie ----------
{
  eq(_normCode("C404"), "c404", "lowercase");
  eq(_normCode("C-404"), "c404", "streepje weg");
  eq(_normCode("c 404"), "c404", "spatie weg");
  eq(_normCode("C.404"), "c404", "punt weg");
  eq(_normCode("106A88V1.M1"), "106a88v1m1", "complex normaliseren");
  eq(_normCode(""), "", "leeg blijft leeg");
  eq(_normCode(null), "", "null gracefully");
}

// ---------- 2. werkbonAddItemByCode happy path ----------
{
  setData([
    { id: "1", code: "C404", location: "Hal A" },
    { id: "2", code: "C405", location: "Hal B" }
  ]);
  resetWerkbon();
  const r = werkbonAddItemByCode("C404");
  eq(r.reason, "added", "Add: gevonden");
  eq(r.item.id, "1", "Add: juiste item");
  eq(_werkbon.ids.length, 1, "Add: ids array gegroeid");
  eq(_werkbon.ids[0], "1", "Add: id correct");
}

// ---------- 3. werkbonAddItemByCode genormaliseerd matchen ----------
{
  setData([{ id: "x", code: "C-404", location: "L1" }]);
  resetWerkbon();
  const r = werkbonAddItemByCode("c 404");
  eq(r.reason, "added", "Genormaliseerd matchen werkt");
  eq(r.item.id, "x", "Match juiste item");
}

// ---------- 4. Duplicaat detecteren ----------
{
  setData([{ id: "1", code: "C404", location: "L1" }]);
  resetWerkbon();
  werkbonAddItemByCode("C404");
  const r = werkbonAddItemByCode("C404");
  eq(r.reason, "dup", "Tweede toevoeg = duplicate");
  eq(_werkbon.ids.length, 1, "Geen tweede id toegevoegd");
}

// ---------- 5. Niet gevonden ----------
{
  setData([{ id: "1", code: "C404", location: "L1" }]);
  resetWerkbon();
  const r = werkbonAddItemByCode("Z999");
  eq(r.reason, "notfound", "Onbestaande code -> notfound");
  eq(_werkbon.ids.length, 0, "Niets toegevoegd");
}

// ---------- 6. werkbonRemoveItem ----------
{
  setData([
    { id: "1", code: "A", location: "L1" },
    { id: "2", code: "B", location: "L2" }
  ]);
  resetWerkbon();
  werkbonAddItemByCode("A");
  werkbonAddItemByCode("B");
  eq(_werkbon.ids.length, 2, "Twee items voor remove");
  // markeer eerst dat item 1 'done' is — moet ook gewist worden
  _werkbon.done["1"] = "ok";
  werkbonRemoveItem("1");
  eq(_werkbon.ids.length, 1, "Een item na remove");
  eq(_werkbon.ids[0], "2", "Resterend item is correct");
  eq(_werkbon.done["1"], undefined, "done-state ook opgeruimd");
}

// ---------- 7. _wbResolveItems filtert weg-gesyncte ----------
{
  setData([{ id: "1", code: "A", location: "L1" }]);
  resetWerkbon();
  werkbonAddItemByCode("A");
  // Simuleer dat data[] nu leeg is (auto-sync verwijderde de kast)
  setData([]);
  const items = _wbResolveItems();
  eq(items.length, 0, "Resolve filtert verloren id's stil weg");
  eq(_werkbon.ids.length, 1, "Maar id blijft in werkbon-state");
}

// ---------- 8. _wbResolveItems dedupliceert dubbele ids ----------
{
  setData([{ id: "1", code: "A", location: "L1" }]);
  resetWerkbon();
  // Direct injecteren in array (handmatige corruptie)
  _werkbon.ids = ["1", "1", "1"];
  const items = _wbResolveItems();
  eq(items.length, 1, "Dubbele id wordt slechts één keer geresolved");
}

// ---------- 9. _wbLoad valideert corrupte localStorage ----------
{
  // Niet-string id's filteren
  _store["ekast_werkbon"] = JSON.stringify({
    ids: ["valid", null, 123, undefined, "", "ok"],
    vergunning: "MA001",
    action: "ok",
    done: {}
  });
  _werkbon = _WB_DEFAULT();
  _wbLoad();
  eq(_werkbon.ids.length, 2, "Alleen valide string-id's behouden");
  eq(_werkbon.ids[0], "valid", "Eerste valide id behouden");
  eq(_werkbon.ids[1], "ok", "Tweede valide id behouden");
}

// ---------- 10. _wbLoad weigert ongeldige actie-waarde ----------
{
  _store["ekast_werkbon"] = JSON.stringify({
    ids: ["a"],
    vergunning: "X",
    action: "PWNED",
    done: {}
  });
  _werkbon = _WB_DEFAULT();
  _wbLoad();
  eq(_werkbon.action, "ok", "Ongeldige actie -> default 'ok'");
}

// ---------- 11. _wbLoad weigert verkeerd type vergunning ----------
{
  _store["ekast_werkbon"] = JSON.stringify({
    ids: [],
    vergunning: 12345,
    action: "ok",
    done: {}
  });
  _werkbon = _WB_DEFAULT();
  _wbLoad();
  eq(_werkbon.vergunning, "", "Niet-string vergunning -> leeg");
}

// ---------- 12. _wbLoad weigert array als 'done' ----------
{
  _store["ekast_werkbon"] = JSON.stringify({
    ids: ["a"],
    action: "ok",
    done: ["bogus"]
  });
  _werkbon = _WB_DEFAULT();
  _wbLoad();
  eq(typeof _werkbon.done, "object", "done is object");
  eq(Array.isArray(_werkbon.done), false, "done is niet array");
}

// ---------- 13. _wbLoad bij volledig ongeldige JSON ----------
{
  _store["ekast_werkbon"] = "{niet:json";
  _werkbon = _WB_DEFAULT();
  _wbLoad();
  eq(_werkbon.ids.length, 0, "Ongeldige JSON -> default state");
  eq(_werkbon.action, "ok", "Default action");
}

// ---------- 14. wbSetItemStatus: per-item actie + valide waardes ----------
{
  setData([{ id: "1", code: "A", location: "L1" }]);
  resetWerkbon();
  werkbonAddItemByCode("A");
  wbSetItemStatus("1", "ok");
  eq(_werkbon.done["1"], "ok", "wbSetItemStatus: 'ok' geaccepteerd");
  wbSetItemStatus("1", "losgekoppeld");
  eq(_werkbon.done["1"], "losgekoppeld", "wbSetItemStatus: 'losgekoppeld' geaccepteerd");
  wbSetItemStatus("1", "");
  eq(_werkbon.done["1"], "", "wbSetItemStatus: '' (in bedrijf) geaccepteerd");
}

// ---------- 15. werkbonAddItemById validatie ----------
{
  setData([{ id: "real", code: "X", location: "L" }]);
  resetWerkbon();
  eq(werkbonAddItemById("real"), true, "Bestaande id geaccepteerd");
  eq(werkbonAddItemById("real"), false, "Duplicate geweigerd");
  eq(werkbonAddItemById("ghost"), false, "Niet-bestaand id geweigerd");
  eq(werkbonAddItemById(""), false, "Lege id geweigerd");
  eq(werkbonAddItemById(null), false, "null id geweigerd");
}

// ---------- 16. Persistentie: ids + done overleven 'restart' ----------
{
  setData([
    { id: "1", code: "A", location: "L1" },
    { id: "2", code: "B", location: "L2" }
  ]);
  resetWerkbon();
  werkbonAddItemByCode("A");
  werkbonAddItemByCode("B");
  wbSetItemStatus("1", "ok");
  wbSetItemStatus("2", "losgekoppeld");

  // Simuleer pagina-reload door state te wissen en opnieuw te laden
  _werkbon = _WB_DEFAULT();
  _wbLoad();

  eq(_werkbon.ids.length, 2, "Ids overleven reload");
  eq(_werkbon.done["1"], "ok", "Actie van item 1 overleeft");
  eq(_werkbon.done["2"], "losgekoppeld", "Actie van item 2 overleeft");
}

// ---------- 17. _wbLoad valideert dat done geen array is ----------
{
  // Done als array moet teruggezet worden naar object
  _store["ekast_werkbon"] = JSON.stringify({
    ids: ["x"],
    action: "ok",
    done: ["bogus", "values"]
  });
  _werkbon = _WB_DEFAULT();
  _wbLoad();
  eq(Array.isArray(_werkbon.done), false, "done is geen array meer na load");
  eq(typeof _werkbon.done, "object", "done is een (object) map");
}

// ---------- 18. _wbResolveItems behoudt volgorde van toevoegen ----------
{
  setData([
    { id: "z", code: "Z", location: "Hal Z" },
    { id: "a", code: "A", location: "Hal A" },
    { id: "m", code: "M", location: "Hal M" }
  ]);
  resetWerkbon();
  werkbonAddItemByCode("Z");
  werkbonAddItemByCode("A");
  werkbonAddItemByCode("M");
  const items = _wbResolveItems();
  eq(items.map(function(i) { return i.id; }), ["z", "a", "m"],
     "Volgorde van toevoegen behouden in resolve");
}

// Helper: vul naam + datum (verplicht in werkbonFinalize) zodat de
// validatie-gates niet onbedoeld in de weg zitten van state-tests.
// Lege string betekent expliciet leeg (om de validatie zelf te testen).
function setNaamDatum(naam, datum) {
  document.getElementById("wbNaam").value = naam === undefined ? "Tester" : naam;
  document.getElementById("wbDatum").value = datum === undefined ? "2026-04-29" : datum;
}

// Tests 19-25 omvatten ook werkbonFinalize, dat async is. We wikkelen
// de hele staart in een async IIFE en awaiten elke finalize-call zodat
// state-asserties pas lopen nadat de promise-keten echt is afgerond.
(async function runAsyncTail() {
  // ---------- 19. werkbonFinalize: alle items gemarkeerd → lijst leeg ----------
  {
    setData([{ id: "1", code: "A", location: "L1" }]);
    resetWerkbon();
    werkbonAddItemByCode("A");
    _werkbon.done["1"] = "ok"; // markeer als gedaan
    setNaamDatum();
    await werkbonFinalize();
    eq(_werkbon.ids.length, 0, "Alles gemarkeerd: lijst leeg na finalize");
    eq(Object.keys(_werkbon.done).length, 0, "Alles gemarkeerd: done-map opgeruimd");
  }

  // ---------- 20. werkbonFinalize: deels gemarkeerd → alleen verwerkte verwijderd ----------
  {
    setData([
      { id: "1", code: "A", location: "L1" },
      { id: "2", code: "B", location: "L2" }
    ]);
    resetWerkbon();
    werkbonAddItemByCode("A");
    werkbonAddItemByCode("B");
    _werkbon.done["1"] = "ok"; // alleen item 1 gemarkeerd
    setNaamDatum();
    await werkbonFinalize();
    eq(_werkbon.ids.length, 1, "Deels gemarkeerd: ongemarkeerde blijft staan");
    eq(_werkbon.ids[0], "2", "Item 2 (ongemarkeerd) is nog in de stapel");
    eq("1" in _werkbon.done, false, "Done-state van verwerkte item verwijderd");
  }

  // ---------- 21. werkbonFinalize: niets gemarkeerd → no-op, stapel intact ----------
  {
    setData([{ id: "1", code: "A", location: "L1" }]);
    resetWerkbon();
    werkbonAddItemByCode("A");
    setNaamDatum();
    await werkbonFinalize();
    eq(_werkbon.ids.length, 1, "Niets gemarkeerd: stapel ongewijzigd");
  }

  // ---------- 22. werkbonFinalize: verplicht naam vóór doorgaan ----------
  {
    setData([{ id: "1", code: "A", location: "L1" }]);
    resetWerkbon();
    werkbonAddItemByCode("A");
    _werkbon.done["1"] = "ok";
    setNaamDatum("", "2026-04-29"); // naam leeg
    await werkbonFinalize();
    eq(_werkbon.ids.length, 1, "Lege naam: finalize geblokkeerd, item blijft");
  }

  // ---------- 23. werkbonClearAll: leegmaakt alle state ----------
  {
    setData([
      { id: "1", code: "A", location: "L1" },
      { id: "2", code: "B", location: "L2" }
    ]);
    resetWerkbon();
    werkbonAddItemByCode("A");
    werkbonAddItemByCode("B");
    _werkbon.done["1"] = "ok";
    _confirmAutoYes = true;
    werkbonClearAll();
    eq(_werkbon.ids.length, 0, "ClearAll: ids leeg");
    eq(Object.keys(_werkbon.done).length, 0, "ClearAll: done-map leeg");
  }

  // ---------- 24. werkbonClearAll: bij lege werkbon doet niets gevaarlijks ----------
  {
    resetWerkbon();
    let err = null;
    try { werkbonClearAll(); } catch (e) { err = e; }
    eq(err, null, "ClearAll bij lege werkbon: geen crash");
  }

  // ---------- 25. werkbonAddItemByCode geeft id terug bij dup ----------
  {
    setData([{ id: "x", code: "ABC", location: "L1" }]);
    resetWerkbon();
    werkbonAddItemByCode("ABC");
    const r = werkbonAddItemByCode("ABC");
    eq(r.added, false, "Dup: added=false");
    ok(r.item != null, "Dup: item teruggegeven (zodat UI kan tonen wat er al stond)");
    eq(r.item.id, "x", "Dup: juiste item");
  }

  // ---------- 26. _wbLoad bij volledig leeg / niet-bestaand ----------
  {
    delete _store["ekast_werkbon"];
    _werkbon = _WB_DEFAULT();
    _wbLoad();
    eq(_werkbon.ids.length, 0, "Geen storage: default state");
    eq(_werkbon.action, "ok", "Geen storage: default actie");
    eq(_werkbon.vergunning, "", "Geen storage: lege vergunning");
  }

  // Herstel console.warn aan einde
  console.warn = _origWarn;

  console.log("Werkbon-tests voltooid.");
  summary();
})().catch(function(e) {
  console.error("Werkbon-tests gefaald met onverwachte fout:", e);
  process.exit(1);
});
