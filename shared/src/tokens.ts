// Visual tokens (spec: TV experience): warm ivory, muted sage, a clear focus outline, legible over photos.
// Sofa Home injects them as CSS custom properties; Companion's TV preview (Session 15) does the same.
// This file also runs on the TV (Chromium 56), so it uses no runtime API newer than ES2017.

/** Colours. Panels stay ivory with ink text whatever is behind them, so a tile reads over a photo or a dark colour. */
export const COLORS = {
  ivory: '#f6f1e7', // page and panel base
  panel: 'rgba(246, 241, 231, 0.94)', // tiles over a background
  panelDim: 'rgba(246, 241, 231, 0.62)', // unavailable tiles
  ink: '#2b2f2a', // text on panels and on light backgrounds
  inkMuted: '#4f5a4d', // secondary text on panels (above 6:1 on ivory)
  sage: '#8aa58d', // muted sage: accents and the app letter badge
  sageDeep: '#2f5d46', // focus outline, selected tab
  focusRing: '#fffdf8', // inner focus ring, separates the outline from any background
  warn: '#a3352b', // errors and "unavailable"
  scrim: 'rgba(31, 36, 30, 0.72)', // behind overlays
} as const;

/** Sizes in px for a 1920x1080 screen. The margins keep content inside the TV-safe area (5%). */
export const SIZES = {
  marginX: 96,
  marginY: 54,
  tile: 220, // an app tile is a square this wide; widgets are this tall
  gap: 28, // between tiles
  radius: 22,
  focusRing: 5, // inner ring; the outline adds 6 more
  focusOutline: 6,
  textBody: 30,
  textLabel: 32,
  textTitle: 40,
  textHero: 68,
} as const;

export const FONT = "'Helvetica Neue', Arial, sans-serif";

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());

/** The tokens as one `:root` rule: `--sofa-color-ivory`, `--sofa-size-margin-x` (px), `--sofa-font`. */
export function tokensCss(): string {
  const lines = ['--sofa-font:' + FONT];
  for (const k of Object.keys(COLORS)) lines.push('--sofa-color-' + kebab(k) + ':' + COLORS[k as keyof typeof COLORS]);
  for (const k of Object.keys(SIZES)) lines.push('--sofa-size-' + kebab(k) + ':' + SIZES[k as keyof typeof SIZES] + 'px');
  return ':root{' + lines.join(';') + '}';
}

/** Which text colour reads on a `#rrggbb` background: ink on light colours, ivory on dark ones (WCAG relative luminance). */
export function textOn(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return COLORS.ink;
  const lin = (h: string) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const lum = 0.2126 * lin(m[1]) + 0.7152 * lin(m[2]) + 0.0722 * lin(m[3]);
  return lum > 0.179 ? COLORS.ink : COLORS.ivory; // 0.179 is where black and white text have equal contrast
}
