import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ROW_UNITS, UNITS } from './layout.ts';
import { COLORS, SCHEME_IDS, SCHEME_PROPS, SCHEMES, schemeCss, schemeVars, SIZES, textOn, tokensCss } from './tokens.ts';

test('tokensCss emits every colour and size as a --sofa- custom property', () => {
  const css = tokensCss();
  assert.match(css, /^:root\{.*\}$/);
  assert.ok(css.includes('--sofa-color-ivory:' + COLORS.ivory));
  assert.ok(css.includes('--sofa-color-sage-deep:' + COLORS.sageDeep));
  assert.ok(css.includes('--sofa-size-margin-x:' + SIZES.marginX + 'px'));
  assert.equal(css.split(';').length, 1 + Object.keys(COLORS).length + Object.keys(SIZES).length);
});

test('textOn picks ink on light backgrounds and ivory on dark ones', () => {
  assert.equal(textOn('#f6f1e7'), COLORS.ink);
  assert.equal(textOn('#ffffff'), COLORS.ink);
  assert.equal(textOn('#1b2a22'), COLORS.ivory);
  assert.equal(textOn('#000000'), COLORS.ivory);
  assert.equal(textOn('not a colour'), COLORS.ink);
});

test('widget widths are whole units plus the gaps between them, and a full row fits inside the margins', () => {
  assert.equal(SIZES.widgetMedium, UNITS.medium * SIZES.widgetSmall + (UNITS.medium - 1) * SIZES.gap);
  assert.equal(SIZES.widgetLarge, UNITS.large * SIZES.widgetSmall + (UNITS.large - 1) * SIZES.gap);
  assert.ok(ROW_UNITS * SIZES.widgetSmall + (ROW_UNITS - 1) * SIZES.gap <= 1920 - 2 * SIZES.marginX);
});

test('a row\'s side padding covers a focused tile: its 1.06 scale plus the ring and outline, for the widest tile (Kids Mode, 700 px)', () => {
  const growth = (700 * 0.06) / 2;
  assert.ok(SIZES.rowPad >= growth + SIZES.focusRing + SIZES.focusOutline, 'the Kids Mode tile would clip');
});

// ---- Colour schemes (Session 37) ----

const HEX = /^#[0-9a-f]{6}$/i;
const lum = (c: number[]) => {
  const l = c.map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
};
const rgbOf = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const contrast = (a: number[], b: number[]) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
// The brightest 3 % of each day wallpaper's widget band (the top 8 to 30 % of the picture), measured from tv/app/img on 2026-11-12.
const BANDS: Record<string, number[]> = { morning: [195, 189, 192], midday: [149, 194, 235], evening: [228, 125, 119], night: [37, 62, 94] };

test('every scheme names all its colours; sage is today\'s look and has no override', () => {
  assert.deepEqual(SCHEME_IDS, ['sage', 'slate', 'lamplight', 'plum', 'graphite']);
  for (const id of SCHEME_IDS) {
    const s = SCHEMES[id];
    assert.ok(s.name && s.glass.length === 3 && s.full.length === 3, id);
    for (const c of [s.accent, s.bar, s.warn, s.rain, s.selected]) assert.match(c, HEX, id);
    for (const n of [...s.glass, ...s.full]) assert.ok(Number.isInteger(n) && n >= 0 && n <= 255, id);
  }
  assert.equal(SCHEMES.sage.accent, COLORS.glassAccent);
  assert.equal(SCHEMES.sage.bar, COLORS.glassBar);
  assert.equal(SCHEMES.sage.selected, COLORS.selected);
  assert.deepEqual(schemeVars('sage'), {});
  assert.deepEqual(schemeVars(undefined), {});
  assert.deepEqual(schemeVars('neon'), {}); // an unknown id is the default
  assert.equal(schemeCss('neon'), '');
});

test('schemeCss sets every scheme property on the stage, and never under Kids Mode', () => {
  for (const id of SCHEME_IDS.filter((i) => i !== 'sage')) {
    const css = schemeCss(id);
    assert.match(css, /^body:not\(\.kids\) #stage\{.*\}$/);
    for (const p of SCHEME_PROPS) assert.ok(css.includes(p + ':'), id + ' ' + p);
    assert.deepEqual(Object.keys(schemeVars(id)), [...SCHEME_PROPS]);
  }
  assert.ok(schemeCss('slate').includes('--p-bg:rgba(13, 24, 38, 0.66)') && schemeCss('slate').includes('--sel-lift:rgba(47, 90, 133, 0.9)'));
});

test('text, accent and bar stay readable over the brightest part of each wallpaper under every scheme', () => {
  for (const id of SCHEME_IDS) {
    const s = SCHEMES[id];
    for (const [band, under] of Object.entries(BANDS)) {
      const glass = s.glass.map((c, i) => c * 0.66 + under[i] * 0.34); // the glass is 66 % over the picture
      const where = id + ' over ' + band;
      assert.ok(contrast(rgbOf(COLORS.glassInk), glass) >= 4.5, where + ' text');
      assert.ok(contrast(rgbOf(s.accent), glass) >= 4.5, where + ' accent');
      assert.ok(contrast(rgbOf(s.warn), glass) >= 3, where + ' warn'); // the stale and unavailable marks are bold: 3:1 (Lamplight's is the lowest, over the morning sky)
      assert.ok(contrast(rgbOf(s.bar), glass) >= 3, where + ' bar');
    }
  }
});
