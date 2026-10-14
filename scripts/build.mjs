// Build: copy src/ + api/ to dist/, bundle research JSON (minus source_check) into dist/data/knoglequiz.json.
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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
  return out;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  await rm(dist, { recursive: true, force: true });
  await cp(resolve(root, 'src'), dist, { recursive: true });
  await mkdir(resolve(dist, 'api'), { recursive: true });
  await cp(resolve(root, 'api/report.php'), resolve(dist, 'api/report.php'));
  await cp(resolve(root, 'api/.htaccess'), resolve(dist, 'api/.htaccess'));
  await mkdir(resolve(dist, 'data'), { recursive: true });
  const data = await buildData();
  await writeFile(resolve(dist, 'data/knoglequiz.json'), JSON.stringify(data));
  const n = ['bones', 'muscles', 'tendons', 'ligaments'].map((t) => `${t}=${data[t].items.length}`).join(' ');
  console.log(`built dist/ (${n})`);
}
