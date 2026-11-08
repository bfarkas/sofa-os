# Sofa.OS / Low profile / v1

Selected direction: Quiet sofa, refined into a modern minimalist Japandi sofa. Warm ivory on deep muted sage; a low continuous back, simple arms and short feet. The SVG is a clean production redraw of the selected concept, not an automatic bitmap trace.

## Files

- `sofa-icon.svg`: canonical square opaque icon, 1024-unit viewBox. No baked-in corner mask.
- `sofa-icon-{192,512}.png`: standard PWA icons; `1024` is a large master export.
- `sofa-icon-maskable-{192,512}.png`: slightly smaller mark with full-bleed background. All mark geometry lies inside the central safe circle of radius 40% of the image width.
- `sofa-icon-180.png`: Apple touch icon.
- `sofa-icon-117.png`: packaged icon for the household's sideloaded Tizen TV app. This is not a Samsung Seller Office submission asset.
- `sofa-icon-{32,48}.png`, `favicon.ico`: browser icons.
- `sofa-mark-{ivory,sage}.svg`: transparent mark for future interface/wordmark use.
- `manifest-icons.json`: manifest fragment; assumes assets will be served under `/icons/`. Adjust paths on integration. This is not a complete PWA manifest.
- `preview.png`: large icon, native small-size samples and mask checks.
- `concept-reference.png`: selected AI exploration board for visual provenance.

Palette: sage `#465C48`, ivory `#FFF5E3`, supporting charcoal `#29332F`. Preserve proportions and negative space. Let platforms apply icon corner masks. Use transparent marks on contrasting backgrounds.

## Rebuild

Run `python3 assets/brand/v1/export.py` with CairoSVG and Pillow installed. The optional preview uses the macOS Arial font. The script rewrites exports in this directory only. App implementation and existing placeholder assets are not modified by this asset pack.

## Design provenance

Explorations used the built-in image generation tool. Selected prompt direction: “Concept 01 Quiet sofa; modern minimalist Japandi; low wide sofa, continuous back and seat, short straight arms with softened corners, ivory on deep muted sage; no gradients, texture, shadows, sun or mountains.” Final vector geometry and raster exports are deterministic and editable in `export.py`.

## Platform references

- [MDN: Define your app icons](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Define_app_icons)
- [Samsung: Smart TV Application Design Q&A](https://developer.samsung.com/smarttv/design/smart-tv-application-design-qa.html) — 117 px packaged test icon versus separately submitted published app imagery.
