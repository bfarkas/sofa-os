"""Export imagegen sources without retouching and measure at TV resolution."""
from pathlib import Path
import json
import numpy as np
from PIL import Image, ImageOps, ImageDraw

ROOT = Path(__file__).resolve().parent
TIMES = ['morning', 'midday', 'evening', 'night']

def fit(im, size):
    return ImageOps.fit(im, size, method=Image.Resampling.LANCZOS)

def luma(im):
    a = np.asarray(im, dtype=np.float64)
    return .2126*a[:,:,0] + .7152*a[:,:,1] + .0722*a[:,:,2]

def local_std(a, n=15):
    a = np.pad(a, n//2, mode='reflect')
    s = np.pad(a, ((1,0),(1,0))).cumsum(0).cumsum(1)
    q = np.pad(a*a, ((1,0),(1,0))).cumsum(0).cumsum(1)
    mean = (s[n:,n:]-s[:-n,n:]-s[n:,:-n]+s[:-n,:-n])/(n*n)
    sq = (q[n:,n:]-q[:-n,n:]-q[n:,:-n]+q[:-n,:-n])/(n*n)
    return float(np.sqrt(np.maximum(0, sq-mean*mean)).mean())

exports, metrics = {}, {}
sheet = Image.new('RGB', (1920,1128), '#17202a')
draw = ImageDraw.Draw(sheet)
for i, t in enumerate(TIMES):
    src = ROOT/'sources'/f'mountain-lake-{t}-native.png'
    im = Image.open(src).convert('RGB')
    stem = f'mountain-lake-{t}-3840x2160'
    out = fit(im, (3840,2160))
    out.save(ROOT/(stem+'.png'))
    out.save(ROOT/(stem+'.jpg'), quality=95, subsampling=0)
    preview = fit(out, (1920,1080))
    preview.save(ROOT/'preview-1920'/f'{t}.jpg', quality=95, subsampling=0)
    a = luma(preview)
    edge = np.abs(a[3:]-a[:-3])
    shore = int(np.argmax(edge.mean(1)[425:475])+426)
    region = edge[255:300,830:890]
    coords = np.argwhere(region > max(4, float(region.max())*.35))
    top = coords[coords[:,0] == coords[:,0].min()]
    peak = [int(830+np.median(top[:,1])), int(256+top[0,0])]
    strip_rows = [int(np.argmax(edge[445:475,x:x+160].mean(1))+446)
                  for x in range(0,1920,160)]
    old = fit(Image.open(ROOT.parents[2]/'v1/wallpaper/day-cycle-4k'/(stem+'.png')).convert('RGB'), (1920,1080))
    new_c, old_c = local_std(a[481:]), local_std(luma(old)[481:])
    metrics[t] = dict(shoreline_y=shore, shoreline_strip_rows=strip_rows,
        peak_xy=peak, mean_15px_local_luminance_std_y_gt_480=round(new_c,3),
        v1_same_region=round(old_c,3),
        contrast_reduction_percent=round(100*(1-new_c/old_c),1),
        mean_water_luminance_0_255=round(float(a[481:].mean()),1))
    exports[t] = dict(source=str(src.relative_to(ROOT)), source_size=list(im.size),
        export_size=list(out.size), upscaled=True, png=stem+'.png', jpg=stem+'.jpg',
        preview=f'preview-1920/{t}.jpg', preview_size=list(preview.size))
    x,y = i%2*960, i//2*564
    sheet.paste(preview.resize((960,540), Image.Resampling.LANCZOS), (x,y+24))
    draw.text((x+12,y+6), t, fill='white')
sheet.save(ROOT/'preview-contact-sheet.png')
(ROOT/'exports.json').write_text(json.dumps(dict(method='Pillow ImageOps.fit + Lanczos; RGB; no added detail, sharpening or color changes; JPEG quality 95, 4:4:4', images=exports), indent=2)+'\n')
(ROOT/'measurements.json').write_text(json.dumps(dict(frame=[1920,1080],
    method='Final PNG downscaled to 1920x1080. Shoreline: strongest full-width mean absolute 3-row luminance gradient, rows425:475. Levelness: same gradient in 12 strips. Peak: uppermost strong sky/land edge in x830:890,y255:300, approximate within 2-3px. Contrast: mean 15x15 local standard deviation of Rec709 luma 0..255 in rows481:1080. Same v1 region includes land; not water-only comparison.',
    images=metrics), indent=2)+'\n')
print(json.dumps(metrics, indent=2))
