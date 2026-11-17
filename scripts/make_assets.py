"""Builds the demo images in public/images from the originals in assets-src.

Both outputs per example are derived from one daylight color photo:
  *-color.jpg    the photo, darkened and noised to imitate a low-light capture
  *-thermal.jpg  a SIMULATED thermal view (no thermal sensor was involved)

Run: python3 scripts/make_assets.py   (needs Pillow and numpy)
"""
import json
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H = 960, 640
rng = np.random.default_rng(7)

# Boxes are the human-drawn Open Images boxes (x0, x1, y0, y1), normalized to the original.
EXAMPLES = {
    "dog": {"src": "assets-src/dog-original.jpg", "box": (0.3652, 0.6215, 0.1619, 0.8160), "warm": True},
    "bag": {"src": "assets-src/bag-original.jpg", "box": (0.4956, 0.7538, 0.3292, 0.7225), "warm": False},
}

STOPS = [(0.0, (8, 6, 30)), (0.25, (70, 10, 110)), (0.5, (170, 30, 90)),
         (0.7, (235, 100, 20)), (0.88, (255, 200, 40)), (1.0, (255, 255, 235))]


def palette(v):
    out = np.zeros(v.shape + (3,))
    for (a, ca), (b, cb) in zip(STOPS, STOPS[1:]):
        m = (v >= a) & (v <= b)
        t = ((v - a) / (b - a))[m][:, None]
        out[m] = np.array(ca) * (1 - t) + np.array(cb) * t
    return out.astype(np.uint8)


def crop(im):
    """Center-crop to 3:2 and resize. Returns the image and the crop offsets."""
    w, h = im.size
    target = w * H // W
    top = max(0, (h - target) // 2)
    return im.crop((0, top, w, top + min(h, target))).resize((W, H), Image.LANCZOS), top, min(h, target), h


def low_light(im):
    a = np.asarray(im).astype(float) / 255
    gray = a.mean(axis=2, keepdims=True)
    a = gray * 0.55 + a * 0.45                      # night scenes lose color
    a = np.power(a, 1.8) * 0.42                     # crush exposure
    a *= np.array([0.92, 1.0, 1.12])                # cool cast
    a += rng.normal(0, 0.022, a.shape)              # sensor noise
    return Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))


def thermal(im, box, warm):
    g = np.asarray(im.convert("L").filter(ImageFilter.GaussianBlur(22 if warm else 34))).astype(float) / 255
    g = (g - g.min()) / (np.ptp(g) + 1e-6)
    v = (0.16 + 0.2 * g) if warm else (0.34 + 0.07 * g)   # bag frame: washed out, low contrast
    if warm:
        x0, x1, y0, y1 = box
        m = Image.new("L", (W, H), 0)
        d = ImageDraw.Draw(m)
        bw, bh = (x1 - x0) * W, (y1 - y0) * H
        d.ellipse([x0 * W + bw * 0.12, y0 * H + bh * 0.08, x1 * W - bw * 0.12, y0 * H + bh * 0.72], fill=255)  # body
        d.ellipse([x0 * W + bw * 0.2, y0 * H + bh * 0.5, x0 * W + bw * 0.62, y0 * H + bh * 0.93], fill=235)   # head
        blob = np.asarray(m.filter(ImageFilter.GaussianBlur(16))).astype(float) / 255
        v = v + blob * (0.9 - v)
    v = v + rng.normal(0, 0.02 if warm else 0.035, v.shape)
    out = Image.fromarray(palette(np.clip(v, 0, 1)))
    d = ImageDraw.Draw(out)
    d.text((12, H - 22), "SIMULATED THERMAL VIEW - not sensor data", fill=(255, 255, 255))
    return out


regions = {}
for name, ex in EXAMPLES.items():
    im, top, ch, h = crop(Image.open(ex["src"]).convert("RGB"))
    x0, x1, y0, y1 = ex["box"]
    y0, y1 = (y0 * h - top) / ch, (y1 * h - top) / ch
    box = (x0, x1, y0, y1)
    low_light(im).save(f"public/images/{name}-color.jpg", quality=86)
    thermal(im, box, ex["warm"]).save(f"public/images/{name}-thermal.jpg", quality=86)
    regions[name] = {"x": round(x0, 3), "y": round(y0, 3), "w": round(x1 - x0, 3), "h": round(y1 - y0, 3)}
print(json.dumps(regions, indent=2))
