import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateLayout, validateSnapshot, type Layout } from './layout.ts';

const valid = (): Layout => ({
  schema: 1,
  apps: [
    { id: 'org.tizen.netflix-app', name: 'Netflix' },
    { id: 'mvOizTfhQn.KiKAplayer', name: 'KiKA' },
  ],
  widgets: [{ id: 'w1', type: 'weather', size: 'medium', config: { entity: 'weather.home' }, profiles: ['household', 'kids'], freshness: 'hourly' }],
  rows: [
    { id: 'apps', title: '', items: [{ kind: 'app', id: 'org.tizen.netflix-app' }, { kind: 'app', id: 'mvOizTfhQn.KiKAplayer' }] },
    { id: 'info', title: 'Today', items: [{ kind: 'widget', id: 'w1' }] },
  ],
  background: { kind: 'color', color: '#f6f1e7' },
  kidsMode: { apps: ['mvOizTfhQn.KiKAplayer'], dailyMinutes: 60 },
});

// Applies a change to a fresh valid layout and returns the errors.
function errorsAfter(change: (l: any) => void): string[] {
  const l = valid();
  change(l);
  return validateLayout(l);
}

test('a valid layout has no errors', () => {
  assert.deepEqual(validateLayout(valid()), []);
  assert.deepEqual(validateLayout(JSON.parse(JSON.stringify(valid()))), []);
});

test('widget type and config stay generic', () => {
  assert.deepEqual(errorsAfter((l) => { l.widgets[0].type = 'anything-new'; l.widgets[0].config = { nested: { a: [1, 2] } }; }), []);
  assert.match(errorsAfter((l) => { l.widgets[0].config = [] }).join(), /widgets\[0\]\.config: must be an object/);
  assert.match(errorsAfter((l) => { l.widgets[0].config = { big: 'x'.repeat(5000) } }).join(), /at most 4096/);
});

test('enums are checked', () => {
  assert.match(errorsAfter((l) => { l.widgets[0].size = 'huge' }).join(), /widgets\[0\]\.size: must be one of small, medium, large/);
  assert.match(errorsAfter((l) => { l.widgets[0].freshness = 'weekly' }).join(), /freshness/);
  assert.match(errorsAfter((l) => { l.widgets[0].profiles = ['adults'] }).join(), /profiles\[0\]/);
  assert.match(errorsAfter((l) => { l.widgets[0].profiles = ['kids', 'kids'] }).join(), /duplicate/);
  assert.match(errorsAfter((l) => { l.background = { kind: 'video' } }).join(), /background\.kind/);
  assert.match(errorsAfter((l) => { l.background.color = 'red' }).join(), /background\.color/);
});

test('references and duplicates are checked', () => {
  assert.match(errorsAfter((l) => { l.rows[0].items.push({ kind: 'app', id: 'missing.App' }) }).join(), /rows\[0\]\.items\[2\]\.id: unknown app "missing.App"/);
  assert.match(errorsAfter((l) => { l.rows[1].items.push({ kind: 'widget', id: 'w1' }) }).join(), /rows\[1\]\.items\[1\]: duplicate/);
  assert.match(errorsAfter((l) => { l.rows[0].items[0].kind = 'tile' }).join(), /kind: must be one of app, widget/);
  assert.match(errorsAfter((l) => { l.apps.push({ id: 'org.tizen.netflix-app', name: 'Again' }) }).join(), /apps\[2\]\.id: duplicate/);
  assert.match(errorsAfter((l) => { l.rows.push({ id: 'apps', title: '', items: [] }) }).join(), /rows\[2\]\.id: duplicate/);
  assert.match(errorsAfter((l) => { l.kidsMode.apps.push('org.tizen.unknown') }).join(), /kidsMode\.apps\[1\]: unknown app/);
});

test('shapes and limits are checked', () => {
  assert.deepEqual(validateLayout(null), ['layout: must be an object']);
  assert.match(errorsAfter((l) => { l.schema = 2 }).join(), /schema: must be 1/);
  assert.match(errorsAfter((l) => { delete l.rows }).join(), /rows: must be a list/);
  assert.match(errorsAfter((l) => { l.apps[0].name = '  ' }).join(), /apps\[0\]\.name/);
  assert.match(errorsAfter((l) => { l.kidsMode.dailyMinutes = 12.5 }).join(), /dailyMinutes/);
  assert.match(errorsAfter((l) => { l.kidsMode.dailyMinutes = '60' }).join(), /dailyMinutes/);
  assert.match(errorsAfter((l) => { l.rows = Array.from({ length: 21 }, (_, i) => ({ id: 'r' + i, title: '', items: [] })) }).join(), /rows: must have at most 20/);
});

test('validateSnapshot checks the envelope and the layout', () => {
  assert.deepEqual(validateSnapshot({ revision: 3, publishedAt: '2026-11-08T12:00:00.000Z', layout: valid() }), []);
  assert.match(validateSnapshot({ revision: 0, publishedAt: 'x', layout: valid() }).join(), /revision/);
  assert.match(validateSnapshot({ revision: 1, publishedAt: 'x', layout: { schema: 2 } }).join(), /schema/);
  assert.deepEqual(validateSnapshot('nope'), ['snapshot: must be an object']);
});
