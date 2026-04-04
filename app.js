// ⚠️ VEREIST: Plak hier je Apps Script Web App URL
// Na het deployen van Code.gs kopieer je de URL hier
var SCRIPT_URL = "https://script.google.com/macros/s/AKfycbx95mvBsmpMxJn7c0cLDL_V63x7Bv9T3XQW_vfL0K2wRlSfxm4476rJ0qZDrFOZ0nF9kg/exec";

// 🔑 API TOKEN — voeg dit toe aan je Apps Script om ongeautoriseerde toegang te blokkeren
// Stel in je Apps Script in: if (e.parameter.token !== "JOUW_TOKEN") return ...
// Wijzig de waarde hieronder en zorg dat je Apps Script dezelfde waarde controleert.
var API_TOKEN = "ekast-2025";

// 🔒 GEDEELDE PIN — dit is de SHA-256 hash van de PIN "5100"
// Om de PIN te wijzigen: bereken de SHA-256 hash van je nieuwe PIN via https://emn178.github.io/online-tools/sha256.html
// en vervang de waarde hieronder. Upload daarna de HTML opnieuw — alle toestellen moeten de nieuwe PIN gebruiken.
var DEVICE_PIN_HASH = "1299c06d517825c0529d69fe9f8bbf7b308b9db68289db3c9f844570deb1d621";
var DEVICE_PIN_LENGTH = 4; // Aantal cijfers van de PIN

// Auto-sync interval in milliseconden (standaard: 30 seconden)
var SYNC_INTERVAL_MS = 30000;

// ℹ️ Beschrijving per e-ruimte (optioneel)
// Voeg hier een omschrijving toe zodat collega's weten waar de ruimte zich bevindt.
// Laat leeg ("") als de naam al duidelijk genoeg is.
var ROOM_INFO = {
  "Stofkisten Gang":   "gelijkvloers, bij het begin van PM6",
  "Omvormerruimte":    "gelijkvloers, rechter kant (AZ) van PM6",
  "3KV":               "1ste verdiep, tussen VSM 20 en Refinerhal",
  "DH":                "2de verdiep",
  "E-Ruimte 774-12":   "1ste verdiep, langs rollen afwerking",
  "W.L. Nieuw":        "gelijkvloers, Walsenloods links van PM6 klein trapje omhoog",
  "OR12":              "1ste verdiep, langs ploegenhok en OR12",
  "Walsen Loods":      "gelijkvloers",
  "Lift 19":           "",
  "CSBO":              "CSB onder",
  "Lift 21":           "",
  "NICO-B":            "1ste verdieping, linkerkant van de NICO",
  "NICO-O":            "Gelijkvloers, links van Nico (AZ) trapje omhoog"
};

// Laad eerder toegevoegde custom ruimtes uit localStorage en voeg toe aan ROOM_INFO
(function loadCustomRooms() {
  try {
    var stored = JSON.parse(localStorage.getItem("ekast-custom-rooms") || "{}");
    Object.keys(stored).forEach(function(name) {
      if (!ROOM_INFO.hasOwnProperty(name)) ROOM_INFO[name] = stored[name];
    });
  } catch(e) {}
})();

// ============================================================
// DATA & STATE
// ============================================================
var data = [];
try {
  data = JSON.parse(document.getElementById("d").textContent) || [];
} catch(e) {
  console.warn("Embedded data kon niet worden geladen:", e);
}
var activeRoom = "all";
var holdTimers = {};
var HOLD_MS = 2000;
var syncTimer = null;
var isSyncing = false;

// Veilige localStorage helpers (werkt ook in privémodus of bij vol geheugen)
function safeGet(key, fallback) {
  try { var v = localStorage.getItem(key); return v !== null ? v : fallback; }
  catch(e) { return fallback; }
}
function safeSet(key, value) {
  try { localStorage.setItem(key, value); return true; }
  catch(e) { showToast("Lokale opslag niet beschikbaar. Probeer buiten privémodus.", true); return false; }
}

// Laad lokale cache als snelle eerste weergave
try {
  var saved = localStorage.getItem("ekast-data");
  if (saved) {
    var parsed = JSON.parse(saved);
    if (Array.isArray(parsed) && parsed.length > 0) data = parsed;
  }
  try { localStorage.removeItem("ekast-local"); } catch(e) {} // oude vuile key opruimen
} catch(e) {
  console.warn("Lokale cache kon niet worden geladen:", e);
  showToast("Lokale opslag niet beschikbaar \u2014 gegevens worden niet bewaard.", true);
}

function saveLocal() {
  try {
    localStorage.setItem("ekast-data", JSON.stringify(data));
  } catch(e) {
    showToast("Lokale opslag vol of geblokkeerd. Wijzigingen worden niet bewaard.", true);
    console.warn("saveLocal mislukt:", e);
  }
}

// ============================================================
// SYNC STATUS UI
// ============================================================
function setSyncStatus(state, label) {
  var badge = document.getElementById("syncBadge");
  var lbl = document.getElementById("syncLabel");
  if (!badge) return;
  badge.className = "sync-badge " + state;
  lbl.textContent = label;
}

// ============================================================
// SYNC: LEZEN — haalt alle data op uit Sheets
// ============================================================
async function fetchWithTimeout(url, ms) {
  var ctrl = new AbortController();
  var timer = setTimeout(function() { ctrl.abort(); }, ms);
  try {
    var resp = await fetch(url, { signal: ctrl.signal });
    return resp;
  } finally {
    clearTimeout(timer);
  }
}

async function syncFromSheets(silent) {
  if (!SCRIPT_URL || isSyncing) return;
  isSyncing = true;
  if (!silent) setSyncStatus("syncing", "Laden...");
  var attempt = 0;
  while (attempt < 2) {
    attempt++;
    try {
      var resp = await fetchWithTimeout(SCRIPT_URL + "?action=get&token=" + encodeURIComponent(API_TOKEN) + "&t=" + Date.now(), 25000);
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      var json = await resp.json();
      if (json.error) throw new Error(json.error);
      if (Array.isArray(json) && json.length > 0) {
        // Bewaar statusBy/statusDate uit lokale data als de server die velden niet kent
        var localMap = {};
        data.forEach(function(d) { if (d.id) localMap[d.id] = d; });
        var merged = json.map(function(serverItem) {
          var local = localMap[serverItem.id];
          if (local && serverItem.status === local.status && !serverItem.statusBy && local.statusBy) {
            return Object.assign({}, serverItem, { statusBy: local.statusBy, statusDate: local.statusDate || "" });
          }
          return serverItem;
        });
        data = deduplicateById(merged);
        saveLocal();
        refreshUI();
        var now = new Date().toLocaleTimeString("nl-NL", {hour:"2-digit", minute:"2-digit"});
        setSyncStatus("ok", "Gesync " + now);
      } else if (Array.isArray(json) && json.length === 0) {
        data = [];
        saveLocal();
        refreshUI();
        var now = new Date().toLocaleTimeString("nl-NL", {hour:"2-digit", minute:"2-digit"});
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
  var seen = {};
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
    var url = SCRIPT_URL + "?" + Object.keys(params).map(function(k) {
      return k + "=" + (k === "data" ? encodeURIComponent(params[k]) : encodeURIComponent(String(params[k])));
    }).join("&") + "&token=" + encodeURIComponent(API_TOKEN) + "&t=" + Date.now();
    var resp = await fetchWithTimeout(url, 25000);
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    var json = await resp.json();
    if (json.error) throw new Error(json.error);
    return json;
  } finally {
    isSyncing = false;
  }
}

// Handmatige sync via klik op badge
function manualSync() {
  if (!SCRIPT_URL) { showToast("Geen SCRIPT_URL ingesteld!", true); return; }
  syncFromSheets(false);
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
      syncFromSheets(false);
    });
    document.addEventListener("keydown", function(e) {
      if (e.key === "Escape") {
        if (document.getElementById("statusNaamOverlay").classList.contains("open")) { sluitStatusNaamModal(); }
        else if (document.getElementById("statusPopup").classList.contains("open")) { closeStatusKeuze(); }
        else if (document.getElementById("editModal").classList.contains("open")) { closeModal(); }
        else if (document.getElementById("infoPopupOverlay").classList.contains("open")) { closeInfoPopup(); }
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

  syncFromSheets(false);
  syncTimer = setInterval(function() { syncFromSheets(true); }, SYNC_INTERVAL_MS);
}

function updateTotalCount() {
  var el = document.getElementById("totalCount");
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
    var btn = document.getElementById("tbtn-" + t);
    btn.classList.remove("active", "active-blue");
    btn.setAttribute("aria-selected", "false");
  });
  document.getElementById("tab-" + name).classList.add("active");
  var activeBtn = document.getElementById("tbtn-" + name);
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
  var tabOrder = ["search","list","status","add"];
  var idx = tabOrder.indexOf(tabName);
  var container = document.getElementById("tabsContainer");
  var pill = document.getElementById("tabsPill");
  if (!container || !pill || idx === -1) return;
  var padding = 4;
  var availWidth = container.offsetWidth - padding * 2;
  var tabWidth = availWidth / 4;
  pill.style.width = tabWidth + "px";
  pill.style.left = (padding + idx * tabWidth) + "px";
}

function renderStatus() {
  _currentSearchTerm = "";
  var active = data.filter(function(d) { return d.status && d.status !== ""; });
  active.sort(function(a, b) { return (a.location||"").localeCompare(b.location||""); });
  document.getElementById("statusCount").innerText = active.length;
  if (active.length === 0) {
    document.getElementById("statusResults").innerHTML = "<div class=\"empty\"><b>Geen actieve meldingen</b>Alle kasten zijn in bedrijf</div>";
    return;
  }
  var html = "";
  for (var i = 0; i < active.length; i++) html += makeCard(active[i]);
  document.getElementById("statusResults").innerHTML = html;
  attachHold();
}

function updateStatusBadge() {
  var count = data.filter(function(d) { return d.status && d.status !== ""; }).length;
  var badge = document.getElementById("statusBadge");
  var statusTabActive = document.getElementById("tab-status").classList.contains("active");
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
var _searchTimer = null;
function doSearch(value) {
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(function() { _doSearchNow(value); }, 150);
}
function _doSearchNow(value) {
  var v = value.toLowerCase().trim();
  var countEl = document.getElementById("resultCount");
  var container = document.getElementById("searchResults");
  if (!v) {
    _currentSearchTerm = "";
    countEl.innerText = "0";
    container.innerHTML = "<div class=\"empty\"><b>Typ een kastnummer</b><span id=\"totalCount\">" + data.length + "</span> kasten beschikbaar<br><span style=\"color:#4a9eff;font-size:2.5rem;font-weight:900;margin-top:2rem;display:block;text-align:center;letter-spacing:.1em;\">Sappi</span></div>";
    return;
  }
  _currentSearchTerm = value.trim();
  var results = [];
  for (var i = 0; i < data.length; i++) {
    var d = data[i];
    if ((d.code||"").toLowerCase().indexOf(v) !== -1 ||
        (d.location||"").toLowerCase().indexOf(v) !== -1 ||
        (d.note||"").toLowerCase().indexOf(v) !== -1 ||
        (d.position||"").toLowerCase().indexOf(v) !== -1) {
      results.push(d);
    }
  }
  countEl.innerText = results.length;
  if (results.length === 0) {
    container.innerHTML = "<div class=\"empty\"><b>Niets gevonden</b>Probeer een andere zoekterm</div>";
    return;
  }
  var html = "";
  for (var i = 0; i < results.length; i++) html += makeCard(results[i]);
  container.innerHTML = html;
  attachHold();
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

function highlight(text, term) {
  if (!term) return esc(text);
  var escaped = esc(text);
  var termEsc = esc(term);
  var regex = new RegExp("(" + termEsc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "gi");
  return escaped.replace(regex, "<mark style=\"background:#f0a500;color:#000;border-radius:2px;padding:0 1px;\">$1</mark>");
}

var _currentSearchTerm = "";

function makeCard(item) {
  var id = esc(item.id);
  var term = _currentSearchTerm;
  var h = "<div class=\"card\" id=\"c-" + id + "\" onclick=\"selectCard(this)\">";
  h += "<div class=\"card-top\"><div class=\"card-info\">";
  h += "<div class=\"code\">" + highlight(item.code, term) + "</div>";
  h += "<div style=\"display:flex;justify-content:space-between;align-items:flex-start;\">" +
        "<div class=\"loc\">" + highlight(item.location, term) + (ROOM_INFO[item.location] ? " <button class=\"btn-info-loc\" onclick=\"event.stopPropagation();showRoomInfo(&#39;" + esc(item.location) + "&#39;)\" title=\"Waar is dit?\">&#9432;</button>" : "") + "</div>" +
        "<div style=\"display:flex;flex-direction:column;align-items:flex-end;flex-shrink:0;margin-left:.5rem;\">" +
        "<button class=\"sbtn-veilig" + (item.status==="ok"?" secured":item.status==="losgekoppeld"?" losgekoppeld":"") + "\" onclick=\"event.stopPropagation();openStatusKeuze(&#39;" + id + "&#39;)\">" +
        (item.status==="ok" ? "&#9888; Veiliggesteld" : item.status==="losgekoppeld" ? "&#9888; Losgekoppeld" : "&#9889; In bedrijf") +
        "</button>" +
        (item.status && item.statusBy ? "<div class=\"status-meta\" style=\"text-align:right;\">" + esc(item.statusBy) + (item.statusDate ? " &bull; " + formatDatum(item.statusDate) : "") + "</div>" : "") +
        "</div>" +
        "</div>";
  if (item.position) h += "<div class=\"pos\">&#128205; " + highlight(item.position, term) + "</div>";
  if (item.note) h += "<div class=\"note\">&#128172; " + highlight(item.note, term) + "</div>";
  h += "</div>";
  h += "<button class=\"btn-pencil\" onclick=\"event.stopPropagation();toggleEdit(&#39;" + id + "&#39;)\">";
  h += "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7\"/><path d=\"M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z\"/></svg>";
  h += "</button></div>";
  h += "<div class=\"edit-actions\" id=\"ea-" + id + "\">";
  h += "<button class=\"btn-bewerk\" onclick=\"openEdit(&#39;" + id + "&#39;)\">&#9998; Gegevens bewerken</button>";
  h += "<button class=\"btn-delete\" id=\"del-" + id + "\" data-id=\"" + id + "\"><div class=\"hold-bar\" id=\"bar-" + id + "\"></div><span>&#128465; Houd in om te verwijderen</span></button>";
  h += "<div class=\"hold-hint\">2 seconden ingedrukt houden</div>";
  h += "</div></div>";
  return h;
}

function selectCard(el) {
  document.querySelectorAll(".card").forEach(function(c) { c.classList.remove("selected"); });
  el.classList.add("selected");
}

function toggleEdit(id) {
  var el = document.getElementById("ea-" + id);
  if (!el) return;
  el.classList.toggle("open");
  if (el.classList.contains("open")) attachHold();
}

// ============================================================
// STATUS (veiligstellen)
// ============================================================
var _statusKeuzeId = null;
var _statusNaamId = null;
var _statusNaamNieuw = null;
function openStatusKeuze(id) {
  _statusKeuzeId = id;
  var item = data.find(function(d) { return d.id === id; });
  if (!item) return;
  var cur = item.status || "";

  // Bouw de 2 knoppen dynamisch — toon altijd de 2 opties die NIET de huidige zijn
  // Als een optie de huidige is, toon hem grijs (uitgeschakeld gevoel) zodat de gebruiker weet wat actief is
  var btns = document.getElementById("statusPopupBtns");
  btns.innerHTML = "";

  // Alle 3 mogelijke statussen — toon enkel de 2 die NIET de huidige zijn
  var alleOpties = [
    { status: "ok",           label: "&#9888; Veiliggesteld", cls: "status-btn-veilig" },
    { status: "losgekoppeld", label: "&#9888; Losgekoppeld",  cls: "status-btn-los"   },
    { status: "",             label: "&#10003; In bedrijf",  cls: "status-btn-vrij"  }
  ];

  alleOpties.filter(function(opt) { return opt.status !== cur; }).forEach(function(opt) {
    var btn = document.createElement("button");
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
  var id = _statusKeuzeId;
  closeStatusKeuze();
  if (!id) return;
  if (newStatus === "") {
    var item = data.find(function(d) { return d.id === id; });
    var kastNaam = item ? (item.code || item.location || "deze kast") : "deze kast";
    if (!confirm("LET OP: Je zet " + kastNaam + " terug naar 'In bedrijf'.\n\nDit betekent dat de kast weer onder spanning kan staan.\n\nWeet je dit zeker?")) return;
  }
  _statusNaamId = id;
  _statusNaamNieuw = newStatus;
  var titelEl = document.getElementById("statusNaamTitel");
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
  setTimeout(function() { var el = document.getElementById("statusNaamInput"); if (el) el.focus(); }, 150);
}
function sluitStatusNaamModal() {
  document.getElementById("statusNaamOverlay").classList.remove("open");
  _statusNaamId = null;
  _statusNaamNieuw = null;
}
function bevestigStatusNaam() {
  var naam = document.getElementById("statusNaamInput").value.trim();
  var datum = document.getElementById("statusDatumInput").value;
  var err = document.getElementById("statusNaamError");
  if (!naam) { err.textContent = "Vul je naam in."; return; }
  if (!datum) { err.textContent = "Vul een datum in."; return; }
  var id = _statusNaamId;
  var newStatus = _statusNaamNieuw;
  sluitStatusNaamModal();
  if (id != null) setStatus(id, newStatus, naam, datum);
}
function formatDatum(raw) {
  if (!raw) return "";
  // ISO formaat: YYYY-MM-DD
  var iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return iso[3] + "-" + iso[2] + "-" + iso[1];
  // Fallback: probeer te parsen als Date (bv. als Google Sheets een datumobject terugstuurt)
  var d = new Date(raw);
  if (!isNaN(d.getTime())) {
    var day = String(d.getDate()).padStart(2, "0");
    var mon = String(d.getMonth() + 1).padStart(2, "0");
    return day + "-" + mon + "-" + d.getFullYear();
  }
  return raw;
}

async function setStatus(id, newStatus, naam, datum) {
  var idx = -1;
  for (var i = 0; i < data.length; i++) {
    if (data[i].id === id) { idx = i; break; }
  }
  if (idx === -1) return;

  var previousItem = Object.assign({}, data[idx]);
  var statusUpdate = { status: newStatus };
  if (newStatus === "") {
    statusUpdate.statusBy = "";
    statusUpdate.statusDate = "";
  } else {
    statusUpdate.statusBy = naam || "";
    statusUpdate.statusDate = datum || "";
  }
  var updatedItem = Object.assign({}, data[idx], statusUpdate);

  // UI meteen updaten — geen wachten op server
  data[idx] = updatedItem;
  saveLocal();
  refreshUI();

  try {
    await sheetAction({ action: "update", data: JSON.stringify(updatedItem) });
    var now = new Date().toLocaleTimeString("nl-NL", {hour:"2-digit", minute:"2-digit"});
    setSyncStatus("ok", "Gesync " + now);
    await syncFromSheets(true);
  } catch(e) {
    // Server faalde — terugdraaien
    data[idx] = previousItem;
    saveLocal();
    refreshUI();
    setSyncStatus("error", "Sync fout");
    showToast("Status niet opgeslagen: " + e.message, true);
    console.warn("setStatus sync:", e);
  }
}

// ============================================================
// LIJST TAB
// ============================================================
function renderList() {
  var rooms = ["all"];
  for (var i = 0; i < data.length; i++) {
    if (data[i].location && rooms.indexOf(data[i].location) === -1) rooms.push(data[i].location);
  }
  rooms.sort(function(a, b) { if (a==="all") return -1; if (b==="all") return 1; return a.localeCompare(b); });
  var fh = "";
  for (var i = 0; i < rooms.length; i++) {
    var r = rooms[i];
    var cnt = r === "all" ? data.length : data.filter(function(d){ return d.location===r; }).length;
    fh += "<span class=\"chip" + (activeRoom===r?" active":"") + "\" onclick=\"setRoom(this,'" + esc(r).replace(/'/g,"\\&#39;") + "')\">" +
          (r==="all" ? "Alle (" + cnt + ")" : esc(r) + " (" + cnt + ")") + "</span>";
  }
  document.getElementById("roomFilter").innerHTML = fh;
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
  var filtered = data.filter(function(d) { return activeRoom === "all" || d.location === activeRoom; });
  filtered.sort(function(a, b) { return (a.code||"").localeCompare(b.code||""); });
  var html = "";
  for (var i = 0; i < filtered.length; i++) html += makeCard(filtered[i]);
  document.getElementById("listResults").innerHTML = html;
  attachHold();
}

// ============================================================
// TOEVOEGEN
// ============================================================
async function addEntry() {
  var code = document.getElementById("newCode").value.trim();
  var loc = document.getElementById("newLocation").value.trim();
  var note = document.getElementById("newNote").value.trim();
  var position = document.getElementById("newPosition").value.trim();
  if (!loc) { showToast("Vul een ruimte in!", true); return; }
  if (!ROOM_INFO.hasOwnProperty(loc)) { showToast("Onbekende ruimte. Kies een ruimte uit de lijst.", true); return; }

  var today = new Date().toLocaleDateString("nl-NL");
  var newItem = {
    id: Date.now() + "-" + Math.random().toString(36).slice(2, 9),
    code: code,
    location: loc,
    position: position,
    note: note,
    status: "",
    added: today,
    addedby: safeGet("ekast-device", "")
  };

  var btnAdd = document.getElementById("btnAdd");
  btnAdd.disabled = true; btnAdd.textContent = "OPSLAAN...";
  setSyncStatus("syncing", "Opslaan...");
  try {
    var result = await sheetAction({ action: "add", data: JSON.stringify(newItem) });
    if (!result) throw new Error("Geen antwoord van server");
    if (result.error) throw new Error(result.error);
    document.getElementById("newCode").value = "";
    document.getElementById("newLocation").value = "";
    document.getElementById("newPosition").value = "";
    document.getElementById("newNote").value = "";
    data.push(newItem);
    saveLocal();
    refreshUI();
    await logAction("Toegevoegd", newItem.code, newItem.location, "Logboek Toevoegingen");
    showToast("Kast toegevoegd!");
    await syncFromSheets(true);
  } catch(e) {
    setSyncStatus("error", "Fout: " + e.message);
    showToast("Fout bij opslaan: " + e.message, true);
    console.error("addEntry sync:", e);
  } finally {
    btnAdd.disabled = false; btnAdd.textContent = "OPSLAAN";
  }
}

// ============================================================
// BEWERKEN
// ============================================================
function openEdit(id) {
  for (var i = 0; i < data.length; i++) {
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
  var id = document.getElementById("editId").value;
  var idx = -1;
  for (var i = 0; i < data.length; i++) {
    if (data[i].id === id) { idx = i; break; }
  }
  if (idx === -1) { closeModal(); return; }

  var newLoc = document.getElementById("editLocation").value.trim();
  if (!newLoc) { showToast("Vul een ruimte in!", true); return; }
  if (!ROOM_INFO.hasOwnProperty(newLoc)) { showToast("Onbekende ruimte. Kies een ruimte uit de lijst.", true); return; }

  var updatedItem = Object.assign({}, data[idx], {
    code:     document.getElementById("editCode").value.trim(),
    location: newLoc,
    position: document.getElementById("editPosition").value.trim(),
    note:     document.getElementById("editNote").value.trim()
  });

  var btnSave = document.getElementById("btnSaveEdit");
  btnSave.disabled = true; btnSave.textContent = "Opslaan...";
  setSyncStatus("syncing", "Opslaan...");
  try {
    var result = await sheetAction({ action: "update", data: JSON.stringify(updatedItem) });
    if (!result) throw new Error("Geen antwoord van server");
    if (result.error) throw new Error(result.error);
    closeModal();
    data[idx] = updatedItem;
    saveLocal();
    refreshUI();
    showToast("Opgeslagen!");
    await syncFromSheets(true);
  } catch(e) {
    setSyncStatus("error", "Fout: " + e.message);
    showToast("Fout: " + e.message, true);
    console.error("saveEdit sync:", e);
  } finally {
    btnSave.disabled = false; btnSave.textContent = "Opslaan";
  }
}

// ============================================================
// VERWIJDEREN
// ============================================================
async function deleteEntry(id) {
  var idx = -1, delCode = "", delLoc = "";
  for (var i = 0; i < data.length; i++) {
    if (data[i].id === id) { idx = i; delCode = data[i].code; delLoc = data[i].location; break; }
  }
  if (idx === -1) return;

  setSyncStatus("syncing", "Verwijderen...");
  try {
    var result = await sheetAction({ action: "delete", id: id });
    if (!result) throw new Error("Geen antwoord van server");
    if (result.error) throw new Error(result.error);
    data.splice(idx, 1);
    saveLocal();
    refreshUI();
    showToast("Verwijderd");
    await syncFromSheets(true);
  } catch(e) {
    setSyncStatus("error", "Fout: " + e.message);
    showToast("Fout bij verwijderen: " + e.message, true);
    console.error("deleteEntry sync:", e);
  }
}

// ============================================================
// HOLD-TO-DELETE
// ============================================================
function attachHold() {
  var btns = document.querySelectorAll(".btn-delete");
  for (var i = 0; i < btns.length; i++) {
    (function(btn) {
      if (btn._att) return; btn._att = true;
      var id = btn.getAttribute("data-id");
      function start(e) {
        e.preventDefault(); btn.classList.add("holding");
        var bar = document.getElementById("bar-" + id);
        if (bar) { bar.style.transition = "width " + HOLD_MS + "ms linear"; bar.style.width = "100%"; }
        holdTimers[id] = setTimeout(function() { deleteEntry(id); }, HOLD_MS);
      }
      function stop() {
        btn.classList.remove("holding");
        var bar = document.getElementById("bar-" + id);
        if (bar) { bar.style.transition = "none"; bar.style.width = "0%"; }
        if (holdTimers[id]) { clearTimeout(holdTimers[id]); delete holdTimers[id]; }
      }
      btn.addEventListener("mousedown", start);
      btn.addEventListener("touchstart", start, {passive:false});
      btn.addEventListener("mouseup", stop);
      btn.addEventListener("mouseleave", stop);
      btn.addEventListener("touchend", stop);
      btn.addEventListener("touchcancel", stop);
    })(btns[i]);
  }
}

// ============================================================
// TOAST
// ============================================================
function showToast(msg, err) {
  var t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "toast show" + (err ? " error" : "");
  setTimeout(function() { t.classList.remove("show"); }, 2500);
}

// ============================================================
// RUIMTE DROPDOWN PICKER
// ============================================================
function toggleRoomDropdown(inputId, dropId) {
  var drop = document.getElementById(dropId);
  if (drop.classList.contains("open")) {
    drop.classList.remove("open");
    return;
  }
  var rooms = Object.keys(ROOM_INFO);
  drop.innerHTML = "";
  rooms.forEach(function(r) {
    var item = document.createElement("div");
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

function saveNewRoom() {
  var name = document.getElementById("newRoomName").value.trim();
  if (!name) { showToast("Geef een naam op voor de ruimte.", true); return; }
  if (ROOM_INFO.hasOwnProperty(name)) { showToast("Deze ruimte bestaat al.", true); return; }
  var desc = document.getElementById("newRoomDesc").value.trim();
  ROOM_INFO[name] = desc;
  try {
    var stored = JSON.parse(localStorage.getItem("ekast-custom-rooms") || "{}");
    stored[name] = desc;
    localStorage.setItem("ekast-custom-rooms", JSON.stringify(stored));
  } catch(e) {}
  var dl = document.getElementById("roomSuggestions");
  if (dl) { var opt = document.createElement("option"); opt.value = name; dl.appendChild(opt); }
  closeAddRoomModal();
  showToast("Ruimte \"" + name + "\" toegevoegd.");
}

// ============================================================
// RUIMTE INFO
// ============================================================
function showRoomInfo(loc) {
  var info = (ROOM_INFO[loc] || "").trim();
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
  var name = safeGet("ekast-device", "Onbekend");
  var uid = safeGet("ekast-device-id", null);
  if (!uid) {
    uid = Math.random().toString(36).slice(2, 6).toUpperCase();
    safeSet("ekast-device-id", uid);
  }
  var device = name + " (" + uid + ")";
  try {
    await sheetAction({ action: "log", logaction: action, code: code||"", location: location||"", device: device, sheet: sheet||"Logboek" });
  } catch(e) {
    console.warn("Log fout:", e);
  }
}

// ============================================================
// PIN BEVEILIGING
// ============================================================
var SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minuten

async function hashPin(pin) {
  var buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pin));
  return Array.from(new Uint8Array(buf)).map(function(b) { return b.toString(16).padStart(2, "0"); }).join("");
}

function checkPin() {
  var device = safeGet("ekast-device", null);
  if (!device) {
    showPinSetup();
    return;
  }
  var lastUnlock = parseInt(safeGet("ekast-unlock", "0"), 10);
  if (Date.now() - lastUnlock < SESSION_TIMEOUT_MS) {
    init();
  } else {
    showPinEnter();
  }
}

function showPinSetup() {
  var ov = document.getElementById("pinOverlay");
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
  var device = document.getElementById("setupDevice").value.trim();
  var pin = document.getElementById("setupPin").value;
  var err = document.getElementById("pinErr");
  if (!device) { err.textContent = "Geef een naam voor dit toestel."; return; }
  var h = await hashPin(pin);
  if (h !== DEVICE_PIN_HASH) { err.textContent = "Onjuiste PIN."; document.getElementById("setupPin").value = ""; return; }
  safeSet("ekast-device", device);
  // Genereer een uniek toestel-ID als die nog niet bestaat
  if (!safeGet("ekast-device-id", null)) {
    var uid = Math.random().toString(36).slice(2, 6).toUpperCase();
    safeSet("ekast-device-id", uid);
  }
  logAction("Registratie", "", "");
  unlockApp();
}

function showPinEnter() {
  var device = safeGet("ekast-device", "Dit toestel");
  var ov = document.getElementById("pinOverlay");
  ov.innerHTML =
    "<div class='pin-title'>E-KAST ZOEKER</div>" +
    "<div class='pin-sub'>" + esc(device) + "<br>Voer je PIN in.</div>" +
    "<input type='password' class='pin-input' id='pinInput' placeholder='••••' maxlength='8' inputmode='numeric' autocomplete='new-password' oninput='verifyPin()'>" +
    "<div class='pin-error' id='pinErr'></div>";
  ov.classList.add("open");
  setTimeout(function() { var el = document.getElementById("pinInput"); if (el) el.focus(); }, 150);
}

var _pinAttempts = 0;
var _pinLockUntil = parseInt(safeGet("ekast-pin-lock", "0"), 10);
var PIN_MAX_ATTEMPTS = 5;
var PIN_LOCKOUT_MS = 5 * 60 * 1000; // 5 minuten

async function verifyPin() {
  var input = document.getElementById("pinInput");
  var errEl = document.getElementById("pinErr");
  if (!input || input._checking) return;

  // Check of account nog geblokkeerd is
  if (_pinLockUntil > Date.now()) {
    var secLeft = Math.ceil((_pinLockUntil - Date.now()) / 1000);
    errEl.textContent = "Geblokkeerd. Wacht " + secLeft + " seconden.";
    input.value = "";
    return;
  }

  if (input.value.length === DEVICE_PIN_LENGTH) {
    input._checking = true;
    input.disabled = true;
    var h = await hashPin(input.value);
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
        var lockInterval = setInterval(function() {
          var left = Math.ceil((_pinLockUntil - Date.now()) / 1000);
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
  // Verleng sessie bij activiteit
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
