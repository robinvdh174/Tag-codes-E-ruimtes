// ============================================================
// E-KAST ZOEKER — Google Apps Script Backend v3
// ============================================================

var SPREADSHEET_ID = "1TZ18nMFeALPOjioHmFnaHFaTWqeRkupZcXbqEygzH5w";
var SHEET_NAME = "Kasten";
var HEADERS = ["id", "code", "location", "note", "position", "status", "added", "addedby", "statusBy", "statusDate"];

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
    if (action === "addRoom")  return makeResponse(handleAddRoom(e.parameter.name, e.parameter.desc));
    if (action === "getRooms") return makeResponse(handleGetRooms());
    return makeResponse({ error: "Onbekende actie: " + action });
  } catch (err) {
    Logger.log("doGet fout: " + err.message);
    return makeResponse({ error: err.message });
  }
}

function doPost(e) {
  try {
    var raw = (e && e.postData) ? e.postData.contents : "";
    if (!raw) throw new Error("Geen data");
    var incoming = JSON.parse(raw);
    if (!Array.isArray(incoming)) throw new Error("Verwacht array");
    writeAllToSheet(incoming);
    return makeResponse({ success: true, count: incoming.length });
  } catch (err) {
    Logger.log("doPost fout: " + err.message);
    return makeResponse({ error: err.message });
  }
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
  var sheet = getOrCreateSheet();
  var row = HEADERS.map(function(h) {
    return h === "status" ? statusNaarSheet(item[h] || "") : (item[h] || "");
  });
  sheet.appendRow(row);
  Logger.log("ADD: " + item.code + " toegevoegd");
  return { success: true, action: "add", id: item.id };
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
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][idCol]) === String(item.id)) {
      var newRow = HEADERS.map(function(h) {
        return h === "status" ? statusNaarSheet(item[h] || "") : (item[h] || "");
      });
      sheet.getRange(i + 1, 1, 1, HEADERS.length).setValues([newRow]);
      Logger.log("UPDATE: rij " + (i+1) + " bijgewerkt voor " + item.code);
      return { success: true, action: "update", id: item.id };
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
  var rows = sheet.getDataRange().getValues();
  var headers = rows[0];
  var idCol = headers.indexOf("id");
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][idCol]) === String(id)) {
      sheet.deleteRow(i + 1);
      Logger.log("DELETE: rij " + (i+1) + " verwijderd, id=" + id);
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
  var sheetName = decodeURIComponent(params.sheet || "Logboek");
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
    decodeURIComponent(params.logaction || ""),
    decodeURIComponent(params.code      || ""),
    decodeURIComponent(params.location  || ""),
    decodeURIComponent(params.device    || "")
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
  name = decodeURIComponent(name);
  desc = decodeURIComponent(desc || "");
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
    var y = val.getFullYear();
    var m = String(val.getMonth() + 1).padStart(2, "0");
    var d = String(val.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }
  return String(val || "");
}

function writeAllToSheet(incoming) {
  var sheet = getOrCreateSheet();
  sheet.clearContents();
  sheet.appendRow(HEADERS);
  var hr = sheet.getRange(1, 1, 1, HEADERS.length);
  hr.setFontWeight("bold"); hr.setBackground("#f0a500"); hr.setFontColor("#000000");
  if (incoming.length > 0) {
    var rows = incoming.map(function(item) {
      return HEADERS.map(function(h) {
        return h === "status" ? statusNaarSheet(item[h] || "") : String(item[h] || "");
      });
    });
    sheet.getRange(2, 1, rows.length, HEADERS.length).setValues(rows);
  }
  sheet.autoResizeColumns(1, HEADERS.length);
  Logger.log("Volledig herschreven: " + incoming.length + " rijen");
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

function makeResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ----------------------------------------------------------
// Testfuncties (uitvoeren via Apps Script editor)
// ----------------------------------------------------------
function testGet() {
  var r = handleGet();
  Logger.log("testGet: " + r.length + " kasten");
}

function testAdd() {
  var item = { id: "test_" + Date.now(), code: "TEST-ADD", location: "Testruimte", note: "testnotitie", position: "", status: "", added: "01-04-2026", addedby: "", statusBy: "", statusDate: "" };
  var r = handleAdd(JSON.stringify(item));
  Logger.log("testAdd: " + JSON.stringify(r));
}

function testDelete() {
  var sheet = getOrCreateSheet();
  var rows = sheet.getDataRange().getValues();
  for (var i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][1]).indexOf("TEST") === 0) {
      var id = String(rows[i][0]);
      Logger.log("testDelete: verwijder " + id);
      handleDelete(id);
      return;
    }
  }
  Logger.log("testDelete: geen TEST rij gevonden");
}

function testLog() {
  var r = handleLog({ logaction: "Toegevoegd", code: "TEST-LOG", location: "Testruimte", device: "GSM Test", sheet: "Logboek%20Toevoegingen" });
  Logger.log("testLog: " + JSON.stringify(r));
}

function testAddRoom() {
  var r = handleAddRoom("Testruimte%20Noord", "gelijkvloers%2C%20links%20van%20de%20ingang");
  Logger.log("testAddRoom: " + JSON.stringify(r));
}

function testGetRooms() {
  var r = handleGetRooms();
  Logger.log("testGetRooms: " + JSON.stringify(r));
}

// Eenmalig uitvoeren vanuit Apps Script editor om locatienamen in de sheet te corrigeren
function migreerLocatieNamen() {
  var sheet = getOrCreateSheet();
  var rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) { Logger.log("Sheet leeg"); return; }
  var headers = rows[0];
  var locCol = headers.indexOf("location");
  if (locCol === -1) { Logger.log("Kolom 'location' niet gevonden"); return; }
  var count = 0;
  for (var i = 1; i < rows.length; i++) {
    var val = String(rows[i][locCol]);
    if (LOCATION_RENAMES[val]) {
      sheet.getRange(i + 1, locCol + 1).setValue(LOCATION_RENAMES[val]);
      count++;
    }
  }
  Logger.log("migreerLocatieNamen: " + count + " rijen bijgewerkt");
}

function dedupliceerSheet() {
  var sheet = getOrCreateSheet();
  var rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) { Logger.log("Sheet leeg"); return; }
  var headers = rows[0];
  var idIndex = headers.indexOf("id");
  var seen = {}, unieke = [headers], dubbels = 0;
  for (var i = 1; i < rows.length; i++) {
    var id = String(rows[i][idIndex]).trim();
    if (!id || seen[id]) { dubbels++; continue; }
    seen[id] = true;
    unieke.push(rows[i]);
  }
  Logger.log(dubbels + " dubbels gevonden, " + (unieke.length - 1) + " uniek");
  sheet.clearContents();
  sheet.getRange(1, 1, unieke.length, headers.length).setValues(unieke);
  var hr = sheet.getRange(1, 1, 1, headers.length);
  hr.setFontWeight("bold"); hr.setBackground("#f0a500"); hr.setFontColor("#000000");
  sheet.autoResizeColumns(1, headers.length);
  Logger.log("Klaar: " + (unieke.length - 1) + " unieke kasten");
}
