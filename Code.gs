// ============================================================
// E-KAST ZOEKER — Google Apps Script Backend v3
// ============================================================

var SPREADSHEET_ID = "1TZ18nMFeALPOjioHmFnaHFaTWqeRkupZcXbqEygzH5w";
var SHEET_NAME = "Kasten";
var HEADERS = ["id", "code", "location", "note", "position", "status", "added", "addedby", "statusBy", "statusDate", "lastModified", "photo"];

// Locatiefoto's: Drive-map waarin foto's/tekeningen bij kasten worden
// bewaard. De kolom "photo" bevat alleen het Drive-bestand-ID; de foto
// zelf wordt via getPhoto (achter de API-token) geserveerd en staat dus
// niet publiek. Beheer loopt uitsluitend via setPhoto/deletePhoto —
// add/update laten de kolom altijd ongemoeid, zodat oudere app-versies
// die het veld niet kennen een bestaande foto nooit kunnen wissen.
var PHOTO_FOLDER_NAME = "E-Kast Locatiefoto's";
var PHOTO_MAX_BASE64 = 3200000; // ± 2,4 MB binair — de app comprimeert naar veel minder

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
var MUTATING_ACTIONS = { add: 1, update: 1, "delete": 1, log: 1, addRoom: 1, blockDevice: 1, unblockDevice: 1, setPhoto: 1, deletePhoto: 1 };

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
    Logger.log("handleRequest fout: " + err.message);
    return makeResponse({ error: err.message });
  }
}

function dispatch_(action, params) {
  if (action === "version")  return { version: "v3", ok: true };
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
  if (action === "setPhoto")     return handleSetPhoto(params);
  if (action === "getPhoto")     return handleGetPhoto(params.id);
  if (action === "deletePhoto")  return handleDeletePhoto(params.id);
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
  if (!dataParam) throw new Error("Geen data voor add");
  var item = JSON.parse(dataParam);
  var newLM = new Date().toISOString();
  item.lastModified = newLM;
  var sheet = getOrCreateSheet();
  var row = HEADERS.map(function(h) {
    if (h === "status") return statusNaarSheet(item[h] || "");
    if (h === "photo")  return ""; // foto's alleen via setPhoto koppelen
    return item[h] || "";
  });
  sheet.appendRow(row);
  Logger.log("ADD: " + item.code + " toegevoegd");
  return { success: true, action: "add", id: item.id, lastModified: newLM };
}

// ----------------------------------------------------------
// UPDATE: bestaande rij bijwerken op basis van id
// ----------------------------------------------------------
function handleUpdate(dataParam) {
  if (!dataParam) throw new Error("Geen data voor update");
  var item = JSON.parse(dataParam);
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
      // Foto-kolom altijd behouden: die wordt uitsluitend via
      // setPhoto/deletePhoto beheerd. Zo kan een client die het veld
      // niet kent (oudere app-versie) de foto niet per ongeluk wissen.
      var photoCol = headers.indexOf("photo");
      var existingPhoto = photoCol !== -1 ? cellToString(rows[i][photoCol]) : "";
      var newRow = HEADERS.map(function(h) {
        if (h === "status") return statusNaarSheet(item[h] || "");
        if (h === "photo")  return existingPhoto;
        return item[h] || "";
      });
      sheet.getRange(i + 1, 1, 1, HEADERS.length).setValues([newRow]);
      Logger.log("UPDATE: rij " + (i+1) + " bijgewerkt voor " + item.code);
      return { success: true, action: "update", id: item.id, lastModified: newLM };
    }
  }
  throw new Error("ID niet gevonden voor update: " + item.id);
}

// ----------------------------------------------------------
// DELETE: rij verwijderen op basis van id
// ----------------------------------------------------------
function handleDelete(id) {
  if (!id) throw new Error("Geen id voor delete");
  var sheet = getOrCreateSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error("ID niet gevonden voor delete: " + id);
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
  throw new Error("ID niet gevonden voor delete: " + id);
}

// ----------------------------------------------------------
// LOG: actie wegschrijven naar opgegeven tabblad
// Maakt het tabblad automatisch aan als het nog niet bestaat
// ----------------------------------------------------------
function handleLog(params) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  // Apps Script decodeert e.parameter automatisch — geen extra decodeURIComponent nodig.
  var sheetName = params.sheet || "Logboek";
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
    params.logaction || "",
    params.code      || "",
    params.location  || "",
    params.device    || ""
  ]);
  Logger.log("LOG (" + sheetName + "): " + params.logaction + " - " + params.code);
  return { success: true };
}

// ----------------------------------------------------------
// ADD ROOM: nieuwe ruimte opslaan in tabblad "Ruimtes"
// Maakt het tabblad automatisch aan als het nog niet bestaat
// ----------------------------------------------------------
function handleAddRoom(name, desc) {
  if (!name) throw new Error("Geen naam opgegeven");
  // Apps Script decodeert e.parameter automatisch — geen extra decodeURIComponent nodig.
  desc = desc || "";
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
  sheet.appendRow([name, desc]);
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
  if (!deviceId) throw new Error("Geen deviceId opgegeven");
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
  sheet.appendRow([deviceId, deviceName || "", blockedBy || "", date]);
  Logger.log("GEBLOKKEERD: " + deviceId + " (" + deviceName + ") door " + blockedBy);
  return { ok: true };
}

// ----------------------------------------------------------
// UNBLOCKDEVICE: toestel verwijderen uit de blocklist
// ----------------------------------------------------------
function handleUnblockDevice(deviceId) {
  if (!deviceId) throw new Error("Geen deviceId opgegeven");
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

// ----------------------------------------------------------
// LOCATIEFOTO'S — foto of tekening bij een kast, opgeslagen in
// Google Drive. Nog niet zichtbaar in de app; de acties staan
// klaar voor de toekomstige foto-UI.
//
// LET OP: deze functies gebruiken DriveApp. Bij het herdeployen
// vraagt Apps Script daarom eenmalig om extra Drive-toestemming.
// ----------------------------------------------------------

// Drive-map ophalen of aanmaken. Het map-ID wordt gecachet in
// Script Properties (sleutel "PHOTO_FOLDER_ID") zodat we niet bij
// elke upload heel Drive hoeven te doorzoeken.
function getPhotoFolder_() {
  var props = PropertiesService.getScriptProperties();
  var cachedId = props.getProperty("PHOTO_FOLDER_ID");
  if (cachedId) {
    try { return DriveApp.getFolderById(cachedId); } catch (err) {
      // Map verwijderd of ID ongeldig — hieronder opnieuw aanmaken
    }
  }
  var it = DriveApp.getFoldersByName(PHOTO_FOLDER_NAME);
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder(PHOTO_FOLDER_NAME);
  props.setProperty("PHOTO_FOLDER_ID", folder.getId());
  return folder;
}

// Data-URL ("data:image/jpeg;base64,....") ontleden en valideren.
// Alleen jpeg/png/webp; geeft null bij alles wat er niet uitziet
// als een geldige afbeelding.
function parsePhotoDataUrl_(image) {
  if (typeof image !== "string") return null;
  var m = image.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+\/]+={0,2})$/);
  if (!m || m[2].length < 4 || m[2].length % 4 !== 0) return null;
  return { mime: m[1], base64: m[2] };
}

// SETPHOTO: foto uploaden en aan een kast koppelen (vervangt een
// eventuele bestaande foto — één foto per kast).
function handleSetPhoto(params) {
  if (!params.id) throw new Error("Geen id voor setPhoto");
  var parsed = parsePhotoDataUrl_(params.image);
  if (!parsed) throw new Error("Ongeldige afbeelding (verwacht base64 data-URL, jpeg/png/webp)");
  if (parsed.base64.length > PHOTO_MAX_BASE64) throw new Error("Afbeelding te groot (max ±2 MB na compressie)");
  var sheet = getOrCreateSheet();
  var rows = sheet.getDataRange().getValues();
  var headers = rows[0];
  var idCol = headers.indexOf("id");
  var codeCol = headers.indexOf("code");
  var photoCol = headers.indexOf("photo");
  var lmCol = headers.indexOf("lastModified");
  if (photoCol === -1) throw new Error("Kolom 'photo' ontbreekt in de sheet");
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][idCol]) === String(params.id)) {
      var ext = parsed.mime === "image/png" ? "png" : (parsed.mime === "image/webp" ? "webp" : "jpg");
      var stamp = Utilities.formatDate(new Date(), "Europe/Brussels", "yyyyMMdd-HHmmss");
      var fileName = (cellToString(rows[i][codeCol]) || params.id) + "_" + stamp + "." + ext;
      var blob = Utilities.newBlob(Utilities.base64Decode(parsed.base64), parsed.mime, fileName);
      var file = getPhotoFolder_().createFile(blob);
      // Oude foto naar de prullenbak (vervangen, niet stapelen)
      var oldFileId = cellToString(rows[i][photoCol]);
      if (oldFileId) {
        try { DriveApp.getFileById(oldFileId).setTrashed(true); } catch (err) {
          Logger.log("SETPHOTO: oude foto " + oldFileId + " niet gevonden (" + err.message + ")");
        }
      }
      var newLM = new Date().toISOString();
      sheet.getRange(i + 1, photoCol + 1).setValue(file.getId());
      if (lmCol !== -1) sheet.getRange(i + 1, lmCol + 1).setValue(newLM);
      Logger.log("SETPHOTO: " + fileName + " (" + file.getId() + ") gekoppeld aan id=" + params.id);
      return { success: true, action: "setPhoto", id: params.id, photo: file.getId(), lastModified: newLM };
    }
  }
  throw new Error("ID niet gevonden voor setPhoto: " + params.id);
}

// GETPHOTO: foto van een kast ophalen als base64 data-URL. Loopt via
// de API (met token) zodat de Drive-bestanden zelf privé blijven.
function handleGetPhoto(id) {
  if (!id) throw new Error("Geen id voor getPhoto");
  var sheet = getOrCreateSheet();
  var rows = sheet.getDataRange().getValues();
  var headers = rows[0];
  var idCol = headers.indexOf("id");
  var photoCol = headers.indexOf("photo");
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][idCol]) === String(id)) {
      var fileId = photoCol !== -1 ? cellToString(rows[i][photoCol]) : "";
      if (!fileId) return { id: id, photo: "", image: null };
      try {
        var blob = DriveApp.getFileById(fileId).getBlob();
        var mime = blob.getContentType() || "image/jpeg";
        return { id: id, photo: fileId, image: "data:" + mime + ";base64," + Utilities.base64Encode(blob.getBytes()) };
      } catch (err) {
        // Bestand handmatig verwijderd uit Drive — behandelen als "geen foto"
        Logger.log("GETPHOTO: bestand " + fileId + " onbereikbaar (" + err.message + ")");
        return { id: id, photo: "", image: null };
      }
    }
  }
  throw new Error("ID niet gevonden voor getPhoto: " + id);
}

// DELETEPHOTO: foto loskoppelen en naar de Drive-prullenbak.
function handleDeletePhoto(id) {
  if (!id) throw new Error("Geen id voor deletePhoto");
  var sheet = getOrCreateSheet();
  var rows = sheet.getDataRange().getValues();
  var headers = rows[0];
  var idCol = headers.indexOf("id");
  var photoCol = headers.indexOf("photo");
  var lmCol = headers.indexOf("lastModified");
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][idCol]) === String(id)) {
      var fileId = photoCol !== -1 ? cellToString(rows[i][photoCol]) : "";
      if (fileId) {
        try { DriveApp.getFileById(fileId).setTrashed(true); } catch (err) {
          Logger.log("DELETEPHOTO: bestand " + fileId + " niet gevonden (" + err.message + ")");
        }
        var newLM = new Date().toISOString();
        sheet.getRange(i + 1, photoCol + 1).setValue("");
        if (lmCol !== -1) sheet.getRange(i + 1, lmCol + 1).setValue(newLM);
        Logger.log("DELETEPHOTO: foto losgekoppeld van id=" + id);
        return { success: true, action: "deletePhoto", id: id, lastModified: newLM };
      }
      return { success: true, action: "deletePhoto", id: id, existing: false };
    }
  }
  throw new Error("ID niet gevonden voor deletePhoto: " + id);
}

function makeResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

