import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeImages } from '../src/lib/images.js';
import { normalize } from '../src/lib/quiz.js';

const hasPhp = (() => { try { return execFileSync('php', ['-m']).toString().includes('pdo_sqlite'); } catch { return false; } })();
const root = new URL('..', import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), 'kqh-'));
const port = 20000 + Math.floor(Math.random() * 500); const fport = port + 600;
const base = `http://127.0.0.1:${port}/api`;
let srv, fake;
const wait = async (u) => { for (let i = 0; i < 40; i++) { try { await fetch(u); return; } catch { await new Promise((r) => setTimeout(r, 100)); } } };
function client() {
  let cookie = '';
  const call = async (path, { method = 'GET', body, xhr = true } = {}) => {
    const r = await fetch(base + path, { method, body: body && JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...(xhr ? { 'X-KQ': '1' } : {}), ...(cookie ? { Cookie: cookie } : {}) } });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  return { call, login: (t) => call('/auth.php?action=login', { method: 'POST', body: { credential: t } }) };
}
const sub = (c, o) => c.call('/score.php', { method: 'POST', body: { category: 'muskler', mode: 'test', correct: 8, total: 10, duration_ms: 60000, ...o } });

before(async () => {
  if (!hasPhp) return;
  const cfg = join(dir, 'config.php');
  writeFileSync(cfg, `<?php return ['sqlite_path' => '${join(dir, 'kq.sqlite')}', 'google_client_id' => 'test-client.apps.googleusercontent.com', 'google_tokeninfo_url' => 'http://127.0.0.1:${fport}/tokeninfo.php', 'score_limits' => ['min_gap_s' => 0, 'per_hour' => 6]];`);
  fake = spawn('php', ['-S', `127.0.0.1:${fport}`, '-t', join(root, 'test/fixtures')], { stdio: 'ignore' });
  srv = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', root], { env: { ...process.env, KQ_CONFIG: cfg }, stdio: 'ignore' });
  await wait(`http://127.0.0.1:${fport}/tokeninfo.php`); await wait(`${base}/auth.php?action=config`);
});
after(() => { srv?.kill(); fake?.kill(); });

test('leaderboard/profile/score require login; score requires CSRF header', { skip: !hasPhp }, async () => {
  const g = client();
  assert.equal((await g.call('/leaderboard.php')).status, 401);
  assert.equal((await g.call('/profile.php')).status, 401);
  assert.equal((await sub(g)).status, 401);
  const a = client(); await a.login('h.p.alice');
  assert.equal((await a.call('/score.php', { method: 'POST', body: { category: 'muskler', mode: 'test', correct: 1, total: 1, duration_ms: 5000 }, xhr: false })).status, 403);
});
test('profile: default first name, opt-out by default, validation, reset', { skip: !hasPhp }, async () => {
  const c = client(); await c.login('h.p.carol');
  let p = (await c.call('/profile.php')).body;
  assert.deepEqual(p, { display_name: 'Carol', display_name_is_default: true, highscore_opt_in: false });
  for (const bad of ['x', 'a'.repeat(25), 'carol@example.com', '<script>', 'www.carol', 42]) {
    assert.equal((await c.call('/profile.php', { method: 'PUT', body: { display_name: bad } })).status, 400, String(bad));
  }
  assert.equal((await c.call('/profile.php', { method: 'PUT', body: { highscore_opt_in: 'yes' } })).status, 400);
  p = (await c.call('/profile.php', { method: 'PUT', body: { display_name: '  Captain   Marvel ' } })).body;
  assert.equal(p.display_name, 'Captain Marvel'); assert.equal(p.highscore_opt_in, false);
  p = (await c.call('/profile.php', { method: 'PUT', body: { display_name: null } })).body;
  assert.equal(p.display_name, 'Carol'); assert.equal(p.display_name_is_default, true);
});
test('score sanity checks: categories, modes incl. memory, ranges, duration, server-side points', { skip: !hasPhp }, async () => {
  const d = client(); await d.login('h.p.dave');
  for (const o of [{ category: 'hjerne' }, { mode: 'cheat' }, { total: 0 }, { total: 51 }, { correct: 11 }, { correct: -1 }, { correct: 5.5 }, { duration_ms: 1000 }, { duration_ms: 9e9 }, { points: 99999 }]) {
    const r = await sub(d, o);
    if ('points' in o) { assert.equal(r.status, 201); assert.equal(r.body.points, 160, 'client points ignored'); } else assert.equal(r.status, 400, JSON.stringify(o));
  }
  const m = await sub(d, { mode: 'memory', category: 'knogler', correct: 6, total: 6, duration_ms: 30000 });
  assert.equal(m.status, 201); assert.equal(m.body.points, 30);
  assert.equal(m.body.totals.overall, 190);
});
test('rate limit per hour', { skip: !hasPhp }, async () => {
  const d = client(); await d.login('h.p.dave'); // dave already has 2 events; limit 6
  const codes = []; for (let i = 0; i < 6; i++) codes.push((await sub(d, { correct: 1 })).status);
  assert.deepEqual(codes, [201, 201, 201, 201, 429, 429]);
});
test('leaderboard: opted-out excluded and names never returned; ranks with ties; own rank', { skip: !hasPhp }, async () => {
  const a = client(); await a.login('h.p.alice');
  const b = client(); await b.login('h.p.bob');
  const c = client(); await c.login('h.p.carol');
  await sub(a, { correct: 10 }); await sub(b, { correct: 10 }); await sub(c, { correct: 5 });
  // nobody opted in yet (dave has scores too) -> empty boards, but own rank null
  let lb = (await a.call('/leaderboard.php')).body;
  assert.equal(lb.opted_in, false); assert.deepEqual(lb.categories.muskler.top, []); assert.equal(lb.categories.muskler.me, null);
  for (const x of [a, b, c]) await x.call('/profile.php', { method: 'PUT', body: { highscore_opt_in: true } });
  await b.call('/profile.php', { method: 'PUT', body: { display_name: 'Bobby' } });
  lb = (await c.call('/leaderboard.php?limit=2')).body;
  const mu = lb.categories.muskler;
  assert.equal(mu.participants, 3);
  assert.deepEqual(mu.top.map((t) => [t.rank, t.score]), [[1, 200], [1, 200]]);
  assert.deepEqual(mu.top.map((t) => t.display_name).sort(), ['Alice', 'Bobby']);
  assert.deepEqual(mu.me, { rank: 3, score: 100 });
  assert.ok(mu.top.every((t) => !('user_id' in t) && !('email' in t)));
  const raw = JSON.stringify(lb);
  assert.ok(!raw.includes('Dave') && !raw.includes('dave@'), 'opted-out user never returned');
  assert.deepEqual(Object.keys(lb.categories).sort(), ['knogler', 'ledbaand', 'muskler', 'overall', 'sener']);
  assert.equal(lb.categories.overall.top[0].score, 200);
  // opting out removes from boards immediately
  await a.call('/profile.php', { method: 'PUT', body: { highscore_opt_in: false } });
  lb = (await b.call('/leaderboard.php')).body;
  assert.ok(!JSON.stringify(lb).includes('Alice'));
  assert.deepEqual(lb.categories.muskler.me, { rank: 1, score: 200 });
  assert.equal((await a.call('/leaderboard.php')).body.categories.muskler.me, null, 'opted-out caller has no rank');
});

test('images.json: validation and loader attach without touching image/hotspots', () => {
  const ids = new Set(['bone_femur', 'muscle_x']);
  const { images, rejected } = normalizeImages({
    bone_femur: { url: 'https://upload.wikimedia.org/f.png', alt: 'Lårben forfra', credit: 'Gray', license: 'Public domain' },
    muscle_x: { url: 'javascript:alert(1)', alt: 'x', license: 'CC0' },
    ghost: { url: 'https://x/y.png', alt: 'a', license: 'CC0' },
    'Bad Id': {},
  }, ids);
  assert.deepEqual(Object.keys(images), ['bone_femur']);
  assert.deepEqual(rejected.map((r) => r.why).sort(), ['bad id', 'unknown id', 'url must be https:// or images/…']);
  const items = normalize({ bones: { items: [{ id: 'bone_femur', name_da: 'Lårben', verification: 'verified' }] }, images });
  assert.equal(items[0].media_image.alt, 'Lårben forfra');
  assert.equal(items[0].image, undefined);
  assert.deepEqual(normalizeImages(null), { images: {}, rejected: [] });
});
