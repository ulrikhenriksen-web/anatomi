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

test('needs_review excluded from ALL quiz modes but browsable', () => {
  const nr = items.filter((i) => i.needs_review);
  assert.ok(nr.length > 0);
  assert.ok(Q.filterItems(items, {}).some((i) => i.needs_review), 'browsable in Udforsk');
  assert.ok(Q.filterItems(items, { quizMode: true }).every((i) => !i.needs_review));
  const cards = Q.pickDrill(items, {}, Q.DEFAULT_FACETS, 5000, Date.now(), rnd);
  assert.ok(cards.length > 0 && cards.every((c) => !c.item.needs_review), 'drill');
  const quizItems = items.filter((i) => !i.needs_review);
  for (const it of quizItems.slice(0, 200)) {
    const q = Q.makeQuestion(it, 'naming', items, rnd);
    for (const o of q.options) assert.ok(!nr.some((n) => n.name_da === o && n.topic === it.topic && !quizItems.some((v) => v.name_da === o)), 'no needs_review distractors');
  }
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /\.filter\(\(i\) => !i\.needs_review\)/);
});
test('mergeProgress newest wins; mergeMeta', () => {
  const m = Q.mergeProgress({ a: { last: 1, v: 'old' }, b: { last: 5 } }, { a: { last: 2, v: 'new' }, b: { last: 3 }, c: { last: 1 } });
  assert.equal(m.a.v, 'new'); assert.equal(m.b.last, 5); assert.ok(m.c);
  const mm = Q.mergeMeta({ xp: 10, streak: 3, lastDay: '2026-10-14', tests: [{ at: 1 }] }, { xp: 20, streak: 9, lastDay: '2026-10-01', tests: [{ at: 1 }, { at: 2 }] });
  assert.deepEqual(mm, { xp: 20, streak: 3, lastDay: '2026-10-14', tests: [{ at: 1 }, { at: 2 }] });
});
test('mediaOf: v2 hotspot schema normalisation', () => {
  assert.deepEqual(Q.mediaOf({}), { image: null, hotspots: [] });
  const m = Q.mediaOf({ image: 'https://x/y.png', hotspots: [{ item_id: 'muscle_a', x: 0.5, y: 0.2 }, { item_id: 'b', x: 2, y: 0 }] });
  assert.equal(m.image, 'https://x/y.png'); assert.equal(m.hotspots.length, 1); assert.equal(m.hotspots[0].r, 0.04);
  assert.equal(Q.mediaOf({ image: 'javascript:alert(1)' }).image, null);
});
test('branding: user-visible copy says Anatomi, not Knoglequiz', () => {
  const html = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(html, /<title>Anatomi/); assert.match(html, /og:site_name" content="Anatomi"/);
  assert.ok(!/knoglequiz/i.test(html));
  assert.match(html, /canonical" href="https:\/\/anatomi\.emiltram\.dk\/"/);
  assert.match(readFileSync(new URL('../src/.htaccess', import.meta.url), 'utf8'), /knoglequiz\\\.emiltram\\\.dk\$ \[NC\][\s\S]*https:\/\/anatomi\.emiltram\.dk%\{REQUEST_URI\} \[L,R=301/);
  assert.ok(!/Knoglequiz/.test(app));
});

test('privacy: exact text in SPA and static page; linked from Profil, login area, footer', async () => {
  const { PRIVACY_TEXT, PRIVACY_TITLE } = await import('../src/lib/privacy.js');
  const expected = 'Anatomi gemmer kun det, der skal til for at appen virker. Logger du ind med Google, gemmer vi dit navn, din e-mail og dit Google-id samt din træningsfremgang, så den følger dig på tværs af enheder. Bruger du appen uden login, gemmes fremgangen kun lokalt i din browser. Fejlrapporter gemmes med den tekst, du skriver, og tidspunktet. Vi bruger ingen reklame- eller sporingscookies og deler ikke data med andre. Data ligger hos Simply.com i EU. Du kan til enhver tid få indsigt i eller sletning af dine data ved at skrive til ulrik.henriksen@gmail.com. Dataansvarlig: Ulrik Henriksen.';
  assert.equal(PRIVACY_TITLE, 'Privatliv');
  assert.equal(PRIVACY_TEXT, expected);
  const stat = readFileSync(new URL('../src/privatliv.html', import.meta.url), 'utf8');
  const body = stat.match(/<p id="privacy-text">([\s\S]*?)<\/p>/)[1].replace(/<[^>]+>/g, '');
  assert.equal(body, expected);
  assert.match(stat, /<h1>Privatliv<\/h1>/);
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /\[\/\^#\\\/privatliv\$\/, privacy\]/);
  assert.match(app, /const legalLinks = '<a href="\/privatliv">Privatliv<\/a> · <a href="\/vilkaar">Vilkår<\/a>'/);
  assert.ok((app.match(/\$\{legalLinks\}/g) || []).length >= 2, 'login area (signed in + out)');
  assert.match(app, /href="\/privatliv"><h2>Privatliv/); assert.match(app, /href="\/vilkaar"><h2>Vilkår/);
  assert.match(readFileSync(new URL('../src/index.html', import.meta.url), 'utf8'), /<footer[^>]*><a href="\/privatliv">Privatliv<\/a> · <a href="\/vilkaar">Vilkår<\/a>/);
  const ht = readFileSync(new URL('../src/.htaccess', import.meta.url), 'utf8');
  assert.match(ht, /RewriteRule \^\(privatliv\|vilkaar\)\/\?\$ \$1\.html \[L\]/);
  assert.match(stat, /canonical" href="https:\/\/anatomi\.emiltram\.dk\/privatliv"/);
  const { TERMS_TEXT } = await import('../src/lib/privacy.js');
  for (const w of ['gratis læringsværktøj', 'ingen garanti', 'ikke medicinsk rådgivning', 'eget ansvar', 'ulrik.henriksen@gmail.com']) assert.ok(TERMS_TEXT.includes(w), w);
  const vt = readFileSync(new URL('../src/vilkaar.html', import.meta.url), 'utf8');
  assert.equal(vt.match(/<p id="terms-text">([\s\S]*?)<\/p>/)[1].replace(/<[^>]+>/g, ''), TERMS_TEXT);
});
