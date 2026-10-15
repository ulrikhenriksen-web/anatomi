# Highscore, Memory and images (v2)

All highscore endpoints require a logged-in session (`kq_session` cookie). State-changing calls also need the header `X-KQ: 1`.

## POST api/score.php — answer events (the client never sends points)
```json
{ "session_id": "s…", "mode": "naming|drill|test|memory", "timer": 45,
  "events": [{ "item_id": "muscle_x", "facet": "naming|navn|udspring|haefte|innervation|pair", "answer": "…", "ts": 1760000000000, "ms": 2300 }],
  "memory": { "difficulty": "let|mellem|svaer", "pairs": 6, "moves": 9, "seconds": 40 } }
```
→ 201 `{ ok, counted, points, rejected:[{i, reason}], reasons:[…], totals:{all_time, today}, tier:{name, from, next:{name, from, to_go}|null} }`
- **Points:** 5 per correct answer in naming, 10 in drill, 20 in test and 5 per pair found in memory. The server checks every answer against `data/knoglequiz.json`, and only `verified` items earn points.
- **Daily caps (Copenhagen day):** naming 100 answers, drill 150 answers, memory 5 games. A test only earns points the first time a given question set is completed.
- **Plausibility:** nothing in a submission counts, and the user is flagged for review, if it contains a future timestamp (more than 2 min ahead), more than 2 answers under 400 ms, or comes while more than 3 other sessions were active in the last 15 min. Events older than 7 days are dropped, as are duplicates. Limit: 120 submissions per hour and 60 events per submission.
- **Rejection reasons per event:** `unknown_item`, `facet`, `not_verified`, `too_old`, `duplicate`, `incorrect`, `daily_cap`.

## GET api/leaderboard.php?period=week|month|all&category=alle|knogler|muskler|sener|ledbaand&mode=alle|naming|drill|test|memory&limit=1..100
→ `{ period, category, mode, profile:{display_name, highscore_opt_in}, all_time_points, tier, top:[{rank, display_name, initial, tier, points, is_me}], me:{rank, points, public, to_next:{rank, points}|null}|null, participants }`
- **Who is listed:** only users who are opted in, not hidden by an admin, and have chosen a display name. Nobody else's name is ever returned. No IDs, e-mail addresses or pictures are returned.
- **Ranks:** standard competition ranking (1, 1, 3), with ties ordered by who reached the score first. Weeks run Monday–Sunday in Danish time, and months are calendar months.
- **Your own position:** `me` is always calculated. If you are not public, it is your hypothetical position ("din plads, hvis du var med").
- **Tier:** based on all-time points. Celle 0 · Væv 250 · Sene 1 000 · Muskel 2 500 · Skelet 5 000 · Prosektor 10 000 · Anatom 20 000 · Vesalius 40 000.

## GET/PUT api/profile.php
GET → `{ display_name|null, suggested_display_name|null, highscore_opt_in, name_change_allowed_from|null }`
PUT `{ display_name?, highscore_opt_in? }`
- **Display name:** 3–20 characters, unique regardless of case, with a filter for offensive words, e-mail addresses and URLs. It can be changed at most once per 30 days.
- **Opt-in:** `highscore_opt_in: true` requires a chosen display name, otherwise the response is 409 `display_name_required`. The default is **off**.
- **Errors:** 400 `{reason: too_short|too_long|chars|contact_info|not_allowed}`, 409 `display_name_taken`, 429 `name_change_too_soon`.

## DELETE api/account.php
Deletes the user together with their sessions, progress, profile and points. Reports are not linked to users.

## Data minimisation (migration in `kq_migrate`, runs automatically)
- `users.picture`, `reports.ip_hash` and `reports.user_agent` are dropped. On SQLite older than 3.35 they are set to NULL instead.
- Report rate limiting is ephemeral: APCu, or else a temporary file in the system temp directory keyed by an HMAC with a daily-rotating salt. Nothing about the client is stored with the report.

## images.json (Research), schema v1
```json
{ "schema_version": 1, "images": { "bone_femur": [ { "id": "femur-ant", "url": "https://…", "width": 800, "height": 500,
  "credit": "…", "license": "CC BY-SA 4.0", "license_url": "https://…", "source_url": "https://…",
  "alt_naming": "Lårben (femur) set forfra", "alt_neutral": "Lang knogle i låret, set forfra",
  "view": "anterior", "side": "dexter", "hotspots": [{ "item_id": "…", "x": 0.4, "y": 0.2, "r": 0.04 }] } ] } }
```
- **Required fields:** `id`, `url` (`https://` or `images/…`), `credit`, `license`, `source_url` (`https://`), `alt_naming` and `alt_neutral`.
- **Which image is used:** the first image is the primary.
- **Alt texts:** `alt_naming` is used in Udforsk. `alt_neutral` is used in quizzes and Memory, because it must not name the structure.
- **When images are missing:** image features are hidden, and Memory offers only the text variant (Danish ↔ Latin).
