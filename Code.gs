// ============================================================
// E-KAST ZOEKER — Google Apps Script Backend v3
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

function doGet(e) {
  try {
    if (!e || !e.parameter || e.parameter.token !== "ekast-2025") {
      return makeResponse({ error: "Ongeautoriseerd" });
    }
    var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : "get";
    if (action === "version")  return makeResponse({ version: "v3", ok: true });
    if (action === "get")      return makeResponse(handleGet());
    if (action === "add")      return makeResponse(handleAdd(e.parameter.data));
    if (action === "update")   return makeResponse(handleUpdate(e.parameter.data));
    if (action === "delete")   return makeResponse(handleDelete(e.parameter.id));
    if (action === "log")      return makeResponse(handleLog(e.parameter));
    if (action === "addRoom")      return makeResponse(handleAddRoom(e.parameter.name, e.parameter.desc));
    if (action === "getRooms")     return makeResponse(handleGetRooms());
    if (action === "getBlocklist") return makeResponse(handleGetBlocklist());
    if (action === "blockDevice")  return makeResponse(handleBlockDevice(e.parameter.deviceId, e.parameter.deviceName, e.parameter.blockedBy));
    if (action === "unblockDevice")return makeResponse(handleUnblockDevice(e.parameter.deviceId));
    if (action === "getDevices")   return makeResponse(handleGetDevices());
    return makeResponse({ error: "Onbekende actie: " + action });
  } catch (err) {
    Logger.log("doGet fout: " + err.message);
    return makeResponse({ error: err.message });
  }
}

function doPost(e) {
  // Bulk-overschrijven uitgeschakeld — de app gebruikt enkel de granulaire
  // add/update/delete-acties via doGet. Laat staan om per ongeluk wissen
  // van de hele sheet te voorkomen.
  return makeResponse({ error: "POST disabled" });
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
    return h === "status" ? statusNaarSheet(item[h] || "") : (item[h] || "");
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
      var newRow = HEADERS.map(function(h) {
        return h === "status" ? statusNaarSheet(item[h] || "") : (item[h] || "");
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

function makeResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

