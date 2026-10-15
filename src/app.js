import {
  TOPICS, FACETS, DEFAULT_FACETS, normalize, regionsOf, filterItems, describe, facetsFor,
  makeQuestion, mediaOf, hasImage, altFor, mergeProgress, mergeMeta, sm2, isMastered, isDue, key, pickDrill, scoreXp, updateStreak, validateReport, shuffle,
} from './lib/quiz.js';
import * as MEM from './lib/memory.js';
import { tierFor, fmt, medal, MODE_POINTS, CATEGORY_OF_TOPIC, CATEGORY_LABEL, MODE_LABEL, PERIOD_LABEL, sessionId } from './lib/highscore.js';
import { PRIVACY_TITLE, PRIVACY_TEXT, TERMS_TITLE, TERMS_TEXT } from './lib/privacy.js';

const $main = document.getElementById('main');
const $live = document.getElementById('live');
const $sheet = document.getElementById('sheet');
const LS = { progress: 'kq.progress.v1', meta: 'kq.meta.v1', settings: 'kq.settings.v1', reports: 'kq.pendingReports.v1', dirty: 'kq.dirty.v1', owner: 'kq.owner.v1', scoreQueue: 'kq.scoreQueue.v1', localScore: 'kq.localScore.v1', hs: 'kq.hsFilters.v1' };
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota/private */ }
  if (k === LS.progress || k === LS.meta) scheduleSync();
};

let ITEMS = [];
let BY_ID = new Map();
let QUIZ_ITEMS = [];
let progress = load(LS.progress, {});
let meta = load(LS.meta, { xp: 0, streak: 0, lastDay: null, tests: [] });
let settings = load(LS.settings, { facets: DEFAULT_FACETS, timer: 45, theme: 'system', motion: 'system', shortcuts: true });
let session = null;
// ---------- Account + server sync (localStorage stays the offline cache) ----------
let auth = { clientId: null, user: null, syncing: false, lastSync: null, error: null };
let syncTimer = null;
const api = async (path, opts = {}) => {
  const r = await fetch(path, { credentials: 'same-origin', ...opts, headers: { 'Content-Type': 'application/json', 'X-KQ': '1', ...(opts.headers || {}) } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(body.error || r.status), { status: r.status, body });
  return body;
};
function scheduleSync() { if (!auth.user) return; save(LS.dirty, true); clearTimeout(syncTimer); syncTimer = setTimeout(pushProgress, 1500); }
async function pushProgress(mergeLocal = false) {
  if (!auth.user || !navigator.onLine) return;
  auth.syncing = true;
  try {
    const r = await api('api/progress.php', { method: 'PUT', body: JSON.stringify({ progress, meta, merge_local: mergeLocal }) });
    progress = mergeProgress(progress, r.progress); meta = mergeMeta(meta, r.meta);
    localStorage.setItem(LS.progress, JSON.stringify(progress)); localStorage.setItem(LS.meta, JSON.stringify(meta));
    localStorage.removeItem(LS.dirty); auth.lastSync = Date.now(); auth.error = null;
  } catch (e) { auth.error = e.status === 401 ? null : 'Kunne ikke synkronisere'; if (e.status === 401) auth.user = null; }
  auth.syncing = false;
}
/** After login: first time -> merge local guest progress into account; later -> server is source, local unsynced changes merged. */
async function afterLogin(mergedBefore) {
  const r = await api('api/progress.php');
  const dirty = load(LS.dirty, false);
  if (!mergedBefore && !r.merged_local) {
    progress = mergeProgress(r.progress, progress); meta = mergeMeta(r.meta, meta);
    await pushProgress(true);
    toast('Dit lokale fremskridt er flettet ind i din konto');
  } else if (dirty && load(LS.owner, null) === auth.user.id) {
    progress = mergeProgress(r.progress, progress); meta = mergeMeta(r.meta, meta); await pushProgress();
  } else {
    progress = r.progress || {}; meta = { xp: 0, streak: 0, lastDay: null, tests: [], ...(r.meta || {}) };
    localStorage.setItem(LS.progress, JSON.stringify(progress)); localStorage.setItem(LS.meta, JSON.stringify(meta));
    auth.lastSync = Date.now();
  }
  save(LS.owner, auth.user.id);
}
async function initAuth() {
  try { auth.clientId = (await api('api/auth.php?action=config')).google_client_id; } catch { auth.clientId = null; }
  if (!auth.clientId) return; // guest mode
  try { auth.user = (await api('api/auth.php?action=me')).user; } catch { auth.user = null; }
  if (auth.user) { try { await afterLogin(true); } catch { /* offline: keep cache */ } }
}
function loadGis() {
  if (window.google?.accounts?.id) return Promise.resolve();
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = res; s.onerror = rej; document.head.append(s); });
}
async function renderGoogleButton(el) {
  try {
    await loadGis();
    google.accounts.id.initialize({ client_id: auth.clientId, callback: onCredential, ux_mode: 'popup', use_fedcm_for_prompt: true });
    google.accounts.id.renderButton(el, { theme: document.documentElement.dataset.theme === 'dark' || matchMedia('(prefers-color-scheme: dark)').matches ? 'filled_black' : 'outline', size: 'large', text: 'signin_with', shape: 'pill', locale: 'da' });
  } catch { el.textContent = 'Google-login kunne ikke indlæses.'; }
}
async function onCredential(resp) {
  try {
    const r = await api('api/auth.php?action=login', { method: 'POST', body: JSON.stringify({ credential: resp.credential }) });
    const prevOwner = load(LS.owner, null);
    auth.user = r.user;
    if (prevOwner && prevOwner !== r.user.id) { progress = {}; meta = { xp: 0, streak: 0, lastDay: null, tests: [] }; } // different account on this device
    await afterLogin(r.merged_local || (prevOwner && prevOwner !== r.user.id));
    toast(`Logget ind som ${r.user.name || r.user.email}`); flushScores(); route();
  } catch { toast('Login mislykkedes'); }
}
async function logout() {
  try { await pushProgress(); await api('api/auth.php?action=logout', { method: 'POST', body: '{}' }); } catch { /* ignore */ }
  try { window.google?.accounts?.id?.disableAutoSelect(); } catch { /* */ }
  auth.user = null; progress = {}; meta = { xp: 0, streak: 0, lastDay: null, tests: [] };
  [LS.progress, LS.meta, LS.dirty, LS.owner].forEach((k) => localStorage.removeItem(k));
  toast('Logget ud'); route();
}

let timerId = null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nameHtml = (it) => `${esc(it.name_da)} <span class="la" lang="la">(${esc(it.name_la_ta2)})</span>`;
const announce = (t) => { $live.textContent = ''; setTimeout(() => { $live.textContent = t; }, 30); };
function toast(t) { const d = document.createElement('div'); d.className = 'toast'; d.setAttribute('role', 'status'); d.textContent = t; document.body.append(d); setTimeout(() => d.remove(), 2600); }
function applyPrefs() {
  const r = document.documentElement;
  if (settings.theme === 'system') { delete r.dataset.theme; localStorage.removeItem('kq.theme'); } else { r.dataset.theme = settings.theme; localStorage.setItem('kq.theme', settings.theme); }
  if (settings.motion === 'reduce') r.dataset.motion = 'reduce'; else delete r.dataset.motion;
}
function itemMastery(it) {
  const fs = facetsFor(it, settings.facets);
  const m = fs.filter((f) => isMastered(progress[key(it.id, f)])).length;
  const started = fs.some((f) => progress[key(it.id, f)]);
  return { total: fs.length, mastered: m, state: fs.length && m === fs.length ? 'full' : (m || started) ? 'half' : '' };
}
const masteryLabel = (s) => (s === 'full' ? 'Mestret' : s === 'half' ? 'I gang' : 'Ikke startet');
const reviewIcon = (it) => (it.needs_review ? `<button class="review" type="button" data-review="${esc(it.id)}" aria-label="Under faglig gennemgang" title="Under faglig gennemgang">i</button>` : '');

// ---------- Router ----------
const routes = [
  [/^#?\/?$/, home], [/^#\/udforsk\/?$/, explore], [/^#\/udforsk\/([\w-]+)$/, detail],
  [/^#\/traen$/, train], [/^#\/session$/, runSession], [/^#\/test$/, testSetup], [/^#\/profil$/, profile], [/^#\/privatliv$/, privacy], [/^#\/vilkaar$/, terms], [/^#\/highscore$/, highscore], [/^#\/memory$/, memorySetup], [/^#\/memory\/spil$/, memoryPlay],
];
function route() {
  clearInterval(timerId);
  document.title = 'Anatomi – anatomiquiz for fysioterapeutstuderende';
  const h = location.hash || '#/';
  const path = h.split('?')[0];
  const params = new URLSearchParams(h.split('?')[1] || '');
  for (const [re, fn] of routes) {
    const m = path.match(re);
    if (m) {
      const nav = path.split('/')[1] || 'home';
      document.querySelectorAll('[data-nav]').forEach((a) => a.toggleAttribute('aria-current', false));
      const navKey = nav === 'session' ? (session?.mode === 'test' ? 'test' : 'traen') : nav === 'memory' ? 'traen' : nav === 'highscore' ? 'home' : nav;
      const cur = document.querySelector(`[data-nav="${navKey}"]`);
      if (cur) cur.setAttribute('aria-current', 'page');
      fn(m[1], params);
      window.scrollTo(0, 0);
      return;
    }
  }
  location.hash = '#/';
}

// ---------- Views ----------
function home() {
  const all = QUIZ_ITEMS.flatMap((it) => facetsFor(it, settings.facets).map((f) => progress[key(it.id, f)]));
  const due = all.filter((s) => s && isDue(s)).length;
  const mastered = all.filter(isMastered).length;
  const last = meta.tests?.[meta.tests.length - 1];
  const rings = Object.entries(TOPICS).map(([t, def]) => {
    const its = QUIZ_ITEMS.filter((i) => i.topic === t);
    const done = its.filter((i) => itemMastery(i).state === 'full').length;
    const p = its.length ? Math.round((done / its.length) * 100) : 0;
    return `<a class="tile row" href="#/udforsk?topic=${t}"><div class="ring" style="--p:${p}" role="img" aria-label="${def.label}: ${done} af ${its.length} mestret">${p}%</div>
      <div><h3>${def.label}</h3><span class="muted">${done}/${its.length} mestret</span></div></a>`;
  }).join('');
  $main.innerHTML = `<div class="stack">
    <section class="hero"><h1>Klar til at terpe?</h1>
      <p>${due ? `Du har <b>${due}</b> kort til repetition i dag.` : 'Start med navngivning, og byg dig op til test.'}</p>
      <a class="btn" href="#/session?mode=${due ? 'drill' : 'naming'}">${due ? 'Fortsæt terping' : 'Start navngivning'}</a></section>
    <a class="tile rank-tile" href="#/highscore" id="ranktile">${rankTileHtml()}</a>
    <div class="grid">
      <div class="card stat"><b>🔥 ${meta.streak || 0}</b><span>dages streak</span></div>
      <div class="card stat"><b>${meta.xp || 0}</b><span>XP i alt</span></div>
      <div class="card stat"><b>${mastered}</b><span>facetter mestret</span></div>
      <div class="card stat"><b>${last ? `${last.score}/${last.total}` : '–'}</b><span>seneste test</span></div>
    </div>
    <h2>Dine emner</h2><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr))">${rings}</div></div>`;
  refreshRankTile();
}

function explore(_, params) {
  const topic = params.get('topic') || 'muscles';
  const region = params.get('region') || '';
  const q = params.get('q') || '';
  const inTopic = ITEMS.filter((i) => i.topic === topic);
  const regions = [...new Set(inTopic.flatMap(regionsOf))].sort((a, b) => a.localeCompare(b, 'da'));
  const list = filterItems(ITEMS, { topic, region, query: q }).sort((a, b) => a.name_da.localeCompare(b.name_da, 'da'));
  const link = (o) => { const p = new URLSearchParams({ topic, region, q, ...o }); [...p.keys()].forEach((k) => !p.get(k) && p.delete(k)); return `#/udforsk?${p}`; };
  $main.innerHTML = `<div class="stack"><h1>Udforsk</h1>
    <div class="chips" role="group" aria-label="Emne">${Object.entries(TOPICS).map(([t, d]) => `<a class="chip" role="button" aria-pressed="${t === topic}" href="${link({ topic: t, region: '' })}" style="display:inline-flex;align-items:center;text-decoration:none">${d.label}</a>`).join('')}</div>
    <label class="field">Søg<input type="search" id="q" value="${esc(q)}" placeholder="Fx deltoideus eller lårben" autocomplete="off"></label>
    <div class="chips" role="group" aria-label="Region"><a class="chip" role="button" aria-pressed="${!region}" href="${link({ region: '' })}" style="display:inline-flex;align-items:center;text-decoration:none">Alle</a>${regions.map((r) => `<a class="chip" role="button" aria-pressed="${r === region}" href="${link({ region: r })}" style="display:inline-flex;align-items:center;text-decoration:none">${esc(r)}</a>`).join('')}</div>
    <p class="muted" aria-live="polite">${list.length} ${list.length === 1 ? TOPICS[topic].singular : TOPICS[topic].label.toLowerCase()}</p>
    <ul class="list">${list.map((it) => { const m = itemMastery(it); return `<li><a href="#/udforsk/${esc(it.id)}">
      <span class="row" style="flex-wrap:nowrap;gap:12px">${hasImage(it) ? `<img class="thumb" src="${esc(it.images[0].url)}" alt="" loading="lazy" width="48" height="48">` : ''}<span class="t"><span>${esc(it.name_da)}</span><small class="la" lang="la">${esc(it.name_la_ta2)}</small></span></span>
      <span class="row" style="flex-wrap:nowrap">${it.needs_review ? '<span class="review" aria-label="Under faglig gennemgang" role="img">i</span>' : ''}<span class="dot ${m.state}" role="img" aria-label="${masteryLabel(m.state)}"></span></span></a></li>`; }).join('') || '<li class="empty">Ingen resultater.</li>'}</ul>
    <a class="btn block" href="#/session?mode=naming&topic=${topic}${region ? `&region=${encodeURIComponent(region)}` : ''}">Navngiv ${esc(region || TOPICS[topic].label.toLowerCase())}</a></div>`;
  const input = document.getElementById('q');
  let t; input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { history.replaceState(null, '', link({ q: input.value })); explore(_, new URLSearchParams(link({ q: input.value }).split('?')[1])); const i2 = document.getElementById('q'); i2.focus(); i2.setSelectionRange(i2.value.length, i2.value.length); }, 200); });
}

function detail(id) {
  const it = BY_ID.get(id);
  if (!it) { $main.innerHTML = '<div class="empty"><h1>Ikke fundet</h1><a href="#/udforsk">Til Udforsk</a></div>'; return; }
  const rows = [];
  const add = (k, v) => v && rows.push(`<dt>${k}</dt><dd>${v}</dd>`);
  add('Region', esc(it.region));
  if (it.topic === 'bones') { add('Type', esc(it.type)); add('Antal i kroppen', esc(it.count_in_body)); add('Landemærker', it.landmarks?.length ? `<ul>${it.landmarks.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''); }
  add('Udspring', esc(FACETS.udspring.get(it))); add('Hæfte', esc(FACETS.haefte.get(it))); add('Innervation', esc(FACETS.innervation.get(it)));
  add('Funktion', esc(it.function_da)); add('Blodforsyning', esc(it.blood_supply_da));
  if (it.associated_muscles?.length) add('Muskler', it.associated_muscles.map((m) => BY_ID.get(m) ? `<a href="#/udforsk/${esc(m)}">${esc(BY_ID.get(m).name_da)}</a>` : esc(m)).join(', '));
  const m = itemMastery(it);
  $main.innerHTML = `<article class="stack">
    <a class="link" href="#/udforsk?topic=${it.topic}">← ${TOPICS[it.topic].label}</a>
    ${imageBlock(it)}
    <div class="spread"><span class="badge">${TOPICS[it.topic].singular}</span>${it.needs_review ? `<button class="pill-review" data-review="${esc(it.id)}">ⓘ Under faglig gennemgang</button>` : ''}</div>
    <h1>${esc(it.name_da)}<br><span class="la" lang="la" style="font-size:20px;font-weight:600">${esc(it.name_la_ta2)}</span></h1>
    <div class="card"><dl class="facts">${rows.join('')}</dl></div>
    ${it.needs_review ? '' : `<p class="muted">${m.mastered}/${m.total} facetter mestret</p>`}
    ${it.needs_review ? '<p class="muted">Kortet indgår ikke i quizzer, før det er fagligt gennemgået.</p>' : ''}
    <div class="row">${it.needs_review ? '' : `<a class="btn" href="#/session?mode=drill&ids=${esc(it.id)}">Terp dette kort</a>`}
      <button class="btn secondary" data-report="${esc(it.id)}">Rapportér fejl</button></div>
    <details class="card"><summary>Kilder</summary><ul>${(it.sources || []).map((s) => `<li>${esc(s)}</li>`).join('')}
      ${(it.source_urls || []).map((u) => /^https?:\/\//.test(u) ? `<li><a href="${esc(u)}" rel="noopener" target="_blank">${esc(u)}</a></li>` : '').join('')}</ul>
      ${it.ta2_id ? `<p class="muted">TA2 ID ${esc(it.ta2_id)}</p>` : ''}</details></article>`;
  bindImageBlock(it);
}

function train() {
  const f = settings.facets;
  $main.innerHTML = `<div class="stack"><h1>Træn</h1>
    <a class="tile" href="#/session?mode=naming"><h2>① Navngivning</h2><p class="muted">Læs beskrivelsen og vælg strukturen. Ingen tidspres.</p></a>
    <a class="tile" href="#/session?mode=drill"><h2>② Terping</h2><p class="muted">Spaced repetition pr. facet – forfaldne kort først.</p></a>
    <a class="tile" href="#/test"><h2>③ Test</h2><p class="muted">Kun mestret, fagligt gennemgået materiale – med timer.</p></a>
    <a class="tile" href="#/memory"><h2>④ Memory</h2><p class="muted">Find parrene – dansk ↔ latin${QUIZ_ITEMS.some(hasImage) ? ' eller billede ↔ navn' : ''}.</p></a>
    <form id="setup" class="card stack"><h2>Sæt</h2>${setupFields()}
      <fieldset><legend><b>Facetter i terping</b></legend><div class="chips">${Object.entries(FACETS).map(([k, d]) => `<button type="button" class="chip" data-facet="${k}" aria-pressed="${f.includes(k)}">${d.label}</button>`).join('')}</div></fieldset>
      <div class="row"><button class="btn" name="mode" value="naming">Navngivning</button><button class="btn secondary" name="mode" value="drill">Terping</button></div></form></div>`;
  $main.querySelectorAll('[data-facet]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.facet; const on = settings.facets.includes(k);
    if (on && settings.facets.length === 1) return toast('Mindst én facet skal være valgt');
    settings.facets = on ? settings.facets.filter((x) => x !== k) : [...settings.facets, k];
    save(LS.settings, settings); b.setAttribute('aria-pressed', String(!on));
  }));
  bindSetup('#setup');
}
function setupFields(extra = '') {
  const regions = [...new Set(ITEMS.flatMap(regionsOf))].sort((a, b) => a.localeCompare(b, 'da'));
  return `<label class="field">Emne<select name="topic"><option value="">Alle emner</option>${Object.entries(TOPICS).map(([t, d]) => `<option value="${t}">${d.label}</option>`).join('')}</select></label>
    <label class="field">Region<select name="region"><option value="">Alle regioner</option>${regions.map((r) => `<option>${esc(r)}</option>`).join('')}</select></label>
    <label class="field">Antal spørgsmål<select name="n"><option>10</option><option>20</option><option>30</option></select></label>${extra}`;
}
function bindSetup(sel, mode) {
  const form = $main.querySelector(sel);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form); const m = mode || e.submitter?.value || 'naming';
    const p = new URLSearchParams({ mode: m });
    for (const k of ['topic', 'region', 'n', 'timer', 'pool']) if (fd.get(k)) p.set(k, fd.get(k));
    if (m === 'test' && fd.get('timer')) { settings.timer = Number(fd.get('timer')); save(LS.settings, settings); }
    location.hash = `#/session?${p}`;
  });
}

function testPool(topic, region, all) {
  const items = filterItems(ITEMS, { topic, region, testMode: true });
  const cards = items.flatMap((it) => facetsFor(it, settings.facets).map((f) => ({ item: it, facet: f })));
  return all ? cards : cards.filter((c) => isMastered(progress[key(c.item.id, c.facet)]));
}
function testSetup() {
  const mastered = testPool('', '', false).length;
  const ok = mastered >= 10;
  $main.innerHTML = `<div class="stack"><h1>Test</h1>
    <div class="card"><p>${ok ? `Du har <b>${mastered}</b> mestrede facetter klar til test.` : `Test bygger på mestret materiale: <b>${mastered}/10</b> facetter mestret. Terp videre – eller tag en øvetest på alt verificeret materiale.`}</p>
      <p class="muted">Kort under faglig gennemgang indgår aldrig i test.</p>
      ${ok ? '' : '<a class="btn secondary" href="#/session?mode=drill">Gå til Terping</a>'}</div>
    <form id="tsetup" class="card stack">${setupFields(`
      <label class="field">Tid pr. spørgsmål<select name="timer">${[[45, '45 sek.'], [90, 'Forlænget (90 sek.)'], [0, 'Uden tid']].map(([v, l]) => `<option value="${v}" ${settings.timer === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field">Materiale<select name="pool">${ok ? '<option value="mastered">Kun mestret</option>' : ''}<option value="all">Øvetest: alt verificeret</option></select></label>`)}
      <button class="btn block">Start test</button></form></div>`;
  bindSetup('#tsetup', 'test');
}

function privacy() {
  const text = esc(PRIVACY_TEXT).replace('ulrik.henriksen@gmail.com', '<a href="mailto:ulrik.henriksen@gmail.com">ulrik.henriksen@gmail.com</a>');
  $main.innerHTML = `<article class="stack"><a class="link" href="#/profil">← Profil</a><h1>${PRIVACY_TITLE}</h1><div class="card"><p id="privacy-text" style="margin:0">${text}</p></div></article>`;
  document.title = 'Privatliv – Anatomi';
}
function terms() {
  const text = esc(TERMS_TEXT).replace('ulrik.henriksen@gmail.com', '<a href="mailto:ulrik.henriksen@gmail.com">ulrik.henriksen@gmail.com</a>');
  $main.innerHTML = `<article class="stack"><a class="link" href="#/profil">← Profil</a><h1>${TERMS_TITLE}</h1><div class="card"><p id="terms-text" style="margin:0">${text}</p></div></article>`;
  document.title = 'Vilkår – Anatomi';
}
const legalLinks = '<a href="/privatliv">Privatliv</a> · <a href="/vilkaar">Vilkår</a>';
function accountHtml() {
  if (!auth.clientId) return '<p class="muted">Login er ikke slået til endnu – du bruger Anatomi som gæst.</p>';
  if (!auth.user) return `<p>Log ind for at gemme dit fremskridt på tværs af enheder. Dit nuværende fremskridt flyttes med første gang.</p><div id="gbtn"></div><p class="muted sync">Ved at logge ind accepterer du vores ${legalLinks}.</p>`;
  const u = auth.user;
  return `<div class="account"><span class="avatar" aria-hidden="true">${esc((u.name || u.email || '?').trim().charAt(0).toUpperCase())}</span><div><b>${esc(u.name || '')}</b><br><span class="muted">${esc(u.email || '')}</span></div></div>
    <p class="muted sync">${auth.error ? esc(auth.error) : auth.lastSync ? `Synkroniseret ${new Date(auth.lastSync).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' })}` : 'Ikke synkroniseret endnu'}</p>
    <p class="sync">${legalLinks}</p>
    <div class="row"><button class="btn secondary" id="syncnow">Synkronisér nu</button><button class="btn ghost" id="logout">Log ud</button></div>
    <div id="hsprofile" class="stack"></div>
    <button class="link" id="delacct" style="color:var(--color-error);align-self:flex-start">Slet konto og data</button>`;
}
function profile() {
  const pending = load(LS.reports, []).length;
  $main.innerHTML = `<div class="stack"><h1>Profil</h1>
    <div class="card stack"><h2>Udseende</h2>
      <label class="field">Tema<select id="theme">${[['system', 'Følg system'], ['light', 'Lyst'], ['dark', 'Mørkt']].map(([v, l]) => `<option value="${v}" ${settings.theme === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field">Bevægelse<select id="motion">${[['system', 'Følg system'], ['reduce', 'Reducér animationer']].map(([v, l]) => `<option value="${v}" ${settings.motion === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="row"><input type="checkbox" id="sc" ${settings.shortcuts ? 'checked' : ''} style="width:24px;height:24px"> Tastaturgenveje 1–4 og Enter i quiz</label></div>
    <div class="card stack"><h2>Konto</h2>${accountHtml()}</div>
    <div class="card stack"><h2>Fremskridt</h2><p class="muted">${auth.user ? 'Gemmes på din konto og i browseren (offline).' : 'Gemmes lokalt i denne browser.'} ${pending ? `${pending} fejlrapport(er) venter på at blive sendt.` : ''}</p>
      <div class="row"><button class="btn secondary" id="export">Eksportér</button><button class="btn ghost" id="reset">Nulstil fremskridt</button></div></div>
    <div class="card"><h2>Hvad betyder mestret?</h2><p>En facet er mestret, når intervallet er mindst 7 dage, og du har svaret rigtigt 3 gange i træk fordelt på mindst 2 dage.</p></div>
    <a class="tile" href="#/highscore"><h2>🏆 Highscore</h2><p class="muted">Din rang og ranglisten.</p></a>
    <div class="grid"><a class="tile" href="/privatliv"><h2>Privatliv</h2><p class="muted">Hvad Anatomi gemmer, og hvordan du får data slettet.</p></a>
    <a class="tile" href="/vilkaar"><h2>Vilkår</h2><p class="muted">Gratis læringsværktøj – ikke medicinsk rådgivning.</p></a></div>
    <p class="muted">Data: Anatomi research v0.3 · ${ITEMS.length} strukturer.</p></div>`;
  const gb = document.getElementById('gbtn'); if (gb) renderGoogleButton(gb);
  const lo = document.getElementById('logout'); if (lo) lo.onclick = logout;
  const da = document.getElementById('delacct'); if (da) da.onclick = deleteAccount;
  const hp = document.getElementById('hsprofile'); if (hp) renderHsProfile(hp);
  const sn = document.getElementById('syncnow'); if (sn) sn.onclick = async () => { await pushProgress(); profile(); };
  const s = (k, v) => { settings[k] = v; save(LS.settings, settings); applyPrefs(); };
  document.getElementById('theme').onchange = (e) => s('theme', e.target.value);
  document.getElementById('motion').onchange = (e) => s('motion', e.target.value);
  document.getElementById('sc').onchange = (e) => s('shortcuts', e.target.checked);
  document.getElementById('export').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ progress, meta, settings }, null, 2)], { type: 'application/json' }));
    a.download = 'anatomi-fremskridt.json'; a.click();
  };
  document.getElementById('reset').onclick = () => { if (confirm(auth.user ? 'Nulstil fremskridt på denne enhed? (Kontoens fremskridt hentes igen ved næste login.)' : 'Slet alt fremskridt på denne enhed?')) { progress = {}; meta = { xp: 0, streak: 0, lastDay: null, tests: [] }; save(LS.progress, progress); save(LS.meta, meta); toast('Fremskridt nulstillet'); } };
}

// ---------- Session runner (naming / drill / test) ----------
function buildSession(params) {
  const mode = params.get('mode') || 'naming';
  const topic = params.get('topic') || ''; const region = params.get('region') || '';
  const n = Number(params.get('n')) || 10;
  const ids = params.get('ids')?.split(',');
  let cards;
  if (mode === 'test') {
    cards = shuffle(testPool(topic, region, params.get('pool') === 'all')).slice(0, n);
  } else {
    let items = (ids ? ids.map((i) => BY_ID.get(i)).filter(Boolean) : filterItems(ITEMS, { topic, region })).filter((i) => !i.needs_review);
    if (mode === 'naming') cards = shuffle(items).slice(0, n).map((it) => ({ item: it, facet: 'naming' }));
    else cards = pickDrill(items, progress, settings.facets, ids ? 20 : n);
  }
  const questions = cards.map((c) => makeQuestion(c.item, c.facet, QUIZ_ITEMS)).filter((q) => q && q.options.length >= 2);
  return { id: sessionId(), events: [], mode, questions, i: 0, score: 0, xp: 0, wrong: [], timer: mode === 'test' ? settings.timer : 0, params: params.toString() };
}
function runSession(_, params) {
  if (!session || session.params !== params.toString() || session.done) session = buildSession(params);
  if (!session.questions.length) { $main.innerHTML = '<div class="empty card"><h1>Intet at øve her</h1><p class="muted">Prøv et andet emne eller en anden region.</p><a class="btn" href="#/traen">Til Træn</a></div>'; return; }
  renderQuestion();
}
const modeLabel = { naming: 'Navngivning', drill: 'Terping', test: 'Test' };
function renderQuestion() {
  const s = session; const q = s.questions[s.i]; const it = BY_ID.get(q.itemId);
  s.shownAt = Date.now();
  const pct = Math.round((s.i / s.questions.length) * 100);
  const facetLabel = q.kind === 'naming' ? '' : FACETS[q.kind].label;
  const legend = q.kind === 'naming'
    ? `<span class="prompt">Hvilken ${TOPICS[it.topic].singular} beskrives?</span>`
    : q.kind === 'navn'
      ? `<span class="prompt">Hvad hedder <span lang="la">${esc(it.name_la_ta2)}</span> på dansk?</span>`
      : `<span class="prompt">${esc(facetLabel)}: ${nameHtml(it)}</span>`;
  $main.innerHTML = `<div class="stack quiz">
    <div class="spread"><button class="btn ghost" id="quit" aria-label="Afslut session">✕</button>
      <div class="progress" style="flex:1" role="progressbar" aria-label="Fremskridt" aria-valuemin="0" aria-valuemax="${s.questions.length}" aria-valuenow="${s.i}"><i style="width:${pct}%"></i></div>
      ${s.timer ? `<span class="timer" id="timer" role="timer" aria-live="off">${s.timer}</span>` : `<span class="badge">${modeLabel[s.mode]}</span>`}</div>
    ${q.kind === 'naming' ? gameImage(it) : ''}
    ${q.kind === 'naming' ? `<ul class="clue">${q.prompt.map((p) => `<li><b>${esc(p.label)}</b>${esc(p.value)}</li>`).join('')}</ul>` : ''}
    <fieldset><legend id="qlegend">${legend} ${reviewIcon(it)}</legend>
      <div class="options">${q.options.map((o, k) => `<button class="opt" data-k="${k}" aria-describedby="qlegend"><span class="n" aria-hidden="true">${k + 1}</span><span>${optLabel(q, o)}</span></button>`).join('')}</div></fieldset>
    <div id="fb"></div></div>`;
  $main.querySelectorAll('.opt').forEach((b) => b.addEventListener('click', () => answer(Number(b.dataset.k))));
  document.getElementById('quit').onclick = () => { if (s.i === 0 || confirm('Afslut sessionen?')) { session = null; location.hash = '#/traen'; } };
  $main.querySelector('.opt').focus({ preventScroll: true });
  if (s.timer) startTimer(s.timer);
}
function optLabel(q, o) {
  if (q.kind === 'naming') { const m = ITEMS.find((x) => x.name_da === o); return m ? nameHtml(m) : esc(o); }
  return esc(o);
}
function startTimer(sec) {
  let left = sec; const el = document.getElementById('timer');
  clearInterval(timerId);
  timerId = setInterval(() => {
    left -= 1; el.textContent = left;
    if (left === 10) { el.classList.add('warn'); announce('10 sekunder tilbage'); }
    if (left <= 0) { clearInterval(timerId); announce('Tiden er gået'); answer(-1); }
  }, 1000);
}
function answer(k) {
  const s = session; const q = s.questions[s.i]; const it = BY_ID.get(q.itemId);
  if (s.answered === s.i) return; s.answered = s.i; clearInterval(timerId);
  const chosen = q.options[k]; const ok = chosen === q.correct;
  $main.querySelectorAll('.opt').forEach((b, j) => {
    b.disabled = true;
    if (q.options[j] === q.correct) { b.classList.add('right'); b.insertAdjacentHTML('beforeend', '<span style="margin-left:auto">✓ <span class="sr-only">Rigtigt svar</span></span>'); }
    else if (j === k) { b.classList.add('wrong'); b.insertAdjacentHTML('beforeend', '<span style="margin-left:auto">✕ <span class="sr-only">Dit svar</span></span>'); }
  });
  if (chosen != null) s.events.push({ item_id: it.id, facet: q.kind, answer: chosen, ts: Date.now(), ms: Date.now() - (s.shownAt || Date.now()), correct: ok });
  if (ok) s.score += 1; else s.wrong.push({ id: it.id, kind: q.kind, correct: q.correct, chosen: chosen ?? '(ingen – tiden gik)' });
  // Progress: naming warms up the 'navn' facet; drill updates SR; test is read-only for SR (pure assessment)
  const facet = q.kind === 'naming' ? 'navn' : q.kind;
  if (s.mode !== 'test') { const kk = key(it.id, facet); progress[kk] = sm2(progress[kk], ok); save(LS.progress, progress); }
  const gained = scoreXp(ok, q.kind); s.xp += gained;
  meta = updateStreak(meta); meta.xp = (meta.xp || 0) + gained; save(LS.meta, meta);
  const fb = document.getElementById('fb');
  fb.innerHTML = `<div class="feedback ${ok ? 'ok' : 'bad'}" role="region" aria-label="Feedback"><h2 tabindex="-1" id="fbh">${ok ? '✓ Rigtigt' : '✕ Forkert'}</h2>
    <p>${ok ? '' : 'Rigtigt svar: '}${optLabel(q, q.correct)}${q.kind !== 'naming' ? ` · <a href="#/udforsk/${esc(it.id)}">${esc(it.name_da)}</a>` : ''}</p>
    <div class="spread"><button class="link" data-report="${esc(it.id)}" data-field="${esc(q.kind)}">Rapportér fejl</button>
      <button class="btn" id="next">${s.i + 1 < s.questions.length ? 'Fortsæt' : 'Se resultat'}</button></div></div>`;
  announce(`${ok ? 'Rigtigt' : 'Forkert. Rigtigt svar'}: ${q.kind === 'naming' ? `${it.name_da}, ${it.name_la_ta2}` : q.correct}`);
  document.getElementById('next').onclick = next;
  document.getElementById('next').focus({ preventScroll: false });
}
function next() {
  const s = session; s.i += 1;
  if (s.i < s.questions.length) { renderQuestion(); return; }
  s.done = true;
  if (s.mode === 'test') { meta.tests = [...(meta.tests || []), { at: Date.now(), score: s.score, total: s.questions.length }].slice(-20); save(LS.meta, meta); }
  const pct = Math.round((s.score / s.questions.length) * 100);
  $main.innerHTML = `<div class="stack"><div class="card" style="text-align:center"><h1>${pct >= 80 ? 'Sæt klaret! 🎉' : 'Godt arbejde'}</h1>
    <div class="score">${s.score}/${s.questions.length}</div><p class="muted">+${s.xp} XP · 🔥 ${meta.streak} dages streak</p><p id="pts" class="muted" aria-live="polite"></p></div>
    ${s.wrong.length ? `<h2>Fejlanalyse</h2><ul class="list">${s.wrong.map((w) => { const it = BY_ID.get(w.id); return `<li><a href="#/udforsk/${esc(it.id)}"><span class="t"><span>${nameHtml(it)}</span>
      <small>${w.kind === 'naming' ? 'Navngivning' : esc(FACETS[w.kind].label)}: ${esc(w.correct)} <span class="muted">(dit svar: ${esc(w.chosen)})</span></small></span>${it.needs_review ? '<span class="review" role="img" aria-label="Under faglig gennemgang">i</span>' : ''}</a></li>`; }).join('')}</ul>` : ''}
    <div class="row">${s.wrong.length ? `<a class="btn" href="#/session?mode=drill&ids=${s.wrong.map((w) => w.id).join(',')}">Terp fejlene</a>` : ''}
      <a class="btn secondary" href="#/session?${s.params}" id="again">Igen</a><a class="btn ghost" href="#/">Hjem</a></div></div>`;
  document.getElementById('again').onclick = () => { session = null; };
  recordScore(s.mode, s.events, s.id, s.mode === 'test' ? { timer: s.timer } : {}).then((r) => showPoints(r));
  $main.querySelector('h1').setAttribute('tabindex', '-1'); $main.querySelector('h1').focus();
}

// ---------- Sheets: needs_review info + report ----------
function openSheet(html) { $sheet.innerHTML = `<div class="inner stack">${html}<button class="btn secondary block" data-close>Luk</button></div>`; $sheet.showModal(); }
function reviewSheet(it) {
  openSheet(`<h2 id="sheet-title">ⓘ Under faglig gennemgang</h2><p>Dette kort er endnu ikke fagligt gennemgået. Brug dine lærebøger som facit.</p>
    ${it.verification_note ? `<p class="muted">${esc(it.verification_note)}</p>` : ''}<p class="muted">Kort under gennemgang indgår ikke i Test.</p>
    <button class="btn block" data-report="${esc(it.id)}">Rapportér fejl</button>`);
}
function reportSheet(it, field) {
  openSheet(`<h2 id="sheet-title">Rapportér fejl</h2><p>${nameHtml(it)}</p>
    <form id="rf" class="stack"><label class="field">Hvad er forkert?<textarea name="message" required minlength="3" maxlength="2000" placeholder="Fx: Innervationen bør være n. femoralis (L2-L4)"></textarea></label>
    <input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px">
    <button class="btn block">Send rapport</button></form>`);
  const f = document.getElementById('rf');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(f);
    const payload = { item_id: it.id, field: field || null, message: String(fd.get('message')), website: fd.get('website') || '', page: location.hash, data_version: '0.3' };
    if (validateReport(payload).length) return toast('Skriv venligst en kort beskrivelse');
    const okSent = await sendReport(payload);
    $sheet.close(); toast(okSent ? 'Tak! Rapporten er modtaget.' : 'Gemt – sendes når du er online.');
  };
}
async function sendReport(p) {
  try {
    const r = await fetch('api/report.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
    if (r.ok) return true;
    if (r.status === 400 || r.status === 429) return true; // rejected; don't queue forever
  } catch { /* offline */ }
  save(LS.reports, [...load(LS.reports, []), p].slice(-50));
  return false;
}
async function flushReports() {
  const q = load(LS.reports, []); if (!q.length) return;
  save(LS.reports, []);
  for (const p of q) await sendReport(p);
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-review],[data-report],[data-close]'); if (!t) return;
  if (t.dataset.close !== undefined) return $sheet.close();
  const id = t.dataset.review || t.dataset.report; const it = BY_ID.get(id); if (!it) return;
  e.preventDefault();
  if ($sheet.open) $sheet.close();
  if (t.dataset.review) reviewSheet(it); else reportSheet(it, t.dataset.field);
});
$sheet.addEventListener('click', (e) => { if (e.target === $sheet) $sheet.close(); });
document.addEventListener('keydown', (e) => {
  if (!settings.shortcuts || $sheet.open || !document.querySelector('.quiz') || /input|textarea|select/i.test(e.target.tagName)) return;
  if (/^[1-4]$/.test(e.key)) { const b = document.querySelector(`.opt[data-k="${Number(e.key) - 1}"]`); if (b && !b.disabled) b.click(); }
});

// ---------- Images (U1/U2). Hidden entirely when an item has no image. ----------
function creditHtml(img) {
  if (!img) return '';
  const lic = img.license_url ? `<a href="${esc(img.license_url)}" target="_blank" rel="noopener">${esc(img.license)}</a>` : esc(img.license);
  return `Kilde: <a href="${esc(img.source_url)}" target="_blank" rel="noopener">${esc(img.credit)}</a> · ${lic}`;
}
function imageBlock(it) {
  if (!hasImage(it)) return '';
  const n = it.images.length;
  return `<figure class="media" id="media" data-i="0">
    <div class="media-frame" aria-busy="true"><button class="media-open" type="button" aria-label="Åbn billede i galleri"><img id="media-img" alt="${esc(altFor(it.images[0], it, 'explore'))}" decoding="async"></button>
      <div class="media-error" hidden><span aria-hidden="true">🖼️</span><p>Billedet kunne ikke hentes</p><button class="btn secondary" type="button" id="media-retry">Prøv igen</button></div></div>
    ${n > 1 ? `<div class="media-nav"><button class="btn ghost" type="button" id="media-prev" aria-label="Forrige billede">←</button>
      <span class="dots" aria-hidden="true">${it.images.map((_, i) => `<i data-dot="${i}"></i>`).join('')}</span><span id="media-count">1/${n}</span>
      <button class="btn ghost" type="button" id="media-next" aria-label="Næste billede">→</button></div>` : ''}
    <figcaption class="credit" id="media-credit"></figcaption></figure>`;
}
function bindImageBlock(it) {
  const fig = document.getElementById('media'); if (!fig) return;
  const frame = fig.querySelector('.media-frame'); const img = document.getElementById('media-img'); const err = fig.querySelector('.media-error');
  let i = 0;
  const show = (k) => {
    i = (k + it.images.length) % it.images.length; const m = it.images[i];
    frame.setAttribute('aria-busy', 'true'); frame.classList.add('loading'); err.hidden = true; img.hidden = false;
    img.onload = () => { frame.classList.remove('loading'); frame.setAttribute('aria-busy', 'false'); };
    img.onerror = () => { frame.classList.remove('loading'); frame.setAttribute('aria-busy', 'false'); img.hidden = true; err.hidden = false; };
    img.alt = altFor(m, it, 'explore'); img.src = m.url;
    document.getElementById('media-credit').innerHTML = creditHtml(m);
    const c = document.getElementById('media-count'); if (c) c.textContent = `${i + 1}/${it.images.length}`;
    fig.querySelectorAll('[data-dot]').forEach((d) => d.classList.toggle('on', Number(d.dataset.dot) === i));
  };
  show(0);
  document.getElementById('media-retry').onclick = () => show(i);
  const prev = document.getElementById('media-prev'); const nxt = document.getElementById('media-next');
  if (prev) prev.onclick = () => show(i - 1); if (nxt) nxt.onclick = () => show(i + 1);
  let x0 = null;
  frame.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  frame.addEventListener('touchend', (e) => { if (x0 == null || it.images.length < 2) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) show(i + (dx < 0 ? 1 : -1)); x0 = null; });
  fig.querySelector('.media-open').onclick = () => openGallery(it, i);
}
function openGallery(it, start) {
  const d = document.createElement('dialog'); d.className = 'gallery'; d.setAttribute('aria-label', `Billeder: ${it.name_da}`);
  let i = start; let z = 1;
  d.innerHTML = `<div class="g-top"><span id="g-count"></span><button class="g-btn" id="g-close" aria-label="Luk galleri">✕</button></div>
    <div class="g-stage" id="g-stage"><img id="g-img" alt=""></div>
    <div class="g-bar"><button class="g-btn" id="g-prev" aria-label="Forrige billede">←</button><button class="g-btn" id="g-out" aria-label="Zoom ud">−</button>
      <button class="g-btn" id="g-in" aria-label="Zoom ind">+</button><button class="g-btn" id="g-next" aria-label="Næste billede">→</button></div>
    <p class="g-credit" id="g-credit"></p>`;
  document.body.append(d); d.showModal();
  const img = d.querySelector('#g-img');
  const apply = () => { img.style.transform = `scale(${z})`; };
  const show = (k) => { i = (k + it.images.length) % it.images.length; const m = it.images[i]; z = 1; apply(); img.src = m.url; img.alt = altFor(m, it, 'explore'); d.querySelector('#g-credit').innerHTML = creditHtml(m); d.querySelector('#g-count').textContent = `${i + 1}/${it.images.length}`; };
  const many = it.images.length > 1; d.querySelector('#g-prev').hidden = !many; d.querySelector('#g-next').hidden = !many;
  d.querySelector('#g-close').onclick = () => d.close();
  d.querySelector('#g-prev').onclick = () => show(i - 1); d.querySelector('#g-next').onclick = () => show(i + 1);
  d.querySelector('#g-in').onclick = () => { z = Math.min(4, z + 0.5); apply(); };
  d.querySelector('#g-out').onclick = () => { z = Math.max(1, z - 0.5); apply(); };
  img.ondblclick = () => { z = z > 1 ? 1 : 2; apply(); };
  d.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') show(i - 1); if (e.key === 'ArrowRight') show(i + 1); if (e.key === '+') d.querySelector('#g-in').click(); if (e.key === '-') d.querySelector('#g-out').click(); });
  d.addEventListener('close', () => d.remove());
  show(i); d.querySelector('#g-close').focus();
}
/** Quiz image (naming): neutral alt text that does not reveal the answer. */
function gameImage(it) {
  if (!hasImage(it) || !it.images[0].alt_neutral) return '';
  return `<figure class="media game"><div class="media-frame"><img src="${esc(it.images[0].url)}" alt="${esc(altFor(it.images[0], it, 'game'))}" loading="lazy"></div></figure>`;
}

// ---------- Points (server-side for logged-in users; local-only for guests) ----------
function localScore() { return load(LS.localScore, { total: 0 }); }
function addLocal(points) { const l = localScore(); l.total += points; save(LS.localScore, l); return l; }
async function recordScore(mode, events, sid, extra = {}) {
  const valid = events.filter((e) => BY_ID.get(e.item_id) && !BY_ID.get(e.item_id).needs_review);
  if (!valid.length) return null;
  if (!auth.user) {
    const pts = valid.filter((e) => e.correct !== false).length * MODE_POINTS[mode];
    const before = tierFor(localScore().total).name; const l = addLocal(pts);
    return { local: true, points: pts, totals: { all_time: l.total }, tier: tierFor(l.total), tierUp: tierFor(l.total).name !== before };
  }
  const body = { session_id: sid, mode, events: valid.slice(0, 60).map(({ correct, ...e }) => e), ...extra };
  try {
    const r = await api('api/score.php', { method: 'POST', body: JSON.stringify(body) });
    return r;
  } catch (e) {
    if (!e.status || e.status >= 500) { save(LS.scoreQueue, [...load(LS.scoreQueue, []), body].slice(-30)); return { queued: true }; }
    return null;
  }
}
async function flushScores() {
  if (!auth.user || !navigator.onLine) return;
  const q = load(LS.scoreQueue, []); if (!q.length) return;
  save(LS.scoreQueue, []);
  for (const b of q) { try { await api('api/score.php', { method: 'POST', body: JSON.stringify(b) }); } catch (e) { if (!e.status || e.status >= 500) save(LS.scoreQueue, [...load(LS.scoreQueue, []), b]); } }
}
function showPoints(r, el = document.getElementById('pts')) {
  if (!el || !r) return;
  if (r.queued) { el.textContent = 'Point sendes, når du er online.'; return; }
  const t = r.tier; const next = t?.next ? ` · ${fmt(t.next.to_go)} point til ${t.next.name}` : '';
  el.innerHTML = `🏆 +${fmt(r.points)} anatomipoint${r.local ? ' (lokalt)' : ''} · ${esc(t?.name || '')}${esc(next)}`;
  if (r.counted === 0 && r.reasons?.includes('daily_cap')) el.innerHTML += '<br>Dagens loft for point er nået.';
  if (r.reasons?.includes('test_set_already_counted')) el.innerHTML += '<br>Dette testsæt har allerede givet point.';
}

// ---------- Highscore (H1–H3) ----------
let rankCache = null;
function rankTileHtml() {
  if (!auth.user) { const t = tierFor(localScore().total); return `<span class="rank-ic" aria-hidden="true">🏆</span><span><b>Din rang: ${esc(t.name)}</b><br><span class="muted">${fmt(localScore().total)} point lokalt · Highscore</span></span>`; }
  if (!rankCache) return '<span class="rank-ic" aria-hidden="true">🏆</span><span><b>Highscore</b><br><span class="muted">Se din rang</span></span>';
  return `<span class="rank-ic" aria-hidden="true">🏆</span><span><b>Din rang: ${esc(rankCache.tier.name)}${rankCache.me ? ` · #${rankCache.me.rank}` : ''}</b><br><span class="muted">${fmt(rankCache.all_time_points)} point${rankCache.tier.next ? ` · ${fmt(rankCache.tier.next.to_go)} til ${esc(rankCache.tier.next.name)}` : ''}</span></span>`;
}
async function refreshRankTile() {
  if (!auth.user) return;
  try { rankCache = await api('api/leaderboard.php?period=all&category=alle&mode=alle&limit=1'); const el = document.getElementById('ranktile'); if (el) el.innerHTML = rankTileHtml(); } catch { /* offline */ }
}
function tierBar(points) {
  const t = tierFor(points); if (!t.next) return `<p class="muted">Højeste trin nået: ${esc(t.name)} 🎓</p>`;
  const pct = Math.round(((points - t.from) / (t.next.from - t.from)) * 100);
  return `<div class="progress thin" role="progressbar" aria-label="Fremskridt til ${esc(t.next.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div><p class="muted">${fmt(t.next.to_go)} point til ${esc(t.next.name)}</p>`;
}
async function highscore() {
  if (!auth.user) {
    const pts = localScore().total; const t = tierFor(pts);
    $main.innerHTML = `<div class="stack"><div class="spread"><h1>Highscore</h1><span class="tier-badge">🏆 ${esc(t.name)}</span></div>
      <div class="card stack"><h2>Din score</h2><div class="score">${fmt(pts)}</div><p class="muted">anatomipoint gemt lokalt på denne enhed</p>${tierBar(pts)}</div>
      <div class="card stack"><h2>Log ind for at komme på ranglisten</h2><p>Med login gemmes dine point på din konto, og du kan vælge at blive vist på ranglisten med et visningsnavn.</p>
        ${auth.clientId ? '<div id="gbtn"></div>' : '<p class="muted">Login er ikke slået til endnu.</p>'}<p class="muted sync">${legalLinks}</p></div>
      <p class="muted">Point gives kun for rigtige svar på fagligt gennemgåede kort. Rangtrin: Celle → Væv → Sene → Muskel → Skelet → Prosektor → Anatom → Vesalius.</p></div>`;
    const gb = document.getElementById('gbtn'); if (gb) renderGoogleButton(gb);
    return;
  }
  const f = { period: 'week', category: 'alle', mode: 'alle', ...load(LS.hs, {}) };
  $main.innerHTML = '<div class="stack"><h1>Highscore</h1><p class="loading">Henter rangliste…</p></div>';
  let lb;
  try { lb = await api(`api/leaderboard.php?period=${f.period}&category=${f.category}&mode=${f.mode}&limit=100`); }
  catch { $main.innerHTML = '<div class="empty card"><h1>Highscore</h1><p>Ranglisten kunne ikke hentes.</p><button class="btn" onclick="location.reload()">Prøv igen</button></div>'; return; }
  rankCache = null;
  const chips = (name, map, cur) => `<div class="chips scroll" role="group" aria-label="${name}">${Object.entries(map).map(([k, l]) => `<button class="chip" type="button" data-f="${name}" data-v="${k}" aria-pressed="${k === cur}">${l}</button>`).join('')}</div>`;
  const meInTop = lb.top.some((t) => t.is_me && t.rank <= 10);
  const periodWord = { week: 'denne uge', month: 'denne måned', all: 'endnu' }[f.period];
  const rows = lb.top.map((t) => `<li class="hs-row${t.is_me ? ' me' : ''}" ${t.is_me ? 'id="hs-me"' : ''}>
      <span class="hs-rank">${medal(t.rank) ? `<span aria-hidden="true">${medal(t.rank)}</span> ` : ''}<span>${t.rank}.</span><span class="sr-only"> plads</span></span>
      <span class="avatar" aria-hidden="true">${esc(t.initial)}</span><span class="hs-name">${esc(t.display_name)}${t.is_me ? ' <span class="badge">Dig</span>' : ''}</span>
      <span class="hs-pts"><span class="muted">${esc(t.tier)}</span> · <b>${fmt(t.points)}</b></span></li>`).join('');
  const me = lb.me;
  $main.innerHTML = `<div class="stack hs"><div class="spread"><h1>Highscore</h1><span class="tier-badge" title="Rang efter samlet point">🏆 ${esc(lb.tier.name)}</span></div>
    ${tierBar(lb.all_time_points)}
    ${lb.profile.highscore_opt_in ? '' : `<div class="card notice"><p>Du vises ikke på den offentlige rangliste.${me ? ` Din plads, hvis du var med: <b>#${me.rank}</b>.` : ''}</p><button class="btn secondary" id="hs-join">${lb.profile.display_name ? 'Vis mig på ranglisten' : 'Vælg visningsnavn'}</button></div>`}
    ${chips('period', PERIOD_LABEL, f.period)}${chips('category', CATEGORY_LABEL, f.category)}${chips('mode', MODE_LABEL, f.mode)}
    ${lb.top.length ? `<ol class="hs-list" aria-label="Rangliste">${rows}</ol>${lb.participants > lb.top.length ? '<p class="muted center">…</p>' : ''}`
      : `<div class="empty card"><p>Ingen point ${periodWord} – en terpe-session giver dig en plads.</p><a class="btn" href="#/session?mode=drill">Fortsæt</a></div>`}
    ${me && !meInTop ? `<button class="hs-pinned" id="hs-pin" type="button"><b>Dig · #${me.rank}${me.public ? '' : ' (ikke offentlig)'}</b><span>${fmt(me.points)} point${me.to_next ? ` · ${fmt(me.to_next.points)} til #${me.to_next.rank}` : ''}</span></button>` : ''}</div>`;
  $main.querySelectorAll('[data-f]').forEach((b) => b.onclick = () => { f[b.dataset.f] = b.dataset.v; save(LS.hs, f); highscore(); });
  const pin = document.getElementById('hs-pin'); if (pin) pin.onclick = () => { const m = document.getElementById('hs-me'); if (m) m.scrollIntoView({ block: 'center' }); else toast(`Du er nr. ${me.rank}`); };
  const join = document.getElementById('hs-join'); if (join) join.onclick = () => nameSheet(!!lb.profile.display_name);
  if (!lb.profile.display_name && !sessionStorage.getItem('kq.h2seen')) { sessionStorage.setItem('kq.h2seen', '1'); nameSheet(false); }
}
const NAME_ERRORS = { too_short: 'Mindst 3 tegn.', too_long: 'Højst 20 tegn.', chars: 'Brug bogstaver, tal, mellemrum og . - _ \'', contact_info: 'Brug ikke e-mail eller webadresser.', not_allowed: 'Navnet er ikke tilladt.', display_name_taken: 'Navnet er taget – prøv et andet.', name_change_too_soon: 'Du kan kun skifte navn én gang pr. 30 dage.' };
async function nameSheet(hasName) {
  let p; try { p = await api('api/profile.php'); } catch { return toast('Kunne ikke hente profil'); }
  if (hasName) { try { await api('api/profile.php', { method: 'PUT', body: JSON.stringify({ highscore_opt_in: true }) }); toast('Du er nu på ranglisten'); route(); } catch { toast('Kunne ikke gemme'); } return; }
  openSheet(`<h2 id="sheet-title">Vælg visningsnavn</h2><p>Dit visningsnavn vises på ranglisten i stedet for dit rigtige navn. Brug aldrig din e-mail.</p>
    <form id="nf" class="stack"><label class="field">Visningsnavn<input name="dn" maxlength="20" minlength="3" required value="${esc(p.display_name || p.suggested_display_name || '')}" autocomplete="nickname" style="width:100%;min-height:48px;padding:12px 14px;border-radius:14px;border:2px solid var(--color-border-strong);background:var(--color-surface);color:var(--color-ink);font:inherit"></label>
    <p class="muted" style="margin:0">3–20 tegn. Kan ændres én gang pr. 30 dage.</p>
    <label class="row"><input type="checkbox" name="optin" style="width:24px;height:24px"> Vis mig på den offentlige rangliste</label>
    <p id="nf-err" class="err" role="alert"></p><button class="btn block">Gem</button></form>`);
  document.getElementById('nf').onsubmit = async (e) => {
    e.preventDefault(); const fd = new FormData(e.target);
    try {
      await api('api/profile.php', { method: 'PUT', body: JSON.stringify({ display_name: String(fd.get('dn')), highscore_opt_in: fd.get('optin') === 'on' }) });
      $sheet.close(); toast('Gemt'); route();
    } catch (err) {
      const reason = err.body?.reason || err.message;
      document.getElementById('nf-err').textContent = NAME_ERRORS[reason] || NAME_ERRORS[err.message] || 'Kunne ikke gemme.';
    }
  };
}
async function renderHsProfile(el) {
  let p; try { p = await api('api/profile.php'); } catch { return; }
  el.innerHTML = `<h3>Highscore</h3><p class="muted" style="margin:0">Visningsnavn: <b>${esc(p.display_name || 'ikke valgt')}</b></p>
    <label class="row"><input type="checkbox" id="optin" ${p.highscore_opt_in ? 'checked' : ''} style="width:24px;height:24px"> Vis mig på den offentlige rangliste</label>
    <button class="link" id="chname" style="align-self:flex-start">${p.display_name ? 'Skift visningsnavn' : 'Vælg visningsnavn'}</button>`;
  el.querySelector('#chname').onclick = () => nameSheet(false);
  el.querySelector('#optin').onchange = async (e) => {
    try { await api('api/profile.php', { method: 'PUT', body: JSON.stringify({ highscore_opt_in: e.target.checked }) }); toast(e.target.checked ? 'Du vises på ranglisten' : 'Du vises ikke længere på ranglisten'); }
    catch (err) { e.target.checked = false; if (err.message === 'display_name_required') nameSheet(false); else toast('Kunne ikke gemme'); }
  };
}
async function deleteAccount() {
  if (!confirm('Slet din konto og alle data på serveren (fremskridt, point, visningsnavn)? Det kan ikke fortrydes.')) return;
  try { await api('api/account.php', { method: 'DELETE' }); } catch { return toast('Kunne ikke slette kontoen'); }
  auth.user = null; progress = {}; meta = { xp: 0, streak: 0, lastDay: null, tests: [] };
  [LS.progress, LS.meta, LS.dirty, LS.owner, LS.scoreQueue].forEach((k) => localStorage.removeItem(k));
  toast('Din konto og dine data er slettet'); location.hash = '#/';
}

// ---------- Memory (M1–M5) ----------
let memCfg = load('kq.memCfg.v1', { topic: '', region: '', difficulty: 'let', timed: false, variant: 'text', autoFlip: false });
let mem = null;
function memorySetup() {
  const pool = filterItems(QUIZ_ITEMS, { topic: memCfg.topic, region: memCfg.region });
  const pairs = MEM.DIFFICULTY[memCfg.difficulty].pairs;
  const v = MEM.variantsFor(pool, pairs);
  const anyImages = QUIZ_ITEMS.some(hasImage);
  const regions = [...new Set(ITEMS.flatMap(regionsOf))].sort((a, b) => a.localeCompare(b, 'da'));
  const radio = (name, opts, cur) => `<div class="chips" role="radiogroup" aria-label="${name}">${opts.map(([val, label, dis]) => `<label class="chip radio${dis ? ' dis' : ''}"><input type="radio" name="${name}" value="${val}" ${String(cur) === String(val) ? 'checked' : ''} ${dis ? 'disabled' : ''}> ${label}</label>`).join('')}</div>`;
  $main.innerHTML = `<div class="stack"><h1>Memory</h1><p class="muted">Find parrene. Kun fagligt gennemgåede kort indgår.</p>
    <form id="mf" class="card stack">
      <label class="field">Emne<select name="topic"><option value="">Alle emner</option>${Object.entries(TOPICS).map(([t, d]) => `<option value="${t}" ${memCfg.topic === t ? 'selected' : ''}>${d.label}</option>`).join('')}</select></label>
      <label class="field">Region<select name="region"><option value="">Alle regioner</option>${regions.map((r) => `<option ${memCfg.region === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></label>
      <fieldset><legend><b>Sværhed</b></legend>${radio('difficulty', Object.entries(MEM.DIFFICULTY).map(([k, d]) => [k, `${d.label} · ${d.pairs} par`]), memCfg.difficulty)}</fieldset>
      <fieldset><legend><b>Tilstand</b></legend>${radio('timed', [[false, 'Afslappet'], [true, 'På tid']], memCfg.timed)}</fieldset>
      <fieldset><legend><b>Kort</b></legend>${radio('variant', [['text', 'Dansk ↔ latin'], ['image', anyImages ? 'Billede ↔ navn' : 'Billede ↔ navn · kommer snart', !v.image]], v.image ? memCfg.variant : 'text')}
        ${anyImages && !v.image ? `<p class="muted">Kun ${v.imageCount} kort med billede her – vælg færre par eller tekst-varianten.</p>` : ''}</fieldset>
      <label class="row"><input type="checkbox" name="autoFlip" ${memCfg.autoFlip ? 'checked' : ''} style="width:24px;height:24px"> Vend automatisk tilbage efter 1,5 s</label>
      ${MEM.tooSmallForHard(innerWidth, innerHeight) && memCfg.difficulty === 'svaer' ? '<p class="muted">Svær passer bedst på en større skærm – prøv Mellem.</p>' : ''}
      ${v.text ? '' : '<p class="err">For få kort i dette udvalg – vælg et andet emne eller færre par.</p>'}
      <button class="btn block" ${v.text ? '' : 'disabled'}>Start</button></form></div>`;
  const form = document.getElementById('mf');
  const read = () => { const fd = new FormData(form); memCfg = { topic: fd.get('topic') || '', region: fd.get('region') || '', difficulty: fd.get('difficulty') || 'let', timed: fd.get('timed') === 'true', variant: fd.get('variant') || 'text', autoFlip: fd.get('autoFlip') === 'on' }; save('kq.memCfg.v1', memCfg); };
  form.addEventListener('change', () => { read(); memorySetup(); });
  form.onsubmit = (e) => { e.preventDefault(); read(); mem = null; location.hash = '#/memory/spil'; };
}
function memoryPlay() {
  if (!mem || mem.g.finished) {
    const pool = filterItems(QUIZ_ITEMS, { topic: memCfg.topic, region: memCfg.region });
    const pairs = MEM.DIFFICULTY[memCfg.difficulty].pairs;
    const variant = memCfg.variant === 'image' && MEM.variantsFor(pool, pairs).image ? 'image' : 'text';
    const deck = MEM.buildDeck(pool, { pairs, variant });
    if (!deck) { $main.innerHTML = '<div class="empty card"><h1>For få kort</h1><p>Vælg et andet emne, en anden region eller færre par.</p><a class="btn" href="#/memory">Tilbage</a></div>'; return; }
    mem = { g: MEM.newGame(deck), cfg: { ...memCfg, variant }, sid: sessionId(), start: Date.now(), last: Date.now(), events: [], busy: false, focus: 0 };
  }
  renderMemory();
}
function memCardFace(c) {
  if (c.kind === 'image') return `<img src="${esc(c.url)}" alt="${esc(c.alt)}">`;
  if (c.kind === 'name') return `<span>${esc(c.da)}</span><span class="la" lang="la">(${esc(c.la)})</span>`;
  if (c.kind === 'da') return `<span>${esc(c.da)}</span>`;
  return `<span class="la" lang="la">${esc(c.la)}</span>`;
}
function memCardLabel(c, cols) {
  const pos = `Kort ${c.index + 1}, række ${Math.floor(c.index / cols) + 1}, kolonne ${(c.index % cols) + 1}`;
  if (c.state === 'hidden') return `${pos}, skjult`;
  const what = c.kind === 'image' ? c.alt : c.kind === 'name' ? `${c.da}, ${c.la}` : (c.da || c.la);
  return `${pos}, ${what}${c.state === 'matched' ? ', matchet' : ''}`;
}
function memCols() { const land = innerHeight < 500 && innerWidth > innerHeight; return MEM.gridFor(mem.cfg.difficulty, innerWidth, land); }
function renderMemory() {
  const { g } = mem; const [cols, rows] = memCols();
  const secs = Math.round((Date.now() - mem.start) / 1000);
  $main.innerHTML = `<div class="stack memory">
    <div class="spread"><button class="btn ghost" id="mquit" aria-label="Afslut spil">✕</button>
      <span><b>${g.found}/${g.pairs}</b> par · ${g.moves} træk</span>${mem.cfg.timed ? `<span class="timer" id="mclock" role="timer" aria-live="off">${fmtTime(secs)}</span>` : '<span class="badge">Afslappet</span>'}</div>
    <div id="mem-peek" aria-hidden="true"></div>
    <div class="mem-grid" role="grid" aria-label="Memory, ${g.pairs} par" style="--cols:${cols};--rows:${rows}">
      ${Array.from({ length: rows }, (_, r) => `<div role="row" class="mem-row">${g.deck.slice(r * cols, r * cols + cols).map((c) => `<div role="gridcell"><button class="mem-card ${c.state}" data-i="${c.index}" tabindex="${c.index === mem.focus ? 0 : -1}" aria-label="${esc(memCardLabel(c, cols))}">
        <span class="mem-inner"><span class="mem-back" aria-hidden="true"></span><span class="mem-front" aria-hidden="true">${c.state === 'hidden' ? '' : memCardFace(c)}${c.state === 'matched' ? '<i class="mem-ok">✓</i>' : ''}</span></span></button></div>`).join('')}</div>`).join('')}
    </div></div><div id="mem-overlay"></div>`;
  $main.querySelectorAll('.mem-card').forEach((b) => b.onclick = () => memTap(Number(b.dataset.i)));
  $main.querySelector('.mem-grid').addEventListener('keydown', memKeys);
  document.getElementById('mquit').onclick = () => { if (g.moves === 0 || confirm('Afslut spil? Dit fremskridt i dette spil gemmes ikke.')) { mem = null; location.hash = '#/memory'; } };
  clearInterval(timerId);
  if (mem.cfg.timed) timerId = setInterval(() => { const el = document.getElementById('mclock'); if (el) el.textContent = fmtTime(Math.round((Date.now() - mem.start) / 1000)); }, 1000);
}
const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
function memKeys(e) {
  const [cols] = memCols(); const n = mem.g.deck.length; let f = mem.focus;
  if (e.key === 'ArrowRight') f = Math.min(n - 1, f + 1); else if (e.key === 'ArrowLeft') f = Math.max(0, f - 1);
  else if (e.key === 'ArrowDown') f = Math.min(n - 1, f + cols); else if (e.key === 'ArrowUp') f = Math.max(0, f - cols);
  else if (e.key === 'Home') f = 0; else if (e.key === 'End') f = n - 1; else return;
  e.preventDefault(); memFocus(f);
}
function memFocus(f) {
  mem.focus = f; $main.querySelectorAll('.mem-card').forEach((b) => { b.tabIndex = Number(b.dataset.i) === f ? 0 : -1; });
  const b = $main.querySelector(`.mem-card[data-i="${f}"]`); if (b) b.focus();
}
function memPanel(c, cls = '') { return `<div class="mem-panel ${cls}">${memCardFace(c)}${cls === 'ok' ? '<i class="mem-ok">✓</i>' : ''}</div>`; }
function memTap(i) {
  if (mem.busy) return;
  mem.focus = i;
  const res = MEM.flip(mem.g, i);
  if (res.result === 'ignored') return;
  mem.g = res.g;
  const ov = () => document.getElementById('mem-overlay');
  const openCards = () => mem.g.deck.filter((c) => c.state === 'flipped' || (res.result === 'match' && mem.g.log.at(-1)?.pair === c.pair));
  renderMemory();
  if (res.result === 'first') {
    const a = mem.g.deck[i];
    document.getElementById('mem-peek').innerHTML = `<div class="mem-peek">${memPanel(a)}</div>`;
    memFocus(i);
    announce(memCardLabel(a, memCols()[0]).split(', ').slice(1).join(', '));
    return;
  }
  const pair = openCards();
  if (res.result === 'match') {
    const it = BY_ID.get(res.pair);
    mem.events.push({ item_id: it.id, facet: 'pair', ts: Date.now(), ms: Date.now() - mem.last, correct: true }); mem.last = Date.now();
    ov().innerHTML = `<div class="mem-ov two" role="dialog" aria-label="Sammenligning">${pair.map((c) => memPanel(c, 'ok')).join('')}<p class="mem-msg ok">✓ Par! ${nameHtml(it)}</p></div>`;
    announce(`Par fundet: ${it.name_da}, ${it.name_la_ta2}. ${mem.g.found} af ${mem.g.pairs} par.`);
    mem.busy = true;
    setTimeout(() => { mem.busy = false; ov().innerHTML = ''; if (mem.g.finished) memoryResult(); else { renderMemory(); memFocus(nextHidden(i)); } }, 900);
    return;
  }
  ov().innerHTML = `<div class="mem-ov two" role="dialog" aria-label="Sammenligning">${pair.map((c) => memPanel(c, 'no')).join('')}<p class="mem-msg">Ikke et par</p><button class="btn block" id="mem-back">Vend tilbage</button></div>`;
  announce('Ikke et par.');
  const back = () => { clearTimeout(mem.auto); document.removeEventListener('keydown', esc1); mem.g = MEM.flipBack(mem.g); ov().innerHTML = ''; renderMemory(); memFocus(nextHidden(i)); };
  const esc1 = (e) => { if (e.key === 'Escape') back(); };
  document.addEventListener('keydown', esc1);
  document.getElementById('mem-back').onclick = back; document.getElementById('mem-back').focus();
  if (mem.cfg.autoFlip) mem.auto = setTimeout(back, 1500);
}
function nextHidden(from) { const d = mem.g.deck; for (let k = 1; k <= d.length; k++) { const c = d[(from + k) % d.length]; if (c.state === 'hidden') return c.index; } return from; }
async function memoryResult() {
  clearInterval(timerId);
  const { g, cfg } = mem; const secs = Math.max(1, Math.round((Date.now() - mem.start) / 1000));
  const eff = MEM.efficiency(g.pairs, g.moves);
  const best = load('kq.memBest.v1', {}); const bk = `${cfg.difficulty}`; const record = !best[bk] || eff > best[bk]; if (record) { best[bk] = eff; save('kq.memBest.v1', best); }
  const ids = g.log.map((l) => l.pair);
  $main.innerHTML = `<div class="stack"><div class="card center"><h1 tabindex="-1">Spillet er slut 🎉</h1>
    <div class="grid"><div class="stat"><b>${g.pairs}</b><span>par</span></div><div class="stat"><b>${g.moves}</b><span>træk</span></div>
    ${cfg.timed ? `<div class="stat"><b>${fmtTime(secs)}</b><span>tid</span></div>` : ''}<div class="stat"><b>${eff}%</b><span>effektivitet${record ? ' · ny rekord!' : ''}</span></div></div>
    <p id="pts" class="muted" aria-live="polite"></p></div>
    <div class="row"><button class="btn" id="m-again">Spil igen</button>${cfg.difficulty !== 'svaer' ? '<button class="btn secondary" id="m-harder">Sværere</button>' : ''}<a class="btn ghost" href="#/traen">Færdig</a></div>
    <h2>Parrene</h2><ul class="list">${ids.map((id) => { const it = BY_ID.get(id); return `<li><a href="#/udforsk/${esc(id)}"><span class="row" style="flex-wrap:nowrap;gap:12px">${hasImage(it) ? `<img class="thumb" src="${esc(it.images[0].url)}" alt="" loading="lazy">` : ''}<span>${nameHtml(it)}</span></span></a></li>`; }).join('')}</ul>
    <a class="btn secondary" href="#/session?mode=drill&ids=${ids.join(',')}">Tilføj til terping</a></div>`;
  announce(`Spillet er slut: ${g.pairs} par, ${g.moves} træk${cfg.timed ? `, ${Math.floor(secs / 60)} minutter ${secs % 60} sekunder` : ''}.`);
  $main.querySelector('h1').focus();
  document.getElementById('m-again').onclick = () => { mem = null; memoryPlay(); };
  const h = document.getElementById('m-harder'); if (h) h.onclick = () => { memCfg.difficulty = cfg.difficulty === 'let' ? 'mellem' : 'svaer'; save('kq.memCfg.v1', memCfg); mem = null; memoryPlay(); };
  const r = await recordScore('memory', mem.events, mem.sid, { memory: { difficulty: cfg.difficulty, pairs: g.pairs, moves: g.moves, seconds: secs } });
  showPoints(r);
}

// ---------- Boot ----------
async function boot() {
  applyPrefs();
  try {
    const r = await fetch('data/knoglequiz.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    ITEMS = normalize(await r.json());
    BY_ID = new Map(ITEMS.map((i) => [i.id, i]));
    QUIZ_ITEMS = ITEMS.filter((i) => !i.needs_review);
  } catch (err) {
    $main.innerHTML = '<div class="empty card"><h1>Kunne ikke indlæse data</h1><p class="muted">Tjek din forbindelse og prøv igen.</p><button class="btn" onclick="location.reload()">Prøv igen</button></div>';
    return;
  }
  window.addEventListener('hashchange', route);
  window.addEventListener('online', () => { flushReports(); flushScores(); if (load(LS.dirty, false)) pushProgress(); });
  await initAuth();
  route(); flushReports(); flushScores();
}
boot();
