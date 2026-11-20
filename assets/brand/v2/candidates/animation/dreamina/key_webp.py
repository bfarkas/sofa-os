"""Green-screen Dreamina clip -> transparent animated WebP for the TV (600 px, 15 fps, plays once).

usage: python3 key_webp.py clip.mp4 out-prefix   (writes out-prefix.webp, -first.png, -still.png)
Needs ffmpeg, img2webp, Pillow, NumPy.
"""
import subprocess, sys, tempfile, pathlib
import numpy as np
from PIL import Image

clip, prefix = sys.argv[1], sys.argv[2]
SIZE, FPS = 600, 15

def key(rgb):
    """Alpha from how much green beats the other channels; despill the edge."""
    a = rgb.astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    excess = g - np.maximum(r, b)  # flat #00B140 gives ~110; the unicorn (ivory/purple) is <= 0
    alpha = np.clip(1 - (excess - 20) / 60, 0, 1)  # shortcut: hand-tuned thresholds for this palette, retune for green-ish art
    a[..., 1] = np.minimum(g, np.maximum(r, b))  # kill the green fringe
    out = np.dstack([a, alpha * 255]).round().astype(np.uint8)
    out[alpha == 0] = 0
    return out

with tempfile.TemporaryDirectory() as tmp:
    subprocess.run(['ffmpeg', '-v', 'error', '-i', clip, '-vf', f'fps={FPS},scale={SIZE}:{SIZE}:flags=lanczos', f'{tmp}/f%03d.png'], check=True)
    frames = sorted(pathlib.Path(tmp).glob('f*.png'))
    for f in frames:
        Image.fromarray(key(np.asarray(Image.open(f).convert('RGB')))).save(f)
    assert len(frames) > FPS, 'clip too short'
    probe = key(np.full((2, 2, 3), (0, 177, 64), np.uint8))
    assert probe[..., 3].max() == 0, 'flat green must be fully transparent'
    Image.open(frames[0]).save(prefix + '-first.png', optimize=True)
    Image.open(frames[-1]).save(prefix + '-still.png', optimize=True)
    subprocess.run(['img2webp', '-loop', '1', '-lossy', '-q', '80', '-d', str(round(1000 / FPS)), *map(str, frames), '-o', prefix + '.webp'], check=True)
    print(len(frames), 'frames ->', prefix + '.webp')
