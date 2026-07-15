# Tag-codes E-ruimtes (e-kast-zoeker)

Zoektool voor elektrische kasten/E-ruimtes bij Sappi (PWA:
`index.html` + `app.js`, met Google Apps Script backend in `Code.gs`).

## Geheugen (memory-vault) — verplicht, elke sessie

Dit project gebruikt de privérepo `robinvdh174/memory-vault` als
persistent geheugen van de gebruiker.

**Bij de start van elke sessie:**
1. Voeg `robinvdh174/memory-vault` toe aan deze sessie (add_repo) en
   clone hem.
2. Lees daar `90-meta/memory-index.md`, de dagnotitie van vandaag en de
   projectnotitie van dit project in `20-projecten/`.

**Na elk afgerond stuk werk (automatisch, niet op verzoek):**
- Log beslissingen en open punten in de dagnotitie en de projectnotitie
  van memory-vault, en volg verder alle regels in `CLAUDE.md` van die
  repo (frontmatter, commit-discipline, zelf mergen naar main).

Lukt het toevoegen van memory-vault niet (geen toegang in deze sessie),
meld dat dan expliciet aan de gebruiker in plaats van zonder geheugen
door te werken.
