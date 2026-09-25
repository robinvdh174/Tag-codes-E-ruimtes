// Verdeler-overzichten (indelingstekeningen uit Meridian).
// Per verdeler: in welke E-ruimte hij staat en per veld welke uitgangen
// (tag + omschrijving + schemanummer) erin zitten. Velden staan in de
// volgorde van links naar rechts op de tekening.
// Nieuwe verdeler toevoegen: `python3 tools/verdeler_uit_pdf.py <pdf> --ruimte <ruimte>`
// en het resultaat hieronder in de lijst plakken (daarna APP_VERSION bumpen).
// "ruimte" moet exact overeenkomen met de naam van de ruimte in de app.
const VERDELERS = [
  {
    naam: "MCC 21B4", ruimte: "3KV", tekening: "E-070-1595",
    velden: [
      { veld: "+03", uitgangen: [
        { nr: "2", tag: "106A43P4.P1", omschrijving: "VERDUNNINGSWATERPOMP CLEANERS 1E TRAP", schema: "E-070-1597" },
        { nr: "5", tag: "106A43P1.P1", omschrijving: "POMP TOEVOER 2E TRAP OL", schema: "E-070-1598" },
        { nr: "9", tag: "", omschrijving: "Spare DOL 55kW", schema: "E-070-1599" },
        { nr: "13", tag: "106A43P3.P1", omschrijving: "POMP TOEVOER 2E TRAP TL", schema: "E-070-1600" },
        { nr: "17", tag: "106A45P1.P1", omschrijving: "CLEANERPOMP 3E TRAP", schema: "E-070-1601" },
        { nr: "22", tag: "106A43P2.P1", omschrijving: "POMP TOEVOER 2E TRAP ML", schema: "E-070-1611" },
      ] },
      { veld: "+01", uitgangen: [
        { nr: "31", tag: "", omschrijving: "Voeding van HVD 21B", schema: "" },
      ] },
      { veld: "+02", uitgangen: [
        { nr: "31", tag: "106A09P1.M1", omschrijving: "POMP MACHINEKIST 7 OL", schema: "E-070-1596" },
      ] },
      { veld: "+04", uitgangen: [
        { nr: "31", tag: "106A02P1.M1", omschrijving: "POMP MACHINEKIST 2 ML", schema: "E-070-1602" },
      ] },
      { veld: "+06", uitgangen: [
        { nr: "31", tag: "106A09P2.M1", omschrijving: "POMP MACHINEKIST 7 TL", schema: "E-070-1603" },
      ] },
      { veld: "+08", uitgangen: [
        { nr: "31", tag: "106A67P7.M1", omschrijving: "DILUTION POMP", schema: "E-070-1604" },
      ] },
      { veld: "+10", uitgangen: [
        { nr: "31", tag: "106A08P1.M1", omschrijving: "THICK STOCK PUMPS PROPTOREN OL", schema: "E-070-1605" },
      ] },
      { veld: "+12", uitgangen: [
        { nr: "31", tag: "06A10P1.M1", omschrijving: "THICK STOCK PUMPS PROPTOREN ML", schema: "E-070-1606" }, // zo op de tekening; mogelijk 106A10P1.M1
      ] },
      { veld: "+14", uitgangen: [
        { nr: "31", tag: "106A67P8.M1", omschrijving: "POMP GEZUIVERD WITWATER NAAR CSB", schema: "E-070-1607" },
      ] },
      { veld: "+16", uitgangen: [
        { nr: "31", tag: "", omschrijving: "Spare", schema: "E-070-1608" },
      ] },
      { veld: "+18", uitgangen: [
        { nr: "31A", tag: "106A09P3.M1", omschrijving: "POMP CONCENTRATIE MEETLIJN MACHINEKIST 7 OL/TL", schema: "E-070-1609" },
        { nr: "31B", tag: "106A02P2.M1", omschrijving: "POMP CONCENTRATIE MEETLIJN MACHINEKIST 2 ML", schema: "E-070-1610" },
      ] },
    ]
  }
];
