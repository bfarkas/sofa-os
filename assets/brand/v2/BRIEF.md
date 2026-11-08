# Kids Mode art brief (v2)

Decision (2026-11-08): the Kids Mode mascot is the purple unicorn from `assets/brand/v1/kids/`, not the spec mockup's pirate octopus.

## Shared rules

- Setting: a magical forest (unicorns live there). No castle anywhere.

- Style reference: `assets/brand/v1/kids/unicorn-welcome-v2.png` (bold dark outline, glossy eyes, ivory body, purple mane/tail/hooves, pink cheeks). Same character, same proportions, same palette.
- No text, letters, logos or UI baked into any image. Labels are live UI text.
- Calm, friendly, never scary or sad-crying. Children are about 3 to 8.
- Save 3 candidates per asset in `assets/brand/v2/candidates/<asset>-a|b|c.png`. Do not touch `v1/`.
- Palette anchors: purple `#8E3FBF`, lavender `#C9A6EE`, ivory `#FFF5E3`, outline near-black. Sage `#465C48` is the adult UI colour and stays out of Kids art.

## Assets

1. **unicorn-warning**: transparent PNG, 1254x1254, sitting pose like welcome-v2, one hoof raised in a gentle wave, a small hourglass or round clock beside it. Meaning: "a few minutes left". Cheerful, not alarming.
2. **unicorn-unavailable**: transparent PNG, 1254x1254, same pose family, curious head tilt, small cloud above. Meaning: "Kids Mode is not available right now". Neutral, not sad.
3. **kids-tile-banner**: 2048x512 PNG, wide, unicorn on the left, a few glowing trees, fireflies and stars on the right over a lavender-to-white gradient. Keep the centre-right clear for the live "Kids Mode" label and an arrow button. Rounded-corner safe: nothing within 40 px of the edges.
4. **kids-background**: 1920x1080 PNG, no characters. Magical forest at dusk: soft lavender and deep purple trees, glowing mushrooms and fireflies, a few stars, low contrast. No castle. Bottom 60 percent must be calm and low detail so large tiles and text stay readable.

## Round 2 decisions (2026-11-08, after reviewing round 1)

- unicorn-warning: candidate **c** (hourglass on the left) is chosen. Copy to `v2/` once integrated.
- unicorn-unavailable: the unicorn must be **sleeping** (closed eyes, curled up or lying down, small moon and stars, no letters). Must look clearly different from `v1/kids/unicorn-resting-v2.png`, which is the Done Screen pose.
- kids-tile-banner: on hold until a combined mockup with all assets exists.
- kids-background: the forest needs dark brown trunks and leafy greens, with the purple magic kept as accent (glowing mushrooms, fireflies, blossoms). Three time-of-day variants: morning, midday, late afternoon, same composition, different light. Colour reference: four stock images supplied by the user (private reference only, watermarked, not committed, ignore the unicorns in them).

## Round 3 decisions (2026-11-08)

- unicorn-sleeping: **b** (lying down) is chosen for the Kids Mode unavailable state.
- Forests approved. Morning gets a light lavender haze: `candidates/kids-forest-morning-haze.png` (made with Pillow from kids-forest-morning.png, haze alpha about 0.36 at its peak, fading out toward top and bottom).
- Tile banner: no generated banner. The Dashboard tile is composed in code from the forest crop, the unicorn and live text. See `mockup/` for the layout study (`mock.py` rebuilds it).
- Dashboard tile: variant **B, light lavender panel** is chosen (dark purple #533B70 label, purple arrow, forest fading in on the right, sleeping unicorn about 1.05x tile height when unavailable). Layout study in `mockup/tile2.py`.
- Chosen assets are copied to `final/` (unicorn PNGs, forest JPEGs at 1920x1080, quality 90).
