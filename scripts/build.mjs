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
  // Optional images.json from Research: { "<item id>": { url, alt, credit, license } }
  const imgPath = resolve(dir, 'images.json');
  if (await access(imgPath).then(() => true, () => false)) {
    const ids = new Set(['bones', 'muscles', 'tendons', 'ligaments'].flatMap((t) => out[t].items.map((i) => i.id)));
    const { images, rejected } = normalizeImages(JSON.parse(await readFile(imgPath, 'utf8')), ids);
    out.images = images;
    if (rejected.length) console.warn(`images.json: ${rejected.length} entries rejected:`, rejected.slice(0, 10));
  }
  return out;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  await rm(dist, { recursive: true, force: true });
  await cp(resolve(root, 'src'), dist, { recursive: true });
  await mkdir(resolve(dist, 'api'), { recursive: true });
  for (const f of ['report.php', 'auth.php', 'progress.php', 'lib.php', 'leaderboard.php', 'score.php', 'profile.php', 'account.php']) await cp(resolve(root, 'api', f), resolve(dist, 'api', f));
  await cp(resolve(root, 'api/.htaccess'), resolve(dist, 'api/.htaccess'));
  await mkdir(resolve(dist, 'data'), { recursive: true });
  const data = await buildData();
  await writeFile(resolve(dist, 'data/knoglequiz.json'), JSON.stringify(data));
  const n = ['bones', 'muscles', 'tendons', 'ligaments'].map((t) => `${t}=${data[t].items.length}`).join(' ');
  console.log(`built dist/ (${n})`);
}
