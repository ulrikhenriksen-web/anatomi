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
      const imgs = raw.images?.[it.id];
      out.push({ ...rest, topic, needs_review: it.verification === 'needs_review', images: Array.isArray(imgs) ? imgs : [] });
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
    if (item.landmarks?.length || item.landmarks_quiz?.length) add('Landemærker', maskLandmarks(item).join(', '));
  } else {
    add('Udspring', quizField(item, ['origin_da', 'attachment_from_da'], FACETS.udspring.get(item)));
    add('Hæfte', quizField(item, ['insertion_da', 'attachment_da', 'attachment_to_da'], FACETS.haefte.get(item)));
    add('Innervation', FACETS.innervation.get(item));
    add('Funktion', item.function_da);
  }
  add('Kendetegn', item.distinguishing_da);
  add('Region', item.region);
  return parts;
}

// ---- QA: landmarks must not reveal the answer (H3) ----
const GENERIC = new Set(['os', 'ossis', 'ossa', 'musculus', 'musculi', 'tendo', 'ligamentum', 'lig', 'costa', 'processus', 'tuberculum', 'concha', 'nasalis', 'inferior', 'superior', 'longus', 'brevis', 'major', 'minor']);
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/æ/g, 'ae').replace(/ø/g, 'oe').replace(/å/g, 'aa');
const words = (s) => fold(s).split(/[^a-z0-9]+/).filter(Boolean);
function cpLen(a, b) { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; }
/** Does landmark word `w` derive from name word `n` (e.g. hamati ← hamatum, tali ← talus)? */
function sameStem(w, n) {
  if (GENERIC.has(n) || n.length < 4 || w.length < 4) return n === w && !GENERIC.has(n);
  const cp = cpLen(w, n);
  return cp >= 5 || (cp >= 3 && cp >= n.length - 2) || (cp >= 4 && cp >= Math.min(w.length, n.length) - 2) || (cp >= 3 && Math.max(w.length, n.length) <= 5 && cp >= Math.min(w.length, n.length) - 1);
}
const ORDINALS = { i: 'primi', ii: 'secundi', iii: 'tertii', iv: 'quarti', v: 'quinti' };
const lmText = (l) => (l && typeof l === 'object' ? l.la || l.name_la || l.text || l.da || '' : String(l ?? ''));
/** Display text of a landmark in Udforsk (unchanged, accepts strings or {la, reveal, masked_la}). */
export const landmarkLabel = lmText;
/**
 * Quiz-mode landmarks (ux/landmark-reveal-rule.md): per landmark `reveal: none|mask|hide`, optional masked_la/masked_da.
 * Explicit field wins; without it, words echoing the structure's own name are masked as ___ (automatic fallback).
 */
/** Research v0.4 quiz_mask for muscles/tendons: {field: {reveal, masked_da}} – quiz modes only. */
export function quizField(item, fields, value) {
  for (const f of fields) {
    const m = item.quiz_mask?.[f];
    if (m && item[f] && item[f] === value) return m.reveal === 'hide' ? null : m.reveal === 'mask' && m.masked_da ? m.masked_da : value;
  }
  return value;
}
export function maskLandmarks(item) {
  if (Array.isArray(item.landmarks_quiz) && item.landmarks_quiz.length) {
    return item.landmarks_quiz.filter((l) => l.reveal !== 'hide')
      .map((l) => (l.reveal === 'mask' ? l.masked_la || autoMask(item, l.la) : l.la));
  }
  const out = [];
  for (const l of item.landmarks || []) {
    const reveal = l && typeof l === 'object' ? l.reveal : undefined;
    const text = lmText(l);
    if (reveal === 'hide') continue;
    if (reveal === 'none') { out.push(text); continue; }
    if (reveal === 'mask' && l.masked_la) { out.push(l.masked_la); continue; }
    out.push(autoMask(item, text));
  }
  return out;
}
function autoMask(item, text) {
  const nameWords = [item.name_la_ta2, item.name_en].flatMap(words);
  const names = nameWords.filter((n) => !GENERIC.has(n) && !/^\d+$|^[ivx]+$/.test(n));
  const ords = nameWords.filter((n) => ORDINALS[n]).map((n) => ORDINALS[n]);
  return String(text).replace(/[\p{L}]+/gu, (w) => (names.some((n) => sameStem(fold(w), n)) || ords.includes(fold(w)) ? '___' : w));
}
const descKey = (item) => JSON.stringify(describe(item).filter((p) => p.label !== 'Region'));
/** Normalised main nerve (first "n. xxx" without parentheses/segments) for distractor exclusion (H2). */
export function mainNerve(v) { return fold(v).replace(/\(.*?\)/g, ' ').replace(/[^a-z ]+/g, ' ').trim().split(/\s+/).slice(0, 2).join(' '); }

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
  const dk = kind === 'naming' ? descKey(item) : null;
  const same = (o) => !o.needs_review && o.id !== item.id && o.topic === item.topic && getter(o) && getter(o) !== correct &&
    !answersMatch(getter(o), correct, kind === 'naming' ? item : null) &&
    !(item.quiz_group && o.quiz_group === item.quiz_group) && // v0.4: same quiz_group never pitted against each other
    (kind !== 'naming' || descKey(o) !== dk) && // fallback heuristic // K1: never offer a distractor that fits the same description
    (kind !== 'innervation' || mainNerve(getter(o)) !== mainNerve(correct)); // H2: same main nerve = also correct
  // prefer distractors from the same region for difficulty
  const near = shuffle(pool.filter((o) => same(o) && regionsOf(o).some((r) => regionsOf(item).includes(r))), rnd);
  const far = shuffle(pool.filter((o) => same(o)), rnd);
  const opts = [];
  for (const o of [...near, ...far]) {
    const v = getter(o);
    if (!opts.some((x) => answersMatch(x, v))) opts.push(v);
    if (opts.length >= nOptions - 1) break;
  }
  const options = shuffle([correct, ...opts], rnd);
  return {
    itemId: item.id, kind, correct, options,
    prompt: kind === 'naming' ? describe(item) : null,
  };
}

// ---- Answer comparator: synonyms, Latin/Danish abbreviations, accents, case, punctuation, minor typos ----
const ABBR = [[/\bmm\b/g, 'musculi'], [/\bm\b/g, 'musculus'], [/\bnn\b/g, 'nervi'], [/\bn\b/g, 'nervus'], [/\bligg\b/g, 'ligamenta'], [/\blig\b/g, 'ligamentum'], [/\baa\b/g, 'arteriae'], [/\ba\b/g, 'arteria'], [/\bproc\b/g, 'processus'], [/\bv\b/g, 'vena']];
/** Canonical form used for comparisons. */
export function normAnswer(s) {
  let t = ' ' + fold(s).replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
  for (const [re, full] of ABBR) t = t.replace(re, full);
  return t.replace(/\s+/g, ' ').trim();
}
export function levenshtein(a, b, max = Infinity) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let best = i;
    for (let j = 1; j <= b.length; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); best = Math.min(best, cur[j]); }
    if (best > max) return max + 1; prev = cur;
  }
  return prev[b.length];
}
const typoBudget = (s) => (s.length <= 4 ? 0 : s.length <= 8 ? 1 : 2);
/** All accepted names of an item: Danish, Latin, English + optional synonyms/aliases/aka (string or array). */
export function acceptedNames(item) {
  const extra = ['accepted_names', 'synonyms', 'aliases', 'aka', 'alt_names'].flatMap((k) => (Array.isArray(item?.[k]) ? item[k] : item?.[k] ? [item[k]] : []))
    .map((x) => (x && typeof x === 'object' ? x.name : x));
  return [item?.name_da, item?.name_la_ta2, item?.name_en, ...extra].filter((x) => typeof x === 'string' && x.trim());
}
/** Digits must match exactly (Costa 7 ≠ Costa 1, L2-L4 ≠ L2-L3). */
const digits = (s) => (s.match(/\d+/g) || []).join(',');
function eqLoose(a, b) {
  const x = normAnswer(a), y = normAnswer(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (digits(x) !== digits(y)) return false;
  return levenshtein(x, y, 2) <= Math.min(typoBudget(x), typoBudget(y));
}
/** Is `given` an acceptable answer for `correct`? If `item` is given, any of its names/synonyms also count. */
export function answersMatch(given, correct, item = null) {
  if (given == null || correct == null) return false;
  if (given === correct) return true;
  const targets = [correct, ...(item ? acceptedNames(item) : [])];
  // Danish names often carry the Latin in parentheses: "Lyskebåndet (Ligamentum inguinale)"
  const parts = (s) => [s, ...String(s).split(/[()]/).map((p) => p.trim()).filter((p) => p.length > 3)];
  return targets.some((t) => eqLoose(given, t)) || (item ? targets.flatMap(parts).some((t) => eqLoose(given, t)) : false);
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

// ---- Images (images.json v1). First image is primary. ----
/** { image: primary url|null, primary: image|null, images: [], hotspots: [] } */
export function mediaOf(item) {
  const images = Array.isArray(item?.images) ? item.images : [];
  const primary = images[0] || null;
  return { image: primary ? primary.url : null, primary, images, hotspots: primary ? primary.hotspots || [] : [] };
}
export const hasImage = (item) => mediaOf(item).image !== null;
/** Alt text: Udforsk may name the structure; games must use the neutral text. */
export function altFor(img, item, context) {
  if (!img) return '';
  if (context === 'game') return img.alt_neutral || '';
  return img.alt_naming || `Illustration af ${item?.name_da || 'strukturen'}`;
}
export function creditLine(img) {
  return img ? { text: `Kilde: ${img.credit}`, license: img.license, license_url: img.license_url, source_url: img.source_url } : null;
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
