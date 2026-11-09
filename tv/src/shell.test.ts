import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Layout } from '@sofa/shared';
import type { RemoteEvent, RemoteKey } from './keys.ts';
import { PAD_ROWS } from './kids.ts';
import { clockText, createShell, dateText, kidsSections, sectionsFor } from './shell.ts';

const app = (id: string, name: string) => ({ id, name });
const layout = (over: Partial<Layout> = {}): Layout => ({
  schema: 1,
  apps: [app('a.One', 'One'), app('a.Two', 'Two'), app('a.Three', 'Three')],
  widgets: [
    { id: 'w1', type: 'weather', size: 'medium', config: {}, profiles: ['household', 'kids'], freshness: 'hourly' },
    { id: 'w2', type: 'calendar', size: 'large', config: {}, profiles: ['household'], freshness: 'hourly' },
    { id: 'w3', type: 'cartoons', size: 'small', config: {}, profiles: ['kids'], freshness: 'daily' },
  ],
  rows: [
    { id: 'r1', title: 'My Apps', items: [{ kind: 'app', id: 'a.One' }, { kind: 'app', id: 'a.Two' }] },
    { id: 'r2', title: 'Today', items: [{ kind: 'widget', id: 'w1' }, { kind: 'widget', id: 'w3' }] },
  ],
  background: { kind: 'color', color: '#f6f1e7' },
  kidsMode: { apps: [], dailyMinutes: 60 },
  ...over,
});

function setup(l: Layout | null = layout()) {
  const focused: (string | null)[] = [];
  let views = 0;
  const shell = createShell({ onView: () => void views++, onFocus: (id) => void focused.push(id) });
  shell.setMode('home');
  shell.setLayout(l);
  const press = (...keys: RemoteKey[]) => keys.map((key) => shell.key({ key, long: false } as RemoteEvent));
  return { shell, focused, press, views: () => views };
}

test('the Dashboard shows the layout rows and ends the last app row with All Apps', () => {
  const s = sectionsFor(layout(), 'dashboard', new Set());
  assert.deepEqual(s.map((x) => x.title), ['', 'My Apps', 'Today']);
  assert.deepEqual(s[0].tiles.map((t) => t.id), ['kids']); // the Kids Mode tile leads
  assert.deepEqual(s[1].tiles.map((t) => t.id), ['app:a.One', 'app:a.Two', 'allapps']);
  assert.deepEqual(s[2].tiles.map((t) => t.id), ['widget:w1']); // w3 is for kids only: the profile filter
  assert.equal(s[2].tiles[0].detail, ''); // the card itself shows the widget (cards.ts)
});

test('without any app row the All Apps tile gets a row of its own', () => {
  const s = sectionsFor(layout({ rows: [] }), 'dashboard', new Set());
  assert.deepEqual(s.map((x) => x.tiles.map((t) => t.id)), [['kids'], ['allapps']]);
});

test('the Apps tab lists every app, seven to a row', () => {
  const many = Array.from({ length: 9 }, (_, i) => app('x.App' + i, 'App ' + i));
  const s = sectionsFor(layout({ apps: many }), 'apps', new Set(['x.App1']));
  assert.deepEqual(s.map((x) => x.tiles.length), [7, 2]);
  assert.equal(s[0].title, 'All Apps');
  assert.equal(s[0].tiles[1].detail, 'Unavailable');
  assert.equal(s[0].tiles[1].unavailable, true);
});

test('the Widgets tab packs six units to a row and says what is on the Dashboard', () => {
  const l = layout();
  l.widgets.push({ id: 'w4', type: 'energy', size: 'small', config: {}, profiles: ['household'], freshness: 'live' });
  l.widgets.push({ id: 'w5', type: 'photos', size: 'large', config: {}, profiles: ['household'], freshness: 'daily' });
  const s = sectionsFor(l, 'widgets', new Set());
  // household widgets: w1 medium (2), w2 large (3), w4 small (1), w5 large (3)
  assert.deepEqual(s.map((x) => x.tiles.map((t) => t.id)), [['widget:w1', 'widget:w2', 'widget:w4'], ['widget:w5']]);
  assert.equal(s[0].tiles[0].detail, 'On Dashboard');
  assert.equal(s[0].tiles[1].detail, 'Not on Dashboard');
});

test('rows that point at nothing are skipped', () => {
  const l = layout({ rows: [{ id: 'r', title: 'Gone', items: [{ kind: 'widget', id: 'w3' }] }] });
  assert.deepEqual(sectionsFor(l, 'dashboard', new Set()).map((x) => x.tiles.map((t) => t.id)), [['kids'], ['allapps']]);
});

test('arrows reach every tile: bar, rows, and back to the bar', () => {
  const { shell, press } = setup();
  const visited = [shell.focus.current()];
  const go = (...k: RemoteKey[]) => (press(...k), visited.push(shell.focus.current()));
  assert.equal(visited[0], 'tab:dashboard');
  go('right'); // focusing a tab shows it
  assert.equal(shell.view().tab, 'apps');
  go('left');
  assert.equal(shell.view().tab, 'dashboard');
  go('down');
  go('down');
  go('right');
  go('right');
  go('down');
  go('up');
  go('up');
  go('up');
  assert.deepEqual(visited.slice(3), ['kids', 'app:a.One', 'app:a.Two', 'allapps', 'widget:w1', 'allapps', 'kids', 'tab:dashboard']);
});

test('tab switching: focusing Apps and Widgets swaps the content, Settings keeps the tab', () => {
  const { shell, press } = setup();
  press('right');
  assert.deepEqual(shell.view().sections[0].tiles.map((t) => t.id), ['app:a.One', 'app:a.Two', 'app:a.Three']);
  press('right');
  assert.equal(shell.view().tab, 'widgets');
  assert.deepEqual(shell.view().sections[0].tiles.map((t) => t.id), ['widget:w1', 'widget:w2']);
  press('right');
  assert.equal(shell.focus.current(), 'settings');
  assert.equal(shell.view().tab, 'widgets');
  press('down'); // into the first tile of the tab
  assert.equal(shell.focus.current(), 'widget:w1');
});

test('OK on a tab goes into it, OK on All Apps opens the Apps tab, OK on an app launches it', () => {
  const { shell, press } = setup();
  assert.deepEqual(press('ok')[0], null);
  assert.equal(shell.focus.current(), 'kids');
  press('down');
  assert.deepEqual(press('ok')[0], { type: 'launch', appId: 'a.One' });
  press('right', 'right', 'ok');
  assert.equal(shell.view().tab, 'apps');
  assert.equal(shell.focus.current(), 'app:a.One');
  assert.deepEqual(press('ok')[0], { type: 'launch', appId: 'a.One' });
});

test('a widget is focusable and OK asks for its full-screen view', () => {
  const { shell, press } = setup();
  press('down', 'down', 'down');
  assert.equal(shell.focus.current(), 'widget:w1');
  assert.deepEqual(press('ok')[0], { type: 'widget', id: 'w1', title: 'Weather' });
});

test('Back: from a tile to the bar, from Apps or Widgets to Dashboard, then nothing', () => {
  const { shell, press } = setup();
  press('right', 'down', 'right'); // Apps tab, on the second app
  press('back');
  assert.equal(shell.focus.current(), 'tab:apps');
  press('back');
  assert.equal(shell.focus.current(), 'tab:dashboard');
  assert.equal(shell.view().tab, 'dashboard');
  press('back');
  assert.equal(shell.focus.current(), 'tab:dashboard');
});

test('Back closes an overlay first and focus returns to the tile that opened it', () => {
  const { shell, press } = setup();
  press('down', 'down', 'right'); // app:a.Two
  shell.focus.push([['set:server'], ['set:again'], ['set:close']], { wrap: true });
  press('down');
  assert.equal(shell.focus.current(), 'set:again');
  assert.deepEqual(press('ok')[0], { type: 'select', id: 'set:again' });
  press('back');
  assert.equal(shell.focus.current(), 'app:a.Two');
  assert.equal(shell.where()!.id, 'app:a.Two');
});

test('Settings is reachable from the bar and OK on it asks for the Settings overlay', () => {
  const { shell, press } = setup();
  press('right', 'right', 'right');
  assert.deepEqual(press('ok')[0], { type: 'settings' });
});

test('focus survives a launch and return: restore puts it on the tile, in its tab', () => {
  const { shell, press } = setup();
  press('right', 'down', 'right'); // Apps tab, app:a.Two
  const saved = shell.where()!;
  assert.deepEqual(saved, { tab: 'apps', id: 'app:a.Two' });
  // The page comes back with a fresh shell, as after a cold start, and the layout loads from storage.
  const fresh = setup();
  assert.equal(fresh.shell.focus.current(), 'tab:dashboard');
  fresh.shell.restore(saved);
  assert.equal(fresh.shell.view().tab, 'apps');
  assert.equal(fresh.shell.focus.current(), 'app:a.Two');
  fresh.shell.restore({ tab: 'apps', id: 'app:gone' }); // a tile that no longer exists leaves focus where it is
  assert.equal(fresh.shell.focus.current(), 'tab:apps');
});

test('an app that failed to launch is marked unavailable, and unmarked when it launches', () => {
  const { shell } = setup();
  shell.setUnavailable('a.One', true);
  assert.equal(shell.view().sections[1].tiles[0].detail, 'Unavailable');
  shell.setUnavailable('a.One', false);
  assert.equal(shell.view().sections[1].tiles[0].detail, '');
});

test('with no layout yet the bar still works and the view says so; empty tabs say what to do', () => {
  const { shell, press } = setup(null);
  assert.match(shell.view().message, /Waiting for the first layout/);
  assert.equal(shell.focus.current(), 'tab:dashboard');
  press('right', 'down');
  assert.equal(shell.focus.current(), 'tab:apps');
  shell.setLayout(layout({ apps: [], rows: [], widgets: [] }));
  assert.match(shell.view().message, /No apps yet/);
  assert.equal(press('down')[0], null);
  assert.equal(shell.focus.current(), 'tab:apps');
});

test('the sign-in screen has one focusable thing, Settings', () => {
  const shell = createShell({ onView() {}, onFocus() {} });
  assert.equal(shell.focus.current(), 'settings');
  assert.deepEqual(shell.key({ key: 'ok', long: false }), { type: 'settings' });
  assert.equal(shell.view().mode, 'signin');
});

test('clock', () => {
  const d = new Date(2026, 10, 5, 7, 4);
  assert.equal(clockText(d), '07:04');
  assert.equal(dateText(d), 'Thu 5 Nov');
});

const kidsLayout = () => layout({ kidsMode: { apps: ['a.Three', 'a.One', 'gone.App'], dailyMinutes: 40 } });

test('the Kids Mode tile: OK enters, and while the Server is unreachable it is unavailable and says so', () => {
  const { shell, press } = setup();
  press('down');
  assert.deepEqual(press('ok')[0], { type: 'kids-enter' });
  shell.setKidsTile(false);
  const tile = shell.view().sections[0].tiles[0];
  assert.deepEqual([tile.unavailable, tile.detail], [true, 'Not available right now']);
  assert.deepEqual(press('ok')[0], { type: 'kids-unavailable' });
  shell.setKidsTile(true);
  assert.equal(shell.view().sections[0].tiles[0].unavailable, false);
});

test('Kids Mode shows only the approved apps in the approved order, five to a row', () => {
  const many = Array.from({ length: 7 }, (_, i) => app('k.App' + i, 'K' + i));
  assert.deepEqual(kidsSections(kidsLayout()).map((x) => x.tiles.map((t) => t.id)), [['app:a.Three', 'app:a.One']], 'a missing app is dropped');
  const rows = kidsSections(layout({ apps: many, kidsMode: { apps: many.map((a) => a.id), dailyMinutes: 40 } }));
  assert.deepEqual(rows.map((x) => x.tiles.length), [5, 2]);
});

test('in Kids Mode focus starts on the first approved app, Back leaves nothing, OK launches, the Adults button asks for the PIN', () => {
  const { shell, press } = setup(kidsLayout());
  shell.setScreen('kids');
  const view = shell.view();
  assert.equal(view.mode, 'kids');
  assert.deepEqual(view.sections[0].tiles.map((t) => t.id), ['app:a.Three', 'app:a.One']);
  assert.equal(shell.focus.current(), 'app:a.Three');
  press('back', 'back');
  assert.equal(shell.view().mode, 'kids');
  assert.equal(shell.focus.current(), 'app:a.Three', 'Back does not move anywhere, let alone out');
  assert.deepEqual(press('ok')[0], { type: 'launch', appId: 'a.Three' });
  press('up');
  assert.equal(shell.focus.current(), 'kids:exit');
  assert.deepEqual(press('ok')[0], { type: 'pin' });
  press('left', 'right', 'down'); // nothing leads to a Settings or tab bar
  assert.equal(shell.focus.current(), 'app:a.Three');
});

test('the Done Screen has one focusable thing, Adults, and Back stays on it', () => {
  const { shell, press } = setup(kidsLayout());
  shell.setScreen('done');
  assert.equal(shell.view().mode, 'done');
  assert.equal(shell.focus.current(), 'done:adults');
  press('back');
  assert.equal(shell.view().mode, 'done');
  assert.deepEqual(press('ok')[0], { type: 'pin' });
  shell.setScreen('household');
  assert.equal(shell.view().mode, 'home');
  assert.equal(shell.focus.current(), 'tab:dashboard');
});

test('number keys reach the PIN pad only while an overlay is open, and Back closes it without leaving Kids Mode', () => {
  const { shell } = setup(kidsLayout());
  const digit = (d: string) => shell.key({ key: 'digit', digit: d, long: false } as RemoteEvent);
  shell.setScreen('kids');
  assert.equal(digit('5'), null);
  shell.focus.push(PAD_ROWS);
  assert.deepEqual(digit('5'), { type: 'digit', digit: '5' });
  assert.deepEqual(shell.key({ key: 'ok', long: false }), { type: 'select', id: 'pin:1' });
  shell.key({ key: 'back', long: false });
  assert.equal(shell.view().mode, 'kids');
  assert.equal(shell.focus.current(), 'app:a.Three');
});

test('Kids Mode ignores the household tab and has no Settings', () => {
  const { shell } = setup(kidsLayout());
  shell.setScreen('kids');
  assert.equal(shell.view().message, '');
  shell.setLayout(layout({ kidsMode: { apps: [], dailyMinutes: 40 } }));
  assert.match(shell.view().message, /No apps are approved/);
  assert.equal(shell.focus.current(), 'kids:exit');
});

const A1 = '11111111-1111-4111-8111-111111111111';
const A2 = '22222222-2222-4222-8222-222222222222';

test('Kids Mode adds an album tile only for an album the layout approves, and OK opens its slideshow', () => {
  const { shell, press } = setup(layout({ kidsMode: { apps: ['a.One'], dailyMinutes: 40, albums: [A1] } }));
  shell.setScreen('kids');
  shell.setAlbums([{ id: A1, name: 'Ponies', count: 12 }, { id: A2, name: 'Not approved', count: 3 }]); // the Server would not send A2; the TV checks anyway
  const tiles = shell.view().sections[0].tiles;
  assert.deepEqual(tiles.map((t) => [t.id, t.kind, t.label, t.detail]), [['app:a.One', 'app', 'One', ''], ['album:' + A1, 'album', 'Ponies', '12 photos']]);
  press('right');
  assert.equal(shell.focus.current(), 'album:' + A1);
  assert.deepEqual(press('ok')[0], { type: 'album', id: A1, name: 'Ponies' });
  shell.setAlbums([{ id: A1, name: 'Ponies', count: 1 }]);
  assert.equal(shell.view().sections[0].tiles[1].detail, '1 photo');
  shell.setAlbums([]);
  assert.deepEqual(shell.view().sections[0].tiles.map((t) => t.id), ['app:a.One']);
});

// Session 16: arranging widgets with a long press.
const long = (shell: ReturnType<typeof setup>['shell']) => shell.key({ key: 'ok', long: true });
const arranged = () => layout({
  widgets: layout().widgets.concat({ id: 'w4', type: 'energy', size: 'small', config: {}, profiles: ['household'], freshness: 'live' }),
  rows: [layout().rows[0], { id: 'r2', title: 'Today', items: [{ kind: 'widget', id: 'w1' }, { kind: 'widget', id: 'w3' }, { kind: 'widget', id: 'w2' }] }], // w3 is kids-only: hidden here
});
const today = (shell: ReturnType<typeof setup>['shell']) => shell.view().sections.filter((s) => s.title === 'Today')[0].tiles;

test('a long press on a Dashboard widget opens Move and Remove; on an app it is a select, as a short press on a widget is', () => {
  const { shell } = setup(arranged());
  assert.ok(shell.focus.focus('widget:w1'));
  assert.deepEqual(long(shell), { type: 'menu', widget: 'w1', title: 'Weather', items: ['move', 'remove'] });
  assert.deepEqual(shell.key({ key: 'ok', long: false }), { type: 'widget', id: 'w1', title: 'Weather' });
  assert.ok(shell.focus.focus('app:a.One'));
  assert.deepEqual(long(shell), { type: 'launch', appId: 'a.One' });
});

test('in the Widgets tab a long press offers Add to Dashboard only for a widget not there', () => {
  const { shell, press } = setup(arranged());
  press('right', 'right', 'down'); // the Widgets tab
  assert.ok(shell.focus.focus('widget:w4'));
  assert.deepEqual(long(shell), { type: 'menu', widget: 'w4', title: 'Energy', items: ['add'] });
  assert.ok(shell.focus.focus('widget:w1'));
  assert.deepEqual(long(shell), { type: 'widget', id: 'w1', title: 'Weather' }, 'already on the Dashboard: the full view');
});

test('Move lifts the widget: right passes hidden tiles, OK places it as a move operation', () => {
  const { shell, press } = setup(arranged());
  assert.ok(shell.lift('w1'));
  assert.ok(shell.lifting());
  assert.deepEqual(today(shell).map((t) => [t.id, !!t.lifted]), [['widget:w1', true], ['widget:w2', false]]);
  assert.deepEqual(press('right'), [null]);
  assert.deepEqual(today(shell).map((t) => t.id), ['widget:w2', 'widget:w1']);
  assert.equal(shell.focus.current(), 'widget:w1', 'focus moves with it');
  press('right', 'up', 'down'); // the end of the row; up and down do nothing while lifted
  assert.equal(shell.focus.current(), 'widget:w1');
  assert.deepEqual(press('ok'), [{ type: 'op', op: { op: 'move', widget: 'w1', index: 2 } }]); // after w3 and w2 in the row
  assert.equal(shell.lifting(), false);
  assert.deepEqual(today(shell).map((t) => [t.id, !!t.lifted]), [['widget:w2', false], ['widget:w1', false]]);
});

test('Back cancels a move, and OK where it started sends nothing', () => {
  const { shell, press } = setup(arranged());
  shell.lift('w2');
  press('left', 'back');
  assert.equal(shell.lifting(), false);
  assert.deepEqual(today(shell).map((t) => t.id), ['widget:w1', 'widget:w2']);
  assert.equal(shell.focus.current(), 'widget:w2');
  shell.lift('w2');
  assert.deepEqual(press('left', 'right', 'ok'), [null, null, null]);
});

test('no menus in Kids Mode, and a screen change drops a lifted widget', () => {
  const { shell } = setup(arranged());
  shell.lift('w1');
  shell.setScreen('kids');
  assert.equal(shell.lifting(), false);
  assert.deepEqual(long(shell), shell.key({ key: 'ok', long: false }), 'a long press is just OK');
  assert.equal(shell.lift('w1'), false);
});
