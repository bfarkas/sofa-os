# Mountain lake: registered day cycle, v2

Four illustrated wallpapers for Sofa Home on a 1920×1080 TV: morning first light with shoreline mist, clear blue midday, warm sunset evening (composition master), and deep blue moonlit night with faint stars and no sunset glow. Compared with v1, the land sits higher, the mountain is lower and wider, the forest is a thin strip, and the lake is much quieter behind widgets and app icons. Nothing in v1 was edited.

Generated with Codex's **built-in imagegen**, evening first, followed by reference-based relighting. Native output was **1672×941**, despite requesting the maximum native 16:9 resolution / 3840×2160. The 4K files are therefore upscaled, not native 4K. Native selected images and all intermediate attempts are retained in `sources/`; every prompt, its reference and output are in `generation-prompts.json`.

## Composition specification

All coordinates below refer to **1920×1080**; double them for the 3840×2160 exports.

- Level forest/water shoreline: y=430–470, target 450 (40–43% height).
- Low, wide snowy mountain: summit x=700–1000, y≥250, approximately ≤200px above shore; lower side ridges permitted.
- Low forest: edge tree tops no more than about 60px above shore.
- Reserved sky: x<700,y<350 and x>1100,y<350 contain only sky with soft low-contrast clouds.
- Below y=480: quiet water, diffuse low-contrast reflections, no bright streaks, hard reflected edges or busy detail, gently darker toward bottom. Mid tones in morning/midday; mid-to-dark evening/night.
- No text, logos, UI, people, boats, birds or other foreground objects.
- Match shoreline, mountain silhouette, forest and framing across times; only illumination, sky, mist, colors and reflections vary.

## Delivery and validation

`mountain-lake-{morning,midday,evening,night}-3840x2160.png` are lossless RGB delivery masters. Matching JPEGs use quality 95 and 4:4:4. Export uses only Pillow `ImageOps.fit` with Lanczos and negligible centered aspect correction: no added detail, sharpening or color changes. `preview-1920/<time>.jpg` provides TV-sized previews. `preview-contact-sheet.png` is a labeled 2×2 overview in morning/midday/evening/night order. `exports.json` records dimensions; `export_and_measure.py` reproduces exports and measurements (Pillow + NumPy).

| Time | Shoreline y | Approx. peak (x,y) | Local contrast v2 / v1 |
|---|---:|---|---:|
| Morning | 468 | (854,274) | 0.985 / 4.529 |
| Midday | 467 | (856,273) | 0.897 / 8.303 |
| Evening | 467 | (859,274) | 0.904 / 3.439 |
| Night | 466 | (855,272) | 0.699 / 3.063 |

Measurements use final PNGs downscaled to 1080. Shoreline is the strongest mean vertical luminance gradient around the boundary; twelve horizontal strips place it within y=466–469, including mist/edge uncertainty. Peak is the uppermost strong summit edge (approximate ±2–3px). Measured peak positions differ by at most 5px horizontally and 2px vertically; shoreline rows differ by 2px. Generative relighting preserves close visual registration, not pixel-identical internal texture.

Local contrast is mean 15×15 local luminance standard deviation (0–255) for every pixel at y>480: **74–89% lower than the same region in v1**. That v1 region includes land, so this compares the actual UI background region, not water alone. Visual inspection checked open sky reserves, thin forest, smooth diffuse reflections, gentle bottom darkening and absence of unwanted objects. Full numeric results are in `measurements.json`. The only delivery limitation is native resolution: the 4K exports are upscaled.
