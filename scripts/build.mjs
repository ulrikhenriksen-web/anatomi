// Build: copy src/ + api/ to dist/, bundle research JSON (minus source_check) into dist/data/knoglequiz.json.
import { cp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import { normalizeImages } from '../src/lib/images.js';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const research = resolve(root, process.env.KQ_RESEARCH_DIR || 'data/research');
const dist = resolve(root, 'dist');
export async function buildData(dir = research) {
  const out = { generated_at: new Date().toISOString() };
  for (const t of ['bones', 'muscles', 'tendons', 'ligaments']) {
    const j = JSON.parse(await readFile(resolve(dir, `${t}.json`), 'utf8'));
    out[t] = { schema_version: j.schema_version, items: j.items.map(({ source_check, ...r }) => r) };
  }
  // Optional images.json from Research (schema v1, see src/lib/images.js)
  const imgPath = resolve(dir, 'images.json');
  if (await access(imgPath).then(() => true, () => false)) {
    const ids = new Set(['bones', 'muscles', 'tendons', 'ligaments'].flatMap((t) => out[t].items.map((i) => i.id)));
    const rawImages = JSON.parse(await readFile(imgPath, 'utf8'));
    // Rewrite local Research files to the converted WebP copies (scripts/convert-images.py -> data/images/manifest.json)
    const manifest = await readFile(resolve(root, 'data/images/manifest.json'), 'utf8').then(JSON.parse, () => ({}));
    for (const list of Object.values(rawImages.images || {})) for (const im of Array.isArray(list) ? list : []) {
      const m = manifest[im?.url]; if (m) Object.assign(im, { url: m.url, width: m.width, height: m.height, animated: m.animated });
    }
    const { images, rejected } = normalizeImages(rawImages, ids);
    out.images_schema_version = 1;
    out.images = images;
    if (rejected.length) console.warn(`images.json: ${rejected.length} entries rejected:`, rejected.slice(0, 10));
  }
  return out;
}
/**
 * Cache-busting: one content hash for the whole build, appended as ?v=… to every
 * module import, app.js/styles.css in HTML and the data fetch. Prevents browsers from
 * mixing a new app.js with stale cached lib/*.js (JS is cached 1 h by .htaccess).
 */
export function versionText(text, v) {
  return text
    .replace(/(from\s+['"])(\.\/[\w./-]+\.js)(['"])/g, `$1$2?v=${v}$3`)
    .replace(/((?:src|href)=")((?:app\.js|styles\.css))(")/g, `$1$2?v=${v}$3`)
    .replace(/(['"])(data\/knoglequiz\.json)(['"])/g, `$1$2?v=${v}$3`);
}
async function versionAssets(dist, data) {
  const { createHash } = await import('node:crypto');
  const files = ['app.js', 'styles.css', 'index.html', 'privatliv.html', 'vilkaar.html', ...['quiz', 'memory', 'images', 'highscore', 'privacy', 'theme'].map((f) => `lib/${f}.js`)];
  const h = createHash('sha256');
  for (const f of files) h.update(await readFile(resolve(dist, f)));
  h.update(JSON.stringify(data));
  const v = h.digest('hex').slice(0, 10);
  for (const f of files) await writeFile(resolve(dist, f), versionText(await readFile(resolve(dist, f), 'utf8'), v));
  return v;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  await rm(dist, { recursive: true, force: true });
  await cp(resolve(root, 'src'), dist, { recursive: true });
  await mkdir(resolve(dist, 'api'), { recursive: true });
  for (const f of ['report.php', 'auth.php', 'progress.php', 'lib.php', 'leaderboard.php', 'score.php', 'profile.php', 'account.php']) await cp(resolve(root, 'api', f), resolve(dist, 'api', f));
  await cp(resolve(root, 'api/.htaccess'), resolve(dist, 'api/.htaccess'));
  await mkdir(resolve(dist, 'data'), { recursive: true });
  // Converted images (WebP) only; originals are never shipped.
  const imgDir = resolve(root, 'data/images');
  if (await access(resolve(imgDir, 'manifest.json')).then(() => true, () => false)) {
    await cp(imgDir, resolve(dist, 'images'), { recursive: true, filter: (f) => !f.endsWith('manifest.json') });
  }
  const data = await buildData();
  await writeFile(resolve(dist, 'data/knoglequiz.json'), JSON.stringify(data));
  const ver = await versionAssets(dist, data);
  const n = ['bones', 'muscles', 'tendons', 'ligaments'].map((t) => `${t}=${data[t].items.length}`).join(' ');
  console.log(`built dist/ (${n}) v=${ver}`);
}
