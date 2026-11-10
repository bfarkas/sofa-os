import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ROW_UNITS, UNITS } from './layout.ts';
import { COLORS, SIZES, textOn, tokensCss } from './tokens.ts';

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
