// Tests voor de OCR-bonparser (_parseBonText).
// Simuleert verschillende OCR-output-vormen die we in de praktijk
// kunnen tegenkomen op een Sappi-werkbon.

const { eq, ok, summary, sliceBlock } = require("./_helpers");

const block = sliceBlock("const _BON_LABEL_RE", "function _showScanResult");
eval(block);

// ---------- 1. Realistische bon (zoals gebruiker fotografeerde) ----------
{
  const text = `NIET INSCHAKELEN

machine    stopnr    volgnummer    soort
ER-770-01            2.2           ZEK

Opdrachtgever: G. Heijnen

omschrijving:                        C404 Cos phi kast
Schakel-Info:                        Mespatronen trekken Verdeler 42B
Vergunning nr.                       MA25202
Tag-code M:
Tag-code E:                          C404
Onderdeel:                           Cos phi kasten`;
  const r = _parseBonText(text);
  eq(r.tagE, "C404", "Realistische bon: Tag-code E = C404");
  eq(r.tagM, "", "Realistische bon: Tag-code M leeg (geen carry-over naar E-label)");
  eq(r.omschrijving, "C404 Cos phi kast", "Realistische bon: omschrijving");
  eq(r.machine, "", "Realistische bon: machine niet uit tabel-header");
}

// ---------- 2. Tag-code M ingevuld i.p.v. E ----------
{
  const text = `Tag-code M: M427-60
Tag-code E:
Onderdeel: Mechanisch onderdeel`;
  const r = _parseBonText(text);
  eq(r.tagM, "M427-60", "M ingevuld: tagM gevangen");
  eq(r.tagE, "", "M ingevuld: tagE blijft leeg");
}

// ---------- 3. Beide tag-codes ingevuld ----------
{
  const text = `Tag-code M: M001
Tag-code E: E002`;
  const r = _parseBonText(text);
  eq(r.tagE, "E002", "Beide ingevuld: tagE");
  eq(r.tagM, "M001", "Beide ingevuld: tagM");
}

// ---------- 4. OCR-spatie in code ('C 404' i.p.v. 'C404') ----------
{
  const text = "Tag-code E: C 404\nOnderdeel: x";
  const r = _parseBonText(text);
  eq(r.tagE, "C404", "OCR-spatie tussen letter en cijfer wordt hersteld");
}

// ---------- 5. Code op volgende regel (tabelcel-layout) ----------
{
  const text = "Tag-code E:\n106A88V1.M1\nOnderdeel: Balansventilator";
  const r = _parseBonText(text);
  eq(r.tagE, "106A88V1.M1", "Volgende-regel-fallback: complexe code");
  eq(r.omschrijving, "", "Onderdeel is niet omschrijving");
}

// ---------- 6. M leeg + E op volgende regel mag NIET label pakken ----------
{
  const text = "Tag-code M:\nTag-code E: C404";
  const r = _parseBonText(text);
  eq(r.tagM, "", "M leeg: pakt niet 'Tag' van volgende label-regel");
  eq(r.tagE, "C404", "E correct gepakt na M-label");
}

// ---------- 7. Lege/ongeldige input ----------
{
  const r = _parseBonText("");
  eq(r.tagE, "", "Lege input: tagE leeg");
  eq(r.tagM, "", "Lege input: tagM leeg");

  const r2 = _parseBonText(null);
  eq(r2.tagE, "", "null input: gracefully empty");

  const r3 = _parseBonText("Random tekst zonder labels");
  eq(r3.tagE, "", "Geen labels: alles leeg");
}

// ---------- 8. Edge case: verschillende label-spellingen ----------
{
  const r1 = _parseBonText("Tagcode E: ABC1");
  eq(r1.tagE, "ABC1", "Variant 'Tagcode' (zonder streepje)");

  const r2 = _parseBonText("Tag code E: ABC1");
  eq(r2.tagE, "ABC1", "Variant 'Tag code' (met spatie)");

  const r3 = _parseBonText("TAG-CODE E: ABC1");
  eq(r3.tagE, "ABC1", "Hoofdletters worden geaccepteerd");
}

// ---------- 9. Edge case: tag-code-achtige tekst in andere velden ----------
{
  const text = `omschrijving: motor type X42-00 vervangen
Tag-code E: P200`;
  const r = _parseBonText(text);
  eq(r.tagE, "P200", "Tag-code in omschrijving lekt niet naar tagE");
  eq(r.omschrijving.indexOf("X42") !== -1, true, "Omschrijving bevat X42");
}

// ---------- 10. Edge case: complexe tag-codes met punten en streepjes ----------
{
  const codes = [
    "106F03v1.p1-m1",
    "A04P1.P1-M1",
    "105UIS150M3",
    "F02V1.M1-M1",
    "M462-115",
    "K1134"
  ];
  for (let i = 0; i < codes.length; i++) {
    const r = _parseBonText("Tag-code E: " + codes[i]);
    eq(r.tagE, codes[i], "Complexe code wordt intact gehouden: " + codes[i]);
  }
}

// ---------- 11. Edge case: meerdere whitespace-types ----------
{
  const text = "Tag-code E:\t\tC404";  // tab i.p.v. spatie
  const r = _parseBonText(text);
  eq(r.tagE, "C404", "Tab tussen label en waarde");
}

// ---------- 12. Machine-extractie alleen bij plausibele code ----------
{
  // Header-rij van een tabel — moet NIET als machine gepakt worden
  const r1 = _parseBonText("machine stopnr volgnummer soort");
  eq(r1.machine, "", "Tabel-header niet als machine gepakt");

  // Wel een geldige machine-code op dezelfde regel
  const r2 = _parseBonText("machine: ER-770-01");
  eq(r2.machine, "ER-770-01", "Geldige machine-code op zelfde regel");

  // Single-word zonder separator wordt afgewezen (te dubieus)
  const r3 = _parseBonText("machine: BLABLA");
  eq(r3.machine, "", "Single-word zonder separator afgewezen");
}

// ---------- 13. Robustness: extra spaties en lege regels ----------
{
  const text = `

Tag-code E:    C404


Tag-code M:    M001

`;
  const r = _parseBonText(text);
  eq(r.tagE, "C404", "Extra whitespace gefilterd");
  eq(r.tagM, "M001", "M ook gefilterd");
}

// ---------- 14. Nieuwe lijnen Windows-stijl (\r\n) ----------
{
  const text = "Tag-code E: C404\r\nOnderdeel: x\r\n";
  const r = _parseBonText(text);
  eq(r.tagE, "C404", "Windows line endings (\\r\\n) verwerkt");
}

// ---------- 15. Geen valse match op cijfers in andere woorden ----------
{
  // "code" zonder "tag" ervoor mag niet matchen
  const r = _parseBonText("Postcode: 1234AB");
  eq(r.tagE, "", "'Postcode' niet als tag-code gepakt");
  eq(r.tagM, "", "'Postcode' niet als tag-code gepakt");
}

console.log("Parser-tests voltooid.");
summary();
