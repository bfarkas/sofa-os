import assert from 'node:assert/strict';
import { test } from 'node:test';
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
