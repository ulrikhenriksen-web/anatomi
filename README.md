# Knoglequiz

Anatomiquiz for fysioterapeutstuderende: knogler, muskler, sener og ledbånd.
Statisk frontend (vanilla JS-moduler, ingen build-afhængigheder) + lille PHP-endpoint til "Rapportér fejl".

## Funktioner (v1)
- **Udforsk**: emne → region (sammensatte regioner som "ryg/skulder" matcher begge) → søg → detaljekort med kilder.
- **Navngivning**: beskrivelsesbaseret (udspring/hæfte/innervation/funktion eller landemærker). Layoutet har en billedplads (`item.image`), som aktiveres, når data får billeder.
- **Terping**: SM-2 pr. facet. Standardfacetter: navn, udspring, hæfte, innervation (kan ændres under Træn).
- **Test**: kun mestret materiale (eller øvetest på alt verificeret). Timer 45 s / 90 s / uden tid.
- **`needs_review`**: synlige i Udforsk, men uden for **alle** quizzer (Navngivning, Terping, Test) indtil de er verificeret.
- **Hotspots (v2-reservation)**: datafelter `image` + `hotspots[{item_id,x,y,r}]` (0–1) og UI-pladsholder; ingen klik-feature endnu.
- Mestret = interval ≥ 7 d + 3 rigtige i træk på ≥ 2 dage. Streak, XP, fejlanalyse.
- **Login**: Google Sign-In (GIS ID-token, verificeret server-side). Fremskridt pr. bruger i SQLite; `localStorage` som offline-cache. Første login fletter eksisterende lokalt fremskridt én gang. Uden `google_client_id` kører appen i gæstetilstand. Session: HttpOnly `SameSite=Lax`-cookie.
- Eksport i Profil.
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
2. Læg `api/config.php` (se `api/config.sample.php`) på serveren. SQLite-filen ligger under `_data/` (deny-all via `.htaccess`).
3. Google Cloud (kun hvis login skal slåes til):
   - Opret et OAuth 2.0 **Web application**-client i Google Cloud Console (APIs & Services → Credentials).
   - **Authorized JavaScript origins**: `https://knoglequiz.emiltram.dk` (og `http://localhost:8080` til lokal udvikling).
   - **Authorized redirect URIs**: ikke nødvendige for GIS ID-token / popup-flow (lad dem være tomme, medmindre du tilføjer et redirect-flow senere).
   - Sæt `google_client_id` i `api/config.php` til client ID'et (`….apps.googleusercontent.com`). Tom = gæstetilstand.
   - Domænebekræftelse / OAuth-consent: sæt appen til *External* (eller *Internal* hvis Workspace-only), tilføj scopes `openid email profile`, tilføj dig selv som testbruger mens status er *Testing*.
4. `SIMPLY_FTP_HOST=… SIMPLY_FTP_USER=… SIMPLY_FTP_PASSWORD=… SIMPLY_REMOTE_DIR=… npm run deploy` (FTPS via lftp, `DRY_RUN=1` for prøvekørsel).
