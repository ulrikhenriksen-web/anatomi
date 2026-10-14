import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const hasPhp = (() => { try { return execFileSync('php', ['-m']).toString().includes('pdo_sqlite'); } catch { return false; } })();
const root = new URL('..', import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), 'kqa-'));
const port = 19000 + Math.floor(Math.random() * 500); const fport = port + 600;
const base = `http://127.0.0.1:${port}/api`;
let srv, fake;
const wait = async (url) => { for (let i = 0; i < 40; i++) { try { await fetch(url); return; } catch { await new Promise((r) => setTimeout(r, 100)); } } };

function client() {
  let cookie = '';
  const call = async (path, { method = 'GET', body, xhr = true } = {}) => {
    const r = await fetch(base + path, { method, body: body && JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...(xhr ? { 'X-KQ': '1' } : {}), ...(cookie ? { Cookie: cookie } : {}) } });
    const sc = r.headers.get('set-cookie'); if (sc) { cookie = sc.split(';')[0]; this_sc = sc; }
    return { status: r.status, body: await r.json().catch(() => null), setCookie: sc };
  };
  let this_sc; return { call, get cookie() { return cookie; } };
}

before(async () => {
  if (!hasPhp) return;
  const mk = (name, extra) => { const f = join(dir, name); writeFileSync(f, `<?php return ${extra};`); return f; };
  const cfg = mk('config.php', `['sqlite_path' => '${join(dir, 'kq.sqlite')}', 'salt' => 't', 'google_client_id' => 'test-client.apps.googleusercontent.com', 'google_tokeninfo_url' => 'http://127.0.0.1:${fport}/tokeninfo.php']`);
  fake = spawn('php', ['-S', `127.0.0.1:${fport}`, '-t', join(root, 'test/fixtures')], { stdio: 'ignore' });
  srv = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', root], { env: { ...process.env, KQ_CONFIG: cfg }, stdio: 'ignore' });
  await wait(`http://127.0.0.1:${fport}/tokeninfo.php`); await wait(`${base}/auth.php?action=config`);
});
after(() => { srv?.kill(); fake?.kill(); });

test('config exposes client id from config.php', { skip: !hasPhp }, async () => {
  const r = await client().call('/auth.php?action=config');
  assert.equal(r.body.google_client_id, 'test-client.apps.googleusercontent.com');
});
test('rejects bad tokens (wrong aud, expired, bad iss, garbage) and missing CSRF header', { skip: !hasPhp }, async () => {
  const c = client();
  for (const t of ['h.p.wrongaud', 'h.p.expired', 'h.p.badiss', 'h.p.unknown', 'not-a-jwt']) {
    assert.equal((await c.call('/auth.php?action=login', { method: 'POST', body: { credential: t } })).status, 401, t);
  }
  assert.equal((await c.call('/auth.php?action=login', { method: 'POST', body: { credential: 'h.p.alice' }, xhr: false })).status, 403);
});
test('login sets HttpOnly SameSite cookie, me works, progress requires auth', { skip: !hasPhp }, async () => {
  const c = client();
  assert.equal((await c.call('/progress.php')).status, 401);
  const r = await c.call('/auth.php?action=login', { method: 'POST', body: { credential: 'h.p.alice' } });
  assert.equal(r.status, 200); assert.equal(r.body.user.email, 'alice@example.com'); assert.equal(r.body.merged_local, false);
  assert.match(r.setCookie, /HttpOnly/i); assert.match(r.setCookie, /SameSite=Lax/i);
  assert.equal((await c.call('/auth.php?action=me')).body.user.name, 'Alice');
});
test('first-login merge, per-user isolation, newest-wins merge, logout', { skip: !hasPhp }, async () => {
  const a = client(); const b = client();
  await a.call('/auth.php?action=login', { method: 'POST', body: { credential: 'h.p.alice' } });
  await b.call('/auth.php?action=login', { method: 'POST', body: { credential: 'h.p.bob' } });
  const local = { 'muscle_trapezius::navn': { interval: 6, last: 1000 }, 'bone_femur::navn': { interval: 1, last: 500 } };
  let r = await a.call('/progress.php', { method: 'PUT', body: { progress: local, meta: { xp: 40, streak: 2, lastDay: '2026-10-13', tests: [] }, merge_local: true } });
  assert.equal(r.status, 200); assert.equal(r.body.merged_local, true);
  // second device pushes older + newer states
  r = await a.call('/progress.php', { method: 'PUT', body: { progress: { 'muscle_trapezius::navn': { interval: 1, last: 900 }, 'bone_femur::navn': { interval: 7, last: 2000 } }, meta: { xp: 10 } } });
  assert.equal(r.body.progress['muscle_trapezius::navn'].interval, 6);
  assert.equal(r.body.progress['bone_femur::navn'].interval, 7);
  assert.equal(r.body.meta.xp, 40);
  assert.deepEqual((await b.call('/progress.php')).body.progress, {});
  // re-login reports merged_local=true so the client won't merge again
  const a2 = client();
  assert.equal((await a2.call('/auth.php?action=login', { method: 'POST', body: { credential: 'h.p.alice' } })).body.merged_local, true);
  assert.equal((await a.call('/progress.php', { method: 'PUT', body: { progress: {} }, xhr: false })).status, 403);
  await a.call('/auth.php?action=logout', { method: 'POST', body: {} });
  assert.equal((await a.call('/progress.php')).status, 401);
});
test('guest mode: config null when client id unset; login disabled', { skip: !hasPhp }, async () => {
  const cfg = join(dir, 'guest.php'); writeFileSync(cfg, `<?php return ['sqlite_path' => '${join(dir, 'g.sqlite')}'];`);
  const p2 = port + 300;
  const s = spawn('php', ['-S', `127.0.0.1:${p2}`, '-t', root], { env: { ...process.env, KQ_CONFIG: cfg }, stdio: 'ignore' });
  try {
    await wait(`http://127.0.0.1:${p2}/api/auth.php?action=config`);
    const r = await (await fetch(`http://127.0.0.1:${p2}/api/auth.php?action=config`)).json();
    assert.equal(r.google_client_id, null);
    const l = await fetch(`http://127.0.0.1:${p2}/api/auth.php?action=login`, { method: 'POST', headers: { 'X-KQ': '1' }, body: '{"credential":"h.p.alice"}' });
    assert.equal(l.status, 503);
  } finally { s.kill(); }
});
test('no client id hardcoded in frontend; CSP allows GIS', () => {
  const app = readFileSync(join(root, 'src/app.js'), 'utf8');
  assert.ok(!/apps\.googleusercontent\.com/.test(app));
  assert.match(readFileSync(join(root, 'src/.htaccess'), 'utf8'), /frame-src https:\/\/accounts\.google\.com\/gsi\//);
  assert.match(readFileSync(join(root, 'src/_data/.htaccess'), 'utf8'), /Require all denied/);
});
