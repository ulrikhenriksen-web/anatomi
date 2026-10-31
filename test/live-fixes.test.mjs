import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { versionText } from '../scripts/build.mjs';

const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');

test('cache-busting: module imports, html assets and data fetch get ?v=', () => {
  const js = "import * as MEM from './lib/memory.js';\nimport { a } from \"./quiz.js\";\nfetch('data/knoglequiz.json')";
  const out = versionText(js, 'abc123');
  assert.match(out, /'\.\/lib\/memory\.js\?v=abc123'/);
  assert.match(out, /"\.\/quiz\.js\?v=abc123"/);
  assert.match(out, /'data\/knoglequiz\.json\?v=abc123'/);
  const html = versionText('<script type="module" src="app.js"></script><link rel="stylesheet" href="styles.css">', 'v1');
  assert.match(html, /src="app\.js\?v=v1"/);
  assert.match(html, /href="styles\.css\?v=v1"/);
});
test('router: #/memory is routed and view errors are caught (no stale view)', () => {
  assert.match(app, /\[\/\^#\\\/memory\$\/, memorySetup\]/);
  assert.match(app, /try \{ fn\(m\[1\], params\); \} catch/);
  assert.match(app, /addEventListener\('hashchange', route\)/);
});
test('memory setup: change does not re-render the form (Start click is never lost)', () => {
  const setup = app.slice(app.indexOf('function memorySetup'), app.indexOf('function memoryPlay'));
  const onChange = setup.slice(setup.indexOf("form.addEventListener('change'"));
  assert.doesNotMatch(onChange.split('\n  });')[0], /memorySetup\(\)/);
  assert.match(onChange, /data-dyn="variant"/);
});
test('memory overlay: revealed only after image decode, deck images preloaded', () => {
  assert.match(app, /function showOverlay[\s\S]*visibility = 'hidden'[\s\S]*decode\(\)/);
  assert.doesNotMatch(app, /ov\(\)\.innerHTML = `<div class="mem-ov/);
  assert.match(app, /preloadDeck\(deck\)/);
});
test('hero: webp + srcset, explicit size, fetchpriority, alt with Latin terms, reduced motion', async () => {
  const { existsSync } = await import('node:fs');
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const h = app.slice(app.indexOf('<section class="hero hero-anatomi"'), app.indexOf('</section>', app.indexOf('hero-anatomi')));
  assert.match(h, /srcset="img\/hero-anatomi-640\.webp 640w, img\/hero-anatomi-1280\.webp 1280w"/);
  assert.match(h, /width="1280" height="720"/);
  assert.match(h, /fetchpriority="high"/);
  assert.match(h, /alt="[^"]{40,}\(clavicula\)[^"]*"/);
  assert.match(h, /knogler \(ossa\), muskler \(musculi\)/);
  assert.match(h, /Start træning/);
  for (const f of ['hero-anatomi-640.webp', 'hero-anatomi-1280.webp']) assert.ok(existsSync(new URL(`../src/img/${f}`, import.meta.url)));
  assert.match(css, /prefers-reduced-motion:no-preference\)\{:root:not\(\[data-motion=reduce\]\) \.hero-anatomi/);
});
