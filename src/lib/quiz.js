// Pure logic for Knoglequiz (no DOM). Shared by the browser app and the tests.
export const TOPICS = {
  bones: { label: 'Knogler', singular: 'knogle' },
  muscles: { label: 'Muskler', singular: 'muskel' },
  tendons: { label: 'Sener', singular: 'sene' },
  ligaments: { label: 'Ledbånd', singular: 'ledbånd' },
};

// Default facets (decision): navn, udspring, hæfte, innervation.
export const FACETS = {
  navn: { label: 'Navn', get: (it) => it.name_da },
  udspring: { label: 'Udspring', get: (it) => it.origin_da || it.attachment_from_da || null },
  haefte: { label: 'Hæfte', get: (it) => it.insertion_da || it.attachment_da || it.attachment_to_da || null },
  innervation: {
    label: 'Innervation',
    get: (it) => (it.innervation && it.innervation.nerve)
      ? it.innervation.nerve + (it.innervation.segments && !it.innervation.nerve.includes(it.innervation.segments) ? ` (${it.innervation.segments})` : '')
      : null,
  },
};
export const DEFAULT_FACETS = ['navn', 'udspring', 'haefte', 'innervation'];

/** Normalise research files ({items:[...]}) into one flat list with `topic`. Drops source_check. */
export function normalize(raw) {
  const out = [];
  for (const topic of Object.keys(TOPICS)) {
    const items = raw[topic]?.items || raw[topic] || [];
    for (const it of items) {
      if (!it || !it.id || !it.name_da) continue;
      const { source_check, ...rest } = it; // not shown to students
      const img = raw.images?.[it.id];
      // images.json is loaded but not rendered yet (UI comes with the UX spec). Kept off `image` so mediaOf() stays unchanged.
      out.push({ ...rest, topic, needs_review: it.verification === 'needs_review', ...(img ? { media_image: img } : {}) });
    }
  }
  return out;
}

export function regionsOf(item) {
  return String(item.region || '').split('/').map((s) => s.trim()).filter(Boolean);
}
export function matchesRegion(item, region) {
  return !region || item.region === region || regionsOf(item).includes(region);
}
export function filterItems(items, { topic, region, query, testMode, quizMode } = {}) {
  const q = (query || '').trim().toLowerCase();
  return items.filter((it) =>
    (!topic || it.topic === topic) &&
    matchesRegion(it, region) &&
    (!(testMode || quizMode) || !it.needs_review) && // needs_review excluded from ALL quiz modes; browsable in Udforsk
    (!q || [it.name_da, it.name_la_ta2, it.name_en].some((s) => s && s.toLowerCase().includes(q))));
}

/** Description used by the naming quiz (v1 is text-based; image slot reserved). */
export function describe(item) {
  const parts = [];
  const add = (label, v) => { if (v && String(v).trim()) parts.push({ label, value: String(v) }); };
  if (item.topic === 'bones') {
    add('Type', item.type);
    if (item.count_in_body) add('Antal i kroppen', item.count_in_body);
    if (item.landmarks?.length) add('Landemærker', item.landmarks.join(', '));
  } else {
    add('Udspring', FACETS.udspring.get(item));
    add('Hæfte', FACETS.haefte.get(item));
    add('Innervation', FACETS.innervation.get(item));
    add('Funktion', item.function_da);
  }
  add('Region', item.region);
  return parts;
}

export function shuffle(arr, rnd = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** Facets that make sense for an item. */
export function facetsFor(item, enabled = DEFAULT_FACETS) {
  return enabled.filter((f) => FACETS[f] && FACETS[f].get(item));
}

/**
 * Build a multiple-choice question.
 * kind 'naming': prompt = description, answer = name.
 * kind = facet key: prompt = name, answer = that facet's value.
 */
export function makeQuestion(item, kind, pool, rnd = Math.random, nOptions = 4) {
  const getter = kind === 'naming' ? FACETS.navn.get : FACETS[kind].get;
  const correct = getter(item);
  if (!correct) return null;
  const same = (o) => !o.needs_review && o.id !== item.id && o.topic === item.topic && getter(o) && getter(o) !== correct;
  // prefer distractors from the same region for difficulty
  const near = shuffle(pool.filter((o) => same(o) && regionsOf(o).some((r) => regionsOf(item).includes(r))), rnd);
  const far = shuffle(pool.filter((o) => same(o)), rnd);
  const opts = [];
  for (const o of [...near, ...far]) {
    const v = getter(o);
    if (!opts.includes(v)) opts.push(v);
    if (opts.length >= nOptions - 1) break;
  }
  const options = shuffle([correct, ...opts], rnd);
  return {
    itemId: item.id, kind, correct, options,
    prompt: kind === 'naming' ? describe(item) : null,
  };
}

// ---- Spaced repetition (SM-2, per item+facet) ----
export function sm2(state, correct, now = Date.now()) {
  const s = { ef: 2.5, reps: 0, interval: 0, streak: 0, days: [], ...(state || {}) };
  const day = new Date(now).toISOString().slice(0, 10);
  if (correct) {
    s.reps += 1;
    s.interval = s.reps === 1 ? 1 : s.reps === 2 ? 6 : Math.round(s.interval * s.ef);
    s.ef = Math.max(1.3, s.ef + 0.1);
    s.streak += 1;
    if (!s.days.includes(day)) s.days = [...s.days, day].slice(-5);
  } else {
    s.reps = 0; s.interval = 0; s.streak = 0; s.days = [];
    s.ef = Math.max(1.3, s.ef - 0.2);
  }
  s.due = now + s.interval * 86400000;
  s.last = now;
  return s;
}
/** Mastered: interval >= 7 d and >= 3 correct in a row on >= 2 different days. */
export function isMastered(s) {
  return !!s && s.interval >= 7 && s.streak >= 3 && (s.days || []).length >= 2;
}
export function isDue(s, now = Date.now()) { return !s || s.due <= now; }
export const key = (itemId, facet) => `${itemId}::${facet}`;

/** Pick the next cards for a drill session: due/new first, then soonest. */
export function pickDrill(itemsIn, progress, facets, n = 10, now = Date.now(), rnd = Math.random) {
  const items = itemsIn.filter((i) => !i.needs_review);
  const cards = [];
  for (const it of items) for (const f of facetsFor(it, facets)) cards.push({ item: it, facet: f, s: progress[key(it.id, f)] });
  const due = shuffle(cards.filter((c) => c.s && isDue(c.s, now)), rnd);
  const fresh = shuffle(cards.filter((c) => !c.s), rnd);
  const later = cards.filter((c) => c.s && !isDue(c.s, now)).sort((a, b) => a.s.due - b.s.due);
  return [...due, ...fresh, ...later].slice(0, n);
}

export function scoreXp(correct, kind) { return correct ? (kind === 'naming' ? 5 : 10) : 1; }

export function updateStreak(meta, now = Date.now()) {
  const today = new Date(now).toISOString().slice(0, 10);
  const yest = new Date(now - 86400000).toISOString().slice(0, 10);
  const m = { streak: 0, lastDay: null, xp: 0, ...(meta || {}) };
  if (m.lastDay === today) return m;
  m.streak = m.lastDay === yest ? m.streak + 1 : 1;
  m.lastDay = today;
  return m;
}

/** Validate a report payload (mirrors api/report.php). */
export function validateReport(r) {
  const errors = [];
  if (!r || typeof r.item_id !== 'string' || !/^[a-z0-9_]{1,120}$/.test(r.item_id)) errors.push('item_id');
  if (!r || typeof r.message !== 'string' || r.message.trim().length < 3 || r.message.length > 2000) errors.push('message');
  if (r && r.field != null && (typeof r.field !== 'string' || r.field.length > 60)) errors.push('field');
  return errors;
}

// ---- v2 image hotspots (schema reserved, no feature yet) ----
/** Normalised media: { image: url|null, hotspots: [{id, item_id, x, y, r}] } with x/y/r in 0..1. */
export function mediaOf(item) {
  const hs = Array.isArray(item?.hotspots) ? item.hotspots : [];
  const ok = (n) => typeof n === 'number' && n >= 0 && n <= 1;
  return {
    image: typeof item?.image === 'string' && /^(https:\/\/|\/|[\w-]+\/)/.test(item.image) ? item.image : null,
    hotspots: hs.filter((h) => h && typeof h.item_id === 'string' && ok(h.x) && ok(h.y)).map((h, i) => ({ id: h.id || `h${i}`, item_id: h.item_id, x: h.x, y: h.y, r: ok(h.r) ? h.r : 0.04 })),
  };
}

// ---- Server sync: merge progress (per card: newest `last` wins) ----
export function mergeProgress(a = {}, b = {}) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) if (!out[k] || (v && (v.last || 0) > (out[k].last || 0))) out[k] = v;
  return out;
}
export function mergeMeta(a = {}, b = {}) {
  a = a || {}; b = b || {};
  const newer = (a.lastDay || '') >= (b.lastDay || '') ? a : b;
  const tests = [...(a.tests || []), ...(b.tests || [])];
  const seen = new Set();
  return {
    xp: Math.max(a.xp || 0, b.xp || 0),
    streak: newer.streak || 0,
    lastDay: newer.lastDay || null,
    tests: tests.filter((t) => t && !seen.has(t.at) && seen.add(t.at)).sort((x, y) => x.at - y.at).slice(-20),
  };
}
