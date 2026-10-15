# Highscore backend (no UI yet)

All endpoints need a logged-in session (`kq_session` cookie). State-changing calls need the header `X-KQ: 1`.

## POST api/score.php
Request: `{ "category": "knogler|muskler|sener|ledbaand", "mode": "naming|drill|test|memory", "correct": int, "total": int, "duration_ms": int }`
Response 201: `{ "ok": true, "points": int, "totals": { "category": int, "overall": int } }`
- The server computes the points as `correct × mode weight` (naming 5, drill 10, test 20, memory 5). Any points value sent by the client is ignored.
- Checks: `1 ≤ total ≤ 50`, `0 ≤ correct ≤ total`, all values must be integers, `duration_ms ≥ total × 1200` and ≤ 2 h.
- Rate limits: max 60 submissions per hour and at least 10 s between submissions. A violation returns 429. The limits can be changed with `score_limits` in config.php.
- Errors: 400 `{error:"validation", fields:[...]}`, 401, 403 (missing CSRF header), 405, 429.

## GET api/leaderboard.php?limit=N (1–50, default 10)
```json
{ "opted_in": false, "me": { "display_name": "Ulrik" },
  "categories": { "knogler": { "top": [{ "rank": 1, "display_name": "Ulrik", "score": 200, "is_me": true }], "me": { "rank": 1, "score": 200 }, "participants": 1 },
                  "muskler": {…}, "sener": {…}, "ledbaand": {…}, "overall": {…} } }
```
- Only opted-in users with a score above 0 are included. Opted-out users never appear, not even their names, and the caller's own `me` is `null` while they are opted out.
- Ranking uses standard competition ranking (1, 1, 3). Ties are broken in the order of the earliest update.
- No user IDs or e-mail addresses are returned.

## GET / PUT api/profile.php
GET → `{ "display_name": "Ulrik", "display_name_is_default": true, "highscore_opt_in": false }`
PUT `{ "display_name"?: string|null, "highscore_opt_in"?: bool }`
- `null` or `""` resets the display name to the first name from Google.
- The display name is 2–24 characters: letters (any script), digits, space and `. - _ '`. Repeated whitespace is collapsed to a single space. E-mail addresses and URLs are not allowed.
- **Default: opted out.** A user only appears on leaderboards after enabling it explicitly (pending the UX spec).

## Tables (SQLite, created automatically)
- `user_profile(user_id, display_name, highscore_opt_in DEFAULT 0, updated_at)`
- `score_events(id, user_id, category, mode, correct, total, duration_ms, points, created_at)`: audit log and rate limiting
- `scores(user_id, category, mode, points, sessions, best_pct, updated_at)`, PK `(user_id, category, mode)`. A category score is the sum over its modes, and the overall score is the sum over everything.

## images.json (Research)
`{ "<item id>": { "url": "https://…" | "images/…", "alt": "…", "credit": "…", "license": "…" } }` (an optional `{ "images": {…} }` wrapper is also accepted).
- `scripts/sync-data.sh` copies the file if it exists.
- The build validates it and drops entries with unknown IDs or invalid URLs, with a warning, then writes the rest to `data/knoglequiz.json` as `images`.
- `normalize()` attaches each entry as `item.media_image`. Nothing renders it yet.
