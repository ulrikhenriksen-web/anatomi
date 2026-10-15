// Validation for Research's optional images.json: { "<item id>": { url, alt, credit, license } }.
const MAX = { alt: 300, credit: 300, license: 120 };
export function normalizeImages(raw, knownIds = null) {
  const images = {}; const rejected = [];
  const src = raw && typeof raw === 'object' ? (raw.images && typeof raw.images === 'object' ? raw.images : raw) : {};
  for (const [id, v] of Object.entries(src)) {
    if (id === 'schema_version') continue;
    const why = !/^[a-z0-9_]{1,120}$/.test(id) ? 'bad id'
      : knownIds && !knownIds.has(id) ? 'unknown id'
      : !v || typeof v !== 'object' ? 'not an object'
      : typeof v.url !== 'string' || !/^(https:\/\/|images\/)[^\s"'<>]+$/.test(v.url) ? 'url must be https:// or images/…'
      : typeof v.alt !== 'string' || !v.alt.trim() ? 'alt required'
      : typeof v.license !== 'string' || !v.license.trim() ? 'license required'
      : null;
    if (why) { rejected.push({ id, why }); continue; }
    images[id] = {
      url: v.url, alt: v.alt.trim().slice(0, MAX.alt),
      credit: typeof v.credit === 'string' ? v.credit.trim().slice(0, MAX.credit) : '',
      license: v.license.trim().slice(0, MAX.license),
    };
  }
  return { images, rejected };
}
