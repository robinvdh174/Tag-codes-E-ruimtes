// ⚠️ VEREIST: Plak hier je Apps Script Web App URL
// Na het deployen van Code.gs kopieer je de URL hier
const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbx95mvBsmpMxJn7c0cLDL_V63x7Bv9T3XQW_vfL0K2wRlSfxm4476rJ0qZDrFOZ0nF9kg/exec";

// 🔑 API TOKEN — voeg dit toe aan je Apps Script om ongeautoriseerde toegang te blokkeren
// Stel in je Apps Script in: if (e.parameter.token !== "JOUW_TOKEN") return ...
// Wijzig de waarde hieronder en zorg dat je Apps Script dezelfde waarde controleert.
const API_TOKEN = "ekast-2025";

// 🔒 GEDEELDE PIN — SHA-256 hash van de PIN
// Om de PIN te wijzigen: bereken de SHA-256 hash van je nieuwe PIN via https://emn178.github.io/online-tools/sha256.html
// en vervang de waarde hieronder. Upload daarna de HTML opnieuw — alle toestellen moeten de nieuwe PIN gebruiken.
const DEVICE_PIN_HASH = "1299c06d517825c0529d69fe9f8bbf7b308b9db68289db3c9f844570deb1d621";
const DEVICE_PIN_LENGTH = 4; // Aantal cijfers van de PIN

// Auto-sync interval in milliseconden (standaard: 30 seconden)
const SYNC_INTERVAL_MS = 30000;

// ℹ️ Beschrijving per e-ruimte (optioneel)
// Voeg hier een omschrijving toe zodat collega's weten waar de ruimte zich bevindt.
// Laat leeg ("") als de naam al duidelijk genoeg is.
const ROOM_INFO = {
  "Stofkisten Gang":   "gelijkvloers, bij het begin van PM6, (ER-737-11)",
  "OMVR B.":           "1ste verdiep, rechter kant (AZ) van PM6 omvormerruimte, (ER-770-11)",
  "3KV":               "1ste verdiep, tussen VSM 20 en Refinerhal, (ER-771-11)",
  "DH":                "2de verdiep, Duivenhok (ER-774-21)",
  "E-Ruimte 774-12":   "1ste verdiep, langs rollen afwerking",
  "W.L. Nieuw":        "gelijkvloers, Walsenloods nieuw links van PM6 klein trapje omhoog,(ER-775-03)",
  "OR12":              "1ste verdiep, langs ploegenhok en OR12,(ER-770-12)",
  "W.L. Oud":          "gelijkvloers, Walsenloods Oud",
  "Lift 19":           "",
  "CSBO":              "CSB onder",
  "Lift 21":           "",
  "NICO-B":            "1ste verdieping, linkerkant van de NICO",
  "NICO-O":            "Gelijkvloers, links van Nico (AZ) trapje omhoog"
};

// Laad eerder toegevoegde custom ruimtes uit localStorage en voeg toe aan ROOM_INFO
(function loadCustomRooms() {
  try {
    const stored = JSON.parse(localStorage.getItem("ekast-custom-rooms") || "{}");
    Object.keys(stored).forEach(function(name) {
      if (!ROOM_INFO.hasOwnProperty(name)) ROOM_INFO[name] = stored[name];
    });
  } catch(e) { console.warn("Custom ruimtes laden mislukt:", e); }
})();

// ============================================================
// DATA & STATE
// ============================================================
let data = [];
try {
  data = JSON.parse(document.getElementById("d").textContent) || [];
} catch(e) {
  console.warn("Embedded data kon niet worden geladen:", e);
}
let activeRoom = "all";
let holdTimers = {};
const HOLD_MS = 2000;
let syncTimer = null;
let isSyncing = false;
// IDs van records met een schrijfactie in de lucht. De auto-sync mag deze
// records NIET overschrijven met (oudere) serverdata, anders flippen wijzigingen
// kort terug op het scherm en gaan ze in races verloren.
const _pendingIds = new Set();

// Cryptografisch-veilige unieke ID. Math.random() heeft op druk gebruik
// (meerdere devices binnen dezelfde ms) een reële collision-kans.
function newId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Date.now() + "-" + Math.random().toString(36).slice(2, 11);
}

// Vandaag in canoniek ISO-formaat (YYYY-MM-DD). Voorkomt gemixte formats in
// de sheet — toLocaleDateString("nl-NL") geeft "17-11-2025" of "17/11/2025"
// afhankelijk van browser-locale, terwijl de server datums teruggeeft als ISO.
function todayISO() {
  let d = new Date();
  return d.getFullYear() + "-" +
         String(d.getMonth() + 1).padStart(2, "0") + "-" +
         String(d.getDate()).padStart(2, "0");
}

// Case-insensitive lookup van een ruimte. Geeft de canonieke (correct
// gespelde) naam terug uit ROOM_INFO, of null als de ruimte niet bestaat.
// Voorkomt dat "omvr b." wordt geweigerd terwijl "OMVR B." wel werkt.
function findRoom(name) {
  if (!name) return null;
  const target = String(name).trim().toLowerCase();
  if (!target) return null;
  const keys = Object.keys(ROOM_INFO);
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase() === target) return keys[i];
  }
  return null;
}

// Veilige localStorage helpers (werkt ook in privémodus of bij vol geheugen)
function safeGet(key, fallback) {
  try { const v = localStorage.getItem(key); return v !== null ? v : fallback; }
  catch(e) { return fallback; }
}
function safeSet(key, value) {
  try { localStorage.setItem(key, value); return true; }
  catch(e) { showToast("Lokale opslag niet beschikbaar. Probeer buiten privémodus.", true); return false; }
}

// Laad lokale cache als snelle eerste weergave
try {
  const saved = localStorage.getItem("ekast-data");
  if (saved) {
    const parsed = JSON.parse(saved);
    if (Array.isArray(parsed) && parsed.length > 0) data = parsed;
  }
  try { localStorage.removeItem("ekast-local"); } catch(e) { console.warn("Opruimen oude key mislukt:", e); }
} catch(e) {
  console.warn("Lokale cache kon niet worden geladen:", e);
  showToast("Lokale opslag niet beschikbaar \u2014 gegevens worden niet bewaard.", true);
}

// Hernoem verouderde locatienamen in geladen data
(function migrateLocationNames() {
  const renames = { "Omvormerruimte": "OMVR B.", "Walsen Loods": "W.L. Oud" };
  let changed = false;
  data.forEach(function(item) {
    if (renames[item.location]) { item.location = renames[item.location]; changed = true; }
  });
  if (changed) {
    try { localStorage.setItem("ekast-data", JSON.stringify(data)); } catch(e) { console.warn("Lokale data opslaan mislukt:", e); }
  }
})();

// Debounced — bij snel achter elkaar muteren (bv. paar status-flips of
// volledige sync) serialiseren we niet 5x dezelfde 500KB JSON-payload.
let _saveTimer = null;
function saveLocal() {
  if (_saveTimer) return;
  _saveTimer = setTimeout(flushSave, 400);
}
function flushSave() {
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  try {
    localStorage.setItem("ekast-data", JSON.stringify(data));
  } catch(e) {
    showToast("Lokale opslag vol of geblokkeerd. Wijzigingen worden niet bewaard.", true);
    console.warn("saveLocal mislukt:", e);
  }
}
// Tab sluiten → pending save direct wegschrijven (anders kunnen wijzigingen
// uit de laatste 400ms verloren gaan).
window.addEventListener("pagehide", flushSave);

// ============================================================
// OFFLINE QUEUE — slaat mislukte schrijfacties op en herprobeert
// ze zodra de server weer bereikbaar is.
// ============================================================
const QUEUE_KEY = "ekast-pending-queue";

function getQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); }
  catch(e) { return []; }
}

function saveQueue(queue) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue)); }
  catch(e) { console.warn("Queue opslaan mislukt:", e); }
}

function enqueue(action, itemData) {
  const queue = getQueue();
  const itemId = itemData.id;
  if (action === "delete") {
    const addIdx = queue.findIndex(function(q) { return q.action === "add" && q.data.id === itemId; });
    if (addIdx !== -1) {
      queue.splice(addIdx, 1);
      saveQueue(queue);
      updatePendingBadge();
      return;
    }
  }
  if (action === "update") {
    const existIdx = queue.findIndex(function(q) { return q.action === "update" && q.data.id === itemId; });
    if (existIdx !== -1) {
      queue[existIdx].data = itemData;
      queue[existIdx].timestamp = Date.now();
      saveQueue(queue);
      return;
    }
  }
  queue.push({
    queueId: newId(),
    action: action,
    data: itemData,
    timestamp: Date.now(),
    retries: 0
  });
  saveQueue(queue);
  updatePendingBadge();
}

function dequeue(queueId) {
  const queue = getQueue().filter(function(q) { return q.queueId !== queueId; });
  saveQueue(queue);
  updatePendingBadge();
}

function getQueueLength() {
  return getQueue().length;
}

function getPendingIds() {
  const ids = new Set();
  getQueue().forEach(function(q) { if (q.data && q.data.id) ids.add(q.data.id); });
  return ids;
}

function updatePendingBadge() {
  const n = getQueueLength();
  const badge = document.getElementById("syncBadge");
  const lbl = document.getElementById("syncLabel");
  if (!badge || !lbl) return;
  if (n > 0 && !isSyncing) {
    badge.className = "sync-badge offline";
    lbl.textContent = n + " wachtend";
  }
}

let _isProcessingQueue = false;
async function processQueue() {
  if (_isProcessingQueue || !SCRIPT_URL) return;
  const queue = getQueue();
  if (queue.length === 0) return;
  _isProcessingQueue = true;
  for (let i = 0; i < queue.length; i++) {
    const entry = queue[i];
    try {
      if (entry.action === "add") {
        const addResult = await sheetAction({ action: "add", data: JSON.stringify(entry.data) });
        if (addResult && addResult.lastModified) {
          const ix = data.findIndex(function(d) { return d.id === entry.data.id; });
          if (ix !== -1) { data[ix].lastModified = addResult.lastModified; saveLocal(); }
        }
      } else if (entry.action === "update") {
        const updResult = await sheetAction({ action: "update", data: JSON.stringify(entry.data) });
        if (updResult && updResult.conflict) {
          dequeue(entry.queueId);
          await handleConflictResult(updResult, entry.data);
          break;
        }
        if (updResult && updResult.lastModified) {
          const ix = data.findIndex(function(d) { return d.id === entry.data.id; });
          if (ix !== -1) { data[ix].lastModified = updResult.lastModified; delete data[ix].expectedLastModified; saveLocal(); }
        }
      } else if (entry.action === "delete") {
        await sheetAction({ action: "delete", id: entry.data.id });
      }
      dequeue(entry.queueId);
      if (entry.action === "add") {
        await logAction("Toegevoegd", entry.data.code, entry.data.location, "Logboek Toevoegingen");
      }
    } catch(e) {
      entry.retries = (entry.retries || 0) + 1;
      if (entry.retries > 10) {
        dequeue(entry.queueId);
        showToast("Sync definitief mislukt: " + entry.action + " " + (entry.data.code || entry.data.id), true);
      } else {
        saveQueue(getQueue().map(function(q) {
          return q.queueId === entry.queueId ? entry : q;
        }));
      }
      break;
    }
  }
  _isProcessingQueue = false;
  updatePendingBadge();
  if (getQueueLength() === 0) {
    const now = new Date().toLocaleTimeString("nl-NL", {hour:"2-digit", minute:"2-digit"});
    setSyncStatus("ok", "Gesync " + now);
  }
}

// ============================================================
// SYNC STATUS UI
// ============================================================
function setSyncStatus(state, label) {
  const badge = document.getElementById("syncBadge");
  const lbl = document.getElementById("syncLabel");
  if (!badge) return;
  badge.className = "sync-badge " + state;
  lbl.textContent = label;
}

// ============================================================
// SYNC: LEZEN — haalt alle data op uit Sheets
// ============================================================
async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(function() { ctrl.abort(); }, ms);
  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    return resp;
  } finally {
    clearTimeout(timer);
  }
}

async function syncFromSheets(silent) {
  if (!SCRIPT_URL || isSyncing) return;
  isSyncing = true;
  if (!silent) setSyncStatus("syncing", "Laden...");
  let attempt = 0;
  while (attempt < 2) {
    attempt++;
    try {
      const resp = await fetchWithTimeout(SCRIPT_URL + "?action=get&token=" + encodeURIComponent(API_TOKEN) + "&t=" + Date.now(), 25000);
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const json = await resp.json();
      if (json.error) throw new Error(json.error);
      if (Array.isArray(json) && json.length > 0) {
        // Bewaar statusBy/statusDate uit lokale data als de server die velden niet kent.
        // Records met pending writes worden NIET met serverdata overschreven.
        const localMap = {};
        data.forEach(function(d) { if (d.id) localMap[d.id] = d; });
        const merged = json.map(function(serverItem) {
          let local = localMap[serverItem.id];
          if (local && _pendingIds.has(serverItem.id)) return local;
          if (local && serverItem.status === local.status && !serverItem.statusBy && local.statusBy) {
            return Object.assign({}, serverItem, { statusBy: local.statusBy, statusDate: local.statusDate || "" });
          }
          return serverItem;
        });
        // Lokale records die nog niet op de server staan maar wel pending zijn (bv. add in flight)
        // niet verliezen: voeg ze achteraan toe.
        const seen = {};
        merged.forEach(function(it) { if (it && it.id) seen[it.id] = true; });
        _pendingIds.forEach(function(pid) {
          if (!seen[pid] && localMap[pid]) merged.push(localMap[pid]);
        });
        data = deduplicateById(merged);
        saveLocal();
        refreshUI();
        const now = new Date().toLocaleTimeString("nl-NL", {hour:"2-digit", minute:"2-digit"});
        setSyncStatus("ok", "Gesync " + now);
      } else if (Array.isArray(json) && json.length === 0) {
        // Server is leeg — behoud lokaal alleen records met een pending write,
        // anders zou een add-in-flight verdwijnen.
        data = data.filter(function(d) { return d.id && _pendingIds.has(d.id); });
        saveLocal();
        refreshUI();
        const now = new Date().toLocaleTimeString("nl-NL", {hour:"2-digit", minute:"2-digit"});
        setSyncStatus("ok", "Gesync " + now + " (leeg)");
      } else {
        setSyncStatus("offline", "Ongeldig antwoord");
      }
      isSyncing = false;
      return;
    } catch(e) {
      if (attempt < 2 && (e.name === "AbortError" || e.message.indexOf("HTTP 5") !== -1 || e.name === "TypeError")) {
        // Cold start, tijdelijke serverfout of netwerkfout — wacht 6s en probeer nog één keer
        setSyncStatus("syncing", "Herproberen...");
        await new Promise(function(r) { setTimeout(r, 6000); });
        continue;
      }
      if (e.name === "AbortError") {
        setSyncStatus("offline", "Server reageert niet");
      } else if (!navigator.onLine) {
        setSyncStatus("offline", "Geen internet");
      } else {
        setSyncStatus("error", "Fout bij laden");
      }
      console.warn("syncFromSheets:", e);
      isSyncing = false;
      return;
    }
  }
  isSyncing = false;
}

function deduplicateById(arr) {
  const seen = {};
  return arr.filter(function(item) {
    if (!item.id || seen[item.id]) return false;
    seen[item.id] = true;
    return true;
  });
}

// ============================================================
// DELTA SYNC — individuele acties naar Sheets sturen via GET
// Geen grote payload, geen CORS-problemen, altijd betrouwbaar
// ============================================================
async function sheetAction(params) {
  if (!SCRIPT_URL) return false;
  // Blokkeer auto-sync terwijl we schrijven, anders overschrijft die onze nieuwe data
  isSyncing = true;
  try {
    const url = SCRIPT_URL + "?" + Object.keys(params).map(function(k) {
      return k + "=" + (k === "data" ? encodeURIComponent(params[k]) : encodeURIComponent(String(params[k])));
    }).join("&") + "&token=" + encodeURIComponent(API_TOKEN) + "&t=" + Date.now();
    const resp = await fetchWithTimeout(url, 25000);
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const json = await resp.json();
    if (json.error) throw new Error(json.error);
    return json;
  } finally {
    isSyncing = false;
  }
}

// Handmatige sync via klik op badge
function manualSync() {
  if (!SCRIPT_URL) { showToast("Geen SCRIPT_URL ingesteld!", true); return; }
  processQueue().then(function() { syncFromSheets(false); });
}

// ============================================================
// RUIMTES SYNCHEN — haalt custom ruimtes op uit Sheets
// en deelt ze met alle toestellen
// ============================================================
async function syncRooms() {
  if (!SCRIPT_URL) return;
  try {
    const resp = await fetchWithTimeout(
      SCRIPT_URL + "?action=getRooms&token=" + encodeURIComponent(API_TOKEN) + "&t=" + Date.now(),
      15000
    );
    if (!resp || !resp.ok) return;
    const rooms = await resp.json();
    if (!Array.isArray(rooms)) return;
    rooms.forEach(function(r) {
      if (!r.name || ROOM_INFO.hasOwnProperty(r.name)) return;
      ROOM_INFO[r.name] = r.desc || "";
      try {
        const stored = JSON.parse(localStorage.getItem("ekast-custom-rooms") || "{}");
        stored[r.name] = r.desc || "";
        localStorage.setItem("ekast-custom-rooms", JSON.stringify(stored));
      } catch(e) { console.warn("Ruimte opslaan in localStorage mislukt:", e); }
      const dl = document.getElementById("roomSuggestions");
      if (dl) { const opt = document.createElement("option"); opt.value = r.name; dl.appendChild(opt); }
    });
  } catch(e) {
    console.warn("syncRooms mislukt:", e);
  }
}

// ============================================================
// INITIALISATIE
// ============================================================
async function init() {
  closeInfoPopup();
  updateTotalCount();
  movePill("search");
  updateStatusBadge();
  renderList();
  if (!init._dropListener) {
    init._dropListener = true;
    document.addEventListener("click", function(e) {
      if (!e.target.closest(".input-with-btn")) {
        document.querySelectorAll(".room-dropdown.open").forEach(function(d) { d.classList.remove("open"); });
      }
    });
    window.addEventListener("offline", function() {
      setSyncStatus("offline", "Geen internet");
    });
    window.addEventListener("online", function() {
      setSyncStatus("syncing", "Verbinding hersteld...");
      processQueue().then(function() { syncFromSheets(false); });
    });
    document.addEventListener("keydown", function(e) {
      if (e.key === "Escape") {
        if (document.getElementById("confirmOverlay").classList.contains("open")) { confirmNee(); }
        else if (document.getElementById("statusNaamOverlay").classList.contains("open")) { sluitStatusNaamModal(); }
        else if (document.getElementById("statusPopup").classList.contains("open")) { closeStatusKeuze(); }
        else if (document.getElementById("editModal").classList.contains("open")) { closeModal(); }
        else if (document.getElementById("infoPopupOverlay").classList.contains("open")) { closeInfoPopup(); }
      }
    });
    // Sync zodra de tab weer zichtbaar wordt (bv. terug uit achtergrond op
    // mobiel) — geeft snel verse data zonder op het 30s-interval te wachten.
    document.addEventListener("visibilitychange", function() {
      if (document.visibilityState === "visible" && SCRIPT_URL) {
        processQueue().then(function() { syncFromSheets(true); });
      }
    });
  }

  if (!SCRIPT_URL) {
    setSyncStatus("offline", "Geen sync");
    document.getElementById("setupBox").style.display = "block";
    return;
  }
  document.getElementById("setupBox").style.display = "none";

  // Voorkom meerdere sync-timers bij herinitialisatie
  if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }

  updatePendingBadge();
  processQueue().then(function() { syncFromSheets(false); });
  syncRooms();
  // Auto-sync alleen wanneer de tab zichtbaar is — bespaart batterij/data
  // wanneer de app op de achtergrond staat of het scherm uit is.
  syncTimer = setInterval(function() {
    if (document.visibilityState === "visible") syncFromSheets(true);
  }, SYNC_INTERVAL_MS);
}

function updateTotalCount() {
  const el = document.getElementById("totalCount");
  if (el) el.textContent = data.length;
}

function refreshUI() {
  updateTotalCount();
  if (document.getElementById("tab-search").classList.contains("active")) doSearch(document.getElementById("searchInput").value);
  if (document.getElementById("tab-list").classList.contains("active")) renderList();
  if (document.getElementById("tab-status").classList.contains("active")) renderStatus();
  updateStatusBadge();
}

// ============================================================
// TABS
// ============================================================
function switchTab(name) {
  ["search","list","status","add"].forEach(function(t) {
    document.getElementById("tab-" + t).classList.remove("active");
    const btn = document.getElementById("tbtn-" + t);
    btn.classList.remove("active", "active-blue");
    btn.setAttribute("aria-selected", "false");
  });
  document.getElementById("tab-" + name).classList.add("active");
  let activeBtn = document.getElementById("tbtn-" + name);
  activeBtn.setAttribute("aria-selected", "true");
  if (name === "status") {
    activeBtn.classList.add("active-blue");
  } else {
    activeBtn.classList.add("active");
  }
  movePill(name);
  if (name === "list") renderList();
  if (name === "status") renderStatus();
  updateStatusBadge();
}

function movePill(tabName) {
  const tabOrder = ["search","list","status","add"];
  let idx = tabOrder.indexOf(tabName);
  const container = document.getElementById("tabsContainer");
  let pill = document.getElementById("tabsPill");
  if (!container || !pill || idx === -1) return;
  const padding = 4;
  const availWidth = container.offsetWidth - padding * 2;
  const tabWidth = availWidth / 4;
  pill.style.width = tabWidth + "px";
  pill.style.left = (padding + idx * tabWidth) + "px";
}

function renderStatus() {
  _currentSearchTerm = "";
  const active = data.filter(function(d) { return d.status && d.status !== ""; });
  active.sort(function(a, b) { return (a.location||"").localeCompare(b.location||""); });
  document.getElementById("statusCount").innerText = active.length;
  const container = document.getElementById("statusResults");
  container.textContent = "";
  if (active.length === 0) {
    container.innerHTML = "<div class=\"empty\"><b>Geen actieve meldingen</b>Alle kasten zijn in bedrijf</div>";
    return;
  }
  const frag = document.createDocumentFragment();
  for (let i = 0; i < active.length; i++) frag.appendChild(makeCard(active[i]));
  container.appendChild(frag);
}

function updateStatusBadge() {
  const count = data.filter(function(d) { return d.status && d.status !== ""; }).length;
  const badge = document.getElementById("statusBadge");
  const statusTabActive = document.getElementById("tab-status").classList.contains("active");
  if (!badge) return;
  badge.textContent = count;
  if (count === 0 || statusTabActive) {
    badge.classList.add("hidden");
  } else {
    badge.classList.remove("hidden");
  }
}

// ============================================================
// ZOEKEN
// ============================================================
let _searchTimer = null;
function doSearch(value) {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(function() { _doSearchNow(value); }, 150);
}
function _doSearchNow(value) {
  const v = value.toLowerCase().trim();
  const countEl = document.getElementById("resultCount");
  const container = document.getElementById("searchResults");
  if (!v) {
    _currentSearchTerm = "";
    countEl.innerText = "0";
    container.innerHTML = "<div class=\"empty\"><b>Typ een kastnummer</b><span id=\"totalCount\">" + data.length + "</span> kasten beschikbaar<br><span style=\"color:#4a9eff;font-size:2.5rem;font-weight:900;margin-top:2rem;display:block;text-align:center;letter-spacing:.1em;\">Sappi</span></div>";
    return;
  }
  _currentSearchTerm = value.trim();
  let results = [];
  for (let i = 0; i < data.length; i++) {
    let d = data[i];
    if ((d.code||"").toLowerCase().indexOf(v) !== -1 ||
        (d.location||"").toLowerCase().indexOf(v) !== -1 ||
        (d.note||"").toLowerCase().indexOf(v) !== -1 ||
        (d.position||"").toLowerCase().indexOf(v) !== -1) {
      results.push(d);
    }
  }
  countEl.innerText = results.length;
  container.textContent = "";
  if (results.length === 0) {
    container.innerHTML = "<div class=\"empty\"><b>Niets gevonden</b>Probeer een andere zoekterm</div>";
    return;
  }
  const frag = document.createDocumentFragment();
  for (let i = 0; i < results.length; i++) frag.appendChild(makeCard(results[i]));
  container.appendChild(frag);
}

// ============================================================
// KAART OPBOUWEN
// ============================================================
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Voegt tekst toe aan `parent`, met zoekterm gemarkeerd via <mark>.
// Veilig: gebruikt textContent/createElement — nooit innerHTML met user-data.
function appendHighlighted(parent, text, term) {
  const safeText = String(text == null ? "" : text);
  if (!term) { parent.appendChild(document.createTextNode(safeText)); return; }
  const termEsc = String(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp("(" + termEsc + ")", "gi");
  const parts = safeText.split(regex);
  // split() met capture-group: oneven indices zijn matches.
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === "") continue;
    if (i % 2 === 1) {
      const mark = document.createElement("mark");
      mark.style.cssText = "background:#f0a500;color:#000;border-radius:2px;padding:0 1px;";
      mark.textContent = parts[i];
      parent.appendChild(mark);
    } else {
      parent.appendChild(document.createTextNode(parts[i]));
    }
  }
}

let _currentSearchTerm = "";

// Bouwt een kaart als DOM-element (geen innerHTML met user-data → XSS-vrij).
function makeCard(item) {
  const id = String(item.id == null ? "" : item.id);
  const term = _currentSearchTerm;

  const card = document.createElement("div");
  card.className = "card";
  card.id = "c-" + id;
  card.addEventListener("click", function() { selectCard(card); });

  const top = document.createElement("div");
  top.className = "card-top";
  const info = document.createElement("div");
  info.className = "card-info";

  const codeEl = document.createElement("div");
  codeEl.className = "code";
  appendHighlighted(codeEl, item.code, term);
  info.appendChild(codeEl);

  const row = document.createElement("div");
  row.style.cssText = "display:flex;justify-content:space-between;align-items:flex-start;";

  const loc = document.createElement("div");
  loc.className = "loc";
  appendHighlighted(loc, item.location, term);
  if (item.location && ROOM_INFO[item.location]) {
    loc.appendChild(document.createTextNode(" "));
    const infoBtn = document.createElement("button");
    infoBtn.className = "btn-info-loc";
    infoBtn.type = "button";
    infoBtn.title = "Waar is dit?";
    infoBtn.textContent = "\u24D8"; // ⓘ
    infoBtn.addEventListener("click", function(e) {
      e.stopPropagation();
      showRoomInfo(item.location);
    });
    loc.appendChild(infoBtn);
  }
  row.appendChild(loc);

  const statusWrap = document.createElement("div");
  statusWrap.style.cssText = "display:flex;flex-direction:column;align-items:flex-end;flex-shrink:0;margin-left:.5rem;";

  const statusBtn = document.createElement("button");
  statusBtn.type = "button";
  statusBtn.className = "sbtn-veilig" + (item.status === "ok" ? " secured" : item.status === "losgekoppeld" ? " losgekoppeld" : "");
  statusBtn.textContent = item.status === "ok" ? "\u26A0 Veiliggesteld"
                       : item.status === "losgekoppeld" ? "\u26A0 Losgekoppeld"
                       : "\u26A1 In bedrijf";
  statusBtn.addEventListener("click", function(e) {
    e.stopPropagation();
    openStatusKeuze(id);
  });
  statusWrap.appendChild(statusBtn);

  if (item.status && item.statusBy) {
    const meta = document.createElement("div");
    meta.className = "status-meta";
    meta.style.textAlign = "right";
    meta.textContent = item.statusBy + (item.statusDate ? " \u2022 " + formatDatum(item.statusDate) : "");
    statusWrap.appendChild(meta);
  }
  row.appendChild(statusWrap);
  info.appendChild(row);

  if (item.position) {
    const pos = document.createElement("div");
    pos.className = "pos";
    pos.appendChild(document.createTextNode("\uD83D\uDCCD ")); // 📍
    appendHighlighted(pos, item.position, term);
    info.appendChild(pos);
  }
  if (item.note) {
    const note = document.createElement("div");
    note.className = "note";
    note.appendChild(document.createTextNode("\uD83D\uDCAC ")); // 💬
    appendHighlighted(note, item.note, term);
    info.appendChild(note);
  }

  top.appendChild(info);

  const pencil = document.createElement("button");
  pencil.type = "button";
  pencil.className = "btn-pencil";
  pencil.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
  pencil.addEventListener("click", function(e) {
    e.stopPropagation();
    toggleEdit(id);
  });
  top.appendChild(pencil);

  card.appendChild(top);

  const editActions = document.createElement("div");
  editActions.className = "edit-actions";
  editActions.id = "ea-" + id;

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "btn-bewerk";
  editBtn.textContent = "\u270E Gegevens bewerken";
  editBtn.addEventListener("click", function(e) {
    e.stopPropagation();
    openEdit(id);
  });
  editActions.appendChild(editBtn);

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "btn-delete";
  deleteBtn.id = "del-" + id;
  deleteBtn.setAttribute("data-id", id);
  const bar = document.createElement("div");
  bar.className = "hold-bar";
  bar.id = "bar-" + id;
  const delLabel = document.createElement("span");
  delLabel.textContent = "\uD83D\uDDD1 Houd in om te verwijderen"; // 🗑
  deleteBtn.appendChild(bar);
  deleteBtn.appendChild(delLabel);
  attachHoldListeners(deleteBtn, id);
  editActions.appendChild(deleteBtn);

  const hint = document.createElement("div");
  hint.className = "hold-hint";
  hint.textContent = "2 seconden ingedrukt houden";
  editActions.appendChild(hint);

  card.appendChild(editActions);
  return card;
}

function selectCard(el) {
  document.querySelectorAll(".card").forEach(function(c) { c.classList.remove("selected"); });
  el.classList.add("selected");
}

function toggleEdit(id) {
  const el = document.getElementById("ea-" + id);
  if (!el) return;
  el.classList.toggle("open");
  // Listeners zijn al gehecht in makeCard — niets opnieuw te doen.
}

// ============================================================
// STATUS (veiligstellen)
// ============================================================
let _statusKeuzeId = null;
let _statusNaamId = null;
let _statusNaamNieuw = null;
function openStatusKeuze(id) {
  _statusKeuzeId = id;
  const item = data.find(function(d) { return d.id === id; });
  if (!item) return;
  let cur = item.status || "";

  // Bouw de 2 knoppen dynamisch — toon altijd de 2 opties die NIET de huidige zijn
  // Als een optie de huidige is, toon hem grijs (uitgeschakeld gevoel) zodat de gebruiker weet wat actief is
  const btns = document.getElementById("statusPopupBtns");
  btns.innerHTML = "";

  // Alle 3 mogelijke statussen — toon enkel de 2 die NIET de huidige zijn
  const alleOpties = [
    { status: "ok",           label: "&#9888; Veiliggesteld", cls: "status-btn-veilig" },
    { status: "losgekoppeld", label: "&#9888; Losgekoppeld",  cls: "status-btn-los"   },
    { status: "",             label: "&#10003; In bedrijf",  cls: "status-btn-vrij"  }
  ];

  alleOpties.filter(function(opt) { return opt.status !== cur; }).forEach(function(opt) {
    const btn = document.createElement("button");
    btn.className = "status-btn-keuze " + opt.cls;
    btn.innerHTML = opt.label;
    btn.addEventListener("click", function() { kiesStatus(opt.status); });
    btns.appendChild(btn);
  });

  document.getElementById("statusPopup").classList.add("open");
}
function closeStatusKeuze() {
  document.getElementById("statusPopup").classList.remove("open");
  _statusKeuzeId = null;
}
function kiesStatus(newStatus) {
  const id = _statusKeuzeId;
  closeStatusKeuze();
  if (!id) return;
  if (newStatus === "") {
    const item = data.find(function(d) { return d.id === id; });
    const kastNaam = item ? (item.code || item.location || "deze kast") : "deze kast";
    showConfirm(
      "LET OP: Je zet \u201c" + kastNaam + "\u201d terug naar In bedrijf. Dit betekent dat de kast weer onder spanning kan staan. Weet je dit zeker?",
      function() { _openNaamModal(id, newStatus); }
    );
    return;
  }
  _openNaamModal(id, newStatus);
}

function _openNaamModal(id, newStatus) {
  _statusNaamId = id;
  _statusNaamNieuw = newStatus;
  const titelEl = document.getElementById("statusNaamTitel");
  if (newStatus === "") {
    titelEl.textContent = "Terugzetten naar In bedrijf";
  } else if (newStatus === "ok") {
    titelEl.textContent = "Veiligstellen registreren";
  } else {
    titelEl.textContent = "Loskoppelen registreren";
  }
  document.getElementById("statusNaamInput").value = "";
  document.getElementById("statusDatumInput").value = new Date().toISOString().slice(0, 10);
  document.getElementById("statusNaamError").textContent = "";
  document.getElementById("statusNaamOverlay").classList.add("open");
  setTimeout(function() { const el = document.getElementById("statusNaamInput"); if (el) el.focus(); }, 150);
}

let _confirmCallback = null;
function showConfirm(msg, onConfirm) {
  document.getElementById("confirmMsg").textContent = msg;
  _confirmCallback = onConfirm;
  document.getElementById("confirmOverlay").classList.add("open");
}
function confirmJa() {
  document.getElementById("confirmOverlay").classList.remove("open");
  if (_confirmCallback) { _confirmCallback(); _confirmCallback = null; }
}
function confirmNee() {
  document.getElementById("confirmOverlay").classList.remove("open");
  _confirmCallback = null;
}
function sluitStatusNaamModal() {
  document.getElementById("statusNaamOverlay").classList.remove("open");
  _statusNaamId = null;
  _statusNaamNieuw = null;
}
function bevestigStatusNaam() {
  const naam = document.getElementById("statusNaamInput").value.trim();
  const datum = document.getElementById("statusDatumInput").value;
  const err = document.getElementById("statusNaamError");
  if (!naam) { err.textContent = "Vul je naam in."; return; }
  if (!datum) { err.textContent = "Vul een datum in."; return; }
  const id = _statusNaamId;
  let newStatus = _statusNaamNieuw;
  sluitStatusNaamModal();
  if (id != null) setStatus(id, newStatus, naam, datum);
}
function formatDatum(raw) {
  if (!raw) return "";
  // ISO formaat: YYYY-MM-DD
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return iso[3] + "-" + iso[2] + "-" + iso[1];
  // Fallback: probeer te parsen als Date (bv. als Google Sheets een datumobject terugstuurt)
  let d = new Date(raw);
  if (!isNaN(d.getTime())) {
    const day = String(d.getDate()).padStart(2, "0");
    const mon = String(d.getMonth() + 1).padStart(2, "0");
    return day + "-" + mon + "-" + d.getFullYear();
  }
  return raw;
}

async function setStatus(id, newStatus, naam, datum) {
  let idx = -1;
  for (let i = 0; i < data.length; i++) {
    if (data[i].id === id) { idx = i; break; }
  }
  if (idx === -1) return;

  const previousItem = Object.assign({}, data[idx]);
  const statusUpdate = { status: newStatus };
  if (newStatus === "") {
    statusUpdate.statusBy = "";
    statusUpdate.statusDate = "";
  } else {
    statusUpdate.statusBy = naam || "";
    statusUpdate.statusDate = datum || "";
  }
  const updatedItem = Object.assign({}, data[idx], statusUpdate, {
    expectedLastModified: data[idx].lastModified || ""
  });

  // UI meteen updaten — geen wachten op server
  data[idx] = updatedItem;
  saveLocal();
  refreshUI();

  _pendingIds.add(id);
  try {
    const result = await sheetAction({ action: "update", data: JSON.stringify(updatedItem) });
    if (result && result.conflict) {
      _pendingIds.delete(id);
      await handleConflictResult(result, updatedItem);
      return;
    }
    if (result && result.lastModified) {
      const ix = data.findIndex(function(d) { return d.id === id; });
      if (ix !== -1) { data[ix].lastModified = result.lastModified; delete data[ix].expectedLastModified; saveLocal(); }
    }
    const now = new Date().toLocaleTimeString("nl-NL", {hour:"2-digit", minute:"2-digit"});
    setSyncStatus("ok", "Gesync " + now);
    const statusLabel = newStatus === "" ? "Terug In bedrijf" : newStatus === "ok" ? "Veiliggesteld" : "Losgekoppeld";
    await logAction(statusLabel + (naam ? " \u2014 " + naam : ""), updatedItem.code, updatedItem.location, "Logboek Status");
    _pendingIds.delete(id);
  } catch(e) {
    _pendingIds.delete(id);
    enqueue("update", updatedItem);
    showToast("Offline opgeslagen \u2014 wordt gesynchroniseerd zodra er verbinding is.");
    console.warn("setStatus sync:", e);
  }
}

// ============================================================
// LIJST TAB
// ============================================================
function renderList() {
  const rooms = ["all"];
  for (let i = 0; i < data.length; i++) {
    if (data[i].location && rooms.indexOf(data[i].location) === -1) rooms.push(data[i].location);
  }
  rooms.sort(function(a, b) { if (a==="all") return -1; if (b==="all") return 1; return a.localeCompare(b); });

  // Tellingen vóór de loop berekenen om O(n*r) te vermijden.
  const counts = {};
  for (let i = 0; i < data.length; i++) {
    const loc = data[i].location;
    if (loc) counts[loc] = (counts[loc] || 0) + 1;
  }

  const filter = document.getElementById("roomFilter");
  filter.textContent = "";
  rooms.forEach(function(r) {
    const cnt = r === "all" ? data.length : (counts[r] || 0);
    const chip = document.createElement("span");
    chip.className = "chip" + (activeRoom === r ? " active" : "");
    chip.textContent = r === "all" ? ("Alle (" + cnt + ")") : (r + " (" + cnt + ")");
    chip.addEventListener("click", function() { setRoom(chip, r); });
    filter.appendChild(chip);
  });
  showFiltered();
}

function setRoom(el, r) {
  activeRoom = r;
  document.querySelectorAll(".chip").forEach(function(c) { c.classList.remove("active"); });
  el.classList.add("active");
  showFiltered();
}

function showFiltered() {
  _currentSearchTerm = "";
  const filtered = data.filter(function(d) { return activeRoom === "all" || d.location === activeRoom; });
  filtered.sort(function(a, b) { return (a.code||"").localeCompare(b.code||""); });
  const container = document.getElementById("listResults");
  container.textContent = "";
  const frag = document.createDocumentFragment();
  for (let i = 0; i < filtered.length; i++) frag.appendChild(makeCard(filtered[i]));
  container.appendChild(frag);
}

// ============================================================
// TOEVOEGEN
// ============================================================
async function addEntry() {
  const code = document.getElementById("newCode").value.trim();
  let loc = document.getElementById("newLocation").value.trim();
  const note = document.getElementById("newNote").value.trim();
  const position = document.getElementById("newPosition").value.trim();
  if (!loc) { showToast("Vul een ruimte in!", true); return; }
  const canonicalLoc = findRoom(loc);
  if (!canonicalLoc) { showToast("Onbekende ruimte. Kies een ruimte uit de lijst.", true); return; }
  loc = canonicalLoc;

  const newItem = {
    id: newId(),
    code: code,
    location: loc,
    position: position,
    note: note,
    status: "",
    added: todayISO(),
    addedby: safeGet("ekast-device", "")
  };

  // Optimistic: meteen lokaal opslaan en UI updaten
  data.push(newItem);
  saveLocal();
  document.getElementById("newCode").value = "";
  document.getElementById("newLocation").value = "";
  document.getElementById("newPosition").value = "";
  document.getElementById("newNote").value = "";
  refreshUI();

  const btnAdd = document.getElementById("btnAdd");
  btnAdd.disabled = true; btnAdd.textContent = "OPSLAAN...";
  setSyncStatus("syncing", "Opslaan...");
  _pendingIds.add(newItem.id);
  try {
    const result = await sheetAction({ action: "add", data: JSON.stringify(newItem) });
    if (!result) throw new Error("Geen antwoord van server");
    if (result.error) throw new Error(result.error);
    if (result.lastModified) {
      const ix = data.findIndex(function(d) { return d.id === newItem.id; });
      if (ix !== -1) { data[ix].lastModified = result.lastModified; saveLocal(); }
    }
    await logAction("Toegevoegd", newItem.code, newItem.location, "Logboek Toevoegingen");
    showToast("Kast toegevoegd!");
    _pendingIds.delete(newItem.id);
    const now = new Date().toLocaleTimeString("nl-NL", {hour:"2-digit", minute:"2-digit"});
    setSyncStatus("ok", "Gesync " + now);
  } catch(e) {
    _pendingIds.delete(newItem.id);
    enqueue("add", newItem);
    showToast("Lokaal opgeslagen — wordt gesynchroniseerd zodra er verbinding is.");
    console.warn("addEntry offline:", e);
  } finally {
    btnAdd.disabled = false; btnAdd.textContent = "OPSLAAN";
  }
}

// ============================================================
// BEWERKEN
// ============================================================
function openEdit(id) {
  for (let i = 0; i < data.length; i++) {
    if (data[i].id === id) {
      document.getElementById("editId").value = id;
      document.getElementById("editCode").value = data[i].code || "";
      document.getElementById("editLocation").value = data[i].location || "";
      document.getElementById("editPosition").value = data[i].position || "";
      document.getElementById("editNote").value = data[i].note || "";
      document.getElementById("editModal").classList.add("open");
      return;
    }
  }
}

function closeModal() { document.getElementById("editModal").classList.remove("open"); }

async function saveEdit() {
  const id = document.getElementById("editId").value;
  let idx = -1;
  for (let i = 0; i < data.length; i++) {
    if (data[i].id === id) { idx = i; break; }
  }
  if (idx === -1) { closeModal(); return; }

  let newLoc = document.getElementById("editLocation").value.trim();
  if (!newLoc) { showToast("Vul een ruimte in!", true); return; }
  let canonicalNewLoc = findRoom(newLoc);
  if (!canonicalNewLoc) { showToast("Onbekende ruimte. Kies een ruimte uit de lijst.", true); return; }
  newLoc = canonicalNewLoc;

  const updatedItem = Object.assign({}, data[idx], {
    code:     document.getElementById("editCode").value.trim(),
    location: newLoc,
    position: document.getElementById("editPosition").value.trim(),
    note:     document.getElementById("editNote").value.trim(),
    expectedLastModified: data[idx].lastModified || ""
  });

  // Optimistic: meteen lokaal opslaan en UI updaten
  closeModal();
  data[idx] = updatedItem;
  saveLocal();
  refreshUI();

  const btnSave = document.getElementById("btnSaveEdit");
  btnSave.disabled = true; btnSave.textContent = "Opslaan...";
  setSyncStatus("syncing", "Opslaan...");
  _pendingIds.add(id);
  try {
    const result = await sheetAction({ action: "update", data: JSON.stringify(updatedItem) });
    if (!result) throw new Error("Geen antwoord van server");
    if (result.conflict) {
      _pendingIds.delete(id);
      await handleConflictResult(result, updatedItem);
      return;
    }
    if (result.error) throw new Error(result.error);
    if (result.lastModified) {
      const ix = data.findIndex(function(d) { return d.id === id; });
      if (ix !== -1) { data[ix].lastModified = result.lastModified; delete data[ix].expectedLastModified; saveLocal(); }
    }
    showToast("Opgeslagen!");
    _pendingIds.delete(id);
    const now = new Date().toLocaleTimeString("nl-NL", {hour:"2-digit", minute:"2-digit"});
    setSyncStatus("ok", "Gesync " + now);
  } catch(e) {
    _pendingIds.delete(id);
    enqueue("update", updatedItem);
    showToast("Lokaal opgeslagen — sync wacht op verbinding.");
    console.warn("saveEdit offline:", e);
  } finally {
    btnSave.disabled = false; btnSave.textContent = "Opslaan";
  }
}

// ============================================================
// VERWIJDEREN
// ============================================================
async function deleteEntry(id) {
  let idx = -1;
  for (let i = 0; i < data.length; i++) {
    if (data[i].id === id) { idx = i; break; }
  }
  if (idx === -1) return;

  // Optimistic: meteen lokaal verwijderen
  const removedItem = data.splice(idx, 1)[0];
  saveLocal();
  refreshUI();
  showToast("Verwijderd");

  setSyncStatus("syncing", "Verwijderen...");
  _pendingIds.add(id);
  try {
    const result = await sheetAction({ action: "delete", id: id });
    if (!result) throw new Error("Geen antwoord van server");
    if (result.error) throw new Error(result.error);
    _pendingIds.delete(id);
    const now = new Date().toLocaleTimeString("nl-NL", {hour:"2-digit", minute:"2-digit"});
    setSyncStatus("ok", "Gesync " + now);
  } catch(e) {
    _pendingIds.delete(id);
    enqueue("delete", { id: id, code: removedItem.code });
    console.warn("deleteEntry offline:", e);
  }
}

// ============================================================
// HOLD-TO-DELETE
// Listeners worden nu één keer per knop in makeCard() gehecht;
// geen globale rescan meer (geen markers, geen dubbele attach).
// ============================================================
function attachHoldListeners(btn, id) {
  const bar = btn.querySelector(".hold-bar");
  function start(e) {
    e.preventDefault();
    btn.classList.add("holding");
    if (bar) { bar.style.transition = "width " + HOLD_MS + "ms linear"; bar.style.width = "100%"; }
    holdTimers[id] = setTimeout(function() { deleteEntry(id); }, HOLD_MS);
  }
  function stop() {
    btn.classList.remove("holding");
    if (bar) { bar.style.transition = "none"; bar.style.width = "0%"; }
    if (holdTimers[id]) { clearTimeout(holdTimers[id]); delete holdTimers[id]; }
  }
  btn.addEventListener("mousedown", start);
  btn.addEventListener("touchstart", start, {passive: false});
  btn.addEventListener("mouseup", stop);
  btn.addEventListener("mouseleave", stop);
  btn.addEventListener("touchend", stop);
  btn.addEventListener("touchcancel", stop);
}

// ============================================================
// TOAST
// ============================================================
function showToast(msg, err) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "toast show" + (err ? " error" : "");
  setTimeout(function() { t.classList.remove("show"); }, 2500);
}

// ============================================================
// RUIMTE DROPDOWN PICKER
// ============================================================
function toggleRoomDropdown(inputId, dropId) {
  const drop = document.getElementById(dropId);
  if (drop.classList.contains("open")) {
    drop.classList.remove("open");
    return;
  }
  const rooms = Object.keys(ROOM_INFO);
  drop.innerHTML = "";
  rooms.forEach(function(r) {
    const item = document.createElement("div");
    item.className = "room-dropdown-item";
    item.textContent = r;
    item.addEventListener("click", function() {
      document.getElementById(inputId).value = r;
      drop.classList.remove("open");
    });
    drop.appendChild(item);
  });
  drop.classList.add("open");
}

// ============================================================
// RUIMTE TOEVOEGEN
// ============================================================
function openAddRoomModal() {
  document.getElementById("newRoomName").value = "";
  document.getElementById("newRoomDesc").value = "";
  document.getElementById("addRoomModal").classList.add("open");
  setTimeout(function() { document.getElementById("newRoomName").focus(); }, 100);
}

function closeAddRoomModal() {
  document.getElementById("addRoomModal").classList.remove("open");
}

async function saveNewRoom() {
  const name = document.getElementById("newRoomName").value.trim();
  if (!name) { showToast("Geef een naam op voor de ruimte.", true); return; }
  if (findRoom(name)) { showToast("Deze ruimte bestaat al.", true); return; }
  const desc = document.getElementById("newRoomDesc").value.trim();

  // Lokaal opslaan
  ROOM_INFO[name] = desc;
  try {
    const stored = JSON.parse(localStorage.getItem("ekast-custom-rooms") || "{}");
    stored[name] = desc;
    localStorage.setItem("ekast-custom-rooms", JSON.stringify(stored));
  } catch(e) { console.warn("Ruimte opslaan in localStorage mislukt:", e); }
  const dl = document.getElementById("roomSuggestions");
  if (dl) { const opt = document.createElement("option"); opt.value = name; dl.appendChild(opt); }
  closeAddRoomModal();
  showToast("Ruimte \"" + name + "\" toegevoegd.");

  // Syncen naar Sheets zodat alle toestellen de ruimte zien
  if (SCRIPT_URL) {
    try {
      await sheetAction({ action: "addRoom", name: name, desc: desc });
    } catch(e) {
      console.warn("Ruimte sync mislukt:", e);
    }
  }
}

// ============================================================
// RUIMTE INFO
// ============================================================
function showRoomInfo(loc) {
  const info = (ROOM_INFO[loc] || "").trim();
  if (!info) return;
  document.getElementById("infoPopupTitle").textContent = loc;
  document.getElementById("infoPopupBody").textContent = info;
  document.getElementById("infoPopupOverlay").classList.add("open");
  clearTimeout(window._roomToast);
  window._roomToast = setTimeout(closeInfoPopup, 8000);
}

function closeInfoPopup() {
  document.getElementById("infoPopupOverlay").classList.remove("open");
  clearTimeout(window._roomToast);
}

// ============================================================
// AUDIT LOG
// ============================================================
async function logAction(action, code, location, sheet) {
  if (!SCRIPT_URL) return;
  const name = safeGet("ekast-device", "Onbekend");
  let uid = safeGet("ekast-device-id", null);
  if (!uid) {
    uid = newId().slice(0, 8).toUpperCase();
    safeSet("ekast-device-id", uid);
  }
  const device = name + " (" + uid + ")";
  try {
    await sheetAction({ action: "log", logaction: action, code: code||"", location: location||"", device: device, sheet: sheet||"Logboek" });
  } catch(e) {
    console.warn("Log fout:", e);
  }
}

// ============================================================
// CONFLICT AFHANDELING
// ============================================================
let _conflictResolve = null;
let _conflictLocalItem = null;
let _conflictServerItem = null;

function showConflictDialog(localItem, serverItem) {
  _conflictLocalItem = localItem;
  _conflictServerItem = serverItem;
  const body = document.getElementById("conflictBody");
  body.textContent = "";
  const fields = [
    { label: "Code", key: "code" },
    { label: "Locatie", key: "location" },
    { label: "Status", key: "status" },
    { label: "Notitie", key: "note" },
    { label: "Positie", key: "position" }
  ];
  fields.forEach(function(f) {
    const lv = localItem[f.key] || "";
    const sv = serverItem[f.key] || "";
    if (lv !== sv) {
      const row = document.createElement("div");
      row.style.cssText = "margin-bottom:.4rem;padding:.3rem .5rem;background:#1c2030;border-radius:6px;";
      row.innerHTML = "<b style='color:var(--accent)'>" + esc(f.label) + ":</b><br>" +
        "<span style='color:#e03c3c'>Jij: " + esc(lv || "(leeg)") + "</span><br>" +
        "<span style='color:#2ecc71'>Server: " + esc(sv || "(leeg)") + "</span>";
      body.appendChild(row);
    }
  });
  if (body.children.length === 0) {
    body.textContent = "Alleen metadata verschilt (bijv. tijdstempel).";
  }
  document.getElementById("conflictOverlay").classList.add("open");
  return new Promise(function(resolve) { _conflictResolve = resolve; });
}

function resolveConflict(choice) {
  document.getElementById("conflictOverlay").classList.remove("open");
  if (_conflictResolve) {
    _conflictResolve({ choice: choice, localItem: _conflictLocalItem, serverItem: _conflictServerItem });
    _conflictResolve = null;
  }
}

async function handleConflictResult(result, localItem) {
  if (!result.conflict) return false;
  const resolution = await showConflictDialog(localItem, result.serverItem);
  if (resolution.choice === "server") {
    const idx = data.findIndex(function(d) { return d.id === localItem.id; });
    if (idx !== -1) {
      data[idx] = result.serverItem;
      saveLocal();
      refreshUI();
    }
    showToast("Server versie overgenomen.");
  } else {
    delete localItem.expectedLastModified;
    localItem.lastModified = result.serverItem.lastModified;
    await sheetAction({ action: "update", data: JSON.stringify(localItem) });
    const idx = data.findIndex(function(d) { return d.id === localItem.id; });
    if (idx !== -1) { data[idx] = localItem; saveLocal(); refreshUI(); }
    showToast("Jouw versie opgeslagen.");
  }
  return true;
}

// ============================================================
// PIN BEVEILIGING
// ============================================================
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minuten

async function hashPin(pin) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pin));
  return Array.from(new Uint8Array(buf)).map(function(b) { return b.toString(16).padStart(2, "0"); }).join("");
}

function checkPin() {
  const device = safeGet("ekast-device", null);
  if (!device) {
    showPinSetup();
    return;
  }
  const lastUnlock = parseInt(safeGet("ekast-unlock", "0"), 10);
  if (Date.now() - lastUnlock < SESSION_TIMEOUT_MS) {
    init();
  } else {
    showPinEnter();
  }
}

function showPinSetup() {
  const ov = document.getElementById("pinOverlay");
  ov.innerHTML =
    "<div class='pin-title'>E-KAST ZOEKER</div>" +
    "<div class='pin-sub'>Eerste keer op dit toestel.<br>Geef dit toestel een naam en voer de PIN in.</div>" +
    "<div style='width:100%;max-width:280px'>" +
    "<div class='form-group'><label>Naam van dit toestel</label>" +
    "<input type='text' id='setupDevice' placeholder='bv. GSM Dag' autocomplete='off'></div>" +
    "<div class='form-group'><label>PIN</label>" +
    "<input type='password' class='pin-input' id='setupPin' placeholder='••••' maxlength='8' inputmode='numeric' autocomplete='off'></div>" +
    "<div class='pin-error' id='pinErr'></div>" +
    "<button class='btn-primary' onclick='savePin()'>Bevestigen</button>" +
    "</div>";
  ov.classList.add("open");
}

async function savePin() {
  const device = document.getElementById("setupDevice").value.trim();
  const pin = document.getElementById("setupPin").value;
  const err = document.getElementById("pinErr");
  if (!device) { err.textContent = "Geef een naam voor dit toestel."; return; }
  const h = await hashPin(pin);
  if (h !== DEVICE_PIN_HASH) { err.textContent = "Onjuiste PIN."; document.getElementById("setupPin").value = ""; return; }
  safeSet("ekast-device", device);
  // Genereer een uniek toestel-ID als die nog niet bestaat
  if (!safeGet("ekast-device-id", null)) {
    let uid = newId().slice(0, 8).toUpperCase();
    safeSet("ekast-device-id", uid);
  }
  logAction("Registratie", "", "");
  unlockApp();
}

function showPinEnter() {
  const device = safeGet("ekast-device", "Dit toestel");
  const ov = document.getElementById("pinOverlay");
  ov.innerHTML =
    "<div class='pin-title'>E-KAST ZOEKER</div>" +
    "<div class='pin-sub'>" + esc(device) + "<br>Voer je PIN in.</div>" +
    "<input type='password' class='pin-input' id='pinInput' placeholder='••••' maxlength='8' inputmode='numeric' autocomplete='new-password' oninput='verifyPin()'>" +
    "<div class='pin-error' id='pinErr'></div>";
  ov.classList.add("open");
  setTimeout(function() { const el = document.getElementById("pinInput"); if (el) el.focus(); }, 150);
}

let _pinAttempts = 0;
let _pinLockUntil = parseInt(safeGet("ekast-pin-lock", "0"), 10);
const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCKOUT_MS = 5 * 60 * 1000; // 5 minuten

async function verifyPin() {
  const input = document.getElementById("pinInput");
  const errEl = document.getElementById("pinErr");
  if (!input || input._checking) return;

  // Check of account nog geblokkeerd is
  if (_pinLockUntil > Date.now()) {
    const secLeft = Math.ceil((_pinLockUntil - Date.now()) / 1000);
    errEl.textContent = "Geblokkeerd. Wacht " + secLeft + " seconden.";
    input.value = "";
    return;
  }

  if (input.value.length === DEVICE_PIN_LENGTH) {
    input._checking = true;
    input.disabled = true;
    const h = await hashPin(input.value);
    if (h === DEVICE_PIN_HASH) {
      _pinAttempts = 0;
      logAction("Aanmelding", "", "", "Logboek Aanmeldingen");
      unlockApp();
    } else {
      _pinAttempts++;
      if (_pinAttempts >= PIN_MAX_ATTEMPTS) {
        _pinLockUntil = Date.now() + PIN_LOCKOUT_MS;
        safeSet("ekast-pin-lock", _pinLockUntil.toString());
        errEl.textContent = "Te veel pogingen. 5 minuten geblokkeerd.";
        input.value = "";
        input.disabled = true;
        input._checking = false;
        // Start countdown
        let lockInterval = setInterval(function() {
          let left = Math.ceil((_pinLockUntil - Date.now()) / 1000);
          if (left <= 0) {
            clearInterval(lockInterval);
            _pinAttempts = 0;
            errEl.textContent = "";
            input.disabled = false;
            input._checking = false;
            input.focus();
          } else {
            errEl.textContent = "Geblokkeerd. Wacht " + left + " seconden.";
          }
        }, 1000);
        return;
      }
      errEl.textContent = "Onjuiste PIN. Nog " + (PIN_MAX_ATTEMPTS - _pinAttempts) + " pogingen.";
      setTimeout(function() {
        input.value = "";
        input.disabled = false;
        input._checking = false;
        input.focus();
      }, 1200);
    }
  }
}

function unlockApp() {
  safeSet("ekast-unlock", Date.now().toString());
  if (document.activeElement) document.activeElement.blur();
  document.getElementById("pinOverlay").classList.remove("open");
  init();
  // Verleng sessie bij activiteit — slechts één keer hechten, anders accumuleren
  // listeners bij elke unlock (memory leak + verspilde calls per click).
  if (unlockApp._activityBound) return;
  unlockApp._activityBound = true;
  ["click", "touchstart", "keydown"].forEach(function(evt) {
    document.addEventListener(evt, function() {
      safeSet("ekast-unlock", Date.now().toString());
    }, {passive: true});
  });
}

// ============================================================
// START
// ============================================================
checkPin();

// Service Worker registreren voor offline ondersteuning
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(function(e) {
    console.warn("Service Worker registratie mislukt:", e);
  });
}

