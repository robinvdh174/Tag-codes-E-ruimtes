// Tests voor scan-flow specifieke logic: file-validatie, _scanToken
// cancellation, Tesseract retry-na-failure. Gebruikt mock File-object
// + spy op _showScanError.

const { eq, ok, summary, sliceBlock } = require("./_helpers");

// ---------- Mocks ----------
let _shownErrors = [];
let _shownResults = [];

global.localStorage = {
  _s: {},
  getItem: function(k) { return this._s[k] === undefined ? null : this._s[k]; },
  setItem: function(k, v) { this._s[k] = String(v); },
  removeItem: function(k) { delete this._s[k]; }
};

const _stubElems = {};
global.document = {
  getElementById: function(id) {
    if (!_stubElems[id]) {
      _stubElems[id] = {
        id: id, _value: "", _children: [], style: {},
        get value() { return this._value; },
        set value(v) { this._value = String(v); },
        textContent: "",
        innerText: "",
        classList: { add: function() {}, remove: function() {}, toggle: function() {}, contains: function() { return false; } },
        querySelector: function() { return null; },
        querySelectorAll: function() { return []; },
        appendChild: function() {},
        setAttribute: function() {},
        addEventListener: function() {},
        focus: function() {}, select: function() {},
        getAttribute: function() { return ""; }
      };
    }
    return _stubElems[id];
  },
  createElement: function() {
    return {
      _children: [], textContent: "", className: "", style: {},
      classList: { add: function() {}, remove: function() {}, toggle: function() {} },
      appendChild: function(c) { this._children.push(c); },
      addEventListener: function() {},
      setAttribute: function() {}
    };
  },
  createTextNode: function(t) { return { textContent: t }; },
  head: { appendChild: function() {} }
};

// Teller voor URL.createObjectURL — moet 0 blijven want we geven het
// File-object rechtstreeks aan recognize() door (zie iOS Safari bugfix).
let _objectUrlCount = 0;

// URL als constructor (voor `new URL(path, base)`) MET statische methoden.
global.URL = function URL(path, base) {
  this.href = String(base || "") + String(path || "");
};
global.URL.createObjectURL = function() { _objectUrlCount++; return "blob:mock"; };
global.URL.revokeObjectURL = function() {};

global.setTimeout = function(fn) { try { fn(); } catch (e) {} return 0; };
global.clearTimeout = function() {};
global.console = { warn: function() {}, log: console.log };
// Mock fetch zodat _preflightTesseract gewoon doorloopt (response.ok=true)
global.fetch = function() { return Promise.resolve({ ok: true, status: 200 }); };

// Stubs voor functies waarvan onScanFileChosen afhankelijk is
let _scanErrors = [];
global._showScanError = function(msg) { _scanErrors.push(msg); };
global._showScanResult = function(parsed) { _shownResults.push(parsed); };
global._setScanProgress = function() {};
global._parseBonText = function() { return { tagE: "MOCK", tagM: "", machine: "", omschrijving: "", raw: "" }; };

// Tesseract mock — onScanFileChosen gebruikt nu Tesseract.createWorker
// gevolgd door worker.recognize. We registreren een aanroep-vlag op de
// recognize-call en bieden ook terminate aan. Ook bewaren we het
// argument waarmee recognize() werd aangeroepen, zodat tests kunnen
// verifiëren dat we het File-object rechtstreeks doorgeven (niet een
// blob URL — dat veroorzaakte de iOS Safari "Failed to fetch" bug).
let _tesseractCalled = false;
let _recognizeArg = null;
function _makeWorkerMock() {
  return {
    recognize: function(arg) {
      _tesseractCalled = true;
      _recognizeArg = arg;
      return Promise.resolve({ data: { text: "Tag-code E: MOCK" } });
    },
    terminate: function() { return Promise.resolve(); }
  };
}
global.Tesseract = {
  // Backwards-compat: oudere code-pad met Tesseract.recognize
  recognize: function(arg) {
    _tesseractCalled = true;
    _recognizeArg = arg;
    return Promise.resolve({ data: { text: "Tag-code E: MOCK" } });
  },
  // Nieuwe v5 API
  createWorker: function() {
    return Promise.resolve(_makeWorkerMock());
  }
};

// _loadTesseract zelf test ik niet hier (vereist DOM). Ik mock 'em.
global._loadTesseract = function() { return Promise.resolve(global.Tesseract); };
// Constants die buiten ons slice-block gedefinieerd zijn
global.TESSERACT_VENDOR_DIR = "./vendor/tesseract/";
global.APP_VERSION = "test-version";
// window.location voor absolute URL-construction in onScanFileChosen
global.window = { location: { href: "https://example.test/app/" } };

// Slice de scan-flow code
const block = sliceBlock("// Maximum bestandsgrootte voor een gescande bon", "// Parse de OCR-tekst");
eval(block);

// Helper: maak een mock File
function mockFile(opts) {
  return {
    name: opts.name || "x.jpg",
    type: opts.type === undefined ? "image/jpeg" : opts.type,
    size: opts.size === undefined ? 1024 * 1024 : opts.size
  };
}

function reset() {
  _scanErrors = [];
  _shownResults = [];
  _tesseractCalled = false;
  _recognizeArg = null;
  _objectUrlCount = 0;
}

// ====================================================================
// TESTS
// ====================================================================

// ---------- 1. Geldige image gaat door naar OCR ----------
async function test1() {
  reset();
  const f = mockFile({ type: "image/jpeg", size: 2 * 1024 * 1024 });
  await onScanFileChosen({ target: { files: [f] } });
  eq(_tesseractCalled, true, "Geldige image: OCR wordt aangeroepen");
  eq(_scanErrors.length, 0, "Geldige image: geen errors");
  eq(_shownResults.length, 1, "Geldige image: resultaat getoond");
  // Regression check voor iOS Safari "Failed to fetch" bug:
  // - recognize() krijgt het File-object rechtstreeks (geen blob URL)
  // - URL.createObjectURL is nooit aangeroepen
  eq(_recognizeArg === f, true, "recognize() krijgt File-object direct (geen blob URL)");
  eq(_objectUrlCount, 0, "URL.createObjectURL wordt NIET gebruikt (iOS Safari worker-fetch bug)");
}

// ---------- 2. PDF afgewezen voor OCR-call ----------
async function test2() {
  reset();
  await onScanFileChosen({ target: { files: [mockFile({ type: "application/pdf" })] } });
  eq(_tesseractCalled, false, "PDF: OCR wordt NIET aangeroepen");
  eq(_scanErrors.length, 1, "PDF: error getoond");
  ok(_scanErrors[0].indexOf("afbeelding") !== -1 || _scanErrors[0].indexOf("JPG") !== -1,
     "PDF: errormessage vermeldt 'afbeelding/JPG'");
}

// ---------- 3. Bestand zonder type afgewezen ----------
async function test3() {
  reset();
  await onScanFileChosen({ target: { files: [mockFile({ type: "" })] } });
  eq(_tesseractCalled, false, "Geen type: OCR niet aangeroepen");
  eq(_scanErrors.length, 1, "Geen type: error");
}

// ---------- 4. Te grote foto afgewezen ----------
async function test4() {
  reset();
  await onScanFileChosen({ target: { files: [mockFile({ type: "image/jpeg", size: 20 * 1024 * 1024 })] } });
  eq(_tesseractCalled, false, "20MB: OCR niet aangeroepen");
  eq(_scanErrors.length, 1, "20MB: error");
  ok(_scanErrors[0].indexOf("te groot") !== -1, "20MB: error vermeldt 'te groot'");
  ok(_scanErrors[0].indexOf("20") !== -1, "20MB: error toont actuele grootte");
}

// ---------- 5. Op de grens (15MB) wordt nog geaccepteerd ----------
async function test5() {
  reset();
  await onScanFileChosen({ target: { files: [mockFile({ type: "image/jpeg", size: 15 * 1024 * 1024 })] } });
  eq(_tesseractCalled, true, "15MB precies: OCR wordt aangeroepen");
  eq(_scanErrors.length, 0, "15MB: geen errors");
}

// ---------- 6. Just-over de grens (15MB + 1 byte) wordt afgewezen ----------
async function test6() {
  reset();
  await onScanFileChosen({ target: { files: [mockFile({ type: "image/jpeg", size: 15 * 1024 * 1024 + 1 })] } });
  eq(_tesseractCalled, false, "15MB+1: afgewezen");
  eq(_scanErrors.length, 1, "15MB+1: error");
}

// ---------- 7. Geen file: stilletjes returnen ----------
async function test7() {
  reset();
  await onScanFileChosen({ target: { files: [] } });
  eq(_tesseractCalled, false, "Geen file: niets gebeurt");
  eq(_scanErrors.length, 0, "Geen file: geen error");
  // null event ook
  await onScanFileChosen(null);
  eq(_tesseractCalled, false, "Null event: niets gebeurt");
}

// ---------- 8. _scanToken-cancellation: token mismatch onderdrukt resultaat ----------
async function test8() {
  reset();
  // We starten een scan en hogen handmatig _scanToken op tijdens OCR
  // (simuleert closeScan tijdens lopende worker.recognize). Houder-
  // object om de resolver te bereiken na await-gap.
  const holder = { resolve: null };
  // De createWorker-flow geeft een worker terug met recognize. We
  // overschrijven de worker.recognize zodat we 'm pending kunnen houden.
  global.Tesseract.createWorker = function() {
    return Promise.resolve({
      recognize: function() {
        _tesseractCalled = true;
        return new Promise(function(r) { holder.resolve = r; });
      },
      terminate: function() { return Promise.resolve(); }
    });
  };
  const promise = onScanFileChosen({ target: { files: [mockFile({ type: "image/jpeg" })] } });
  // Twee microtasks wachten: één voor createWorker resolve, één voor de
  // recognize-call die de holder vult.
  await new Promise(function(r) { setImmediate(r); });
  await new Promise(function(r) { setImmediate(r); });
  ok(holder.resolve != null, "worker.recognize is aangeroepen (sanity)");
  // Simuleer closeScan: token++ zodat huidige scan ongeldig is
  _scanToken = 999;
  holder.resolve({ data: { text: "Tag-code E: SHOULDNOTSHOW" } });
  await promise;
  eq(_shownResults.length, 0, "Token-mismatch: resultaat NIET getoond");
}

// ---------- 9. _scanTargetDims: schaalberekening ----------
function test9() {
  let d = _scanTargetDims(4000, 3000);
  eq(d.w, 2000, "4000x3000 landscape: breedte naar 2000");
  eq(d.h, 1500, "4000x3000 landscape: hoogte naar 1500");
  d = _scanTargetDims(3000, 4000);
  eq(d.w, 1500, "3000x4000 portret: breedte naar 1500");
  eq(d.h, 2000, "3000x4000 portret: hoogte naar 2000");
  eq(_scanTargetDims(1600, 1200), null, "Kleine foto: geen schaling nodig");
  eq(_scanTargetDims(2000, 2000), null, "Exact op de grens: geen schaling");
  eq(_scanTargetDims(0, 0), null, "0x0: null");
  eq(_scanTargetDims(undefined, undefined), null, "undefined: null");
}

// Helper: installeer canvas + createImageBitmap mocks voor de
// _prepareScanImage tests. Geeft een restore-functie terug.
function _mockDecodePipeline(bitmapImpl, fakeBlob) {
  const state = { canvas: null, drawArgs: null };
  global.createImageBitmap = bitmapImpl;
  const origCreateElement = global.document.createElement;
  global.document.createElement = function(tag) {
    if (tag === "canvas") {
      state.canvas = {
        width: 0, height: 0,
        getContext: function() {
          return { drawImage: function(src, x, y, w, h) { state.drawArgs = [x, y, w, h]; } };
        },
        toBlob: function(cb) { cb(fakeBlob); }
      };
      return state.canvas;
    }
    return origCreateElement(tag);
  };
  state.restore = function() {
    delete global.createImageBitmap;
    global.document.createElement = origCreateElement;
  };
  return state;
}

// ---------- 10. _prepareScanImage: grote foto wordt verkleind tot blob ----------
async function test10() {
  reset();
  const fakeBlob = { size: 12345, type: "image/jpeg" };
  let closed = false;
  const pipe = _mockDecodePipeline(function() {
    return Promise.resolve({ width: 4000, height: 3000, close: function() { closed = true; } });
  }, fakeBlob);
  const out = await _prepareScanImage(mockFile({ size: 8 * 1024 * 1024 }));
  eq(out === fakeBlob, true, "Grote foto: verkleinde blob teruggegeven");
  eq(pipe.drawArgs && pipe.drawArgs[2], 2000, "Grote foto: getekend op 2000px breed");
  eq(pipe.drawArgs && pipe.drawArgs[3], 1500, "Grote foto: getekend op 1500px hoog");
  eq(closed, true, "Grote foto: ImageBitmap.close() aangeroepen (geheugen)");
  pipe.restore();
}

// ---------- 11. _prepareScanImage: options-bag niet ondersteund → kale retry ----------
async function test11() {
  reset();
  const fakeBlob = { size: 999, type: "image/jpeg" };
  const calls = [];
  const pipe = _mockDecodePipeline(function(f, opts) {
    calls.push(opts);
    if (opts) return Promise.reject(new Error("options niet ondersteund"));
    return Promise.resolve({ width: 1000, height: 800, close: function() {} });
  }, fakeBlob);
  const out = await _prepareScanImage(mockFile({}));
  eq(calls.length, 2, "Options-fout: createImageBitmap kaal opnieuw geprobeerd");
  eq(out === fakeBlob, true, "Options-fout: alsnog her-encodeerde blob terug");
  // Kleine foto wordt niet geschaald maar wél her-encodeerd (EXIF/HEIC)
  eq(pipe.drawArgs && pipe.drawArgs[2], 1000, "Kleine foto: originele breedte behouden");
  pipe.restore();
}

// ---------- 12. _prepareScanImage: geen decode-API's → origineel File terug ----------
async function test12() {
  reset();
  // In Node bestaan createImageBitmap en Image niet — fallback-pad.
  const f = mockFile({});
  const out = await _prepareScanImage(f);
  eq(out === f, true, "Geen decode-API's: origineel File-object terug");
}

// ---------- 13. End-to-end: recognize() krijgt de voorbereide blob ----------
async function test13() {
  reset();
  // test8 heeft Tesseract.createWorker overschreven met een pending mock;
  // herstel de standaard worker-mock.
  global.Tesseract.createWorker = function() { return Promise.resolve(_makeWorkerMock()); };
  const fakeBlob = { size: 555, type: "image/jpeg" };
  const pipe = _mockDecodePipeline(function() {
    return Promise.resolve({ width: 4000, height: 3000, close: function() {} });
  }, fakeBlob);
  await onScanFileChosen({ target: { files: [mockFile({ size: 5 * 1024 * 1024 })] } });
  eq(_tesseractCalled, true, "E2E met voorbewerking: OCR aangeroepen");
  eq(_recognizeArg === fakeBlob, true, "E2E: recognize() krijgt de verkleinde blob");
  eq(_shownResults.length, 1, "E2E: resultaat getoond");
  pipe.restore();
}

// Run alle tests sequentieel
(async function() {
  await test1();
  await test2();
  await test3();
  await test4();
  await test5();
  await test6();
  await test7();
  await test8();
  test9();
  await test10();
  await test11();
  await test12();
  await test13();
  console.log("Scan-flow tests voltooid.");
  summary();
})();
