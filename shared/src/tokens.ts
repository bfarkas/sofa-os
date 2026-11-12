// Visual tokens (spec: TV experience): warm ivory, muted sage, a clear focus outline, legible over photos.
// Sofa Home injects them as CSS custom properties; Companion's TV preview (Session 15) does the same.
// This file also runs on the TV (Chromium 56), so it uses no runtime API newer than ES2017.

/** Colours. Panels stay ivory with ink text whatever is behind them, so a tile reads over a photo or a dark colour. */
export const COLORS = {
  ivory: '#f6f1e7', // page and panel base
  panel: 'rgba(246, 241, 231, 0.94)', // ivory tiles over a background (Kids Mode)
  panelDim: 'rgba(246, 241, 231, 0.62)', // unavailable ivory tiles
  // Smoked glass (Session 28): translucent dark panels with light text, for the Dashboard, tabs and full-screen views. No blur, since
  // the TV's Chromium 56 has no backdrop-filter; the wallpaper just shows through.
  glass: 'rgba(16, 24, 21, 0.66)',
  glassDim: 'rgba(16, 24, 21, 0.5)', // unavailable tiles, tab pills
  glassFull: 'rgba(14, 20, 18, 0.96)', // the full-screen panel, which needs more body than a tile (at 0.9 the Dashboard behind it ghosted through)
  glassInk: '#fffdf8',
  glassMuted: 'rgba(255, 253, 248, 0.74)',
  glassLine: 'rgba(255, 255, 255, 0.2)',
  glassSoft: 'rgba(255, 255, 255, 0.1)',
  glassAccent: '#b5dcc0', // headings and lines on glass
  glassBar: '#8fc3a0', // bars and fills on glass
  glassWarn: '#ffb4aa', // "unavailable" and stale marks on glass
  rain: '#8cc4f5', // the chance of rain on glass
  // Bin colours (Session 34), named in the display model as `tone`. Yellow carries dark ink, the others light.
  toneGrey: '#5f666b',
  toneBrown: '#86613f',
  toneBlue: '#3a74b8',
  toneYellow: '#e6c04a',
  selected: '#2f5d46', // the selected tab pill and the lifted tile (a colour scheme changes it, see SCHEMES)
  selectedLift: 'rgba(47, 93, 70, 0.9)', // the lifted tile: `selected` at 90 %
  ink: '#2b2f2a', // text on panels and on light backgrounds
  inkMuted: '#4f5a4d', // secondary text on panels (above 6:1 on ivory)
  sage: '#8aa58d', // muted sage: accents and the app letter badge
  sageDeep: '#2f5d46', // focus outline, selected tab
  focusRing: 'rgba(255, 253, 248, 0.8)', // inner focus ring, separates the outline from any background; slightly transparent
  warn: '#a3352b', // errors and "unavailable"
  scrim: 'rgba(31, 36, 30, 0.72)', // behind overlays
} as const;

/**
 * Colour schemes (Session 37): the household picks one in Companion's Appearance (Layout.scheme). A scheme tints the glass (the
 * same 66 / 50 / 96 % alphas as today) and sets the accent, bar, warn, rain and selected colours; text on glass does not change.
 * `sage` is today's look and has no override (COLORS holds it). Kids Mode never takes a scheme.
 */
export const SCHEME_IDS = ['sage', 'slate', 'lamplight', 'plum', 'graphite'] as const;
export type SchemeId = (typeof SCHEME_IDS)[number];
export interface Scheme {
  name: string;
  glass: readonly [number, number, number]; // rgb of the Dashboard glass
  full: readonly [number, number, number]; // rgb of the full-screen glass
  accent: string;
  bar: string;
  warn: string;
  rain: string;
  selected: string;
}
export const SCHEMES: Record<SchemeId, Scheme> = {
  sage: { name: 'Sage', glass: [16, 24, 21], full: [14, 20, 18], accent: '#b5dcc0', bar: '#8fc3a0', warn: '#ffb4aa', rain: '#8cc4f5', selected: '#2f5d46' },
  slate: { name: 'Lake Slate', glass: [13, 24, 38], full: [11, 20, 32], accent: '#a8cdf0', bar: '#7aaedc', warn: '#ffb4aa', rain: '#78d9d0', selected: '#2f5a85' },
  lamplight: { name: 'Lamplight', glass: [27, 20, 16], full: [24, 18, 14], accent: '#f1cb8e', bar: '#e0a458', warn: '#ff9f93', rain: '#8cc4f5', selected: '#8a5a14' },
  plum: { name: 'Plum Dusk', glass: [28, 18, 34], full: [24, 15, 30], accent: '#dcc2f0', bar: '#b494d8', warn: '#ffb0a8', rain: '#8cc4f5', selected: '#5b3a86' },
  graphite: { name: 'Graphite & Coral', glass: [19, 20, 22], full: [16, 17, 19], accent: '#efe9dd', bar: '#f08a6e', warn: '#ffd479', rain: '#8cc4f5', selected: '#b5482e' },
};
/** The custom properties on #stage that a scheme sets (index.html defines their defaults, the sage look). */
export const SCHEME_PROPS = ['--p-bg', '--p-dim', '--p-full', '--p-accent', '--p-bar', '--p-warn', '--rain', '--sel', '--sel-lift'] as const;

const rgba = (c: readonly number[], a: number) => 'rgba(' + c.join(', ') + ', ' + a + ')';
const hexRgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
/** The overrides of a scheme as property -> value; empty for sage and for an unknown id (the default look). */
export function schemeVars(id: unknown): Record<string, string> {
  const s = id === 'sage' ? undefined : (SCHEMES as Record<string, Scheme | undefined>)[id as string];
  if (!s) return {};
  return {
    '--p-bg': rgba(s.glass, 0.66),
    '--p-dim': rgba(s.glass, 0.5),
    '--p-full': rgba(s.full, 0.96),
    '--p-accent': s.accent,
    '--p-bar': s.bar,
    '--p-warn': s.warn,
    '--rain': s.rain,
    '--sel': s.selected,
    '--sel-lift': rgba(hexRgb(s.selected), 0.9),
  };
}

/** The overrides as one rule for a style element. Not under Kids Mode, which keeps its ivory panels whatever the scheme. */
export function schemeCss(id: unknown): string {
  const v = schemeVars(id);
  const keys = Object.keys(v);
  return keys.length ? 'body:not(.kids) #stage{' + keys.map((k) => k + ':' + v[k]).join(';') + '}' : '';
}

/** Sizes in px for a 1920x1080 screen. The margins keep content inside the TV-safe area (5%). */
export const SIZES = {
  marginX: 96,
  marginY: 54,
  tile: 176, // an app tile is a square this wide
  widgetHeight: 252, // every widget is this tall
  widgetSmall: 323, // five small widgets fill a row; a medium takes two (2 x 323 + gap), a large three
  widgetMedium: 674,
  widgetLarge: 1025,
  gap: 28, // between tiles
  rowPad: 36, // a row's side padding, room for the focus ring and scale of its first and last tile
  radius: 22,
  focusRing: 5, // inner ring; the outline adds 6 more. A focused tile also scales by 1.06, so a row's side padding (36) must cover the widest tile's growth plus 11 (the 700 px Kids Mode tile: 21 + 11)
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
