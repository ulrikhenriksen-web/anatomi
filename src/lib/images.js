// Research images.json, schema v1:
// { schema_version: 1, images: { <item_id>: [ { id, url, width, height, credit, license, license_url, source_url,
//   alt_naming, alt_neutral, view, side, hotspots: [{ item_id, x, y, r }] } ] } }
// Required: id, url, credit, license, source_url, alt_naming, alt_neutral. First image = primary.
// alt_naming may name the structure (Udforsk); alt_neutral must not (quiz/Memory).
const REQ = ['id', 'url', 'credit', 'license', 'source_url', 'alt_naming', 'alt_neutral'];
const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const httpsOrLocal = (u) => typeof u === 'string' && /^(https:\/\/|images\/)[^\s"'<>]+$/.test(u);
const httpsOnly = (u) => typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u);
const unit = (n) => typeof n === 'number' && n >= 0 && n <= 1;

export function normalizeImages(raw, knownIds = null) {
  const images = {}; const rejected = [];
  if (!raw || typeof raw !== 'object') return { images, rejected, schema_version: null };
  if (raw.schema_version !== 1 || !raw.images || typeof raw.images !== 'object') {
    rejected.push({ id: '*', why: 'schema_version must be 1 with an images object' });
    return { images, rejected, schema_version: raw.schema_version ?? null };
  }
  for (const list of Object.values(raw.images)) for (const v of Array.isArray(list) ? list : []) {
    // Auto-upgrade http license links (e.g. http://creativecommons.org/...) to https
    if (v && typeof v.license_url === 'string' && /^http:\/\//.test(v.license_url)) v.license_url = v.license_url.replace(/^http:/, 'https:');
  }
  for (const [itemId, list] of Object.entries(raw.images)) {
    if (!/^[a-z0-9_]{1,120}$/.test(itemId)) { rejected.push({ id: itemId, why: 'bad item id' }); continue; }
    if (knownIds && !knownIds.has(itemId)) { rejected.push({ id: itemId, why: 'unknown item id' }); continue; }
    if (!Array.isArray(list)) { rejected.push({ id: itemId, why: 'must be an array' }); continue; }
    const ok = []; const seen = new Set();
    list.forEach((v, i) => {
      const where = `${itemId}[${i}]`;
      if (!v || typeof v !== 'object') return rejected.push({ id: where, why: 'not an object' });
      const missing = REQ.filter((k) => typeof v[k] !== 'string' || !v[k].trim());
      if (missing.length) return rejected.push({ id: where, why: `missing ${missing.join(', ')}` });
      if (!httpsOrLocal(v.url)) return rejected.push({ id: where, why: 'url must be https:// or images/…' });
      if (!httpsOnly(v.source_url)) return rejected.push({ id: where, why: 'source_url must be https://' });
      if (v.license_url != null && !httpsOnly(v.license_url)) return rejected.push({ id: where, why: 'license_url must be https://' });
      if (seen.has(v.id)) return rejected.push({ id: where, why: 'duplicate image id' });
      seen.add(v.id);
      const dim = (n) => (Number.isInteger(n) && n > 0 && n < 20000 ? n : null);
      ok.push({
        id: str(v.id, 120), url: v.url, width: dim(v.width), height: dim(v.height),
        credit: str(v.credit, 300), license: str(v.license, 120), license_url: v.license_url || null, source_url: v.source_url,
        alt_naming: str(v.alt_naming, 300), alt_neutral: str(v.alt_neutral, 300),
        view: str(v.view, 40) || null, side: str(v.side, 20) || null,
        hotspots: (Array.isArray(v.hotspots) ? v.hotspots : [])
          .filter((h) => h && typeof h.item_id === 'string' && (!knownIds || knownIds.has(h.item_id)) && unit(h.x) && unit(h.y))
          .map((h) => ({ item_id: h.item_id, x: h.x, y: h.y, r: unit(h.r) ? h.r : 0.04 })),
      });
    });
    if (ok.length) images[itemId] = ok;
  }
  return { images, rejected, schema_version: 1 };
}
