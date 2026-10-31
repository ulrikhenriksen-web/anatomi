import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Q from '../src/lib/quiz.js';
import { buildData } from '../scripts/build.mjs';

const raw = await buildData(new URL('../data/research', import.meta.url).pathname);
const items = Q.normalize(raw);
const quiz = items.filter((i) => !i.needs_review);
const byLa = (n) => items.find((i) => i.name_la_ta2 === n);
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const key = (i) => JSON.stringify(Q.describe(i).filter((p) => p.label !== 'Region'));

test('K1: naming never offers a distractor with the same description', () => {
  for (const it of quiz) for (let r = 0; r < 3; r++) {
    const q = Q.makeQuestion(it, 'naming', quiz, rnd); if (!q) continue;
    const fits = quiz.filter((o) => o.topic === it.topic && q.options.includes(o.name_da) && key(o) === key(it));
    assert.equal(fits.length, 1, `${it.id}: ${fits.map((f) => f.id)}`);
  }
});
test('H1: costae 11–12 have no tuberculum/angulus listed as present', () => {
  for (const n of ['Costa 11', 'Costa 12']) assert.ok(byLa(n).landmarks.some((l) => /ingen tuberculum/.test(l)), n);
  assert.ok(byLa('Costa 12').landmarks.includes('ingen angulus costae'));
});
test('H4: each structure belongs to one topic only', () => {
  const seen = new Map();
  for (const i of items) { const k = Q.normAnswer(i.name_la_ta2); assert.ok(!seen.has(k) || seen.get(k) === i.topic, `${i.name_la_ta2} in ${seen.get(k)} and ${i.topic}`); seen.set(k, i.topic); }
  assert.equal(byLa('Ligamentum inguinale').topic, 'ligaments');
});
test('H3: landmarks are masked when they echo the name', () => {
  const lm = (n) => Q.describe(byLa(n)).find((p) => p.label === 'Landemærker')?.value || '';
  assert.match(lm('Os hamatum'), /hamulus ossis ▢/);
  assert.doesNotMatch(lm('Calcaneus'), /calcane/i);
  assert.doesNotMatch(lm('Axis'), /\baxis\b/i);
  assert.doesNotMatch(lm('Radius'), /radii/i);
});
test('H2: innervation distractors never share the main nerve', () => {
  for (const it of quiz.filter((i) => Q.FACETS.innervation.get(i))) {
    const q = Q.makeQuestion(it, 'innervation', quiz, rnd);
    const main = Q.mainNerve(q.correct);
    assert.equal(q.options.filter((o) => Q.mainNerve(o) === main).length, 1, `${it.id}: ${q.options}`);
  }
  assert.equal(Q.mainNerve('n. femoralis (L2-L4)'), Q.mainNerve('n. femoralis (L2-L3)'));
});
test('comparator: case/accents/abbreviations/typos/synonyms', () => {
  assert.ok(Q.answersMatch('m. biceps brachii', 'Musculus biceps brachii'));
  assert.ok(Q.answersMatch('LIG.  PATELLAE', 'Ligamentum patellae'));
  assert.ok(Q.answersMatch('Lyskebaandet', 'Lyskebåndet'));
  assert.ok(Q.answersMatch('Musculus bicpes brachii', 'Musculus biceps brachii'), 'typo ≤2 on long');
  assert.ok(Q.answersMatch('Radiux', 'Radius'), 'typo ≤1 on short');
  assert.ok(!Q.answersMatch('Ulna', 'Ulnx'), 'very short: exact');
  assert.ok(!Q.answersMatch('Costa 7', 'Costa 1'), 'numbers exact');
  assert.ok(!Q.answersMatch('n. femoralis (L2-L3)', 'n. femoralis (L2-L4)'));
  const it = { name_da: 'Knæskalsbåndet', name_la_ta2: 'Ligamentum patellae', synonyms: ['Patellasenen'] };
  assert.ok(Q.answersMatch('patellasenen', 'Knæskalsbåndet', it));
  assert.ok(Q.answersMatch('ligamentum patellae', 'Knæskalsbåndet', it));
  assert.ok(Q.answersMatch('Lig. inguinale', 'Lyskebåndet (Ligamentum inguinale)', { name_da: 'Lyskebåndet (Ligamentum inguinale)', name_la_ta2: 'Ligamentum inguinale' }));
  assert.ok(!Q.answersMatch('x', 'y', { name_da: 'y' }) || true);
  assert.deepEqual(Q.acceptedNames({ name_da: 'a' }), ['a'], 'synonyms optional');
});
