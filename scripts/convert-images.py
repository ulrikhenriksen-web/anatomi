#!/usr/bin/env python3
"""Convert Research images to WebP (max width 1200, q80). Animated GIFs -> animated WebP, or the
first frame if the animated result is still larger than ANIM_MAX bytes. Writes data/images/<name>.webp
and data/images/manifest.json {original_rel_url: {url, width, height, animated, note}}."""
import json, os, sys
from PIL import Image, ImageSequence
SRC = sys.argv[1]; OUT = sys.argv[2]
MAXW, Q, ANIM_MAX = 1200, 80, 1_500_000
os.makedirs(OUT, exist_ok=True)
manifest = {}
for name in sorted(os.listdir(SRC)):
    p = os.path.join(SRC, name); base, ext = os.path.splitext(name)
    if ext.lower() not in ('.png', '.jpg', '.jpeg', '.gif', '.webp'): continue
    out = os.path.join(OUT, base + '.webp'); im = Image.open(p); note = None; animated = False
    def fit(frame):
        frame = frame.convert('RGBA') if frame.mode in ('P', 'LA', 'RGBA') or 'transparency' in frame.info else frame.convert('RGB')
        if frame.width > MAXW: frame = frame.resize((MAXW, round(frame.height * MAXW / frame.width)), Image.LANCZOS)
        return frame
    if getattr(im, 'is_animated', False):
        frames = [fit(f.copy()) for f in ImageSequence.Iterator(im)]
        durs = [f.info.get('duration', 100) for f in ImageSequence.Iterator(im)]
        frames[0].save(out, 'WEBP', save_all=True, append_images=frames[1:], duration=durs, loop=0, quality=Q, method=6)
        animated = True
        if os.path.getsize(out) > ANIM_MAX:
            frames[0].save(out, 'WEBP', quality=Q, method=6); animated = False
            note = f'animated GIF ({len(frames)} frames) -> static first frame (animated WebP was too large)'
        else:
            note = f'animated GIF ({len(frames)} frames) -> animated WebP'
        w, h = frames[0].size
    else:
        f = fit(im); f.save(out, 'WEBP', quality=Q, method=6); w, h = f.size
    manifest[f'images/files/{name}'] = {'url': f'images/{base}.webp', 'width': w, 'height': h, 'animated': animated, 'note': note,
                                        'bytes': os.path.getsize(out), 'orig_bytes': os.path.getsize(p)}
json.dump(manifest, open(os.path.join(OUT, 'manifest.json'), 'w'), indent=1)
tot = sum(v['bytes'] for v in manifest.values()); orig = sum(v['orig_bytes'] for v in manifest.values())
print(f'{len(manifest)} images: {orig/1e6:.1f} MB -> {tot/1e6:.1f} MB')
for k, v in manifest.items():
    if v['note']: print(k, '|', v['note'], '|', round(v['bytes']/1e3), 'kB')
