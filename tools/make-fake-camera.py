"""Builds a synthetic camera clip (y4m) of a canvas hanging on a wall, moving in perspective,
for the headless AR tests:  python tools/make-fake-camera.py samples/diwali.jpg cam.y4m [static]"""
import sys, math
import numpy as np
from PIL import Image, ImageDraw

src = Image.open(sys.argv[1]).convert('RGB'); out_path = sys.argv[2]
static = len(sys.argv) > 3 and sys.argv[3] == 'static'  # fixed pose: isolates alignment error from lag
W, H, N = 640, 480, 120

def coeffs(pa, pb):
    m = []
    for p1, p2 in zip(pa, pb):
        m.append([p1[0], p1[1], 1, 0, 0, 0, -p2[0] * p1[0], -p2[0] * p1[1]])
        m.append([0, 0, 0, p1[0], p1[1], 1, -p2[1] * p1[0], -p2[1] * p1[1]])
    return np.linalg.solve(np.array(m, float), np.array(pb).reshape(8)).tolist()

wall = Image.new('RGB', (W, H), (150, 140, 128)); d = ImageDraw.Draw(wall)
for i in range(0, W, 40): d.line([(i, 0), (i, H)], fill=(140, 131, 120))
out = open(out_path, 'wb'); out.write(f'YUV4MPEG2 W{W} H{H} F15:1 Ip A1:1 C420jpeg\n'.encode())
ar = src.size[1] / src.size[0]
for f in range(N):
    t = 0.6 if static else f / N * 2 * math.pi
    cx, cy, s, k = W / 2 + 40 * math.sin(t), H / 2 + 20 * math.sin(2 * t), 210 + 30 * math.sin(t * 0.5), 30 * math.sin(t)
    q = [(cx - s + k * .3, cy - s * ar - k * .5), (cx + s + k * .3, cy - s * ar + k * .5), (cx + s - k * .3, cy + s * ar - k * .5), (cx - s - k * .3, cy + s * ar + k * .5)]
    sw, sh = src.size
    warped = src.transform((W, H), Image.PERSPECTIVE, coeffs(q, [(0, 0), (sw, 0), (sw, sh), (0, sh)]), Image.BILINEAR)
    mask = Image.new('L', (W, H), 0); ImageDraw.Draw(mask).polygon(q, fill=255)
    fr = wall.copy(); fr.paste(warped, (0, 0), mask)
    yuv = np.asarray(fr.convert('YCbCr'))
    out.write(b'FRAME\n'); out.write(yuv[:, :, 0].tobytes()); out.write(yuv[::2, ::2, 1].tobytes()); out.write(yuv[::2, ::2, 2].tobytes())
out.close()
