# E-Kast Zoeker — Tag codes / E-ruimtes

Mobiele web-app voor Sappi om elektrische verdeelkasten te zoeken, beheren en de status bij te houden. Synchroniseert met Google Sheets via Google Apps Script.

## Functies
- Kasten zoeken op tagcode, locatie of notitie (genormaliseerd matchen — `C404`, `C-404`, `c 404` vinden allemaal hetzelfde)
- "Bedoelde je…?"-suggesties bij typfouten
- Bon scannen via camera + OCR (Tag-code E/M wordt automatisch gelezen, foto wordt nergens bewaard)
- Werkbon-modus: meerdere bonnen verzamelen, gegroepeerd per ruimte, in één sessie afvinken
- Status bijhouden: In bedrijf / Veiliggesteld / Losgekoppeld
- Offline beschikbaar (PWA met Service Worker)
- Audit-log van alle wijzigingen

## Locatiefoto's (voorbereid, nog geen UI)

Soms is een locatie moeilijk in woorden uit te leggen — een foto (eventueel met een pijl of cirkel erop getekend) zegt meer. De volledige opslaglaag hiervoor is gebouwd en staat klaar; er is bewust nog geen knop of weergave in de app. Zodra de UI gewenst is hoeft alleen nog de interface gebouwd te worden.

**Hoe het werkt:**
- Foto's worden opgeslagen in een Google Drive-map (`E-Kast Locatiefoto's`) van hetzelfde account als de spreadsheet — dus binnen de eigen omgeving, niet bij een externe dienst.
- De kolom `photo` in het tabblad "Kasten" bevat alleen het Drive-bestand-ID. De foto zelf wordt via de API (achter de token) geserveerd; de bestanden staan niet publiek.
- Backend-acties in `Code.gs`: `setPhoto` (upload, vervangt bestaande foto — één foto per kast), `getPhoto` (ophalen als data-URL), `deletePhoto` (naar Drive-prullenbak).
- Klaarstaande functies in `app.js`: `compressPhotoToDataUrl` (verkleint naar max 1280 px JPEG vóór upload), `uploadLocationPhoto`, `fetchLocationPhoto`, `removeLocationPhoto`. Uploads en verwijderingen worden gelogd in "Logboek Bewerkingen".
- Een tekening werkt via hetzelfde kanaal: een canvas (schets of pijl-op-foto) exporteert dezelfde soort data-URL.
- Eerste versie is bewust online-only: geen offline-wachtrij voor foto's. `add`/`update` kunnen de foto-kolom nooit wissen — foto's worden uitsluitend via `setPhoto`/`deletePhoto` beheerd, dus ook oudere app-versies zijn veilig.

**Let op bij herdeployen:** de foto-acties gebruiken `DriveApp`. Bij de eerstvolgende herdeploy van `Code.gs` vraagt Apps Script daarom eenmalig om extra Drive-toestemming.

## Tests draaien
```bash
node tests/run.js
```
De testsuite valideert de OCR-bonparser en de werkbon-state-logica. Voer hem uit voor je wijzigingen pusht. Dezelfde suite draait automatisch via GitHub Actions bij elke push en pull request.

## Backend bijwerken (Code.gs)
Na een wijziging aan `Code.gs` moet het script opnieuw gedeployed worden in de Apps Script-editor (Implementeren → Implementaties beheren → potlood-icoon → Nieuwe versie). De app werkt ook met een oudere deployment: schrijfacties vallen dan automatisch terug op het oude GET-pad, maar de verbeteringen (POST-schrijfacties, script-lock tegen gelijktijdige wijzigingen) zijn pas actief na herdeployen.

De API-token kan geroteerd worden zonder code-wijziging via Apps Script → Projectinstellingen → Scripteigenschappen → sleutel `API_TOKEN` (en dezelfde waarde in `app.js` bovenaan).

## Hoe wijzigingen doorvoeren (git workflow)

Gebruik de onderstaande werkwijze i.p.v. bestanden via de GitHub webinterface te uploaden.

### Eerste keer instellen
```bash
git clone https://github.com/robinvdh174/tag-codes-e-ruimtes.git
cd tag-codes-e-ruimtes
```

### Wijzigingen maken en pushen
```bash
# 1. Zorg dat je de laatste versie hebt
git pull origin main

# 2. Bewerk de bestanden (bijv. index.html)

# 3. Bekijk wat je gewijzigd hebt
git status
git diff

# 4. Stage je wijzigingen
git add index.html

# 5. Maak een commit met een duidelijke omschrijving
git commit -m "Beschrijving van wat je gewijzigd hebt"

# 6. Push naar GitHub
git push origin main
```

### Waarom geen bestanden uploaden via de webinterface?
Het uploaden via GitHub (Delete + Add files via upload) maakt de commit-geschiedenis onleesbaar en maakt het moeilijk om te zien wat er precies gewijzigd is. Door bestanden direct te bewerken en te committen blijft de geschiedenis overzichtelijk.
