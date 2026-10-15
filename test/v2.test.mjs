import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeImages } from '../src/lib/images.js';
import * as Q from '../src/lib/quiz.js';
import * as M from '../src/lib/memory.js';
import * as H from '../src/lib/highscore.js';
import { buildData } from '../scripts/build.mjs';

const items = Q.normalize(await buildData(new URL('../data/research', import.meta.url).pathname));
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const img = (o = {}) => ({ id: 'i1', url: 'https://upload.wikimedia.org/a.png', credit: 'Gray 1918', license: 'Public domain', source_url: 'https://commons.wikimedia.org/x', alt_naming: 'Lårben (femur) forfra', alt_neutral: 'Lang knogle i låret, set forfra', ...o });

test('images.json v1: schema, required fields, URLs, primary first, hotspots', () => {
  const ids = new Set(['bone_femur', 'bone_tibia']);
  const { images, rejected } = normalizeImages({ schema_version: 1, images: {
    bone_femur: [img({ hotspots: [{ item_id: 'bone_tibia', x: 0.4, y: 0.5 }, { item_id: 'ghost', x: 0.1, y: 0.1 }, { item_id: 'bone_tibia', x: 3, y: 0 }], view: 'anterior', width: 800, height: 500 }), img({ id: 'i2', url: 'images/femur-post.webp' }), img({ id: 'i3', alt_neutral: '' }), img({ id: 'i4', url: 'javascript:alert(1)' }), img({ id: 'i1' })],
    bone_tibia: [img({ source_url: 'http://insecure' })], ghost: [img()], 'Bad Id': [img()],
  } }, ids);
  assert.deepEqual(images.bone_femur.map((i) => i.id), ['i1', 'i2']);
  assert.equal(images.bone_femur[0].hotspots.length, 1); assert.equal(images.bone_femur[0].hotspots[0].r, 0.04);
  assert.equal(images.bone_femur[0].view, 'anterior'); assert.equal(images.bone_femur[0].width, 800);
  assert.ok(!images.bone_tibia);
  const why = rejected.map((r) => r.why).join('|');
  for (const w of ['missing alt_neutral', 'url must be', 'duplicate image id', 'source_url must be https', 'unknown item id', 'bad item id']) assert.ok(why.includes(w), w);
  assert.equal(normalizeImages({ images: {} }).rejected[0].id, '*', 'schema_version required');
  assert.deepEqual(normalizeImages(null).images, {});
});
test('normalize attaches images; mediaOf/altFor/hasImage; graceful without images', () => {
  const its = Q.normalize({ bones: { items: [{ id: 'bone_femur', name_da: 'Lårben', name_la_ta2: 'Femur', verification: 'verified' }, { id: 'bone_x', name_da: 'X', verification: 'verified' }] }, images: { bone_femur: [img()] } });
  assert.equal(Q.hasImage(its[0]), true); assert.equal(Q.hasImage(its[1]), false);
  assert.deepEqual(Q.mediaOf(its[1]), { image: null, primary: null, images: [], hotspots: [] });
  assert.equal(Q.altFor(its[0].images[0], its[0], 'game'), 'Lang knogle i låret, set forfra');
  assert.equal(Q.altFor(its[0].images[0], its[0], 'explore'), 'Lårben (femur) forfra');
  assert.equal(Q.altFor({ ...img(), alt_naming: '' }, its[0], 'explore'), 'Illustration af Lårben');
  assert.ok(items.every((i) => Array.isArray(i.images)));
});
test('memory: pairs per difficulty and grid per breakpoint', () => {
  assert.deepEqual(Object.values(M.DIFFICULTY).map((d) => d.pairs), [6, 8, 12]);
  assert.deepEqual(M.gridFor('let', 375), [3, 4]); assert.deepEqual(M.gridFor('let', 700), [4, 3]); assert.deepEqual(M.gridFor('let', 1200), [4, 3]);
  assert.deepEqual(M.gridFor('mellem', 375), [4, 4]); assert.deepEqual(M.gridFor('svaer', 375), [4, 6]); assert.deepEqual(M.gridFor('svaer', 800), [6, 4]);
  assert.deepEqual(M.gridFor('let', 700, true), [4, 3]); assert.deepEqual(M.gridFor('svaer', 700, true), [6, 4]);
  for (const d of Object.keys(M.DIFFICULTY)) { const [c, r] = M.gridFor(d, 375); assert.equal(c * r, M.DIFFICULTY[d].pairs * 2); }
  assert.equal(M.tooSmallForHard(340, 600), true); assert.equal(M.tooSmallForHard(390, 844), false);
});
test('memory: text deck excludes needs_review, unambiguous pairs; image variant unavailable without images', () => {
  const deck = M.buildDeck(items, { pairs: 12, variant: 'text' }, rnd);
  assert.equal(deck.length, 24);
  const ids = new Set(deck.map((c) => c.pair));
  assert.equal(ids.size, 12);
  assert.ok([...ids].every((id) => !items.find((i) => i.id === id).needs_review));
  assert.equal(new Set(deck.map((c) => (c.da || c.la).toLowerCase())).size, 24);
  assert.equal(M.variantsFor(items, 6).image, false);
  assert.equal(M.buildDeck(items, { pairs: 6, variant: 'image' }, rnd), null);
  const withImg = items.slice(0, 30).map((i) => ({ ...i, images: [img({ id: i.id })] }));
  const ideck = M.buildDeck(withImg, { pairs: 6, variant: 'image' }, rnd);
  assert.ok(ideck.filter((c) => c.kind === 'image').every((c) => c.alt === 'Lang knogle i låret, set forfra'));
});
test('memory: game flow — flip, match, no match, flip back, moves, finish', () => {
  const deck = M.buildDeck(items, { pairs: 6, variant: 'text' }, rnd);
  let g = M.newGame(deck);
  const byPair = {}; deck.forEach((c) => (byPair[c.pair] ||= []).push(c.index));
  const pairs = Object.values(byPair);
  const other = pairs[1][0];
  let r = M.flip(g, pairs[0][0]); assert.equal(r.result, 'first'); g = r.g;
  assert.equal(M.flip(g, pairs[0][0]).result, 'ignored', 'same card twice');
  r = M.flip(g, other); assert.equal(r.result, 'nomatch'); g = r.g; assert.equal(g.moves, 1);
  assert.equal(M.flip(g, pairs[2][0]).result, 'ignored', 'locked until flipped back');
  g = M.flipBack(g); assert.ok(g.deck.every((c) => c.state === 'hidden'));
  for (const [a, b] of pairs) { g = M.flip(g, a).g; r = M.flip(g, b); assert.equal(r.result, 'match'); g = r.g; }
  assert.equal(g.finished, true); assert.equal(g.moves, 7); assert.equal(g.found, 6);
  assert.equal(M.efficiency(6, 7), 86);
});
test('highscore helpers: tiers Celle→Vesalius, local points verified-only', () => {
  assert.equal(H.tierFor(0).name, 'Celle'); assert.equal(H.tierFor(249).next.to_go, 1);
  assert.equal(H.tierFor(10000).name, 'Prosektor'); assert.equal(H.tierFor(40000).name, 'Vesalius'); assert.equal(H.tierFor(99999).next, null);
  const byId = new Map(items.map((i) => [i.id, i]));
  const v = items.find((i) => !i.needs_review); const n = items.find((i) => i.needs_review);
  assert.equal(H.localPoints([{ item_id: v.id, mode: 'test', correct: true }, { item_id: n.id, mode: 'test', correct: true }, { item_id: v.id, mode: 'drill', correct: false }], byId), 20);
  assert.match(H.sessionId(), /^[A-Za-z0-9_-]{8,64}$/);
  // JS and PHP weights/tiers agree
  const php = readFileSync(new URL('../api/lib.php', import.meta.url), 'utf8');
  assert.match(php, /KQ_MODE_POINTS = \['naming' => 5, 'drill' => 10, 'test' => 20, 'memory' => 5\]/);
  for (const [name, from] of H.TIERS) assert.ok(php.includes(`['${name}', ${from}]`), name);
});
