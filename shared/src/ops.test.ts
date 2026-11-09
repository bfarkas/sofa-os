import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Layout } from './layout.ts';
import { applyOp, isLayoutOp } from './ops.ts';

const w = (id: string) => ({ id, type: 'status', size: 'small' as const, config: {}, profiles: ['household' as const], freshness: 'live' as const });
const layout = (): Layout => ({
  schema: 1,
  apps: [{ id: 'a.Netflix', name: 'Netflix' }, { id: 'a.Plex', name: 'Plex' }],
  widgets: [w('a'), w('b'), w('c'), w('d')],
  rows: [
    { id: 'apps', title: 'Apps', items: [{ kind: 'app', id: 'a.Netflix' }] },
    { id: 'info', title: 'Info', items: [{ kind: 'widget', id: 'a' }, { kind: 'app', id: 'a.Plex' }, { kind: 'widget', id: 'b' }, { kind: 'widget', id: 'c' }] }, // apps count for the index
  ],
  background: { kind: 'color', color: '#f6f1e7' },
  kidsMode: { apps: [], dailyMinutes: 40 },
});
const ids = (l: Layout | null, row = 'info') => l && l.rows.filter((r) => r.id === row)[0].items.map((i) => i.id);

test('move puts the widget at the index among its row, clamped', () => {
  assert.deepEqual(ids(applyOp(layout(), { op: 'move', widget: 'a', index: 2 })), ['a.Plex', 'b', 'a', 'c']);
  assert.deepEqual(ids(applyOp(layout(), { op: 'move', widget: 'c', index: 0 })), ['c', 'a', 'a.Plex', 'b']);
  assert.deepEqual(ids(applyOp(layout(), { op: 'move', widget: 'a', index: 40 })), ['a.Plex', 'b', 'c', 'a']);
  const once = applyOp(layout(), { op: 'move', widget: 'a', index: 2 })!;
  assert.deepEqual(applyOp(once, { op: 'move', widget: 'a', index: 2 }), once, 'replaying a move is harmless');
});

test('remove takes the widget off the Dashboard and keeps the widget', () => {
  const l = applyOp(layout(), { op: 'remove', widget: 'b' })!;
  assert.deepEqual(ids(l), ['a', 'a.Plex', 'c']);
  assert.equal(l.widgets.length, 4);
});

test('add puts the widget at the end of the first row holding a widget, or a new row', () => {
  assert.deepEqual(ids(applyOp(layout(), { op: 'add', widget: 'd' })), ['a', 'a.Plex', 'b', 'c', 'd']);
  const bare = { ...layout(), rows: [layout().rows[0]] };
  const added = applyOp(bare, { op: 'add', widget: 'd' })!;
  assert.deepEqual(added.rows[1], { id: 'row-2', title: 'Widgets', items: [{ kind: 'widget', id: 'd' }] });
});

test('add skips a row with no room left, since the TV clips past six units (found on the TV)', () => {
  const l = layout();
  l.widgets[0] = { ...w('a'), size: 'large' }; // info: large 3 + small 1 + small 1 = 5 units
  l.widgets[3] = { ...w('d'), size: 'medium' };
  const added = applyOp(l, { op: 'add', widget: 'd' })!;
  assert.deepEqual(ids(added), ['a', 'a.Plex', 'b', 'c'], 'Info is left alone');
  assert.deepEqual(added.rows[2].items, [{ kind: 'widget', id: 'd' }]);
  l.widgets[3] = w('d');
  assert.deepEqual(ids(applyOp(l, { op: 'add', widget: 'd' })), ['a', 'a.Plex', 'b', 'c', 'd'], 'a small one still fits');
});

test('an operation that does not apply returns null', () => {
  assert.equal(applyOp(layout(), { op: 'move', widget: 'd', index: 0 }), null); // not on the Dashboard
  assert.equal(applyOp(layout(), { op: 'remove', widget: 'd' }), null);
  assert.equal(applyOp(layout(), { op: 'add', widget: 'a' }), null); // already there
  assert.equal(applyOp(layout(), { op: 'add', widget: 'gone' }), null); // no such widget
  assert.equal(applyOp(layout(), { op: 'move', widget: 'a.Plex', index: 0 }), null, 'apps are not moved by the TV');
});

test('isLayoutOp accepts only the three operations on a widget id', () => {
  assert.ok(isLayoutOp({ op: 'move', widget: 'a', index: 0 }));
  assert.ok(isLayoutOp({ op: 'remove', widget: 'a' }));
  assert.ok(isLayoutOp({ op: 'add', widget: 'a' }));
  for (const bad of [null, 'move', {}, { op: 'move', widget: 'a' }, { op: 'move', widget: 'a', index: -1 }, { op: 'move', widget: 'a', index: 1.5 }, { op: 'move', widget: 'a', index: 50 }, { op: 'delete', widget: 'a' }, { op: 'add', widget: '' }, { op: 'add', widget: 'x'.repeat(65) }, { op: 'add', widget: 3 }])
    assert.equal(isLayoutOp(bad), false, JSON.stringify(bad));
});
