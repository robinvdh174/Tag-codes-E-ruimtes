// Tests voor de Apps Script-backend (Code.gs) tegen een nagebootste
// Google Sheet. Zo wordt de serverlogica (toevoegen, bewerken, conflict,
// verwijderen, ruimtes, blocklist, logboek) getest zonder de echte sheet.
// Alle data hieronder is verzonnen.

const fs = require("fs");
const path = require("path");
const { eq, ok, summary } = require("./_helpers");

// ---- Nagebootste Apps Script-diensten ----
function makeSheet(name) {
  const rows = [];
  function range(r, c, nr, nc) {
    nr = nr || 1; nc = nc || 1;
    const api = {
      getValues: function() {
        const out = [];
        for (let i = 0; i < nr; i++) {
          const row = [];
          for (let j = 0; j < nc; j++) row.push((rows[r - 1 + i] || [])[c - 1 + j] === undefined ? "" : rows[r - 1 + i][c - 1 + j]);
          out.push(row);
        }
        return out;
      },
      getValue: function() { return api.getValues()[0][0]; },
      setValues: function(vals) {
        for (let i = 0; i < nr; i++) {
          while (rows.length < r + i) rows.push([]);
          for (let j = 0; j < nc; j++) rows[r - 1 + i][c - 1 + j] = vals[i][j];
        }
        return api;
      },
      setValue: function(v) { return api.setValues([[v]]); },
      setFontWeight: function() { return api; },
      setBackground: function() { return api; },
      setFontColor: function() { return api; }
    };
    return api;
  }
  return {
    name: name, rows: rows,
    appendRow: function(r) { rows.push(r.slice()); },
    getLastRow: function() { return rows.length; },
    getLastColumn: function() { return rows.reduce(function(m, r) { return Math.max(m, r.length); }, 0); },
    getDataRange: function() { return range(1, 1, Math.max(rows.length, 1), Math.max(this.getLastColumn(), 1)); },
    getRange: range,
    deleteRow: function(n) { rows.splice(n - 1, 1); },
    setFrozenRows: function() {},
    setColumnWidth: function() {}
  };
}
var sheets = {};
var SpreadsheetApp = {
  openById: function() {
    return {
      getSheetByName: function(n) { return sheets[n] || null; },
      insertSheet: function(n) { sheets[n] = makeSheet(n); return sheets[n]; }
    };
  }
};
var locked = false, lockBusy = false;
var LockService = { getScriptLock: function() { return {
  waitLock: function() { if (lockBusy) throw new Error("lock timeout"); locked = true; },
  releaseLock: function() { locked = false; }
}; } };
var scriptProps = {};
var PropertiesService = { getScriptProperties: function() { return { getProperty: function(k) { return scriptProps[k] || null; } }; } };
var Utilities = { formatDate: function() { return "01-01-2026 12:00:00"; } };
var Logger = { log: function() {} };
var ContentService = {
  MimeType: { JSON: "json" },
  createTextOutput: function(t) { return { text: t, setMimeType: function() { return this; } }; }
};

eval(fs.readFileSync(path.join(__dirname, "..", "Code.gs"), "utf8"));

function get(params) { return JSON.parse(doGet({ parameter: Object.assign({ token: "ekast-2025" }, params) }).text); }
function post(params) { return JSON.parse(doPost({ postData: { contents: JSON.stringify(Object.assign({ token: "ekast-2025" }, params)) } }).text); }
function kast(id, extra) { return Object.assign({ id: id, code: "T-" + id, location: "Testruimte", note: "", position: "", status: "" }, extra || {}); }

// ---- Toegang ----
eq(get({ token: "fout" }), { error: "Ongeautoriseerd" }, "verkeerd token geweigerd");
eq(JSON.parse(doGet({}).text), { error: "Ongeautoriseerd" }, "geen parameters geweigerd");
eq(JSON.parse(doPost({ postData: { contents: "{kapot" } }).text), { error: "Ongeldige POST-body" }, "kapotte POST-body");
ok(/Onbekende actie/.test(get({ action: "bestaatniet" }).error), "onbekende actie geeft fout");
eq(get({ action: "version" }).ok, true, "version-actie werkt");
scriptProps.API_TOKEN = "nieuw-token";
eq(get({ action: "version" }), { error: "Ongeautoriseerd" }, "token uit scripteigenschappen gaat voor");
eq(get({ action: "version", token: "nieuw-token" }).ok, true, "nieuw token werkt");
delete scriptProps.API_TOKEN;

// ---- Kasten: add / get ----
eq(get({ action: "get" }), [], "lege sheet → lege lijst");
const a1 = post({ action: "add", data: JSON.stringify(kast("1", { status: "ok", statusBy: "Jan", statusDate: "2026-01-02" })) });
ok(a1.success && a1.lastModified, "add geeft lastModified terug");
post({ action: "add", data: JSON.stringify(kast("2")) });
let all = get({ action: "get" });
eq(all.length, 2, "twee kasten opgehaald");
eq(all[0].status, "ok", "status komt als app-waarde terug");
eq(sheets.Kasten.rows[1][5], "Veiliggesteld", "status staat leesbaar in de sheet");
eq(all[0].statusBy, "Jan", "statusBy bewaard");

// Idempotent: dezelfde add opnieuw (retry na time-out) → geen dubbele rij.
const a1b = post({ action: "add", data: JSON.stringify(kast("1", { status: "ok" })) });
eq(sheets.Kasten.rows.length, 3, "herhaalde add maakt geen dubbele rij");
ok(a1b.success && a1b.existing, "herhaalde add meldt succes (existing)");
eq(a1b.lastModified, a1.lastModified, "herhaalde add geeft de bestaande lastModified");

// ---- Kasten: update + conflict ----
const u1 = post({ action: "update", data: JSON.stringify(kast("2", { note: "pomp", expectedLastModified: all[1].lastModified })) });
ok(u1.success, "update met juiste expectedLastModified slaagt");
eq(get({ action: "get" })[1].note, "pomp", "update is weggeschreven");
const u2 = post({ action: "update", data: JSON.stringify(kast("2", { note: "motor", expectedLastModified: "verouderd" })) });
ok(u2.conflict && u2.serverItem.note === "pomp", "verouderde expectedLastModified → conflict met serverversie");
eq(get({ action: "get" })[1].note, "pomp", "conflict schrijft niets weg");
const u3 = post({ action: "update", data: JSON.stringify(kast("2", { note: "motor" })) });
ok(u3.success, "update zonder expectedLastModified overschrijft (keuze 'mijn versie')");
ok(/niet gevonden/.test(post({ action: "update", data: JSON.stringify(kast("999")) }).error), "update van onbekende id → 'niet gevonden'");
eq(sheets.Kasten.rows[2].indexOf("verouderd"), -1, "expectedLastModified belandt niet in de sheet");

// ---- Kasten: delete ----
ok(post({ action: "delete", id: "1" }).success, "delete slaagt");
eq(get({ action: "get" }).map(function(k) { return k.id; }), ["2"], "juiste rij verwijderd");
ok(/niet gevonden/.test(post({ action: "delete", id: "1" }).error), "tweede delete → 'niet gevonden'");

// ---- Lock ----
lockBusy = true;
eq(post({ action: "delete", id: "2" }), { error: "Server bezet, probeer opnieuw" }, "bezette lock → 'Server bezet'");
eq(get({ action: "get" }).length, 1, "lezen heeft geen lock nodig");
lockBusy = false;
post({ action: "add", data: JSON.stringify(kast("3")) });
eq(locked, false, "lock wordt vrijgegeven na een schrijfactie");

// ---- Verouderde locatienamen ----
post({ action: "add", data: JSON.stringify(kast("4", { location: "Omvormerruimte" })) });
eq(get({ action: "get" }).filter(function(k) { return k.id === "4"; })[0].location, "OMVR B.", "oude locatienaam wordt vertaald");

// ---- Ruimtes ----
eq(get({ action: "getRooms" }), [], "nog geen ruimtes");
eq(post({ action: "addRoom", name: " Kelder ", desc: "onder" }), { ok: true }, "ruimte toegevoegd");
ok(post({ action: "addRoom", name: "Kelder", desc: "x" }).existing, "bestaande ruimte niet dubbel");
eq(get({ action: "getRooms" }), [{ name: "Kelder", desc: "onder", renamedFrom: "" }], "ruimte opgehaald (naam getrimd)");
// Beschrijving wijzigen van een ruimte die nog niet in het tabblad staat (ingebouwd).
eq(post({ action: "updateRoom", oldName: "Testruimte", newName: "Testruimte", desc: "nieuw" }).renamed, false, "enkel beschrijving gewijzigd");
// Hernoemen: kasten gaan mee, oude naam wordt bewaard.
const r1 = post({ action: "updateRoom", oldName: "Testruimte", newName: "Proefruimte", desc: "nieuw" });
eq([r1.ok, r1.renamed, r1.kastenRenamed], [true, true, 2], "hernoemen neemt de 2 kasten mee");
eq(get({ action: "get" }).filter(function(k) { return k.location === "Proefruimte"; }).length, 2, "kasten staan in de nieuwe ruimte");
eq(get({ action: "getRooms" })[1], { name: "Proefruimte", desc: "nieuw", renamedFrom: "Testruimte" }, "renamedFrom bewaard");
ok(/bestaat al/.test(post({ action: "updateRoom", oldName: "Proefruimte", newName: "Kelder", desc: "" }).error), "botsende naam geweigerd");
ok(post({ action: "updateRoom", oldName: "", newName: "X" }).error, "lege oude naam geweigerd");

// ---- Hernoemen: kasten met afwijkende schrijfwijze + verdelers + herhaling ----
(function() {
  const k = sheets["Kasten"];
  const loc = k.rows[0].indexOf("location"), id = k.rows[0].indexOf("id");
  function rij(i, l) { const r = k.rows[0].map(function() { return ""; }); r[id] = i; r[loc] = l; k.rows.push(r); }
  rij("h1", "Hal A"); rij("h2", "Hal A "); rij("h3", "hal a"); rij("h4", "Hal B");
  sheets["Verdelers"] = makeSheet("Verdelers");
  sheets["Verdelers"].appendRow(["verdeler", "ruimte", "tekening", "veld", "nr", "tag", "omschrijving", "schema"]);
  sheets["Verdelers"].appendRow(["MCC T", "Hal A", "", "+01", "1", "T1", "", ""]);
  const r = post({ action: "updateRoom", oldName: "Hal A", newName: "Hal Noord", desc: "" });
  eq(r.kastenRenamed, 3, "ook kasten met spatie/andere hoofdletters hernoemd");
  function locs() { return get({ action: "get" }).filter(function(x) { return /^h\d$/.test(x.id); }).map(function(x) { return x.location; }); }
  eq(locs(), ["Hal Noord", "Hal Noord", "Hal Noord", "Hal B"], "kasten staan onder de nieuwe naam");
  eq(get({ action: "getVerdelers" })[0].ruimte, "Hal Noord", "verdeler mee hernoemd");
  // dezelfde actie nog eens (herhaling na time-out) -> geen 'bestaat al'
  const again = post({ action: "updateRoom", oldName: "Hal A", newName: "Hal Noord", desc: "nu met tekst" });
  ok(again.ok && again.already, "herhaalde hernoeming is geen fout");
  // tweede hernoeming: beide oude namen bewaard
  post({ action: "updateRoom", oldName: "Hal Noord", newName: "Hal N", desc: "" });
  const room = get({ action: "getRooms" }).filter(function(x) { return x.name === "Hal N"; })[0];
  eq(room.renamedFrom, "Hal A | Hal Noord", "keten van oude namen bewaard");
  // een kast die in de sheet nog de oude naam draagt, komt toch goed door
  rij("h5", "Hal A");
  eq(locs()[4], "Hal N", "oude naam in de sheet -> huidige naam bij ophalen");

  // ---- Ruimte verwijderen ----
  ok(/4 kasten/.test(post({ action: "deleteRoom", name: "Hal N" }).error), "ruimte met kasten niet verwijderbaar");
  ok(post({ action: "deleteRoom", name: "" }).error, "lege naam geweigerd");
  eq(post({ action: "deleteRoom", name: "Kelder" }), { ok: true }, "lege ruimte verwijderd");
  eq(get({ action: "getRooms" }).filter(function(x) { return x.name === "Kelder"; })[0].deleted, true, "verwijdering zichtbaar voor andere toestellen");
  eq(post({ action: "deleteRoom", name: "Ingebouwd" }), { ok: true }, "ingebouwde ruimte (geen rij) verwijderd");
  eq(get({ action: "getRooms" }).filter(function(x) { return x.name === "Ingebouwd"; })[0].deleted, true, "markering voor ingebouwde ruimte");
  ok(post({ action: "addRoom", name: "Kelder", desc: "terug" }).restored, "verwijderde ruimte opnieuw toegevoegd");
  eq(get({ action: "getRooms" }).filter(function(x) { return x.name === "Kelder"; })[0], { name: "Kelder", desc: "terug", renamedFrom: "" }, "weer actief");
  // hernoemen naar de naam van een verwijderde ruimte mag
  post({ action: "addRoom", name: "Tijdelijk", desc: "" });
  ok(post({ action: "updateRoom", oldName: "Tijdelijk", newName: "Ingebouwd", desc: "" }).ok, "naam van verwijderde ruimte hergebruikt");
  eq(get({ action: "getRooms" }).filter(function(x) { return x.name === "Ingebouwd"; }).length, 1, "geen dubbele rij");
  eq(get({ action: "version" }).version, "v5", "backend-versie v5");
  delete sheets["Verdelers"];
})();

// ---- Logboek ----
post({ action: "log", logaction: "Toegevoegd", code: "T-1", location: "Kelder", device: "Test (ABCD1234)", sheet: "Logboek Toevoegingen" });
eq(sheets["Logboek Toevoegingen"].rows.length, 2, "logregel in het juiste tabblad");
const kastenVoor = sheets.Kasten.rows.length;
post({ action: "log", logaction: "x", code: "y", sheet: "Kasten" });
post({ action: "log", logaction: "x", code: "y", sheet: "Geblokkeerd" });
eq(sheets.Kasten.rows.length, kastenVoor, "log kan geen rijen in 'Kasten' schrijven");
ok(!sheets.Geblokkeerd, "log kan geen 'Geblokkeerd'-tabblad vullen");
eq(sheets.Logboek.rows.length, 3, "afwijkende tabbladnaam valt terug op 'Logboek'");

// ---- Toestellen / blocklist ----
post({ action: "log", logaction: "Aanmelding", device: "GSM Dag (ABCD1234)", sheet: "Logboek Aanmeldingen" });
post({ action: "log", logaction: "Aanmelding", device: "Tablet (0000FFFF)", sheet: "Logboek Aanmeldingen" });
post({ action: "log", logaction: "Aanmelding", device: "GSM Dag (ABCD1234)", sheet: "Logboek Aanmeldingen" });
eq(get({ action: "getDevices" }).map(function(d) { return d.deviceId; }), ["ABCD1234", "0000FFFF"], "unieke toestellen, recentste eerst");
eq(get({ action: "getBlocklist" }), [], "blocklist leeg");
eq(get({ action: "blockDevice", deviceId: "ABCD1234", deviceName: "GSM Dag", blockedBy: "Beheer" }), { ok: true }, "toestel geblokkeerd");
ok(get({ action: "blockDevice", deviceId: "ABCD1234" }).existing, "niet dubbel geblokkeerd");
eq(get({ action: "getBlocklist" }), ["ABCD1234"], "blocklist bevat het toestel");
eq(get({ action: "unblockDevice", deviceId: "ABCD1234" }), { ok: true }, "blokkade opgeheven");
eq(get({ action: "getBlocklist" }), [], "blocklist weer leeg");

// ---- Verdelers ----
eq(get({ action: "getVerdelers" }), [], "tabblad Verdelers wordt aangemaakt, lege lijst");
sheets.Verdelers.appendRow(["MCC 99Z9", "Kelder", "T-001", 3, "1", "=99A01", "Testpomp", "S-1"]);
sheets.Verdelers.appendRow(["", "", "", "", "", "", "", ""]);
eq(get({ action: "getVerdelers" }), [{ verdeler: "MCC 99Z9", ruimte: "Kelder", tekening: "T-001", veld: "3", nr: "1", tag: "=99A01", omschrijving: "Testpomp", schema: "S-1" }], "verdeler-rij opgehaald, lege rij overgeslagen");

// ---- Datums uit de sheet ----
eq(cellToString(new Date(2026, 0, 5)), "2026-01-05", "datum zonder tijd → JJJJ-MM-DD");
ok(/T/.test(cellToString(new Date(2026, 0, 5, 13, 30))), "datum met tijd → volledige ISO");

summary();
