import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inHalloweenWindow, halloweenActive, themeOverride, HALLOWEEN_HTML } from '../src/lib/theme.js';

const at = (iso) => new Date(iso);
test('window: 24/10–1/11 inclusive, Europe/Copenhagen (CEST/CET edges)', () => {
  // 24/10 00:00 CEST = 23/10 22:00Z
  assert.equal(inHalloweenWindow(at('2026-10-23T21:59:59Z')), false);
  assert.equal(inHalloweenWindow(at('2026-10-23T22:00:00Z')), true);
  assert.equal(inHalloweenWindow(at('2026-10-31T12:00:00Z')), true);
  // 1/11 23:59 CET = 1/11 22:59Z (DST ended 25/10); 2/11 00:00 CET = 1/11 23:00Z
  assert.equal(inHalloweenWindow(at('2026-11-01T22:59:59Z')), true);
  assert.equal(inHalloweenWindow(at('2026-11-01T23:00:00Z')), false);
  assert.equal(inHalloweenWindow(at('2026-10-25T01:30:00Z')), true); // DST switch night
  assert.equal(inHalloweenWindow(at('2026-06-15T12:00:00Z')), false);
  assert.equal(inHalloweenWindow(at('2027-10-24T00:00:00Z')), true);
});
test('flag off disables; override wins both ways', () => {
  const d = at('2026-10-31T12:00:00Z'); const out = at('2026-03-01T12:00:00Z');
  assert.equal(halloweenActive({ date: d }), true);
  assert.equal(halloweenActive({ date: d, enabled: false }), false);
  assert.equal(halloweenActive({ date: out, enabled: false, override: 'halloween' }), true);
  assert.equal(halloweenActive({ date: d, override: 'none' }), false);
  assert.equal(themeOverride({ search: '?theme=halloween', hash: '' }), 'halloween');
  assert.equal(themeOverride({ search: '', hash: '#/?theme=none' }), 'none');
  assert.equal(themeOverride({ search: '?theme=evil', hash: '' }), null);
});
test('config endpoint exposes halloween_enabled (default true); caps unchanged', () => {
  const php = readFileSync(new URL('../api/auth.php', import.meta.url), 'utf8');
  assert.match(php, /'halloween_enabled' => \(kq_config\(\)\['halloween_enabled'\] \?\? true\) !== false/);
  const lib = readFileSync(new URL('../api/score.php', import.meta.url), 'utf8') + readFileSync(new URL('../api/lib.php', import.meta.url), 'utf8');
  for (const n of ['100', '150']) assert.match(lib, new RegExp(`\\b${n}\\b`));
});
test('decor: inline only, counts per spec, reduced motion, dim, pause', () => {
  assert.doesNotMatch(HALLOWEEN_HTML, /https?:|url\(/);
  assert.equal((HALLOWEEN_HTML.match(/hw-bat b/g) || []).length, 6);
  assert.equal((HALLOWEEN_HTML.match(/hw-ghost g/g) || []).length, 2);
  assert.equal((HALLOWEEN_HTML.match(/hw-pumpkin p/g) || []).length, 3);
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const hw = css.slice(css.indexOf('/* Halloween event theme'));
  assert.ok(Buffer.byteLength(hw + HALLOWEEN_HTML) < 60000);
  assert.match(hw, /#halloween,#halloween>\*\{position:fixed;pointer-events:none\}/);
  assert.match(hw, /prefers-reduced-motion:no-preference\)\{\s*:root:not\(\[data-motion=reduce\]\) \.hw-bat/);
  assert.match(hw, /\[data-hw-dim\] #halloween\{opacity:\.4\}/);
  assert.match(hw, /data-hw-paused\] #halloween \*\{animation-play-state:paused\}/);
  assert.match(hw, /rgba\(23,30,40,\.94\)[^}]*blur\(6px\)/);
  assert.doesNotMatch(hw.match(/@keyframes[\s\S]*/)[0], /(left|top|width|height|margin)\s*:/);
  assert.match(css, /:root\[data-theme=dark\],:root\[data-theme-event=halloween\]\{/);
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /setAttribute\('aria-hidden', 'true'\)/);
});
