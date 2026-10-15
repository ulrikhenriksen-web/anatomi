// Highscore helpers shared by UI and tests (server is authoritative for logged-in users).
export const MODE_POINTS = { naming: 5, drill: 10, test: 20, memory: 5 };
export const TIERS = [['Celle', 0], ['Væv', 250], ['Sene', 1000], ['Muskel', 2500], ['Skelet', 5000], ['Prosektor', 10000], ['Anatom', 20000], ['Vesalius', 40000]];
export const CATEGORY_OF_TOPIC = { bones: 'knogler', muscles: 'muskler', tendons: 'sener', ligaments: 'ledbaand' };
export const CATEGORY_LABEL = { alle: 'Alle', knogler: 'Knogler', muskler: 'Muskler', sener: 'Sener', ledbaand: 'Ledbånd' };
export const MODE_LABEL = { alle: 'Alle spil', naming: 'Navngivning', drill: 'Terping', test: 'Test', memory: 'Memory' };
export const PERIOD_LABEL = { week: 'Uge', month: 'Måned', all: 'Altid' };

export function tierFor(points) {
  let cur = TIERS[0]; let next = null;
  TIERS.forEach((t, i) => { if (points >= t[1]) { cur = t; next = TIERS[i + 1] || null; } });
  return { name: cur[0], from: cur[1], next: next ? { name: next[0], from: next[1], to_go: next[1] - points } : null };
}
export const fmt = (n) => Number(n || 0).toLocaleString('da-DK');
export const medal = (rank) => (rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '');

/** Local (guest) points: same per-answer weights, verified items only; no caps (local only, never public). */
export function localPoints(events, itemsById) {
  let p = 0;
  for (const e of events) if (e.correct && itemsById.get(e.item_id) && !itemsById.get(e.item_id).needs_review) p += MODE_POINTS[e.mode] || 0;
  return p;
}
/** Random session id for score submissions. */
export function sessionId(rnd = Math.random) { return `s${Date.now().toString(36)}${Math.floor(rnd() * 1e9).toString(36)}`.slice(0, 40).padEnd(8, '0'); }
