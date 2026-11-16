// ============================================================
// E-KAST ZOEKER — Google Apps Script Backend v6
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
var MUTATING_ACTIONS = { add: 1, update: 1, "delete": 1, log: 1, addRoom: 1, updateRoom: 1, deleteRoom: 1, blockDevice: 1, unblockDevice: 1 };

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
  if (action === "version")  return { version: "v6", ok: true };
  if (action === "get")      return handleGet();
  if (action === "add")      return handleAdd(params.data);
  if (action === "update")   return handleUpdate(params.data);
  if (action === "delete")   return handleDelete(params.id);
  if (action === "log")      return handleLog(params);
  if (action === "addRoom")      return handleAddRoom(params.name, params.desc);
  if (action === "updateRoom")   return handleUpdateRoom(params.oldName, params.newName, params.desc);
  if (action === "deleteRoom")   return handleDeleteRoom(params.name);
  if (action === "getRooms")     return handleGetRooms();
  if (action === "getBlocklist") return handleGetBlocklist();
  if (action === "blockDevice")  return handleBlockDevice(params.deviceId, params.deviceName, params.blockedBy);
  if (action === "unblockDevice")return handleUnblockDevice(params.deviceId);
  if (action === "getDevices")   return handleGetDevices();
  if (action === "getVerdelers") return handleGetVerdelers();
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
// VERDELERS: indeling van verdelers (uit de indelingstekeningen).
// Staat bewust enkel in de sheet en niet in de app-code: de repo en de
// website zijn openbaar. Eén rij per uitgang; de volgorde van de rijen
// bepaalt de volgorde van de velden in het kastfront (links → rechts).
// ----------------------------------------------------------
var VERDELER_SHEET = "Verdelers";
var VERDELER_HEADERS = ["verdeler", "ruimte", "tekening", "veld", "nr", "tag", "omschrijving", "schema"];

function handleGetVerdelers() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(VERDELER_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(VERDELER_SHEET);
    sheet.appendRow(VERDELER_HEADERS);
    sheet.setFrozenRows(1);
    return [];
  }
  var rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];
  var headers = rows[0].map(function(h) { return String(h).trim().toLowerCase(); });
  var aliases = roomAliases_();
  var result = [];
  for (var i = 1; i < rows.length; i++) {
    var obj = {};
    for (var j = 0; j < VERDELER_HEADERS.length; j++) {
      var col = headers.indexOf(VERDELER_HEADERS[j]);
      obj[VERDELER_HEADERS[j]] = col === -1 ? "" : cellToString(rows[i][col]).trim();
    }
    if (obj.ruimte) obj.ruimte = currentLocation_(obj.ruimte, aliases);
    if (obj.verdeler && obj.veld) result.push(obj);
  }
  return result;
}

// ----------------------------------------------------------
// GET: alle rijen ophalen
// ----------------------------------------------------------
function handleGet() {
  var sheet = getOrCreateSheet();
  var rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];
  var headers = rows[0];
  var aliases = roomAliases_();
  var result = [];
  for (var i = 1; i < rows.length; i++) {
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      var key = headers[j];
      var val = cellToString(rows[i][j]);
      if (key === "status") obj[key] = statusVanSheet(val);
      else if (key === "location") obj[key] = currentLocation_(val, aliases);
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
  // Idempotent: komt dezelfde kast (id) een tweede keer binnen — de app
  // herhaalt een add na een time-out terwijl de eerste poging toch gelukt
  // was — dan geen dubbele rij maken. Een dubbele rij is niet meer weg te
  // krijgen: update en delete raken telkens alleen de eerste.
  var lastRow = sheet.getLastRow();
  if (item.id && lastRow >= 2) {
    var hdrs = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var idCol = hdrs.indexOf("id");
    var lmCol = hdrs.indexOf("lastModified");
    if (idCol !== -1) {
      var idValues = sheet.getRange(2, idCol + 1, lastRow - 1, 1).getValues();
      for (var i = 0; i < idValues.length; i++) {
        if (String(idValues[i][0]) === String(item.id)) {
          var lm = lmCol === -1 ? "" : cellToString(sheet.getRange(i + 2, lmCol + 1).getValue());
          return { success: true, action: "add", id: item.id, lastModified: lm, existing: true };
        }
      }
    }
  }
  var newLM = new Date().toISOString();
  item.lastModified = newLM;
  var row = HEADERS.map(function(h) {
    return h === "status" ? statusNaarSheet(item[h] || "") : (item[h] || "");
  });
  appendTextRow_(sheet, row);
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
            else if (key === "location") serverItem[key] = currentLocation_(val);
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
      writeTextRow_(sheet, i + 1, newRow);
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
  var sheetName = String(params.sheet || "Logboek");
  // Enkel logboek-tabbladen: zonder deze controle kon een log-aanroep rijen
  // toevoegen aan gelijk welk tabblad (bv. "Kasten" of "Geblokkeerd").
  if (!/^Logboek( [A-Za-z]+)?$/.test(sheetName)) sheetName = "Logboek";
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
  appendTextRow_(sheet, [
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
  name = String(name).trim();
  desc = (desc || "").toString();
  var sheet = getOrCreateRoomsSheet_();
  // Controleer of de ruimte al bestaat
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() !== name) continue;
    if (isDeletedRow_(rows[i])) {
      // Eerder verwijderde ruimte opnieuw toegevoegd: rij weer actief maken.
      writeTextRow_(sheet, i + 1, [name, desc, "", ""]);
      return { ok: true, restored: true };
    }
    return { ok: true, existing: true };
  }
  appendTextRow_(sheet, [name, desc, "", ""]);
  Logger.log("Ruimte toegevoegd: " + name);
  return { ok: true };
}

// ----------------------------------------------------------
// UPDATE ROOM: naam en/of beschrijving van een ruimte wijzigen
// (beheerder-actie). Werkt zowel voor custom ruimtes als voor de
// ingebouwde ruimtes: staat de ruimte nog niet in het tabblad
// "Ruimtes", dan wordt er een override-rij toegevoegd. Bij een
// naamswijziging worden ook alle kasten in "Kasten" en alle verdelers
// in "Verdelers" mee hernoemd en worden de oude namen in kolom
// "renamedFrom" bewaard (gescheiden door " | ") zodat elk toestel de
// oude namen lokaal kan opruimen.
// ----------------------------------------------------------
function handleUpdateRoom(oldName, newName, desc) {
  oldName = (oldName || "").toString().trim();
  newName = (newName || "").toString().trim();
  desc = (desc || "").toString();
  if (!oldName) throw new Error("Geen oude naam opgegeven");
  if (!newName) throw new Error("Geen nieuwe naam opgegeven");

  var renamed = (newName !== oldName);
  var sheet = getOrCreateRoomsSheet_();
  var rows = sheet.getDataRange().getValues();

  var oldRow = -1, newRow = -1;
  for (var i = 1; i < rows.length; i++) {
    var nm = String(rows[i][0]).trim();
    if (oldRow === -1 && nm === oldName) oldRow = i;
    if (renamed && newRow === -1 && nm === newName) newRow = i;
  }

  if (renamed && newRow !== -1) {
    if (isDeletedRow_(rows[newRow])) {
      // De nieuwe naam was van een verwijderde ruimte: die markering weg.
      sheet.deleteRow(newRow + 1);
      if (oldRow > newRow) oldRow--;
      rows.splice(newRow, 1);
    } else if (oldRow === -1 && splitNames_(rows[newRow][2]).indexOf(oldName) !== -1) {
      // Deze hernoeming is al uitgevoerd (de app herhaalt een actie na een
      // time-out). Niet weigeren: beschrijving bijwerken en de kasten en
      // verdelers nog eens nalopen.
      sheet.getRange(newRow + 1, 2).setValue(desc);
      var again = renameKastenLocation_(oldName, newName);
      renameVerdelerRuimte_(oldName, newName);
      return { ok: true, renamed: true, kastenRenamed: again, already: true };
    } else {
      // Botsing: nieuwe naam is al in gebruik door een ándere ruimte.
      return { error: "Er bestaat al een ruimte met de naam \"" + newName + "\"." };
    }
  }

  if (oldRow !== -1) {
    var chain = splitNames_(rows[oldRow][2]);
    if (renamed) chain.push(oldName);
    chain = chain.filter(function(n, ix) { return n !== newName && chain.indexOf(n) === ix; });
    writeTextRow_(sheet, oldRow + 1, [newName, desc, chain.join(" | "), ""]);
  } else {
    // Ingebouwde ruimte die nog geen override-rij had.
    appendTextRow_(sheet, [newName, desc, renamed ? oldName : "", ""]);
  }

  // Hernoem alle kasten en verdelers die naar de oude ruimte verwezen.
  var renamedCount = 0;
  if (renamed) {
    renamedCount = renameKastenLocation_(oldName, newName);
    renameVerdelerRuimte_(oldName, newName);
  }

  Logger.log("Ruimte bijgewerkt: \"" + oldName + "\" -> \"" + newName + "\" (" + renamedCount + " kasten hernoemd)");
  return { ok: true, renamed: renamed, kastenRenamed: renamedCount };
}

// ----------------------------------------------------------
// DELETE ROOM: ruimte verwijderen (beheerder-actie). Kan alleen als er
// geen kasten meer in staan. De rij blijft als markering ("deleted")
// in het tabblad staan: zo weten alle toestellen dat de ruimte weg moet,
// ook als het een in de app ingebouwde ruimte is.
// ----------------------------------------------------------
function handleDeleteRoom(name) {
  name = (name || "").toString().trim();
  if (!name) throw new Error("Geen naam opgegeven");
  var n = countKastenInRoom_(name);
  if (n > 0) {
    return { error: "Er " + (n === 1 ? "staat nog 1 kast" : "staan nog " + n + " kasten") + " in \"" + name + "\". Verplaats of verwijder die eerst." };
  }
  var sheet = getOrCreateRoomsSheet_();
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === name) {
      sheet.getRange(i + 1, 4).setValue("ja");
      Logger.log("Ruimte verwijderd: " + name);
      return { ok: true };
    }
  }
  appendTextRow_(sheet, [name, "", "", "ja"]);
  Logger.log("Ruimte verwijderd (ingebouwd): " + name);
  return { ok: true };
}

function isDeletedRow_(row) {
  return String(row[3] || "").trim() !== "";
}

// "A | B" -> ["A", "B"]
function splitNames_(val) {
  return String(val || "").split("|").map(function(n) { return n.trim(); }).filter(function(n) { return n; });
}

// Vergelijkingssleutel voor een ruimtenaam: spaties eromheen, hoofd-/
// kleine letters en de verouderde namen uit LOCATION_RENAMES maken geen
// verschil. Voorheen werd exact vergeleken, waardoor een kast met bv. een
// spatie achter de ruimtenaam bij het hernoemen werd overgeslagen en in
// de app de oude ruimtenaam bleef tonen.
function roomKey_(val) {
  var t = String(val == null ? "" : val).trim();
  return (LOCATION_RENAMES[t] || t).toLowerCase();
}

// Oude ruimtenamen -> huidige naam, uit de kolom "renamedFrom". Een oude
// naam die intussen weer een eigen (actieve) ruimte is, telt niet mee.
function roomAliases_() {
  var map = {};
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName("Ruimtes");
    if (!sheet || sheet.getLastRow() <= 1) return map;
    var rows = sheet.getDataRange().getValues();
    var live = {};
    for (var i = 1; i < rows.length; i++) {
      if (rows[i][0] && !isDeletedRow_(rows[i])) live[roomKey_(rows[i][0])] = true;
    }
    for (var j = 1; j < rows.length; j++) {
      if (!rows[j][0] || isDeletedRow_(rows[j])) continue;
      var cur = String(rows[j][0]).trim();
      splitNames_(rows[j][2]).forEach(function(old) {
        var k = roomKey_(old);
        if (!live[k]) map[k] = cur;
      });
    }
  } catch (err) {
    Logger.log("roomAliases_ fout: " + err.message);
  }
  return map;
}

// Locatie zoals ze in de sheet staat -> huidige ruimtenaam.
function currentLocation_(val, aliases) {
  var t = String(val == null ? "" : val).trim();
  t = LOCATION_RENAMES[t] || t;
  if (!aliases) aliases = roomAliases_();
  return aliases[t.toLowerCase()] || t;
}

function countKastenInRoom_(name) {
  var sheet = getOrCreateSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var locCol = headers.indexOf("location");
  var idCol = headers.indexOf("id");
  if (locCol === -1) return 0;
  var rows = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  var aliases = roomAliases_();
  var key = name.toLowerCase();
  var n = 0;
  for (var i = 0; i < rows.length; i++) {
    if (idCol !== -1 && !rows[i][idCol]) continue;
    if (currentLocation_(rows[i][locCol], aliases).toLowerCase() === key) n++;
  }
  return n;
}

// Werk de kolom "location" in het Kasten-tabblad bij: elke rij die naar
// oldName verwees (zie roomKey_), krijgt newName. Eén batch-lees + -schrijf.
function renameKastenLocation_(oldName, newName) {
  return renameColumn_(getOrCreateSheet(), "location", oldName, newName);
}

// Idem voor de kolom "ruimte" in het tabblad "Verdelers".
function renameVerdelerRuimte_(oldName, newName) {
  var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(VERDELER_SHEET);
  if (!sheet) return 0;
  return renameColumn_(sheet, "ruimte", oldName, newName);
}

function renameColumn_(sheet, header, oldName, newName) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function(h) { return String(h).trim().toLowerCase(); });
  var col = headers.indexOf(header);
  if (col === -1) return 0;
  var range = sheet.getRange(2, col + 1, lastRow - 1, 1);
  var vals = range.getValues();
  var key = roomKey_(oldName);
  var changed = 0;
  for (var i = 0; i < vals.length; i++) {
    if (vals[i][0] !== "" && roomKey_(vals[i][0]) === key && String(vals[i][0]) !== newName) {
      vals[i][0] = newName; changed++;
    }
  }
  if (changed > 0) range.setValues(vals);
  return changed;
}

// Haalt het tabblad "Ruimtes" op of maakt het aan met de kolommen
// name / desc / renamedFrom / deleted. Een ouder tabblad met minder
// kolommen krijgt de ontbrekende koppen erbij.
var ROOM_HEADERS = ["name", "desc", "renamedFrom", "deleted"];
function getOrCreateRoomsSheet_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName("Ruimtes");
  if (!sheet) {
    sheet = ss.insertSheet("Ruimtes");
    sheet.appendRow(ROOM_HEADERS);
    sheet.getRange(1, 1, 1, 4).setFontWeight("bold").setBackground("#f0a500").setFontColor("#000000");
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 200);
    sheet.setColumnWidth(2, 300);
    sheet.setColumnWidth(3, 160);
    sheet.setColumnWidth(4, 90);
    return sheet;
  }
  // Bestaand tabblad: vul ontbrekende kolomkoppen aan.
  for (var c = sheet.getLastColumn(); c < ROOM_HEADERS.length; c++) {
    if (c < 2) continue;
    sheet.getRange(1, c + 1).setValue(ROOM_HEADERS[c]).setFontWeight("bold").setBackground("#f0a500").setFontColor("#000000");
  }
  return sheet;
}

// ----------------------------------------------------------
// GET ROOMS: alle custom ruimtes ophalen uit tabblad "Ruimtes".
// Verwijderde ruimtes komen mee met deleted: true, zodat elk toestel
// ze lokaal kan opruimen.
// ----------------------------------------------------------
function handleGetRooms() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName("Ruimtes");
  if (!sheet || sheet.getLastRow() <= 1) return [];
  var rows = sheet.getDataRange().getValues();
  var result = [];
  for (var i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    var room = {
      name: String(rows[i][0]).trim(),
      desc: String(rows[i][1] || ""),
      renamedFrom: String(rows[i][2] || "").trim()
    };
    if (isDeletedRow_(rows[i])) room.deleted = true;
    result.push(room);
  }
  return result;
}

// ----------------------------------------------------------
// Hulpfuncties
// ----------------------------------------------------------

// Schrijft één rij als PLATTE TEKST. Zonder dit behandelt Sheets wat de app
// stuurt alsof het ingetypt is: "7/5" of "1-2" wordt een datum, "0123" en
// "+12" worden een getal (voorloopnul/plus weg) en tekst die met "=" begint
// wordt een formule die in de sheet wordt uitgevoerd. De cellen krijgen
// eerst de opmaak "platte tekst" (@); een "=" vooraan wordt bovendien
// weggehaald, zodat er in geen geval een formule kan ontstaan.
function textCell_(v) {
  return String(v == null ? "" : v).replace(/^=+/, "");
}
function writeTextRow_(sheet, rowIndex, values) {
  var row = values.map(textCell_);
  sheet.getRange(rowIndex, 1, 1, row.length).setNumberFormat("@").setValues([row]);
}
function appendTextRow_(sheet, values) {
  writeTextRow_(sheet, sheet.getLastRow() + 1, values);
}
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
  appendTextRow_(sheet, [deviceId, deviceName || "", blockedBy || "", date]);
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

