// ============================================================
// E-KAST ZOEKER — Google Apps Script Backend v4
// ============================================================

var SPREADSHEET_ID = "1TZ18nMFeALPOjioHmFnaHFaTWqeRkupZcXbqEygzH5w";
var SHEET_NAME = "Kasten";
var HEADERS = ["id", "code", "location", "note", "position", "status", "added", "addedby", "statusBy", "statusDate", "lastModified"];

// Hernoem verouderde locatienamen bij het ophalen uit de sheet
var LOCATION_RENAMES = { "Omvormerruimte": "OMVR B.", "Walsen Loods": "W.L. Oud" };

// Vertaling status: app-waarde → leesbare naam voor de sheet
function statusNaarSheet(val) {
  if (val === "ok")           return "Veiliggesteld";
  if (val === "losgekoppeld") return "Losgekoppeld";
  return "In bedrijf";
}

// Vertaling status: leesbare naam uit sheet → app-waarde
function statusVanSheet(val) {
  if (val === "Veiliggesteld") return "ok";
  if (val === "Losgekoppeld")  return "losgekoppeld";
  if (val === "In bedrijf")    return "";
  // Oudere rijen die nog de ruwe waarde hebben
  if (val === "ok")            return "ok";
  if (val === "losgekoppeld")  return "losgekoppeld";
  return "";
}

// Token bij voorkeur uit Script Properties (Project-instellingen →
// Scripteigenschappen → sleutel "API_TOKEN"). Zo kun je de token roteren
// zonder code-wijziging. Fallback op de oude hardcoded waarde zodat een
// bestaande deployment blijft werken tot de property is ingesteld.
function getApiToken_() {
  try {
    var t = PropertiesService.getScriptProperties().getProperty("API_TOKEN");
    if (t) return t;
  } catch (err) {}
  return "ekast-2025";
}

// Acties die de sheet wijzigen. Deze draaien onder een script-lock zodat
// twee toestellen die tegelijk schrijven elkaars rijen niet kunnen
// verschuiven (deleteRow op een verschoven index = verkeerde rij weg).
var MUTATING_ACTIONS = { add: 1, update: 1, "delete": 1, log: 1, addRoom: 1, blockDevice: 1, unblockDevice: 1 };

// Logboek-tabbladen die de client mag aanspreken. Al het andere valt terug
// op "Logboek" — anders kan iedereen met de token onbeperkt tabbladen
// aanmaken in de spreadsheet.
var LOG_SHEETS = {
  "Logboek": 1,
  "Logboek Aanmeldingen": 1,
  "Logboek Toevoegingen": 1,
  "Logboek Status": 1,
  "Logboek Bewerkingen": 1,
  "Logboek Verwijderingen": 1
};

// Maximale veldlengtes server-side (iets ruimer dan de maxlength-attributen
// in de app). Te lange waarden worden afgekapt i.p.v. geweigerd: een harde
// fout zou offline-queue-entries van legitieme gebruikers permanent laten
// mislukken.
var FIELD_MAX = { id: 80, code: 60, location: 60, note: 600, position: 120, added: 40, addedby: 120, statusBy: 120, statusDate: 40, lastModified: 40 };
var VALID_STATUS = { "": 1, "ok": 1, "losgekoppeld": 1 };

// Bewust gegooide fouten waarvan de tekst veilig naar de client mag.
// Onverwachte fouten (Apps Script-internals) kunnen gevoelige details
// bevatten zoals het spreadsheet-ID — die blijven in de serverlog en de
// client krijgt een generieke melding (zie handleRequest_).
function appError_(msg) {
  var e = new Error(msg);
  e.isAppError = true;
  return e;
}

// Sheets interpreteert celwaarden die met "=" beginnen (en bij handmatige
// invoer ook "+" of "@") als formule. Een leidende apostrof dwingt tekst af;
// Sheets toont en retourneert de waarde daarna zonder de apostrof. Alleen
// toepassen op het moment van wegschrijven, zodat vergelijkingen met
// teruggelezen waarden blijven kloppen.
function sanitizeCell_(val) {
  var s = String(val == null ? "" : val);
  return /^[=+@]/.test(s) ? "'" + s : s;
}

// Valideert het JSON-object van een add/update: verplicht id, status uit de
// vaste lijst, veldlengtes afgekapt op FIELD_MAX.
function validateItem_(dataParam, actionName) {
  if (!dataParam) throw appError_("Geen data voor " + actionName);
  var item;
  try {
    item = JSON.parse(dataParam);
  } catch (err) {
    throw appError_("Ongeldige data voor " + actionName);
  }
  if (!item || typeof item !== "object" || !item.id) throw appError_("Ontbrekend id voor " + actionName);
  if (!VALID_STATUS.hasOwnProperty(String(item.status || ""))) throw appError_("Ongeldige status voor " + actionName);
  Object.keys(FIELD_MAX).forEach(function(h) {
    if (item[h] == null) return;
    item[h] = String(item[h]).slice(0, FIELD_MAX[h]);
  });
  return item;
}

function handleRequest_(params) {
  try {
    if (!params || params.token !== getApiToken_()) {
      return makeResponse({ error: "Ongeautoriseerd" });
    }
    var action = params.action || "get";
    if (MUTATING_ACTIONS[action]) {
      var lock = LockService.getScriptLock();
      try {
        lock.waitLock(20000);
      } catch (lockErr) {
        return makeResponse({ error: "Server bezet, probeer opnieuw" });
      }
      try {
        return makeResponse(dispatch_(action, params));
      } finally {
        lock.releaseLock();
      }
    }
    return makeResponse(dispatch_(action, params));
  } catch (err) {
    Logger.log("handleRequest fout: " + err.message + (err.stack ? "\n" + err.stack : ""));
    return makeResponse({ error: err.isAppError ? err.message : "Serverfout, probeer het opnieuw" });
  }
}

function dispatch_(action, params) {
  if (action === "version")  return { version: "v4", ok: true };
  if (action === "get")      return handleGet();
  if (action === "add")      return handleAdd(params.data);
  if (action === "update")   return handleUpdate(params.data);
  if (action === "delete")   return handleDelete(params.id);
  if (action === "log")      return handleLog(params);
  if (action === "addRoom")      return handleAddRoom(params.name, params.desc);
  if (action === "getRooms")     return handleGetRooms();
  if (action === "getBlocklist") return handleGetBlocklist();
  if (action === "blockDevice")  return handleBlockDevice(params.deviceId, params.deviceName, params.blockedBy);
  if (action === "unblockDevice")return handleUnblockDevice(params.deviceId);
  if (action === "getDevices")   return handleGetDevices();
  return { error: "Onbekende actie: " + action };
}

function doGet(e) {
  return handleRequest_(e && e.parameter ? e.parameter : null);
}

// POST met Content-Type text/plain (geen CORS-preflight nodig). De body is
// een JSON-object met dezelfde velden als de GET-querystring. Schrijfacties
// horen via POST: GET-requests kunnen door proxies/prefetchers herhaald
// worden en lopen tegen URL-lengtelimieten aan.
function doPost(e) {
  var params = null;
  try {
    if (e && e.postData && e.postData.contents) {
      params = JSON.parse(e.postData.contents);
    }
  } catch (err) {
    return makeResponse({ error: "Ongeldige POST-body" });
  }
  // Bulk-overschrijven bestaat bewust niet — enkel de granulaire acties
  // hierboven, zodat de hele sheet nooit in één call gewist kan worden.
  return handleRequest_(params);
}

// ----------------------------------------------------------
// GET: alle rijen ophalen
// ----------------------------------------------------------
function handleGet() {
  var sheet = getOrCreateSheet();
  var rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];
  var headers = rows[0];
  var result = [];
  for (var i = 1; i < rows.length; i++) {
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      var key = headers[j];
      var val = cellToString(rows[i][j]);
      if (key === "status") obj[key] = statusVanSheet(val);
      else if (key === "location") obj[key] = LOCATION_RENAMES[val] || val;
      else obj[key] = val;
    }
    if (obj.id) result.push(obj);
  }
  return result;
}

// ----------------------------------------------------------
// ADD: één nieuwe rij toevoegen
// ----------------------------------------------------------
function handleAdd(dataParam) {
  var item = validateItem_(dataParam, "add");
  var newLM = new Date().toISOString();
  item.lastModified = newLM;
  var sheet = getOrCreateSheet();
  var row = HEADERS.map(function(h) {
    return h === "status" ? statusNaarSheet(item[h] || "") : sanitizeCell_(item[h] || "");
  });
  sheet.appendRow(row);
  Logger.log("ADD: " + item.code + " toegevoegd");
  return { success: true, action: "add", id: item.id, lastModified: newLM };
}

// ----------------------------------------------------------
// UPDATE: bestaande rij bijwerken op basis van id
// ----------------------------------------------------------
function handleUpdate(dataParam) {
  var item = validateItem_(dataParam, "update");
  var sheet = getOrCreateSheet();
  var rows = sheet.getDataRange().getValues();
  var headers = rows[0];
  var idCol = headers.indexOf("id");
  var lmCol = headers.indexOf("lastModified");
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][idCol]) === String(item.id)) {
      // Conflictdetectie: als client een expectedLastModified meestuurt,
      // vergelijk met de huidige waarde in de sheet.
      if (item.expectedLastModified && lmCol !== -1) {
        var serverLM = cellToString(rows[i][lmCol]);
        if (serverLM && serverLM !== item.expectedLastModified) {
          var serverItem = {};
          for (var j = 0; j < headers.length; j++) {
            var key = headers[j];
            var val = cellToString(rows[i][j]);
            if (key === "status") serverItem[key] = statusVanSheet(val);
            else if (key === "location") serverItem[key] = LOCATION_RENAMES[val] || val;
            else serverItem[key] = val;
          }
          Logger.log("CONFLICT: rij " + (i+1) + " voor " + item.code + " (verwacht: " + item.expectedLastModified + ", server: " + serverLM + ")");
          return { conflict: true, serverItem: serverItem, message: "Record is gewijzigd door een ander toestel" };
        }
      }
      var newLM = new Date().toISOString();
      item.lastModified = newLM;
      delete item.expectedLastModified;
      var newRow = HEADERS.map(function(h) {
        return h === "status" ? statusNaarSheet(item[h] || "") : sanitizeCell_(item[h] || "");
      });
      sheet.getRange(i + 1, 1, 1, HEADERS.length).setValues([newRow]);
      Logger.log("UPDATE: rij " + (i+1) + " bijgewerkt voor " + item.code);
      return { success: true, action: "update", id: item.id, lastModified: newLM };
    }
  }
  throw appError_("ID niet gevonden voor update: " + item.id);
}

// ----------------------------------------------------------
// DELETE: rij verwijderen op basis van id
// ----------------------------------------------------------
function handleDelete(id) {
  if (!id) throw appError_("Geen id voor delete");
  var sheet = getOrCreateSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) throw appError_("ID niet gevonden voor delete: " + id);
  // Lees alleen de id-kolom (1 kolom) i.p.v. alle data — scheelt ~12× API-werk.
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var idCol = headers.indexOf("id");
  var idValues = sheet.getRange(2, idCol + 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < idValues.length; i++) {
    if (String(idValues[i][0]) === String(id)) {
      sheet.deleteRow(i + 2);
      Logger.log("DELETE: rij " + (i+2) + " verwijderd, id=" + id);
      return { success: true, action: "delete", id: id };
    }
  }
  throw appError_("ID niet gevonden voor delete: " + id);
}

// ----------------------------------------------------------
// LOG: actie wegschrijven naar opgegeven tabblad
// Maakt het tabblad automatisch aan als het nog niet bestaat
// ----------------------------------------------------------
function handleLog(params) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  // Apps Script decodeert e.parameter automatisch — geen extra decodeURIComponent nodig.
  // Alleen tabbladen uit de whitelist; onbekende namen vallen terug op "Logboek".
  var sheetName = LOG_SHEETS.hasOwnProperty(String(params.sheet || "")) ? params.sheet : "Logboek";
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(["Tijdstip", "Actie", "Code", "Ruimte", "Apparaat"]);
    sheet.getRange(1, 1, 1, 5).setFontWeight("bold").setBackground("#f0a500").setFontColor("#000000");
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 150);
    sheet.setColumnWidth(2, 130);
    sheet.setColumnWidth(3, 130);
    sheet.setColumnWidth(4, 160);
    sheet.setColumnWidth(5, 140);
  }
  var timestamp = Utilities.formatDate(new Date(), "Europe/Brussels", "dd-MM-yyyy HH:mm:ss");
  sheet.appendRow([
    timestamp,
    sanitizeCell_(String(params.logaction || "").slice(0, 60)),
    sanitizeCell_(String(params.code      || "").slice(0, 60)),
    sanitizeCell_(String(params.location  || "").slice(0, 60)),
    sanitizeCell_(String(params.device    || "").slice(0, 120))
  ]);
  Logger.log("LOG (" + sheetName + "): " + params.logaction + " - " + params.code);
  return { success: true };
}

// ----------------------------------------------------------
// ADD ROOM: nieuwe ruimte opslaan in tabblad "Ruimtes"
// Maakt het tabblad automatisch aan als het nog niet bestaat
// ----------------------------------------------------------
function handleAddRoom(name, desc) {
  if (!name) throw appError_("Geen naam opgegeven");
  // Apps Script decodeert e.parameter automatisch — geen extra decodeURIComponent nodig.
  name = String(name).slice(0, 60);
  desc = String(desc || "").slice(0, 120);
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName("Ruimtes");
  if (!sheet) {
    sheet = ss.insertSheet("Ruimtes");
    sheet.appendRow(["name", "desc"]);
    sheet.getRange(1, 1, 1, 2).setFontWeight("bold").setBackground("#f0a500").setFontColor("#000000");
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 200);
    sheet.setColumnWidth(2, 300);
  }
  // Controleer of de ruimte al bestaat
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] === name) return { ok: true, existing: true };
  }
  sheet.appendRow([sanitizeCell_(name), sanitizeCell_(desc)]);
  Logger.log("Ruimte toegevoegd: " + name);
  return { ok: true };
}

// ----------------------------------------------------------
// GET ROOMS: alle custom ruimtes ophalen uit tabblad "Ruimtes"
// ----------------------------------------------------------
function handleGetRooms() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName("Ruimtes");
  if (!sheet || sheet.getLastRow() <= 1) return [];
  var rows = sheet.getDataRange().getValues();
  var result = [];
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0]) result.push({ name: String(rows[i][0]), desc: String(rows[i][1] || "") });
  }
  return result;
}

// ----------------------------------------------------------
// Hulpfuncties
// ----------------------------------------------------------
function cellToString(val) {
  if (val instanceof Date) {
    // Datum mét tijd (bijv. lastModified opgeslagen als ISO-timestamp en later
    // door Sheets als Date geïnterpreteerd) → volledige ISO terugsturen, anders
    // zou de conflictdetectie systematisch falen wanneer een gebruiker per
    // ongeluk de kolom als datum formatteert.
    if (val.getHours() !== 0 || val.getMinutes() !== 0 || val.getSeconds() !== 0 || val.getMilliseconds() !== 0) {
      return val.toISOString();
    }
    var y = val.getFullYear();
    var m = String(val.getMonth() + 1).padStart(2, "0");
    var d = String(val.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }
  return String(val || "");
}

function getOrCreateSheet() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    var hr = sheet.getRange(1, 1, 1, HEADERS.length);
    hr.setFontWeight("bold"); hr.setBackground("#f0a500"); hr.setFontColor("#000000");
  } else {
    var existingHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var updated = false;
    for (var i = 0; i < HEADERS.length; i++) {
      if (existingHeaders.indexOf(HEADERS[i]) === -1) {
        sheet.getRange(1, i + 1).setValue(HEADERS[i]);
        sheet.getRange(1, i + 1).setFontWeight("bold").setBackground("#f0a500").setFontColor("#000000");
        updated = true;
      }
    }
    if (updated) Logger.log("Header-rij bijgewerkt met nieuwe kolommen");
  }
  return sheet;
}

// ----------------------------------------------------------
// GETBLOCKLIST: geblokkeerde toestel-ID's ophalen
// ----------------------------------------------------------
function handleGetBlocklist() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName("Geblokkeerd");
  if (!sheet || sheet.getLastRow() <= 1) return [];
  var idValues = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  var result = [];
  for (var i = 0; i < idValues.length; i++) {
    if (idValues[i][0]) result.push(String(idValues[i][0]));
  }
  return result;
}

// ----------------------------------------------------------
// BLOCKDEVICE: toestel toevoegen aan de blocklist
// ----------------------------------------------------------
function handleBlockDevice(deviceId, deviceName, blockedBy) {
  if (!deviceId) throw appError_("Geen deviceId opgegeven");
  deviceId = String(deviceId).slice(0, 40);
  deviceName = String(deviceName || "").slice(0, 120);
  blockedBy = String(blockedBy || "").slice(0, 120);
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName("Geblokkeerd");
  if (!sheet) {
    sheet = ss.insertSheet("Geblokkeerd");
    sheet.appendRow(["deviceId", "deviceName", "blockedBy", "date"]);
    sheet.getRange(1, 1, 1, 4).setFontWeight("bold").setBackground("#d32f2f").setFontColor("#ffffff");
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 120);
    sheet.setColumnWidth(2, 180);
    sheet.setColumnWidth(3, 160);
    sheet.setColumnWidth(4, 160);
  }
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(deviceId)) return { ok: true, existing: true };
  }
  var date = Utilities.formatDate(new Date(), "Europe/Brussels", "dd-MM-yyyy HH:mm:ss");
  sheet.appendRow([sanitizeCell_(deviceId), sanitizeCell_(deviceName), sanitizeCell_(blockedBy), date]);
  Logger.log("GEBLOKKEERD: " + deviceId + " (" + deviceName + ") door " + blockedBy);
  return { ok: true };
}

// ----------------------------------------------------------
// UNBLOCKDEVICE: toestel verwijderen uit de blocklist
// ----------------------------------------------------------
function handleUnblockDevice(deviceId) {
  if (!deviceId) throw appError_("Geen deviceId opgegeven");
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName("Geblokkeerd");
  if (!sheet || sheet.getLastRow() <= 1) return { ok: true };
  var idValues = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < idValues.length; i++) {
    if (String(idValues[i][0]) === String(deviceId)) {
      sheet.deleteRow(i + 2);
      Logger.log("GEDEBLOKKEERD: " + deviceId);
      return { ok: true };
    }
  }
  return { ok: true };
}

// ----------------------------------------------------------
// GETDEVICES: unieke toestellen ophalen uit aanmeldingslogboek
// ----------------------------------------------------------
function handleGetDevices() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName("Logboek Aanmeldingen");
  if (!sheet || sheet.getLastRow() <= 1) return [];
  var rows = sheet.getDataRange().getValues();
  var seen = {};
  var result = [];
  for (var i = rows.length - 1; i >= 1; i--) {
    var deviceStr = String(rows[i][4] || "");
    if (!deviceStr) continue;
    var match = deviceStr.match(/^(.+)\s+\(([A-F0-9]{8})\)$/i);
    if (!match) continue;
    var name = match[1].trim();
    var id = match[2].toUpperCase();
    if (!seen[id]) {
      seen[id] = true;
      result.push({ deviceId: id, deviceName: name, lastSeen: String(rows[i][0] || "") });
    }
  }
  return result;
}

function makeResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

