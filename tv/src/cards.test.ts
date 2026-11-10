import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chartPaths } from './cards.ts';

test('chartPaths draws one stretch per run of readings and leaves a gap for null', () => {
  assert.deepEqual(chartPaths([0, 1]), { line: 'M0,100L1000,0', fill: 'M0,100L1000,0L1000,100L0,100Z' });
  const gap = chartPaths([0.5, null, 0.5]);
  assert.equal(gap.line, 'M0,50M1000,50');
  assert.equal(gap.fill, 'M0,50L0,100L0,100ZM1000,50L1000,100L1000,100Z');
  assert.deepEqual(chartPaths([null, null]), { line: '', fill: '' });
  assert.equal(chartPaths([0.25]).line, 'M500,75');
});
