# Knoglequiz

Anatomiquiz for fysioterapeutstuderende: knogler, muskler, sener og ledbånd.
Statisk frontend (vanilla JS-moduler, ingen build-afhængigheder) + lille PHP-endpoint til "Rapportér fejl".

## Funktioner (v1)
- **Udforsk**: emne → region (sammensatte regioner som "ryg/skulder" matcher begge) → søg → detaljekort med kilder.
- **Navngivning**: beskrivelsesbaseret (udspring/hæfte/innervation/funktion eller landemærker). Layoutet har en billedplads (`item.image`), som aktiveres, når data får billeder.
- **Terping**: SM-2 pr. facet. Standardfacetter: navn, udspring, hæfte, innervation (kan ændres under Træn).
- **Test**: kun mestret materiale (eller øvetest på alt verificeret); `needs_review` er altid udelukket. Timer 45 s / 90 s / uden tid.
- Mestret = interval ≥ 7 d + 3 rigtige i træk på ≥ 2 dage. Streak, XP, fejlanalyse.
- Fremskridt i `localStorage` (login senere). Eksport i Profil.
- `needs_review` markeres diskret (lilla "i") med forklaring.
- **Rapportér fejl** → `api/report.php` → MySQL (via `api/config.php`) eller SQLite uden for webroden. Offline-kø i browseren.
- Lyst/mørkt tema (følger system, kan vælges), reduceret bevægelse, tastaturgenveje 1–4, WCAG 2.2 AA-hensyn.

## Kør lokalt
```bash
npm run sync-data     # kopiér nyeste research-JSON til data/research
npm test              # node:test (+ PHP-endpoint-test hvis php findes)
npm run build         # -> dist/
cd dist && php -S localhost:8080
```

## Deploy (Simply.com)
1. Opret subdomænet `knoglequiz.emiltram.dk` i Simply-kontrolpanelet (peger på en mappe), aktivér Let's Encrypt SSL.
2. (Valgfrit) opret MySQL-database; læg `api/config.php` (se `api/config.sample.php`) på serveren.
3. `SIMPLY_FTP_HOST=… SIMPLY_FTP_USER=… SIMPLY_FTP_PASSWORD=… SIMPLY_REMOTE_DIR=… npm run deploy` (FTPS via lftp, `DRY_RUN=1` for prøvekørsel).
