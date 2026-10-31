// Seasonal theme (Halloween). Active 24/10–1/11 inclusive in Europe/Copenhagen time,
// unless disabled by config (halloween_enabled=false) or overridden by ?theme=halloween|none.
export const TZ = 'Europe/Copenhagen';
export function copenhagenMonthDay(date) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, month: 'numeric', day: 'numeric' }).formatToParts(date);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return { month: get('month'), day: get('day') };
}
export function inHalloweenWindow(date = new Date()) {
  const { month, day } = copenhagenMonthDay(date);
  return (month === 10 && day >= 24) || (month === 11 && day === 1);
}
/** override: 'halloween' | 'none' | null (from ?theme=). enabled: config flag (default true). */
export function halloweenActive({ date = new Date(), enabled = true, override = null } = {}) {
  if (override === 'halloween') return true;
  if (override === 'none') return false;
  return enabled !== false && inHalloweenWindow(date);
}
export function themeOverride(loc) {
  const q = new URLSearchParams(loc.search || '');
  const hq = new URLSearchParams((loc.hash || '').split('?')[1] || '');
  const v = q.get('theme') || hq.get('theme');
  return v === 'halloween' || v === 'none' ? v : null;
}
// Decorative markup (inline SVG/CSS only). Mobile hides b4–b6, g2, p2–p3 via CSS.
export const HALLOWEEN_HTML = `<div class="hw-sky"></div><div class="hw-moon"></div><svg class="hw-forest" viewBox="0 0 1440 200" preserveAspectRatio="none"><path fill="#141A2B" d="M0 200V90l40-50 30 40 30-70 30 60 40-60 30 70 40-50 40 60 30-80 40 70 40-40 30 50 40-70 40 60 30-40 40 50 30-80 40 70 40-50 30 60 40-60 40 50 30-70 40 60 30-40 40 50 40-70 30 60 40-50 30 40 40-60 40 70 30-50 40 40V200z"/><path fill="#0A0E18" d="M0 200v-60l30-40 30 50 40-80 30 70 30-40 40 50 40-70 30 60 40-30 30 40 40-60 40 70 30-50 40 40 30-60 40 50 40-30 30 40 40-70 30 60 40-40 40 50 30-60 40 60 30-40 40 30 40-60 30 70 40-40 30 30 40-50 40 60 30-30 40 40V200z"/></svg><div class="hw-fog f1"></div><div class="hw-fog f2"></div><svg class="hw-bat b1" viewBox="0 0 40 16"><path d="M0 6q8-10 16-2q4-6 8 0q8-8 16 2q-10-2-14 6q-2-4-6 0q-4-8-20-6z"/></svg><svg class="hw-bat b2" viewBox="0 0 40 16"><path d="M0 6q8-10 16-2q4-6 8 0q8-8 16 2q-10-2-14 6q-2-4-6 0q-4-8-20-6z"/></svg><svg class="hw-bat b3" viewBox="0 0 40 16"><path d="M0 6q8-10 16-2q4-6 8 0q8-8 16 2q-10-2-14 6q-2-4-6 0q-4-8-20-6z"/></svg><svg class="hw-bat b4" viewBox="0 0 40 16"><path d="M0 6q8-10 16-2q4-6 8 0q8-8 16 2q-10-2-14 6q-2-4-6 0q-4-8-20-6z"/></svg><svg class="hw-bat b5" viewBox="0 0 40 16"><path d="M0 6q8-10 16-2q4-6 8 0q8-8 16 2q-10-2-14 6q-2-4-6 0q-4-8-20-6z"/></svg><svg class="hw-bat b6" viewBox="0 0 40 16"><path d="M0 6q8-10 16-2q4-6 8 0q8-8 16 2q-10-2-14 6q-2-4-6 0q-4-8-20-6z"/></svg><svg class="hw-ghost g1" viewBox="0 0 60 72"><path d="M0 40q0-40 30-40t30 40v30l-10-8-10 8-10-8-10 8-10-8-10 8z"/><circle cx="21" cy="30" r="4" fill="#0B1020"/><circle cx="39" cy="30" r="4" fill="#0B1020"/></svg><svg class="hw-ghost g2" viewBox="0 0 60 72"><path d="M0 40q0-40 30-40t30 40v30l-10-8-10 8-10-8-10 8-10-8-10 8z"/><circle cx="21" cy="30" r="4" fill="#0B1020"/><circle cx="39" cy="30" r="4" fill="#0B1020"/></svg><svg class="hw-pumpkin p1" viewBox="-36 -36 72 64"><rect x="-4" y="-34" width="8" height="12" rx="2" fill="#3A5A2A"/><ellipse rx="34" ry="26" fill="#E8731A"/><g class="hw-face" fill="#FFC857"><path d="M-17-5l8-8 7 8zM17-5l-8-8-7 8zM-15 7q15 11 30 0l-6 7-4-4-5 4-5-4-5 4z"/></g></svg><svg class="hw-pumpkin p2" viewBox="-36 -36 72 64"><rect x="-4" y="-34" width="8" height="12" rx="2" fill="#3A5A2A"/><ellipse rx="34" ry="26" fill="#E8731A"/><g class="hw-face" fill="#FFC857"><path d="M-17-5l8-8 7 8zM17-5l-8-8-7 8zM-15 7q15 11 30 0l-6 7-4-4-5 4-5-4-5 4z"/></g></svg><svg class="hw-pumpkin p3" viewBox="-36 -36 72 64"><rect x="-4" y="-34" width="8" height="12" rx="2" fill="#3A5A2A"/><ellipse rx="34" ry="26" fill="#E8731A"/><g class="hw-face" fill="#FFC857"><path d="M-17-5l8-8 7 8zM17-5l-8-8-7 8zM-15 7q15 11 30 0l-6 7-4-4-5 4-5-4-5 4z"/></g></svg>`;
