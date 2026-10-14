import {
  TOPICS, FACETS, DEFAULT_FACETS, normalize, regionsOf, filterItems, describe, facetsFor,
  makeQuestion, mediaOf, mergeProgress, mergeMeta, sm2, isMastered, isDue, key, pickDrill, scoreXp, updateStreak, validateReport, shuffle,
} from './lib/quiz.js';

const $main = document.getElementById('main');
const $live = document.getElementById('live');
const $sheet = document.getElementById('sheet');
const LS = { progress: 'kq.progress.v1', meta: 'kq.meta.v1', settings: 'kq.settings.v1', reports: 'kq.pendingReports.v1', dirty: 'kq.dirty.v1', owner: 'kq.owner.v1' };
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
  if (!r.ok) throw Object.assign(new Error(body.error || r.status), { status: r.status });
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
    toast(`Logget ind som ${r.user.name || r.user.email}`); route();
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
  [/^#\/traen$/, train], [/^#\/session$/, runSession], [/^#\/test$/, testSetup], [/^#\/profil$/, profile],
];
function route() {
  clearInterval(timerId);
  const h = location.hash || '#/';
  const path = h.split('?')[0];
  const params = new URLSearchParams(h.split('?')[1] || '');
  for (const [re, fn] of routes) {
    const m = path.match(re);
    if (m) {
      const nav = path.split('/')[1] || 'home';
      document.querySelectorAll('[data-nav]').forEach((a) => a.toggleAttribute('aria-current', false));
      const cur = document.querySelector(`[data-nav="${nav === 'session' ? (session?.mode === 'test' ? 'test' : 'traen') : nav}"]`);
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
    <div class="grid">
      <div class="card stat"><b>🔥 ${meta.streak || 0}</b><span>dages streak</span></div>
      <div class="card stat"><b>${meta.xp || 0}</b><span>XP i alt</span></div>
      <div class="card stat"><b>${mastered}</b><span>facetter mestret</span></div>
      <div class="card stat"><b>${last ? `${last.score}/${last.total}` : '–'}</b><span>seneste test</span></div>
    </div>
    <h2>Dine emner</h2><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr))">${rings}</div></div>`;
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
      <span class="t"><span>${esc(it.name_da)}</span><small class="la" lang="la">${esc(it.name_la_ta2)}</small></span>
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
    <div class="spread"><span class="badge">${TOPICS[it.topic].singular}</span>${it.needs_review ? `<button class="pill-review" data-review="${esc(it.id)}">ⓘ Under faglig gennemgang</button>` : ''}</div>
    <h1>${esc(it.name_da)}<br><span class="la" lang="la" style="font-size:20px;font-weight:600">${esc(it.name_la_ta2)}</span></h1>
    <div class="card"><dl class="facts">${rows.join('')}</dl></div>
    ${it.needs_review ? '' : `<p class="muted">${m.mastered}/${m.total} facetter mestret</p>`}
    ${hotspotSlot(it)}
    ${it.needs_review ? '<p class="muted">Kortet indgår ikke i quizzer, før det er fagligt gennemgået.</p>' : ''}
    <div class="row">${it.needs_review ? '' : `<a class="btn" href="#/session?mode=drill&ids=${esc(it.id)}">Terp dette kort</a>`}
      <button class="btn secondary" data-report="${esc(it.id)}">Rapportér fejl</button></div>
    <details class="card"><summary>Kilder</summary><ul>${(it.sources || []).map((s) => `<li>${esc(s)}</li>`).join('')}
      ${(it.source_urls || []).map((u) => /^https?:\/\//.test(u) ? `<li><a href="${esc(u)}" rel="noopener" target="_blank">${esc(u)}</a></li>` : '').join('')}</ul>
      ${it.ta2_id ? `<p class="muted">TA2 ID ${esc(it.ta2_id)}</p>` : ''}</details></article>`;
}

function train() {
  const f = settings.facets;
  $main.innerHTML = `<div class="stack"><h1>Træn</h1>
    <a class="tile" href="#/session?mode=naming"><h2>① Navngivning</h2><p class="muted">Læs beskrivelsen og vælg strukturen. Ingen tidspres.</p></a>
    <a class="tile" href="#/session?mode=drill"><h2>② Terping</h2><p class="muted">Spaced repetition pr. facet – forfaldne kort først.</p></a>
    <a class="tile" href="#/test"><h2>③ Test</h2><p class="muted">Kun mestret, fagligt gennemgået materiale – med timer.</p></a>
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

function accountHtml() {
  if (!auth.clientId) return '<p class="muted">Login er ikke slået til endnu – du bruger Knoglequiz som gæst.</p>';
  if (!auth.user) return '<p>Log ind for at gemme dit fremskridt på tværs af enheder. Dit nuværende fremskridt flyttes med første gang.</p><div id="gbtn"></div>';
  const u = auth.user;
  return `<div class="account">${u.picture && /^https:\/\//.test(u.picture) ? `<img src="${esc(u.picture)}" alt="" referrerpolicy="no-referrer">` : ''}<div><b>${esc(u.name || '')}</b><br><span class="muted">${esc(u.email || '')}</span></div></div>
    <p class="muted sync">${auth.error ? esc(auth.error) : auth.lastSync ? `Synkroniseret ${new Date(auth.lastSync).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' })}` : 'Ikke synkroniseret endnu'}</p>
    <div class="row"><button class="btn secondary" id="syncnow">Synkronisér nu</button><button class="btn ghost" id="logout">Log ud</button></div>`;
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
    <p class="muted">Data: Knoglequiz research v0.3 · ${ITEMS.length} strukturer.</p></div>`;
  const gb = document.getElementById('gbtn'); if (gb) renderGoogleButton(gb);
  const lo = document.getElementById('logout'); if (lo) lo.onclick = logout;
  const sn = document.getElementById('syncnow'); if (sn) sn.onclick = async () => { await pushProgress(); profile(); };
  const s = (k, v) => { settings[k] = v; save(LS.settings, settings); applyPrefs(); };
  document.getElementById('theme').onchange = (e) => s('theme', e.target.value);
  document.getElementById('motion').onchange = (e) => s('motion', e.target.value);
  document.getElementById('sc').onchange = (e) => s('shortcuts', e.target.checked);
  document.getElementById('export').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ progress, meta, settings }, null, 2)], { type: 'application/json' }));
    a.download = 'knoglequiz-fremskridt.json'; a.click();
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
  return { mode, questions, i: 0, score: 0, xp: 0, wrong: [], timer: mode === 'test' ? settings.timer : 0, params: params.toString() };
}
function runSession(_, params) {
  if (!session || session.params !== params.toString() || session.done) session = buildSession(params);
  if (!session.questions.length) { $main.innerHTML = '<div class="empty card"><h1>Intet at øve her</h1><p class="muted">Prøv et andet emne eller en anden region.</p><a class="btn" href="#/traen">Til Træn</a></div>'; return; }
  renderQuestion();
}
const modeLabel = { naming: 'Navngivning', drill: 'Terping', test: 'Test' };
function renderQuestion() {
  const s = session; const q = s.questions[s.i]; const it = BY_ID.get(q.itemId);
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
    ${hotspotSlot(it, true)}
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
    <div class="score">${s.score}/${s.questions.length}</div><p class="muted">+${s.xp} XP · 🔥 ${meta.streak} dages streak</p></div>
    ${s.wrong.length ? `<h2>Fejlanalyse</h2><ul class="list">${s.wrong.map((w) => { const it = BY_ID.get(w.id); return `<li><a href="#/udforsk/${esc(it.id)}"><span class="t"><span>${nameHtml(it)}</span>
      <small>${w.kind === 'naming' ? 'Navngivning' : esc(FACETS[w.kind].label)}: ${esc(w.correct)} <span class="muted">(dit svar: ${esc(w.chosen)})</span></small></span>${it.needs_review ? '<span class="review" role="img" aria-label="Under faglig gennemgang">i</span>' : ''}</a></li>`; }).join('')}</ul>` : ''}
    <div class="row">${s.wrong.length ? `<a class="btn" href="#/session?mode=drill&ids=${s.wrong.map((w) => w.id).join(',')}">Terp fejlene</a>` : ''}
      <a class="btn secondary" href="#/session?${s.params}" id="again">Igen</a><a class="btn ghost" href="#/">Hjem</a></div></div>`;
  document.getElementById('again').onclick = () => { session = null; };
  $main.querySelector('h1').setAttribute('tabindex', '-1'); $main.querySelector('h1').focus();
}

// ---------- v2 hotspot placeholder (layout reserved; no interaction yet) ----------
function hotspotSlot(it, compact = false) {
  const m = mediaOf(it);
  if (!m.image) return compact ? '' : `<figure class="hotspot-slot" aria-hidden="true"><span>Billede med klikbare strukturer kommer i v2</span></figure>`;
  return `<figure class="hotspot-slot has-image"><img src="${esc(m.image)}" alt="Illustration: ${esc(it.name_da)}">
    ${m.hotspots.map((h) => `<span class="hotspot" data-hotspot="${esc(h.id)}" style="left:${h.x * 100}%;top:${h.y * 100}%;width:${h.r * 200}%" aria-hidden="true"></span>`).join('')}</figure>`;
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
  window.addEventListener('online', () => { flushReports(); if (load(LS.dirty, false)) pushProgress(); });
  await initAuth();
  route(); flushReports();
}
boot();
