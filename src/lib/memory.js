// Memory (spil 4): deck building, grid layout, game state. Pure logic, no DOM.
import { shuffle, hasImage, altFor } from './quiz.js';

export const DIFFICULTY = {
  let: { label: 'Let', pairs: 6, factor: 1, grid: { mobile: [3, 4], tablet: [4, 3], desktop: [4, 3] } },
  mellem: { label: 'Mellem', pairs: 8, factor: 1.5, grid: { mobile: [4, 4], tablet: [4, 4], desktop: [4, 4] } },
  svaer: { label: 'Svær', pairs: 12, factor: 2, grid: { mobile: [4, 6], tablet: [6, 4], desktop: [6, 4] } },
};
/** [columns, rows] for a viewport width (px). Landscape phones use the tablet layout. */
export function gridFor(difficulty, width, landscapePhone = false) {
  const g = DIFFICULTY[difficulty].grid;
  if (landscapePhone) return difficulty === 'svaer' ? [6, 4] : g.tablet;
  return width < 600 ? g.mobile : width < 1024 ? g.tablet : g.desktop;
}
/** Hard does not fit on tiny screens (< 360 × 640) -> suggest Mellem. */
export const tooSmallForHard = (w, h) => w < 360 || h < 640;

/** Memory image: primary if memory_ok, else first memory_ok image; must have neutral alt. */
export function memoryImage(it) {
  const ok = (im) => im && im.memory_ok === true && im.alt_neutral;
  const imgs = it.images || [];
  return ok(imgs[0]) ? imgs[0] : imgs.find(ok) || null;
}
/** Eligible items: verified only; image variant also needs an image with neutral alt text. */
export function eligible(items, variant) {
  return items.filter((i) => !i.needs_review && i.name_la_ta2 && i.name_da
    && (variant !== 'image' || memoryImage(i)));
}
/** Variant availability for a pool: image needs >= pairs eligible items. Text (da ↔ la) is always possible if enough items. */
export function variantsFor(items, pairs) {
  return { text: eligible(items, 'text').length >= pairs, image: eligible(items, 'image').length >= pairs, imageCount: eligible(items, 'image').length };
}
/**
 * Build a deck of 2 × pairs cards.
 * text: card A = Danish name, card B = Latin name. image: card A = image (neutral alt), card B = "Dansk (latin)".
 * Items whose Danish or Latin names collide are skipped so every pair is unambiguous.
 */
export function buildDeck(items, { pairs, variant = 'text' }, rnd = Math.random) {
  const pool = shuffle(eligible(items, variant), rnd);
  const chosen = []; const da = new Set(); const la = new Set(); const groups = new Set();
  for (const it of pool) {
    const d = it.name_da.toLowerCase(); const l = it.name_la_ta2.toLowerCase();
    if (da.has(d) || la.has(l) || d === l || (it.quiz_group && groups.has(it.quiz_group))) continue;
    da.add(d); la.add(l); if (it.quiz_group) groups.add(it.quiz_group); chosen.push(it);
    if (chosen.length === pairs) break;
  }
  if (chosen.length < pairs) return null;
  const cards = [];
  for (const it of chosen) {
    if (variant === 'image') {
      const img = memoryImage(it);
      cards.push({ key: `${it.id}:img`, pair: it.id, kind: 'image', url: img.url, alt: altFor(img, it, 'game') });
      cards.push({ key: `${it.id}:name`, pair: it.id, kind: 'name', da: it.name_da, la: it.name_la_ta2 });
    } else {
      cards.push({ key: `${it.id}:da`, pair: it.id, kind: 'da', da: it.name_da });
      cards.push({ key: `${it.id}:la`, pair: it.id, kind: 'la', la: it.name_la_ta2 });
    }
  }
  return shuffle(cards, rnd).map((c, i) => ({ ...c, index: i, state: 'hidden' }));
}

/** Immutable-ish game reducer. States: hidden → flipped → (compared) → matched | hidden. */
export function newGame(deck) { return { deck, open: [], moves: 0, found: 0, pairs: deck.length / 2, finished: false, log: [] }; }
export function flip(g, index, now = Date.now()) {
  const c = g.deck[index];
  if (!c || g.finished || c.state !== 'hidden' || g.open.length >= 2) return { g, result: 'ignored' };
  const deck = g.deck.map((x) => (x.index === index ? { ...x, state: 'flipped' } : x));
  const open = [...g.open, index];
  if (open.length < 2) return { g: { ...g, deck, open }, result: 'first' };
  const [a, b] = open.map((i) => deck[i]);
  const moves = g.moves + 1;
  if (a.pair === b.pair) {
    const d2 = deck.map((x) => (open.includes(x.index) ? { ...x, state: 'matched' } : x));
    const found = g.found + 1;
    return { g: { ...g, deck: d2, open: [], moves, found, finished: found === g.pairs, log: [...g.log, { pair: a.pair, at: now }] }, result: 'match', pair: a.pair };
  }
  return { g: { ...g, deck, open, moves }, result: 'nomatch' };
}
/** Flip back the two non-matching cards. */
export function flipBack(g) {
  return { ...g, deck: g.deck.map((x) => (g.open.includes(x.index) ? { ...x, state: 'hidden' } : x)), open: [] };
}
export const efficiency = (pairs, moves) => (moves ? Math.round((100 * pairs) / moves) : 0);
