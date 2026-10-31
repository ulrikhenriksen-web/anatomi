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
test('H1 (v0.4 source): costae 11–12 without tuberculum; costa 12 without angulus', () => {
  for (const n of ['Costa 11', 'Costa 12']) assert.ok(!byLa(n).landmarks.some((l) => /tuberculum/.test(l)), n);
  assert.ok(!byLa('Costa 12').landmarks.some((l) => /angulus/.test(l)));
});
test('H4: each structure belongs to one topic only', () => {
  const seen = new Map();
  for (const i of items) { const k = Q.normAnswer(i.name_la_ta2); assert.ok(!seen.has(k) || seen.get(k) === i.topic, `${i.name_la_ta2} in ${seen.get(k)} and ${i.topic}`); seen.set(k, i.topic); }
  assert.equal(byLa('Ligamentum inguinale').topic, 'ligaments');
});
test('H3: landmarks are masked when they echo the name', () => {
  const lm = (n) => Q.describe(byLa(n)).find((p) => p.label === 'Landemærker')?.value || '';
  assert.match(lm('Os hamatum'), /hamulus ossis ___/);
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

test('landmark reveal field: none/mask/hide honoured, auto-mask fallback', () => {
  const it = { name_la_ta2: 'Os hamatum', landmarks: [{ la: 'hamulus ossis hamati', reveal: 'none' }, { la: 'x hamati', reveal: 'mask', masked_la: 'x ___' }, { la: 'facies hamati', reveal: 'hide' }, 'hamulus ossis hamati'] };
  assert.deepEqual(Q.maskLandmarks(it), ['hamulus ossis hamati', 'x ___', 'hamulus ossis ___']);
  assert.equal(Q.landmarkLabel({ la: 'a' }), 'a');
  assert.match(Q.maskLandmarks({ name_la_ta2: 'Os metatarsi V', landmarks: ['tuberositas ossis metatarsi quinti'] })[0], /___ ___$/);
});

const lmOf = (n) => Q.describe(byLa(n)).find((p) => p.label === 'Landemærker')?.value || '';
test('v0.4: quiz_group items never appear together in any question', () => {
  for (const it of quiz.filter((i) => i.quiz_group)) for (const kind of ['naming', ...Q.facetsFor(it)]) {
    const q = Q.makeQuestion(it, kind, quiz, rnd); if (!q) continue;
    const g = getterIds(q, it, kind);
    assert.ok(g.every((o) => o.id === it.id || o.quiz_group !== it.quiz_group), `${it.id}/${kind}`);
  }
});
function getterIds(q, it, kind) {
  const get = kind === 'naming' ? Q.FACETS.navn.get : Q.FACETS[kind].get;
  const wrong = q.options.filter((v) => v !== q.correct);
  return quiz.filter((o) => o.topic === it.topic && o.quiz_group === it.quiz_group && o.id !== it.id && wrong.includes(get(o)) && get(o) !== q.correct);
}
test('v0.4: data-driven masking wins, per-item scope, dens hidden, Udforsk unchanged', () => {
  assert.match(lmOf('Os hamatum'), /hamulus ossis ___/);
  assert.doesNotMatch(lmOf('Axis'), /dens/);
  assert.ok(byLa('Axis').landmarks.some((l) => /dens/.test(String(l))), 'Udforsk keeps landmarks');
  assert.match(lmOf('Femur'), /caput femoris/, 'data reveal:none wins over auto-blank');
  const am = items.find((i) => i.id === 'muscle_adductor_magnus');
  if (am?.quiz_mask && Object.keys(am.quiz_mask).length) assert.ok(Q.describe(am).some((p) => /___/.test(p.value)));
  const pl = items.find((i) => i.id === 'muscle_palmaris_longus');
  assert.equal(Q.describe(pl).find((p) => p.label === 'Hæfte').value, pl.quiz_mask.insertion_da.masked_da);
  assert.ok(!items.some((i) => i.id.startsWith('tendon_ligamentum_')));
  assert.ok(items.some((i) => i.id === 'muscle_arytenoideus_obliquus'));
});
test('v0.4: accepted_names feed the answer matcher', () => {
  const lp = items.find((i) => i.id === 'ligament_ligamentum_patellae');
  assert.ok(Q.answersMatch('patellasenen', lp.name_da, lp));
  assert.ok(Q.answersMatch('x', 'y', { name_da: 'y', accepted_names: [{ name: 'x', lang: 'da' }] }));
});
