// Tests voor ruimtes bewerken (naam/beschrijving): de wijziging mag niet
// stilletjes terugspringen naar de oude tekst.
//  1. Een getRooms-antwoord dat al onderweg was vóór de wijziging wordt genegeerd.
//  2. Weigert de server de wijziging (bv. verouderde Code.gs: "Onbekende
//     actie"), dan wordt ze teruggedraaid + gemeld i.p.v. eindeloos in de
//     queue te blijven hangen.
//  3. Netwerkfout → in de queue; syncRooms overschrijft die ruimte niet.

const { eq, ok, summary, sliceBlock } = require("./_helpers");

// ---- Minimale browser-omgeving ----
const _ls = {};
var localStorage = {
  getItem: function(k) { return Object.prototype.hasOwnProperty.call(_ls, k) ? _ls[k] : null; },
  setItem: function(k, v) { _ls[k] = String(v); },
  removeItem: function(k) { delete _ls[k]; }
};
const _els = {};
function _el(id) {
  if (!_els[id]) _els[id] = { value: "", textContent: "", classList: { add: function() {}, remove: function() {}, contains: function() { return false; } } };
  return _els[id];
}
var document = { getElementById: _el };
var toasts = [];
function showToast(msg, isErr) { toasts.push({ msg: msg, err: !!isErr }); }
function renderRoomsList() {}
function renderList() {}
function saveLocal() {}
function findRoom(n) { return Object.keys(ROOM_INFO).find(function(k) { return k.toLowerCase() === n.toLowerCase(); }) || null; }
async function logAction() {}
var SCRIPT_URL = "https://example.invalid/exec";
var API_TOKEN = "t";
var activeRoom = "";
var data = [];
var ROOM_INFO = {};
var queue = [];
function getQueue() { return queue; }
function enqueue(action, d) { queue.push({ action: action, data: d }); }

// Server-mock
var sheetActionImpl = null;
async function sheetAction(p) { return sheetActionImpl(p); }
var fetchImpl = null;
async function fetchWithTimeout(url) { return fetchImpl(url); }

var VERDELERS = [];
var uiRefreshes = 0;
function refreshUI() { uiRefreshes++; }
var confirmCb = null;
function showConfirm(msg, cb) { confirmCb = cb; }
eval(sliceBlock("// Oude ruimtenaam -> huidige naam", "// ============================================================\n// DATA & STATE"));
eval(sliceBlock("// Fout die de server zélf teruggaf", "// Handmatige sync"));
eval(sliceBlock("// Teller die elke lokale ruimte-wijziging", "// ============================================================\n// INITIALISATIE"));
eval(sliceBlock("// Aantal kasten en verdelers per ruimte", "function renderRoomsList"));
eval(sliceBlock("let _editRoomOriginalName", "// ============================================================\n// AUDIT LOG"));

function reset(rooms) {
  Object.keys(_ls).forEach(function(k) { delete _ls[k]; });
  Object.keys(ROOM_INFO).forEach(function(k) { delete ROOM_INFO[k]; });
  Object.assign(ROOM_INFO, rooms);
  queue = []; toasts = []; activeRoom = ""; VERDELERS = [];
  data = [{ id: "1", location: "Oud" }];
}
function startEdit(oldName, newName, desc) {
  _editRoomOriginalName = oldName;
  _el("editRoomName").value = newName;
  _el("editRoomDesc").value = desc;
  return saveEditRoom();
}
function jsonResp(body) { return { ok: true, json: async function() { return body; } }; }

(async function() {
  // ---- 1. Trage getRooms-respons vóór de wijziging ----
  reset({ "Oud": "oude tekst" });
  let release;
  fetchImpl = function() { return new Promise(function(r) { release = function() { r(jsonResp([{ name: "Oud", desc: "oude tekst", renamedFrom: "" }])); }; }); };
  const syncP = syncRooms();           // onderweg met de oude serverdata
  sheetActionImpl = async function() { return { ok: true }; };
  await startEdit("Oud", "Nieuw", "nieuwe tekst");
  release(); await syncP;
  eq(ROOM_INFO["Nieuw"], "nieuwe tekst", "1: nieuwe beschrijving blijft staan");
  ok(!("Oud" in ROOM_INFO), "1: oude naam komt niet terug door verouderd antwoord");
  eq(data[0].location, "Nieuw", "1: kast mee hernoemd");

  // ---- 2. Server weigert (verouderde deployment) ----
  reset({ "Oud": "oude tekst" });
  sheetActionImpl = async function() { throw serverError("Onbekende actie: updateRoom"); };
  await startEdit("Oud", "Nieuw", "nieuwe tekst");
  eq(queue.length, 0, "2: geweigerde wijziging niet in de queue");
  eq(ROOM_INFO["Oud"], "oude tekst", "2: lokaal teruggedraaid naar oude tekst");
  ok(!("Nieuw" in ROOM_INFO), "2: nieuwe naam verwijderd");
  eq(data[0].location, "Oud", "2: kast teruggezet");
  eq(JSON.parse(localStorage.getItem("ekast-room-renames") || "{}"), {}, "2: hernoeming niet onthouden");
  ok(toasts.some(function(t) { return t.err && /Code\.gs/.test(t.msg); }), "2: duidelijke foutmelding met deploy-hint");

  // ---- 3. Netwerkfout → queue, sync overschrijft niet ----
  reset({ "Oud": "oude tekst" });
  sheetActionImpl = async function() { throw new Error("Failed to fetch"); };
  await startEdit("Oud", "Oud", "nieuwe tekst");
  eq(queue.length, 1, "3: in de queue gezet");
  fetchImpl = async function() { return jsonResp([{ name: "Oud", desc: "oude tekst", renamedFrom: "" }]); };
  await syncRooms();
  eq(ROOM_INFO["Oud"], "nieuwe tekst", "3: wachtende wijziging niet overschreven door sync");

  // ---- 4. Normale sync neemt serverwaarde nog steeds over ----
  reset({ "Oud": "oude tekst" });
  fetchImpl = async function() { return jsonResp([{ name: "Oud", desc: "van ander toestel", renamedFrom: "" }]); };
  await syncRooms();
  eq(ROOM_INFO["Oud"], "van ander toestel", "4: wijziging van ander toestel komt binnen");

  // ---- 6. Kasten met de oude naam uit de sheet krijgen de nieuwe naam ----
  reset({ "Oud": "tekst" });
  VERDELERS = [{ naam: "MCC X", ruimte: "Oud" }];
  sheetActionImpl = async function() { return { ok: true }; };
  await startEdit("Oud", "Nieuw", "tekst");
  eq(VERDELERS[0].ruimte, "Nieuw", "6: verdeler verhuist mee naar de nieuwe naam");
  const vanServer = [{ id: "1", location: "Oud" }, { id: "2", location: "Elders" }];
  ok(_applyRoomRenamesTo(vanServer), "6: verouderde serverdata herkend");
  eq(vanServer.map(function(d) { return d.location; }), ["Nieuw", "Elders"], "6: oude ruimtenaam uit de sheet -> nieuwe naam");
  await startEdit("Nieuw", "Nieuwer", "tekst");
  const keten = [{ id: "1", location: "Oud" }];
  _applyRoomRenamesTo(keten);
  eq(keten[0].location, "Nieuwer", "6: keten Oud -> Nieuw -> Nieuwer gevolgd");

  // ---- 7. Meerdere oude namen in renamedFrom (ander toestel) ----
  reset({ "Oud": "tekst", "Tussen": "" });
  fetchImpl = async function() { return jsonResp([{ name: "Eind", desc: "d", renamedFrom: "Oud | Tussen" }]); };
  await syncRooms();
  eq(Object.keys(ROOM_INFO), ["Eind"], "7: alle oude namen opgeruimd");
  eq(data[0].location, "Eind", "7: kast mee hernoemd");

  // ---- 8. Ruimte verwijderen ----
  reset({ "Leeg": "weg ermee", "Oud": "tekst" });
  let sent = null;
  sheetActionImpl = async function(p) { sent = p; return { ok: true }; };
  _editRoomOriginalName = "Oud"; confirmCb = null;
  askDeleteRoom();
  ok(confirmCb === null && /1 kast/.test(_el("editRoomErr").textContent), "8: ruimte met kasten kan niet weg");
  _editRoomOriginalName = "Leeg"; _el("editRoomErr").textContent = "";
  askDeleteRoom();
  ok(typeof confirmCb === "function", "8: lege ruimte vraagt bevestiging");
  await deleteRoom("Leeg");
  eq(sent, { action: "deleteRoom", name: "Leeg" }, "8: deleteRoom naar de server");
  ok(!("Leeg" in ROOM_INFO), "8: ruimte lokaal weg");
  eq(JSON.parse(localStorage.getItem("ekast-room-deleted")), ["Leeg"], "8: verwijdering onthouden");
  // server weigert -> terugzetten
  reset({ "Leeg": "weg ermee" }); data = [];
  sheetActionImpl = async function() { throw serverError("Onbekende actie: deleteRoom"); };
  await deleteRoom("Leeg");
  eq(ROOM_INFO["Leeg"], "weg ermee", "8: geweigerde verwijdering teruggezet");
  eq(JSON.parse(localStorage.getItem("ekast-room-deleted")), [], "8: niet meer als verwijderd onthouden");
  ok(toasts.some(function(t) { return t.err && /Code\.gs/.test(t.msg); }), "8: deploy-hint bij oude backend");
  // netwerkfout -> queue, sync zet de ruimte niet terug
  reset({ "Leeg": "weg ermee" }); data = [];
  sheetActionImpl = async function() { throw new Error("Failed to fetch"); };
  await deleteRoom("Leeg");
  eq(queue.map(function(q) { return q.action; }), ["deleteRoom"], "8: offline verwijderen in de queue");
  fetchImpl = async function() { return jsonResp([{ name: "Leeg", desc: "weg ermee", renamedFrom: "" }]); };
  await syncRooms();
  ok(!("Leeg" in ROOM_INFO), "8: wachtende verwijdering niet teruggezet door sync");

  // ---- 9. Verwijderd op een ander toestel ----
  reset({ "Leeg": "x", "Blijft": "y" }); activeRoom = "Leeg";
  fetchImpl = async function() { return jsonResp([{ name: "Leeg", desc: "", renamedFrom: "", deleted: true }]); };
  await syncRooms();
  eq(Object.keys(ROOM_INFO), ["Blijft"], "9: verwijderde ruimte verdwijnt");
  eq(activeRoom, "all", "9: filter terug naar alle ruimtes");
  fetchImpl = async function() { return jsonResp([{ name: "Leeg", desc: "terug", renamedFrom: "" }]); };
  await syncRooms();
  eq(ROOM_INFO["Leeg"], "terug", "9: opnieuw toegevoegde ruimte komt terug");
  eq(JSON.parse(localStorage.getItem("ekast-room-deleted")), [], "9: niet meer als verwijderd onthouden");

  // ---- 10. Tellers in het beheer ----
  reset({ "Oud": "" });
  data = [{ id: "1", location: "Oud" }, { id: "2", location: "Oud" }, { id: "3", location: "B" }];
  VERDELERS = [{ naam: "MCC X", ruimte: "Oud" }];
  eq(_roomUsage(), { kasten: { "Oud": 2, "B": 1 }, verdelers: { "Oud": 1 } }, "10: kasten en verdelers per ruimte");
  eq([_aantal(1, "kast", "kasten"), _aantal(0, "kast", "kasten")], ["1 kast", "0 kasten"], "10: enkelvoud/meervoud");

  ok(isPermanentServerError(serverError("Onbekende actie: x")), "5: serverfout is permanent");
  ok(!isPermanentServerError(serverError("Server bezet, probeer opnieuw")), "5: 'bezet' is niet permanent");
  ok(!isPermanentServerError(new Error("HTTP 500")), "5: netwerk/HTTP-fout is niet permanent");

  summary();
})();
