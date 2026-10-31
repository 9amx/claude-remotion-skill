"""2.5D parallax clips from still paintings (free, CPU only).

For each public/paint/NN.png: estimate depth with Depth Anything V2 Small, then
render a slow camera move where near pixels shift more than far ones, so the
painting reads as a 3D scene. Optional "glow" pulses warm (lava / red-dot)
pixels. Writes public/paint/NN.mp4 at 1280x1080, 30 fps.

  python -I scripts/parallax.py            # all clips
  python -I scripts/parallax.py 03 07      # only these
"""
import os
import subprocess
import sys

import cv2
import numpy as np
import torch
from PIL import Image
from transformers import pipeline

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAINT = os.path.join(ROOT, "public", "paint")
W, H, FPS, END = 1280, 1080, 30, 68.0
XF = 0.4  # crossfade overlap, seconds

# file, start (s), camera (dx, dy: parallax direction; zoom: end scale), glow
CLIPS = [
    ("01", 0.0, (1, 0, 1.06), False),
    ("02", 4.2, (-1, 0, 1.05), False),
    ("03", 9.7, (0, 1, 1.08), True),
    ("04", 14.4, (1, -0.5, 1.08), False),
    ("05", 18.3, (-1, 0, 1.06), False),
    ("06", 23.8, (1, 0, 1.05), False),
    ("07", 30.2, (0, -1, 1.09), True),
    ("08", 37.4, (-1, 0.5, 1.06), False),
    ("09", 40.8, (0, 1, 1.07), False),
    ("10", 44.7, (1, 0, 1.06), False),
    ("11", 47.3, (0, -1, 1.08), True),
    ("12", 52.3, (-1, 0, 1.05), False),
    ("13", 56.0, (1, 0.5, 1.06), False),
    ("14", 58.2, (-1, 0, 1.05), False),
    ("15", 62.6, (0, 1, 1.06), False),
]
AMP = 34  # max parallax shift in px at the nearest depth
MARGIN = 1.12  # oversize so shifts never reveal edges


def cover(img, w, h):
    s = max(w / img.shape[1], h / img.shape[0])
    img = cv2.resize(img, (round(img.shape[1] * s), round(img.shape[0] * s)), interpolation=cv2.INTER_LANCZOS4)
    y, x = (img.shape[0] - h) // 2, (img.shape[1] - w) // 2
    return img[y:y + h, x:x + w]


def ease(t):
    return t * t * (3 - 2 * t)


def main(only):
    depth_pipe = pipeline("depth-estimation", model="depth-anything/Depth-Anything-V2-Small-hf", device=-1)
    starts = [c[1] for c in CLIPS] + [END]
    for i, (name, at, (dx, dy, zoom), glow) in enumerate(CLIPS):
        if only and name not in only:
            continue
        dur = starts[i + 1] - at + XF
        frames = round(dur * FPS)
        src = cv2.imread(os.path.join(PAINT, f"{name}.png"), cv2.IMREAD_COLOR)
        bw, bh = round(W * MARGIN), round(H * MARGIN)
        big = cover(src, bw, bh)

        with torch.inference_mode():
            d = np.array(depth_pipe(Image.fromarray(cv2.cvtColor(big, cv2.COLOR_BGR2RGB)))["depth"], dtype=np.float32)
        d = cv2.resize(d, (bw, bh))
        d = (d - d.min()) / max(1e-6, d.max() - d.min())  # 1 = near
        d = cv2.GaussianBlur(d, (0, 0), 6)  # soften edges so layers don't tear

        if glow:
            hsv = cv2.cvtColor(big, cv2.COLOR_BGR2HSV).astype(np.float32)
            hue, sat, val = hsv[..., 0], hsv[..., 1], hsv[..., 2]
            mask = (((hue < 22) | (hue > 170)) & (sat > 120) & (val > 110)).astype(np.float32)
            mask = cv2.GaussianBlur(mask, (0, 0), 3)[..., None]

        gx, gy = np.meshgrid(np.arange(bw, dtype=np.float32), np.arange(bh, dtype=np.float32))
        cx, cy = bw / 2, bh / 2
        out = os.path.join(PAINT, f"{name}.mp4")
        enc = subprocess.Popen(
            ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
             "-c:v", "libx264", "-crf", "17", "-preset", "medium", "-pix_fmt", "yuv420p", out],
            stdin=subprocess.PIPE,
        )
        for f in range(frames):
            t = ease(f / max(1, frames - 1))
            shift = (t - 0.5) * 2 * AMP
            s = 1 + (zoom - 1) * t
            # Inverse map: sample source at (pos - parallax), then zoom about the centre.
            mx = (gx - cx) / s + cx - dx * shift * (d - 0.35)
            my = (gy - cy) / s + cy - dy * shift * (d - 0.35)
            frame = cv2.remap(big, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
            if glow:
                pulse = 1 + 0.45 * (0.5 + 0.5 * np.sin(2 * np.pi * f / FPS * 0.7))
                m = cv2.remap(mask, mx, my, cv2.INTER_LINEAR)[..., None]
                frame = np.clip(frame.astype(np.float32) * (1 + (pulse - 1) * m), 0, 255).astype(np.uint8)
            y, x = (bh - H) // 2, (bw - W) // 2
            enc.stdin.write(np.ascontiguousarray(frame[y:y + H, x:x + W]).tobytes())
        enc.stdin.close()
        enc.wait()
        print(f"{name}.mp4  {dur:.1f}s", flush=True)


if __name__ == "__main__":
    main(set(sys.argv[1:]))
