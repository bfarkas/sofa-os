# Mountain lake / four times of day

Delivery size for every PNG and JPEG: **3840 × 2160 pixels**, RGB, exactly 16:9.

These are **upscaled 4K exports, not native 4K generations**. The built-in image tool returned 1672 × 941 for every source despite a 3840 × 2160 prompt. The originals are preserved in sources/. Export used Pillow ImageOps.fit with Lanczos resampling and a negligible centered aspect correction; no added detail, sharpening or color changes.

- Morning: soft first light and shoreline mist.
- Midday: clear blue sky, naturally lit green forest and snow.
- Evening: the original selected warm sunset wallpaper.
- Night: deep blue moonlit landscape and faint stars; no sunset glow.

PNG is the lossless delivery master (the source itself is generated at lower resolution). JPEG quality 95, 4:4:4 is a lighter runtime alternative. The scenery is visually consistent; generative relighting is not guaranteed to maintain pixel-perfect registration for animated dissolves.

Generated with the built-in image tool using the selected wallpaper as the landscape identity reference. Full prompts and export dimensions are recorded in generation-prompts.json and exports.json. Native high-resolution generation would require a different authorized generation workflow. App integration and time scheduling are not included.
