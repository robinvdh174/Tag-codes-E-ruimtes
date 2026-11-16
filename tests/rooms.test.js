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

eval(sliceBlock("// Fout die de server zélf teruggaf", "// Handmatige sync"));
eval(sliceBlock("// Teller die elke lokale ruimte-wijziging", "// ============================================================\n// INITIALISATIE"));
eval(sliceBlock("let _editRoomOriginalName", "// ============================================================\n// AUDIT LOG"));

function reset(rooms) {
  Object.keys(_ls).forEach(function(k) { delete _ls[k]; });
  Object.keys(ROOM_INFO).forEach(function(k) { delete ROOM_INFO[k]; });
  Object.assign(ROOM_INFO, rooms);
  queue = []; toasts = []; activeRoom = "";
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

  ok(isPermanentServerError(serverError("Onbekende actie: x")), "5: serverfout is permanent");
  ok(!isPermanentServerError(serverError("Server bezet, probeer opnieuw")), "5: 'bezet' is niet permanent");
  ok(!isPermanentServerError(new Error("HTTP 500")), "5: netwerk/HTTP-fout is niet permanent");

  summary();
})();
