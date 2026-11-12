import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chartPaths, columnClass, toneClass } from './cards.ts';

test('chartPaths draws one stretch per run of readings and leaves a gap for null', () => {
  assert.deepEqual(chartPaths([0, 1]), { line: 'M0,100L1000,0', fill: 'M0,100L1000,0L1000,100L0,100Z' });
  const gap = chartPaths([0.5, null, 0.5]);
  assert.equal(gap.line, 'M0,50M1000,50');
  assert.equal(gap.fill, 'M0,50L0,100L0,100ZM1000,50L1000,100L1000,100Z');
  assert.deepEqual(chartPaths([null, null]), { line: '', fill: '' });
  assert.equal(chartPaths([0.25]).line, 'M500,75');
});

test('a tone fills a value card and makes a column a tile; a word is drawn smaller than a count', () => {
  assert.equal(toneClass({ template: 'value', value: '5', unit: 'days', tone: 'brown' }), 'tone-brown');
  assert.equal(toneClass({ template: 'value', value: '5' }), '');
  assert.equal(toneClass({ template: 'list', rows: [] }), '');
  assert.equal(columnClass({ label: 'Bioabfall', value: '5', unit: 'days', tone: 'brown' }), 'c toned tone-brown');
  assert.equal(columnClass({ label: 'Papier', value: 'Today', tone: 'blue' }), 'c toned tone-blue word');
  assert.equal(columnClass({ label: 'Glas', value: null, tone: 'grey' }), 'c toned tone-grey');
  assert.equal(columnClass({ label: 'Tue', value: 'Tomorrow' }), 'c'); // no tone, no tile
  assert.equal(columnClass({ label: '14:00', value: '4', tint: 0.5 }), 'c tinted');
});
