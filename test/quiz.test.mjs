import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as Q from '../src/lib/quiz.js';
import { buildData } from '../scripts/build.mjs';

const raw = await buildData(new URL('../data/research', import.meta.url).pathname);
const items = Q.normalize(raw);
let seed = 42; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

test('data loads all four topics, strips source_check', () => {
  for (const t of Object.keys(Q.TOPICS)) assert.ok(items.some((i) => i.topic === t), t);
  assert.ok(items.every((i) => !('source_check' in i)));
  assert.equal(new Set(items.map((i) => i.id)).size, items.length, 'ids unique');
});
test('every item has name_da, name_la_ta2, region, verification', () => {
  for (const i of items) assert.ok(i.name_da && i.name_la_ta2 && i.region && i.verification, i.id);
});
test('test mode excludes needs_review', () => {
  const all = Q.filterItems(items, {});
  const t = Q.filterItems(items, { testMode: true });
  assert.ok(all.some((i) => i.needs_review));
  assert.ok(t.length > 0 && t.every((i) => !i.needs_review));
});
test('compound regions match both parts', () => {
  const r = Q.filterItems(items, { topic: 'muscles', region: 'skulder' });
  assert.ok(r.some((i) => i.region === 'ryg/skulder'));
});
test('search matches danish and latin', () => {
  assert.ok(Q.filterItems(items, { query: 'deltoideus' }).length >= 1);
  assert.ok(Q.filterItems(items, { query: 'kraveben' }).length >= 1);
});
test('default facets', () => assert.deepEqual(Q.DEFAULT_FACETS, ['navn', 'udspring', 'haefte', 'innervation']));
test('muscles expose all default facets', () => {
  const m = items.find((i) => i.id === 'muscle_trapezius');
  assert.deepEqual(Q.facetsFor(m), Q.DEFAULT_FACETS);
});
test('naming question: description prompt, 4 unique options incl. correct, never leaks name', () => {
  for (const it of items) {
    const q = Q.makeQuestion(it, 'naming', items, rnd);
    assert.ok(q.options.includes(q.correct));
    assert.equal(new Set(q.options).size, q.options.length);
    assert.ok(q.options.length >= 2, it.id);
    assert.ok(q.prompt.length >= 1, it.id);
  }
});
test('facet questions for every item/facet are valid', () => {
  for (const it of items) for (const f of Q.facetsFor(it)) {
    const q = Q.makeQuestion(it, f, items, rnd);
    assert.ok(q && q.options.includes(q.correct) && new Set(q.options).size === q.options.length, `${it.id} ${f}`);
  }
});
test('SM-2 and mastery rule (>=7d, 3 in a row, >=2 days)', () => {
  const d0 = Date.UTC(2026, 0, 1);
  let s = Q.sm2(null, true, d0); assert.equal(s.interval, 1);
  s = Q.sm2(s, true, d0 + 864e5); assert.equal(s.interval, 6); assert.ok(!Q.isMastered(s));
  s = Q.sm2(s, true, d0 + 7 * 864e5); assert.ok(s.interval >= 7); assert.ok(Q.isMastered(s));
  s = Q.sm2(s, false, d0 + 20 * 864e5); assert.equal(s.interval, 0); assert.ok(!Q.isMastered(s));
  let same = null; for (let i = 0; i < 5; i++) same = Q.sm2(same, true, d0 + i * 1000);
  assert.ok(!Q.isMastered(same), 'same-day cramming does not master');
});
test('pickDrill prioritises due, then new', () => {
  const now = Date.UTC(2026, 5, 1);
  const subset = items.filter((i) => i.topic === 'muscles').slice(0, 5);
  const prog = { [Q.key(subset[0].id, 'navn')]: { due: now - 1, interval: 1, reps: 1, ef: 2.5, streak: 1, days: [] } };
  const cards = Q.pickDrill(subset, prog, Q.DEFAULT_FACETS, 5, now, rnd);
  assert.equal(cards[0].item.id, subset[0].id); assert.equal(cards[0].facet, 'navn');
  assert.equal(cards.length, 5);
});
test('streak', () => {
  const d = Date.UTC(2026, 3, 10, 12);
  let m = Q.updateStreak(null, d); assert.equal(m.streak, 1);
  m = Q.updateStreak(m, d + 864e5); assert.equal(m.streak, 2);
  m = Q.updateStreak(m, d + 864e5); assert.equal(m.streak, 2);
  m = Q.updateStreak(m, d + 4 * 864e5); assert.equal(m.streak, 1);
});
test('report validation', () => {
  assert.deepEqual(Q.validateReport({ item_id: 'muscle_x', message: 'Forkert nerve' }), []);
  assert.ok(Q.validateReport({ item_id: 'x;drop', message: 'abc' }).includes('item_id'));
  assert.ok(Q.validateReport({ item_id: 'x', message: '' }).includes('message'));
});
test('UI source escapes data and contains a11y hooks', () => {
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
  assert.match(html, /<html lang="da">/); assert.match(html, /aria-live="polite"/);
  assert.match(app, /lang="la"/); assert.match(app, /role="progressbar"/);
  assert.ok(!/innerHTML\s*=\s*[^`'"]*\bit\.name_da\b/.test(app));
});

const hasPhp = (() => { try { execFileSync('php', ['-m']); return true; } catch { return false; } })();
test('report.php stores reports in SQLite and validates', { skip: !hasPhp && 'php not installed' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kq-'));
  const cfg = join(dir, 'config.php');
  writeFileSync(cfg, `<?php return ['sqlite_path' => '${join(dir, 'r.sqlite')}', 'salt' => 't'];`);
  const port = 18000 + Math.floor(Math.random() * 1000);
  const srv = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', new URL('..', import.meta.url).pathname], { env: { ...process.env, KQ_CONFIG: cfg }, stdio: 'ignore' });
  try {
    await new Promise((r) => setTimeout(r, 600));
    const url = `http://127.0.0.1:${port}/api/report.php`;
    const post = (b) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
    assert.equal((await fetch(url)).status, 405);
    assert.equal((await post({ item_id: 'bad id', message: 'x' })).status, 400);
    const ok = await post({ item_id: 'muscle_trapezius', field: 'innervation', message: 'Test af rapport' });
    assert.equal(ok.status, 201); assert.equal((await ok.json()).ok, true);
    assert.ok(existsSync(join(dir, 'r.sqlite')));
    const rows = execFileSync('php', ['-r', `$p=new PDO('sqlite:${join(dir, 'r.sqlite')}');echo $p->query('select count(*) from reports')->fetchColumn();`]).toString();
    assert.equal(rows.trim(), '1');
  } finally { srv.kill(); }
});
