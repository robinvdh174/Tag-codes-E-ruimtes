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

## Tests draaien
```bash
node tests/run.js
```
De testsuite valideert de OCR-bonparser en de werkbon-state-logica. Voer hem uit voor je wijzigingen pusht.

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
