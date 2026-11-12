import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkWidgets, validateLayout, type Layout, type WidgetType, type WidgetsResponse } from '@sofa/shared';
import { addApp, addRow, addWidget, moveApp, moveItem, moveRow, moveWidget, newId, placeInRow, previewWidgets, removeApp, removeFromRows, removeRow, removeWidget, renameRow, rowOf, rowTooWide, setBackgroundColor, setBackgroundDayCycle, setBackgroundStream, setConfig, setScheme, showOnDashboard, updateWidget } from './edit.ts';

const type: WidgetType = {
  type: 'home', title: 'Home', description: '', templates: ['list'], sizes: ['small', 'medium'], defaultSize: 'medium', defaultFreshness: 'live',
  fields: [{ key: 'title', label: 'Title', kind: 'text', maxLength: 10, default: 'Home' }, { key: 'entities', label: 'Entities', kind: 'entities', domains: ['sensor'], max: 2, required: true }],
};
const base = (): Layout => ({
  schema: 1,
  apps: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }],
  widgets: [{ id: 'w1', type: 'home', size: 'medium', config: { title: 'Home', entities: ['sensor.x'] }, profiles: ['household'], freshness: 'live' }],
  rows: [{ id: 'row-1', title: 'First', items: [{ kind: 'app', id: 'a' }, { kind: 'widget', id: 'w1' }] }, { id: 'row-2', title: '', items: [{ kind: 'app', id: 'b' }] }],
  background: { kind: 'color', color: '#f6f1e7' },
  kidsMode: { apps: ['a', 'b'], dailyMinutes: 40 },
});
const ids = (l: Layout, row: number) => l.rows[row].items.map((i) => i.id);

test('every operation keeps the layout valid', () => {
  assert.deepEqual(validateLayout(base()), []);
  const steps: ((l: Layout) => Layout)[] = [
    (l) => addRow(l, 'New'), (l) => moveRow(l, 'row-2', -1), (l) => renameRow(l, 'row-1', 'Renamed'), (l) => placeInRow(l, { kind: 'app', id: 'c' }, 'row-2'),
    (l) => moveItem(l, { kind: 'app', id: 'c' }, -1), (l) => addApp(l, { id: 'd', name: 'D' }), (l) => moveApp(l, 'd', -2), (l) => addWidget(l, type), (l) => updateWidget(l, 'home', { size: 'small' }),
    (l) => setConfig(l, 'home', 'entities', ['sensor.y']), (l) => showOnDashboard(l, { kind: 'widget', id: 'home' }, true), (l) => removeApp(l, 'a'), (l) => removeWidget(l, 'w1'), (l) => removeRow(l, 'row-1'), (l) => setBackgroundColor(l, '#112233'),
  ];
  let l = base();
  for (const step of steps) {
    l = step(l);
    assert.deepEqual(validateLayout(l), []);
  }
});

test('rows: add, rename, reorder and remove', () => {
  let l = addRow(addRow(base()), 'Third');
  assert.deepEqual(l.rows.map((r) => r.id), ['row-1', 'row-2', 'row-3', 'row-4']);
  l = moveRow(l, 'row-4', -1);
  assert.deepEqual(l.rows.map((r) => r.id), ['row-1', 'row-2', 'row-4', 'row-3']);
  assert.deepEqual(moveRow(l, 'row-1', -1), l, 'the first row cannot move up');
  assert.equal(removeRow(renameRow(l, 'row-4', 'X'), 'row-4').rows.length, 3);
});

test('a tile is on the Dashboard at most once: placing it moves it', () => {
  let l = placeInRow(base(), { kind: 'app', id: 'a' }, 'row-2');
  assert.deepEqual([ids(l, 0), ids(l, 1)], [['w1'], ['b', 'a']]);
  assert.equal(rowOf(l, { kind: 'app', id: 'a' }), 'row-2');
  l = moveItem(l, { kind: 'app', id: 'a' }, -1);
  assert.deepEqual(ids(l, 1), ['a', 'b']);
  assert.deepEqual(moveItem(l, { kind: 'app', id: 'a' }, -1), l);
  assert.equal(rowOf(removeFromRows(l, { kind: 'app', id: 'a' }), { kind: 'app', id: 'a' }), null);
});

test('showing a tile joins a row of its kind, or makes one', () => {
  let l = showOnDashboard(base(), { kind: 'app', id: 'c' }, true);
  assert.deepEqual(ids(l, 0), ['a', 'w1', 'c']);
  assert.equal(showOnDashboard(l, { kind: 'app', id: 'c' }, true), l);
  l = showOnDashboard({ ...base(), rows: [] }, { kind: 'widget', id: 'w1' }, true);
  assert.deepEqual(l.rows, [{ id: 'row-1', title: 'Widgets', items: [{ kind: 'widget', id: 'w1' }] }]);
  assert.equal(rowOf(showOnDashboard(l, { kind: 'widget', id: 'w1' }, false), { kind: 'widget', id: 'w1' }), null);
});

test('apps: add (no duplicates), reorder, and remove everywhere', () => {
  let l = addApp(base(), { id: ' d ', name: ' D ' });
  assert.deepEqual(l.apps.map((a) => [a.id, a.name]).pop(), ['d', 'D']);
  assert.equal(addApp(l, { id: 'd', name: 'Again' }), l);
  assert.equal(addApp(l, { id: '', name: 'No id' }), l);
  l = moveApp(l, 'd', -1);
  assert.deepEqual(l.apps.map((a) => a.id), ['a', 'b', 'd', 'c']);
  l = removeApp(l, 'a');
  assert.deepEqual(l.apps.map((a) => a.id), ['b', 'd', 'c']);
  assert.deepEqual(ids(l, 0), ['w1']);
  assert.deepEqual(l.kidsMode.apps, ['b']);
});

test('widgets: a new instance has defaults and unique ids, config edits clear and set, removal clears the Dashboard', () => {
  let l = addWidget(addWidget(base(), type), type);
  assert.deepEqual(l.widgets.map((w) => w.id), ['w1', 'home', 'home-2']);
  assert.deepEqual(l.widgets[1], { id: 'home', type: 'home', size: 'medium', config: { title: 'Home' }, profiles: ['household'], freshness: 'live' });
  assert.deepEqual(checkWidgets(l, [type]), ['widgets[1] (home): entities: is required', 'widgets[2] (home-2): entities: is required']);
  l = setConfig(l, 'home', 'entities', ['sensor.a']);
  l = setConfig(l, 'home', 'title', undefined);
  assert.deepEqual(l.widgets[1].config, { entities: ['sensor.a'] });
  assert.deepEqual(checkWidgets(updateWidget(l, 'home', { size: 'large' }), [type]), ['widgets[1] (home): size: Home comes in small, medium, not large', 'widgets[2] (home-2): entities: is required']);
  assert.deepEqual(moveWidget(l, 'home', -1).widgets.map((w) => w.id), ['home', 'w1', 'home-2']);
  assert.deepEqual(removeWidget(l, 'w1').rows[0].items, [{ kind: 'app', id: 'a' }]);
  assert.equal(newId(['x', 'x-2'], 'x'), 'x-3');
});

test('the preview shows live data for an unchanged widget and honest placeholders for the rest', () => {
  const published = base();
  const live: WidgetsResponse = { serverTime: '2026-11-09T10:00:00.000Z', widgets: [{ id: 'w1', title: 'Home', status: 'ok', card: { template: 'list', rows: [] }, updatedAt: '2026-11-09T10:00:00.000Z', failing: false, staleAfterSeconds: 180 }] };
  let l = published;
  assert.equal(previewWidgets(l, published, [type], live).widgets[0], live.widgets[0]);
  l = setConfig(l, 'w1', 'title', 'Other');
  assert.deepEqual(previewWidgets(l, published, [type], live).widgets.map((w) => [w.status, w.message]), [['empty', 'Shows data once published']]);
  l = setConfig(l, 'w1', 'entities', undefined);
  assert.deepEqual(previewWidgets(l, published, [type], live).widgets.map((w) => [w.status, w.message]), [['unavailable', 'Check this widget in Companion']]);
  assert.deepEqual(previewWidgets(published, published, [], null).widgets.map((w) => [w.status, w.message]), [['unavailable', 'This widget type is not available']]);
  const kidsOnly = { ...published, widgets: [{ ...published.widgets[0], profiles: ['kids' as const] }] };
  assert.deepEqual(previewWidgets(kidsOnly, published, [type], live).widgets, []);
});

test('the photostream background is a slideshow of the stream; a colour replaces it', () => {
  const l = setBackgroundStream(base());
  assert.deepEqual(l.background, { kind: 'slideshow', album: 'photostream' });
  assert.deepEqual(setBackgroundColor(l, '#112233').background, { kind: 'color', color: '#112233' });
});

test('the day cycle background replaces a colour, and validates', () => {
  const l = setBackgroundDayCycle(setBackgroundColor(base(), '#112233'));
  assert.deepEqual(l.background, { kind: 'daycycle' });
  assert.deepEqual(validateLayout(l), []);
});

test('a row is too wide when its widgets pass five units (small 1, medium 2, large 3); apps do not count', () => {
  let l = placeInRow(addWidget(base(), { ...type, defaultSize: 'large' }), { kind: 'widget', id: 'home' }, 'row-1');
  assert.equal(rowTooWide(l, 'row-1'), false); // medium 2 + large 3 = 5
  l = updateWidget(l, 'w1', { size: 'large' });
  assert.equal(rowTooWide(l, 'row-1'), true); // 6
  assert.equal(rowTooWide(l, 'row-2'), false);
  assert.equal(rowTooWide(l, 'missing'), false);
});

test('setScheme changes only the scheme, and the result validates', () => {
  const l = base();
  const p = setScheme(l, 'plum');
  assert.deepEqual({ ...p, scheme: undefined }, { ...l, scheme: undefined });
  assert.equal(p.scheme, 'plum');
  assert.deepEqual(validateLayout(p), []);
  assert.equal(l.scheme, undefined); // the layout it was given is untouched
});
