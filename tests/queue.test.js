// Tests voor de offline-wachtrij en de lees-sync:
//  1. Netwerkfouten tellen niet mee als "poging": een wijziging die zonder
//     bereik gemaakt is, mag nooit na 10 pogingen weggegooid worden.
//  2. "ID niet gevonden" (kast intussen verwijderd op een ander toestel)
//     blokkeert de wachtrij niet.
//  3. Een lees-antwoord dat onderweg was terwijl er geschreven werd, wordt
//     genegeerd (anders springt een status even terug naar de oude waarde).
//  4. De time-out dekt ook het binnenhalen van de body.
// Alle data hieronder is verzonnen.

const { eq, ok, summary, sliceBlock } = require("./_helpers");

// ---- Minimale browser-omgeving ----
const _ls = {};
var localStorage = {
  getItem: function(k) { return Object.prototype.hasOwnProperty.call(_ls, k) ? _ls[k] : null; },
  setItem: function(k, v) { _ls[k] = String(v); },
  removeItem: function(k) { delete _ls[k]; }
};
const _badge = { className: "", textContent: "" };
const _label = { className: "", textContent: "" };
var document = { getElementById: function(id) { return id === "syncBadge" ? _badge : id === "syncLabel" ? _label : null; } };
var navigator = { onLine: true };
var toasts = [];
function showToast(msg, isErr) { toasts.push({ msg: msg, err: !!isErr }); }
var uiRefreshes = 0;
function refreshUI() { uiRefreshes++; }
function saveLocal() {}
async function logAction() {}
async function handleConflictResult() { return true; }
function syncRooms() {}
var _idSeq = 0;
function newId() { return "q" + (++_idSeq); }
var SCRIPT_URL = "https://example.invalid/exec";
var API_TOKEN = "t";
var data = [];
var _isReading = false;
var _isWriting = false;
var _pendingIds = new Set();

// Server-mock: fetchImpl(url, opts) geeft een body (object) terug of gooit.
var fetchImpl = null;
var fetchCalls = [];
function respond(body, status) {
  const text = JSON.stringify(body);
  return { ok: (status || 200) < 400, status: status || 200, text: async function() { return text; } };
}
var fetch = async function(url, opts) {
  fetchCalls.push({ url: url, opts: opts || {} });
  return fetchImpl(url, opts || {});
};
function postedAction(call) { return JSON.parse(call.opts.body).action; }

eval(sliceBlock("// Oude ruimtenaam -> huidige naam", "// ============================================================\n// DATA & STATE"));
eval(sliceBlock("const QUEUE_KEY", "// Handmatige sync"));

// De herhaal-sync niet echt inplannen in de test.
var resyncs = 0;
_resyncSoon = function() { resyncs++; };

function reset(items) {
  Object.keys(_ls).forEach(function(k) { delete _ls[k]; });
  data = items || [];
  toasts = []; fetchCalls = []; resyncs = 0; uiRefreshes = 0;
  navigator.onLine = true;
  _isReading = false; _isWriting = false; _writeSeq = 0; _postSupported = true;
}
function netError() { const e = new TypeError("Failed to fetch"); throw e; }

(async function() {
  // ---- 1. Netwerkfout: bewaren, teller niet ophogen ----
  reset([{ id: "a", code: "X1", status: "ok" }]);
  enqueue("update", { id: "a", code: "X1", status: "ok" }, { label: "Veiliggesteld", sheet: "Logboek Status" });
  fetchImpl = netError;
  for (let i = 0; i < 15; i++) await processQueue();
  eq(getQueue().length, 1, "1: na 15 mislukte pogingen zonder bereik staat de actie er nog");
  eq(getQueue()[0].retries, 0, "1: netwerkfout telt niet als poging");
  eq(toasts.length, 0, "1: geen 'definitief mislukt'-melding");

  // HTTP 5xx (Apps Script even onbereikbaar) idem.
  fetchImpl = async function() { return respond({}, 503); };
  for (let i = 0; i < 12; i++) await processQueue();
  eq(getQueue().length, 1, "1: HTTP 503 gooit de actie niet weg");

  // "Server bezet" (script-lock) idem.
  fetchImpl = async function() { return respond({ error: "Server bezet, probeer opnieuw" }); };
  for (let i = 0; i < 12; i++) await processQueue();
  eq(getQueue().length, 1, "1: 'Server bezet' gooit de actie niet weg");

  // Offline: niet eens proberen.
  fetchCalls = [];
  navigator.onLine = false;
  await processQueue();
  eq(fetchCalls.length, 0, "1: offline → geen verzoek");
  navigator.onLine = true;

  // Zodra de server antwoordt wordt de actie verstuurd en verdwijnt ze.
  fetchImpl = async function() { return respond({ success: true, lastModified: "LM2" }); };
  await processQueue();
  eq(getQueue().length, 0, "1: bij verbinding alsnog verstuurd");
  eq(data[0].lastModified, "LM2", "1: lastModified van de server overgenomen");
  ok(/^Gesync/.test(_label.textContent), "1: status 'Gesync' na lege wachtrij");

  // ---- 2. Kast bestaat niet meer op de server ----
  reset([{ id: "b", code: "B2" }]);
  enqueue("delete", { id: "weg", code: "W1", location: "R" }, { label: "Verwijderd", sheet: "Logboek Verwijderingen" });
  enqueue("update", { id: "ook-weg", code: "W2" });
  enqueue("update", { id: "b", code: "B2-nieuw" });
  fetchImpl = async function(url, opts) {
    const p = JSON.parse(opts.body);
    if (p.action === "delete") return respond({ error: "ID niet gevonden voor delete: weg" });
    if (p.action === "update" && JSON.parse(p.data).id === "ook-weg") return respond({ error: "ID niet gevonden voor update: ook-weg" });
    return respond({ success: true, lastModified: "LM3" });
  };
  await processQueue();
  eq(getQueue().length, 0, "2: 'niet gevonden' blokkeert de wachtrij niet; rest is verwerkt");
  eq(data[0].lastModified, "LM3", "2: de actie erachter is gewoon uitgevoerd");
  eq(toasts.filter(function(t) { return /vervallen/.test(t.msg); }).length, 1, "2: melding voor de vervallen update");
  ok(!toasts.some(function(t) { return /W1/.test(t.msg); }), "2: reeds verwijderde kast geeft geen foutmelding");

  // ---- 3. Andere serverfout: wél tellen en na 10 pogingen opgeven ----
  reset([]);
  enqueue("add", { id: "c", code: "C3" });
  fetchImpl = async function() { return respond({ error: "Geen data voor add" }); };
  for (let i = 0; i < 10; i++) await processQueue();
  eq(getQueue().length, 1, "3: na 10 serverweigeringen nog in de wachtrij");
  await processQueue();
  eq(getQueue().length, 0, "3: na de 11e opgegeven");
  ok(toasts.some(function(t) { return t.err && /definitief mislukt/.test(t.msg); }), "3: duidelijke melding");

  // ---- 4. Verouderd lees-antwoord tijdens een schrijfactie ----
  reset([{ id: "k", code: "K1", status: "ok", statusBy: "Jan" }]);
  let releaseGet;
  fetchImpl = function(url, opts) {
    if (opts.method === "POST") return Promise.resolve(respond({ success: true, lastModified: "LM9" }));
    // GET: de server las de sheet vóór de wijziging.
    return new Promise(function(r) { releaseGet = function() { r(respond([{ id: "k", code: "K1", status: "", statusBy: "" }])); }; });
  };
  const readP = syncFromSheets(true);
  await new Promise(function(r) { setImmediate(r); });
  await sheetAction({ action: "update", data: JSON.stringify(data[0]) });
  releaseGet(); await readP;
  eq(data[0].status, "ok", "4: status springt niet terug door een verouderd antwoord");
  eq(resyncs, 1, "4: er wordt opnieuw opgehaald");
  eq(_isReading, false, "4: lees-vlag is vrijgegeven");

  // Log-acties tellen niet als schrijfactie op de kasten.
  reset([{ id: "k", code: "K1", status: "" }]);
  fetchImpl = function(url, opts) {
    if (opts.method === "POST") return Promise.resolve(respond({ success: true }));
    return new Promise(function(r) { releaseGet = function() { r(respond([{ id: "k", code: "K1", status: "ok", statusBy: "Piet" }])); }; });
  };
  const readP2 = syncFromSheets(true);
  await new Promise(function(r) { setImmediate(r); });
  await sheetAction({ action: "log", logaction: "Aanmelding" });
  releaseGet(); await readP2;
  eq(data[0].status, "ok", "4: een log-actie houdt de sync niet tegen");
  eq(uiRefreshes, 1, "4: scherm ververst bij echte wijziging");

  // ---- 5. Gewone sync + wachtende acties in de statusbadge ----
  reset([{ id: "k", code: "K1", status: "" }, { id: "q", code: "Q1", status: "ok" }]);
  enqueue("update", { id: "q", code: "Q1", status: "ok" });
  fetchImpl = async function() { return respond([{ id: "k", code: "K1", status: "losgekoppeld" }, { id: "q", code: "Q1", status: "" }]); };
  await syncFromSheets(true);
  eq(data[0].status, "losgekoppeld", "5: serverwijziging komt binnen");
  eq(data[1].status, "ok", "5: kast met wachtende wijziging wordt niet overschreven");
  eq(_label.textContent, "1 wachtend", "5: badge toont de wachtende actie i.p.v. 'Gesync'");

  // Lege serverlijst wist lokale data niet.
  fetchImpl = async function() { return respond([]); };
  await syncFromSheets(true);
  eq(data.length, 2, "5: lege serverlijst wist de lokale data niet");

  // ---- 6. Time-out dekt ook de body ----
  fetchImpl = function(url, opts) {
    return Promise.resolve({
      ok: true, status: 200,
      text: function() {
        return new Promise(function(_, rej) {
          opts.signal.addEventListener("abort", function() {
            const e = new Error("aborted"); e.name = "AbortError"; rej(e);
          });
        });
      }
    });
  };
  let aborted = null;
  try { await fetchWithTimeout("https://example.invalid/x", 30); } catch(e) { aborted = e.name; }
  eq(aborted, "AbortError", "6: hangende body wordt afgebroken door de time-out");

  summary();
})();
