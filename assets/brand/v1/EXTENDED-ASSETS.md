# Supporting assets / v1

Open collection.html for the complete visual review.

## Deliverables

- wordmarks/: Sofa.OS plus the selected sofa symbol; transparent SVG and 1280 × 400 PNG, in sage, charcoal and ivory. Sage accent on the dot. SVG has live text using Avenir Next, Avenir, sans-serif; it is not outlined and typography may vary across systems. Use PNG for a fixed appearance. No font file is redistributed.
- wallpaper/mountain-sunset.png: clean mountain-lake sunset inspired by the original dashboard reference; no UI, furniture, labels or logos. Native generation is 1672 × 941, approximately 16:9. This is not native 4K. Use cover-fit at 16:9. Check text contrast in the actual dashboard; bright sunset areas still need surface contrast.
- kids/unicorn-welcome.png: simple friendly ivory unicorn with purple mane, tail and hooves.
- kids/unicorn-resting.png: same character, eyes closed and resting for the Done screen. Both are native transparent RGBA 1254 × 1254 PNGs.
- launch/: centered ivory wordmark on sage, SVG and 1920 × 1080 PNG.
- generation-prompts.json: full prompts used with the built-in image generation tool. Wallpaper uses docs/sofa-os-mountain-sunset-dashboard.png as mood reference; resting unicorn uses the welcome pose as its identity reference.
- export-extended.py: reproducible SVG and PNG export for wordmarks and launch screen; requires CairoSVG. Preserves the icon geometry in the existing SVG master.

## Direction

Adult surfaces retain the calm minimalist Japandi palette: sage #465C48, ivory #FFF5E3 and charcoal #29332F. Kids artwork adds lavender #B69AD9 and plum #75519A. A suggested pale card background is #E9DFF2. Generated illustration colors are approximate, not exact flat color swatches.

Use the unicorn without an embedded label, preserving the alpha channel and generous padding. Keep labels and messages in the app so they remain legible and accessible. The collection shows suggested entry and Done compositions; copy and backgrounds are not baked into the character assets. No app integration has been changed.

## Unicorn cartoon revision / v2

The gallery now uses kids/unicorn-welcome-v2.png and kids/unicorn-resting-v2.png. These follow the user-provided cartoon style reference: dark outlines, shiny expressive eyes, smooth cel shading, ivory bodies and purple accents. Generated with the built-in image tool. Earlier unversioned artwork is preserved. Full prompts are in kids/cartoon-v2-prompts.json. The user attachment served only as a style reference and is not bundled in this repository.

## Four times of day / 4K exports

wallpaper/day-cycle-4k/ contains morning, midday, evening and night, each as exact 3840 × 2160 PNG and JPEG. These are explicitly upscaled exports from 1672 × 941 generations, not native 4K artwork. Originals, full prompts and dimensions are preserved in that folder. The gallery now shows all four variants.
