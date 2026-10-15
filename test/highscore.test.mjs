import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildData } from '../scripts/build.mjs';
import { normalize, FACETS } from '../src/lib/quiz.js';

const hasPhp = (() => { try { return execFileSync('php', ['-m']).toString().includes('pdo_sqlite'); } catch { return false; } })();
const root = new URL('..', import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), 'kqh-'));
const db = join(dir, 'kq.sqlite');
const port = 20000 + Math.floor(Math.random() * 500); const fport = port + 600;
const base = `http://127.0.0.1:${port}/api`;
let srv, fake, items;
const wait = async (u) => { for (let i = 0; i < 40; i++) { try { await fetch(u); return; } catch { await new Promise((r) => setTimeout(r, 100)); } } };
const sql = (q) => execFileSync('php', ['-r', `$p=new PDO('sqlite:${db}');$p->setAttribute(PDO::ATTR_ERRMODE,PDO::ERRMODE_EXCEPTION);$s=$p->query(${JSON.stringify(q).replace(/\$/g, '\\$')});echo json_encode($s?$s->fetchAll(PDO::FETCH_ASSOC):[]);`]).toString();
function client() {
  let cookie = '';
  const call = async (path, { method = 'GET', body, xhr = true } = {}) => {
    const r = await fetch(base + path, { method, body: body && JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...(xhr ? { 'X-KQ': '1' } : {}), ...(cookie ? { Cookie: cookie } : {}) } });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  return { call, login: (t) => call('/auth.php?action=login', { method: 'POST', body: { credential: t } }) };
}
let sidN = 0;
const sid = () => `sess-${Date.now()}-${++sidN}`;
const now = () => Date.now();
const verified = (topic) => items.filter((i) => !i.needs_review && (!topic || i.topic === topic));
const ev = (it, facet, { wrong = false, ms = 3000, ts = now() } = {}) => ({ item_id: it.id, facet, answer: wrong ? 'forkert' : (facet === 'naming' ? it.name_da : FACETS[facet].get(it)), ts, ms });
const submit = (c, mode, events, extra = {}) => c.call('/score.php', { method: 'POST', body: { session_id: sid(), mode, events, ...extra } });

before(async () => {
  items = normalize(await buildData(join(root, 'data/research')));
  if (!hasPhp) return;
  const dataPath = join(dir, 'data.json'); writeFileSync(dataPath, JSON.stringify(await buildData(join(root, 'data/research'))));
  const cfg = join(dir, 'config.php');
  writeFileSync(cfg, `<?php return ['sqlite_path' => '${db}', 'data_path' => '${dataPath}', 'salt' => 't', 'google_client_id' => 'test-client.apps.googleusercontent.com', 'google_tokeninfo_url' => 'http://127.0.0.1:${fport}/tokeninfo.php', 'score_limits' => ['parallel' => 1000]];`);
  // legacy DB with columns that must be removed by the migration
  execFileSync('php', ['-r', `$p=new PDO('sqlite:${db}');$p->exec("CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, google_sub TEXT UNIQUE NOT NULL, email TEXT, name TEXT, picture TEXT, created_at TEXT NOT NULL, last_login TEXT NOT NULL)");$p->exec("INSERT INTO users (google_sub,email,name,picture,created_at,last_login) VALUES ('old','o@x.dk','Old','https://pic','x','x')");$p->exec("CREATE TABLE reports (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at VARCHAR(25) NOT NULL, item_id VARCHAR(120) NOT NULL, field VARCHAR(60) NULL, message TEXT NOT NULL, page VARCHAR(255) NULL, data_version VARCHAR(20) NULL, ip_hash CHAR(64) NOT NULL, user_agent VARCHAR(255) NULL, status VARCHAR(20) NOT NULL DEFAULT 'new')");$p->exec("INSERT INTO reports (created_at,item_id,message,ip_hash,user_agent) VALUES ('x','bone_femur','m','abc','UA')");`]);
  fake = spawn('php', ['-S', `127.0.0.1:${fport}`, '-t', join(root, 'test/fixtures')], { stdio: 'ignore' });
  srv = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', root], { env: { ...process.env, KQ_CONFIG: cfg }, stdio: 'ignore' });
  await wait(`http://127.0.0.1:${fport}/tokeninfo.php`); await wait(`${base}/auth.php?action=config`);
});
after(() => { srv?.kill(); fake?.kill(); });

test('migration drops picture, ip_hash, user_agent; reports store only text/time/page/version', { skip: !hasPhp }, async () => {
  const a = client(); const r = await a.login('h.p.alice');
  assert.equal(r.status, 200); assert.ok(!('picture' in r.body.user));
  const ucols = JSON.parse(sql('PRAGMA table_info(users)')).map((c) => c.name);
  const rcols = JSON.parse(sql('PRAGMA table_info(reports)')).map((c) => c.name);
  assert.ok(!ucols.includes('picture'), ucols.join());
  assert.ok(!rcols.includes('ip_hash') && !rcols.includes('user_agent'), rcols.join());
  assert.equal(JSON.parse(sql("SELECT message FROM reports"))[0].message, 'm', 'existing reports kept');
  const rep = await fetch(`${base}/report.php`, { method: 'POST', headers: { 'User-Agent': 'SecretUA/1.0' }, body: JSON.stringify({ item_id: 'bone_femur', message: 'Test', page: '#/udforsk/bone_femur', data_version: '0.3' }) });
  assert.equal(rep.status, 201);
  const row = JSON.parse(sql('SELECT * FROM reports ORDER BY id DESC LIMIT 1'))[0];
  assert.deepEqual(Object.keys(row).sort(), ['created_at', 'data_version', 'field', 'id', 'item_id', 'message', 'page', 'status']);
  assert.ok(!sql('SELECT * FROM reports').includes('SecretUA') && !sql('SELECT * FROM users').includes('googleusercontent'));
});
test('endpoints require login; score requires CSRF header', { skip: !hasPhp }, async () => {
  const g = client();
  for (const p of ['/leaderboard.php', '/profile.php']) assert.equal((await g.call(p)).status, 401);
  assert.equal((await submit(g, 'naming', [ev(verified()[0], 'naming')])).status, 401);
  const a = client(); await a.login('h.p.alice');
  assert.equal((await a.call('/score.php', { method: 'POST', xhr: false, body: { session_id: sid(), mode: 'naming', events: [ev(verified()[0], 'naming')] } })).status, 403);
});
test('points: server-side from answer events, 5/10/20/5, verified-only, answers validated, client points ignored', { skip: !hasPhp }, async () => {
  const c = client(); await c.login('h.p.bob');
  const [m1, m2, m3] = verified('muscles'); const nr = items.find((i) => i.needs_review);
  let r = await submit(c, 'naming', [ev(m1, 'naming'), ev(m2, 'naming', { wrong: true }), ev(nr, 'naming'), { ...ev(m3, 'naming'), points: 9999 }]);
  assert.equal(r.status, 201); assert.equal(r.body.counted, 2); assert.equal(r.body.points, 10);
  assert.deepEqual(r.body.rejected.map((x) => x.reason), ['incorrect', 'not_verified']);
  r = await submit(c, 'drill', [ev(m1, 'innervation'), ev(m2, 'udspring')]); assert.equal(r.body.points, 20);
  r = await submit(c, 'test', [ev(m1, 'haefte'), ev(m2, 'navn')]); assert.equal(r.body.points, 40);
  r = await submit(c, 'test', [ev(m2, 'navn'), ev(m1, 'haefte')]); assert.equal(r.body.points, 0); assert.ok(r.body.reasons.includes('test_set_already_counted'));
  r = await submit(c, 'memory', verified('bones').slice(0, 6).map((it) => ({ item_id: it.id, facet: 'pair', ts: now(), ms: 2000 })), { memory: { difficulty: 'let', pairs: 6, moves: 9, seconds: 40 } });
  assert.equal(r.status, 201); assert.equal(r.body.points, 30);
  assert.equal(r.body.totals.all_time, 100); assert.equal(r.body.tier.name, 'Celle'); assert.equal(r.body.tier.next.to_go, 150);
  const cats = JSON.parse(sql("SELECT category, SUM(points) p FROM score_events GROUP BY category ORDER BY category"));
  assert.deepEqual(cats.map((x) => x.category), ['knogler', 'muskler']);
});
test('validation + plausibility: future ts, too fast, old events, caps, rate limits', { skip: !hasPhp }, async () => {
  const c = client(); await c.login('h.p.carol');
  const v = verified('bones');
  for (const body of [{ mode: 'cheat' }, { events: [] }, { session_id: 'x' }, { mode: 'memory', memory: { pairs: 7, moves: 7, seconds: 30 } }]) {
    const r = await c.call('/score.php', { method: 'POST', body: { session_id: sid(), mode: 'naming', events: [ev(v[0], 'naming')], ...body } });
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  let r = await submit(c, 'naming', [ev(v[0], 'naming', { ts: now() + 3600e3 })]);
  assert.equal(r.body.counted, 0); assert.ok(r.body.reasons.includes('future_timestamp'));
  r = await submit(c, 'naming', v.slice(0, 4).map((it) => ev(it, 'naming', { ms: 150 })));
  assert.equal(r.body.counted, 0); assert.ok(r.body.reasons.includes('too_fast'));
  assert.equal(JSON.parse(sql("SELECT flagged FROM user_profile p JOIN users u ON u.id=p.user_id WHERE u.email='carol@example.com'"))[0].flagged, 1);
  r = await submit(c, 'naming', [ev(v[1], 'naming', { ts: now() - 8 * 864e5 })]);
  assert.deepEqual(r.body.rejected.map((x) => x.reason), ['too_old']);
  // naming cap 100 answers/day
  const d = client(); await d.login('h.p.dave');
  const pool = verified();
  let counted = 0;
  for (let k = 0; k < 3; k++) counted += (await submit(d, 'naming', pool.slice(k * 50, k * 50 + 50).map((it) => ev(it, 'naming')))).body.counted;
  assert.equal(counted, 100);
  // memory: 5 games/day
  const mem = () => submit(d, 'memory', pool.slice(0, 6).map((it) => ({ item_id: it.id, facet: 'pair', ts: now(), ms: 2000 })), { memory: { difficulty: 'let', pairs: 6, moves: 8, seconds: 30 } });
  const pts = []; for (let k = 0; k < 6; k++) pts.push((await mem()).body.points);
  assert.deepEqual(pts, [30, 30, 30, 30, 30, 0]);
});
test('profile: no public name by default; 3–20 chars, unique, filtered, 30-day change limit; opt-in needs name', { skip: !hasPhp }, async () => {
  const e = client(); await e.login('h.p.erin');
  let p = (await e.call('/profile.php')).body;
  assert.equal(p.display_name, null); assert.equal(p.highscore_opt_in, false); assert.match(p.suggested_display_name, /^Erin\d{2}$/);
  assert.equal((await e.call('/profile.php', { method: 'PUT', body: { highscore_opt_in: true } })).status, 409);
  for (const bad of ['ab', 'a'.repeat(21), 'erin@example.com', '<b>x</b>', 'www.erin', 'Fuck you', 7]) {
    assert.equal((await e.call('/profile.php', { method: 'PUT', body: { display_name: bad } })).status, 400, String(bad));
  }
  p = (await e.call('/profile.php', { method: 'PUT', body: { display_name: '  Erin   Fys ', highscore_opt_in: true } })).body;
  assert.equal(p.display_name, 'Erin Fys'); assert.equal(p.highscore_opt_in, true);
  assert.equal((await e.call('/profile.php', { method: 'PUT', body: { display_name: 'Erin Nyt' } })).status, 429, '30-day limit');
  const f = client(); await f.login('h.p.frank');
  assert.equal((await f.call('/profile.php', { method: 'PUT', body: { display_name: 'erin fys' } })).status, 409, 'unique, case-insensitive');
});
test('leaderboard: opt-in only, names hidden otherwise, ties, own (hypothetical) rank, filters, tiers', { skip: !hasPhp }, async () => {
  const a = client(); await a.login('h.p.alice');
  const b = client(); await b.login('h.p.bob');
  const f = client(); await f.login('h.p.frank');
  await a.call('/profile.php', { method: 'PUT', body: { display_name: 'Alice A', highscore_opt_in: true } });
  await b.call('/profile.php', { method: 'PUT', body: { display_name: 'Bobby', highscore_opt_in: true } });
  const m = verified('muscles');
  await submit(a, 'drill', m.slice(10, 17).map((it) => ev(it, 'navn'))); // 70 pts muskler (= bob)
  await submit(f, 'drill', m.slice(20, 35).map((it) => ev(it, 'navn'))); // frank 150, not opted in
  let lb = (await a.call('/leaderboard.php?period=all&category=muskler')).body;
  assert.deepEqual(lb.top.map((t) => [t.rank, t.display_name, t.points]), [[1, 'Alice A', 70], [1, 'Bobby', 70]]);
  assert.ok(lb.top.every((t) => Object.keys(t).sort().join() === 'display_name,initial,is_me,points,rank,tier'));
  assert.equal(lb.top[0].initial, 'A'); assert.equal(lb.top[0].tier, 'Celle');
  assert.deepEqual(lb.me, { rank: 1, points: 70, public: true, to_next: null });
  const raw = JSON.stringify(lb);
  for (const s of ['Frank', 'frank@', 'Erin Fys', '@example.com', 'googleusercontent']) assert.ok(!raw.includes(s), s);
  const fl = (await f.call('/leaderboard.php?period=all&category=muskler')).body;
  assert.deepEqual(fl.me, { rank: 1, points: 150, public: false, to_next: null }, 'hypothetical rank for opted-out user');
  assert.equal(fl.participants, 2);
  lb = (await b.call('/leaderboard.php?period=week&category=muskler&mode=drill')).body;
  assert.equal(lb.me.points, 20);
  assert.deepEqual(lb.me.to_next, { rank: 1, points: 50 });
  assert.equal((await b.call('/leaderboard.php?period=year')).status, 400);
  lb = (await b.call('/leaderboard.php?period=all&category=knogler&mode=memory')).body;
  assert.equal(lb.top[0].points, 30);
  // opt-out removes immediately; admin hide
  await a.call('/profile.php', { method: 'PUT', body: { highscore_opt_in: false } });
  assert.ok(!JSON.stringify((await b.call('/leaderboard.php?period=all')).body.top).includes('Alice'));
  sql("UPDATE user_profile SET hidden=1 WHERE display_name='Bobby'");
  assert.deepEqual((await f.call('/leaderboard.php?period=all')).body.top, []);
});
test('account deletion removes user data', { skip: !hasPhp }, async () => {
  const f = client(); await f.login('h.p.frank');
  assert.equal((await f.call('/account.php', { method: 'DELETE' })).status, 200);
  assert.equal(JSON.parse(sql("SELECT COUNT(*) n FROM users WHERE email='frank@example.com'"))[0].n, 0);
  assert.equal(JSON.parse(sql("SELECT COUNT(*) n FROM score_events e LEFT JOIN users u ON u.id=e.user_id WHERE u.id IS NULL"))[0].n, 0);
  assert.equal((await f.call('/profile.php')).status, 401);
});
