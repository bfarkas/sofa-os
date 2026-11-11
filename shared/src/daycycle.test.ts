import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayFootInk, dayImage, dayInk, dayShadow, DAY_PERIODS, DAY_SKY, periodAt } from './daycycle.ts';
import { COLORS } from './tokens.ts';

test('the period of every hour: morning 6 to 10, midday 10 to 17, evening 17 to 21, night 21 to 6', () => {
  const by = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => periodAt(from + i));
  assert.ok(by(0, 6).every((p) => p === 'night'));
  assert.ok(by(6, 10).every((p) => p === 'morning'));
  assert.ok(by(10, 17).every((p) => p === 'midday'));
  assert.ok(by(17, 21).every((p) => p === 'evening'));
  assert.ok(by(21, 24).every((p) => p === 'night'));
});

test('the text on the wallpaper follows the measured sky: ink in the morning and at midday, ivory in the evening and at night', () => {
  assert.deepEqual(DAY_PERIODS.map(dayInk), [COLORS.ink, COLORS.ink, COLORS.ivory, COLORS.ivory]);
  assert.deepEqual(DAY_PERIODS.map(dayFootInk), Array(4).fill(COLORS.ivory), 'the footer sits on the water');
  assert.deepEqual(Object.keys(DAY_SKY), [...DAY_PERIODS]);
});

test('each period has its picture in the package', () => {
  assert.equal(dayImage('night'), 'img/day-night.jpg');
});

test('the halo behind the wallpaper text is dark behind ivory and none behind ink', () => {
  assert.deepEqual(DAY_PERIODS.map((p) => dayShadow(p).includes('0, 0, 0')), [false, false, true, true]);
  assert.equal(dayShadow('midday'), 'none');
});
