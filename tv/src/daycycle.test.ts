import assert from 'node:assert/strict';
import { test } from 'node:test';
import { currentPeriod, fakeHour } from './daycycle.ts';

test('a usable fake hour is a whole number 0 to 23; the first one wins, the rest are ignored', () => {
  assert.equal(fakeHour(undefined, '', 'x', 24, -1, 6.5), null);
  assert.equal(fakeHour(undefined, '21'), 21);
  assert.equal(fakeHour(0), 0);
  assert.equal(fakeHour('abc', ' 7 ', 12), 7);
});

test('the period follows the clock, or the fake hour when there is one', () => {
  const at = (h: number) => new Date(2026, 10, 10, h, 30);
  assert.equal(currentPeriod(at(23), null), 'night');
  assert.equal(currentPeriod(at(23), 12), 'midday');
  assert.equal(currentPeriod(at(12), 3), 'night');
});
