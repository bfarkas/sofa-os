import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { validateWidgetData, type Layout, type WidgetInstance, type WidgetsResponse } from '@sofa/shared';
import { duration, statusAdapter } from './adapters/status.ts';
import { createAllowance, fromDb } from './allowance.ts';
import { hashSecret } from './auth.ts';
import type { Config } from './config.ts';
import { openDb } from './db.ts';
import { startServer } from './server.ts';
import { createWidgets, Unavailable, type WidgetAdapter, type WidgetResult } from './widgets.ts';

const card = (value: string | null): WidgetResult => ({ card: { template: 'value', value, unit: '°C' } });

function adapter(type: string, read: WidgetAdapter['read'], extra: Partial<WidgetAdapter> = {}): WidgetAdapter {
  return { type, title: type, description: '', templates: ['value'], sizes: ['small', 'medium', 'large'], defaultSize: 'small', defaultFreshness: 'live', fields: [], read, ...extra };
}

const inst = (id: string, type: string, more: Partial<WidgetInstance> = {}): WidgetInstance => ({ id, type, size: 'small', config: {}, profiles: ['household'], freshness: 'live', ...more });
const layoutOf = (widgets: WidgetInstance[]): Layout => ({ schema: 1, apps: [], widgets, rows: [], background: { kind: 'color', color: '#f6f1e7' }, kidsMode: { apps: [], dailyMinutes: 40 } });

// Every way an adapter can fail, next to one that works.
const broken: WidgetAdapter[] = [
  adapter('good', () => card('21.5')),
  adapter('throws', () => {
    throw new Error('boom');
  }),
  adapter('rejects', async () => {
    throw new Unavailable('Home Assistant is not reachable');
  }),
  adapter('hangs', () => new Promise<WidgetResult>(() => {})),
  adapter('garbage', () => ({ card: { template: 'chart', value: 1 } }) as unknown as WidgetResult),
  adapter('needs', () => card('1'), { fields: [{ key: 'entity', label: 'Entity', kind: 'entity', domains: ['sensor'], required: true }] }),
];
const brokenLayout = layoutOf(['good', 'throws', 'rejects', 'hangs', 'garbage', 'needs', 'nosuch'].map((t) => inst(t, t)));

test('a failing adapter leaves every other widget working', async () => {
  const w = createWidgets({ adapters: broken, layout: () => brokenLayout, timeoutMs: 50 });
  await w.tick();
  const data = w.data('household');
  const by = Object.fromEntries(data.map((d) => [d.id, d]));
  assert.equal(by.good.status, 'ok');
  assert.deepEqual(by.good.card, { template: 'value', value: '21.5', unit: '°C' });
  assert.equal(by.good.failing, false);
  assert.ok(by.good.updatedAt);
  assert.deepEqual(
    ['throws', 'rejects', 'hangs', 'garbage', 'needs', 'nosuch'].map((id) => [id, by[id].status, by[id].message]),
    [
      ['throws', 'unavailable', 'Not available right now'], // the error itself stays in the Server log
      ['rejects', 'unavailable', 'Home Assistant is not reachable'],
      ['hangs', 'unavailable', 'Not available right now'],
      ['garbage', 'unavailable', 'Not available right now'],
      ['needs', 'unavailable', 'Check this widget in Companion'],
      ['nosuch', 'unavailable', 'This widget type is not available'],
    ],
  );
  for (const d of data) assert.deepEqual(validateWidgetData(d), [], d.id);
});

test('a failed read keeps the last good data, marked failing, and retries within a minute', async () => {
  let t = 1_000_000, fail = false, reads = 0;
  const w = createWidgets({
    adapters: [adapter('flaky', () => {
      reads++;
      if (fail) throw new Error('down');
      return card(String(reads));
    })],
    layout: () => layoutOf([inst('a', 'flaky', { freshness: 'hourly' })]),
    now: () => t,
  });
  await w.tick();
  const first = w.data('household')[0];
  fail = true;
  t += 600_000; // hourly reads every 10 minutes
  await w.tick();
  const second = w.data('household')[0];
  assert.equal(second.status, 'ok');
  assert.deepEqual(second.card, first.card);
  assert.equal(second.updatedAt, first.updatedAt);
  assert.equal(second.failing, true);
  assert.equal(second.staleAfterSeconds, 7200);
  t += 59_000;
  await w.tick();
  assert.equal(reads, 2, 'not yet');
  fail = false;
  t += 1000;
  await w.tick();
  assert.equal(reads, 3);
  assert.deepEqual(w.data('household')[0].card, { template: 'value', value: '3', unit: '°C' });
  assert.equal(w.data('household')[0].failing, false);
});

test('reads follow the freshness policy, and a config change starts over', async () => {
  let t = 0, reads = 0, layout = layoutOf([inst('a', 'n', { freshness: 'live' })]);
  const w = createWidgets({ adapters: [adapter('n', () => card(String(++reads)))], layout: () => layout, now: () => t });
  await w.tick();
  t += 29_000;
  await w.tick();
  assert.equal(reads, 1);
  t += 1000;
  await w.tick();
  assert.equal(reads, 2);
  layout = layoutOf([inst('a', 'n', { freshness: 'live', config: { x: 1 } })]);
  assert.deepEqual(w.data('household'), [], 'new config, not read yet: no data, so the TV shows it loading');
  await w.tick();
  assert.equal(reads, 3);
  layout = layoutOf([]);
  assert.deepEqual(w.data('household'), []);
});

test('an answer for a config that changed meanwhile is dropped', async () => {
  let release: (r: WidgetResult) => void = () => {};
  let layout = layoutOf([inst('a', 'slow', { config: { v: 1 } })]);
  const w = createWidgets({ adapters: [adapter('slow', (c) => (c.v === 1 ? new Promise((r) => (release = r)) : card('new')))], layout: () => layout });
  const pending = w.tick();
  layout = layoutOf([inst('a', 'slow', { config: { v: 2 } })]);
  await w.tick();
  release(card('old'));
  await pending;
  assert.deepEqual(w.data('household')[0].card, { template: 'value', value: 'new', unit: '°C' });
});

test('the kids profile sees only kids widgets, through the type filter, and nothing if the filter fails', async () => {
  const strip = adapter('cal', () => ({ card: { template: 'agenda', days: [{ title: 'Today', events: [{ time: '18:00', title: 'Dentist', detail: 'Main St 1' }] }] } }), {
    forKids: (r) => ('card' in r && r.card.template === 'agenda' ? { card: { template: 'agenda', days: r.card.days.map((d) => ({ title: d.title, events: d.events.map((e) => ({ time: e.time, title: e.title })) })) } } : r),
  });
  const bad = adapter('leaky', () => card('secret'), {
    forKids: () => {
      throw new Error('oops');
    },
  });
  const w = createWidgets({
    adapters: [strip, bad, adapter('plain', () => card('1'))],
    layout: () => layoutOf([inst('cal', 'cal', { profiles: ['household', 'kids'] }), inst('leaky', 'leaky', { profiles: ['household', 'kids'] }), inst('adults', 'plain')]),
  });
  await w.tick();
  assert.deepEqual(w.data('household').map((d) => d.id), ['cal', 'leaky', 'adults']);
  const kids = w.data('kids');
  assert.deepEqual(kids.map((d) => d.id), ['cal', 'leaky']);
  assert.deepEqual(kids[0].card, { template: 'agenda', days: [{ title: 'Today', events: [{ time: '18:00', title: 'Dentist' }] }] });
  assert.equal(kids[1].status, 'unavailable');
  assert.equal(JSON.stringify(kids).indexOf('secret'), -1);
});

test('empty results, titles, refreshType and the catalogue', async () => {
  let n = 0;
  const w = createWidgets({
    adapters: [adapter('e', () => ({ title: 'Calendar', empty: n++ ? 'Still nothing' : 'No events today' }), { fields: [{ key: 'title', label: 'Title', kind: 'text', maxLength: 10 }] })],
    layout: () => layoutOf([inst('a', 'e', { freshness: 'daily' })]),
  });
  await w.tick();
  assert.deepEqual(w.data('household').map((d) => [d.title, d.status, d.message]), [['Calendar', 'empty', 'No events today']]);
  await w.refreshType('e');
  assert.equal(w.data('household')[0].message, 'Still nothing');
  assert.deepEqual(w.types(), [{ type: 'e', title: 'e', description: '', templates: ['value'], sizes: ['small', 'medium', 'large'], defaultSize: 'small', defaultFreshness: 'live', fields: [{ key: 'title', label: 'Title', kind: 'text', maxLength: 10 }] }]);
});

test('the status adapter reads the Server and shows a dash without Home Assistant', async () => {
  const db = openDb(':memory:');
  const allowance = createAllowance({ ...fromDb(db), ha: null, timeZone: 'Europe/Berlin', resetMinutes: 240, graceSeconds: 0, topUpUrl: 'https://sofa.test/kids/topup' });
  const a = statusAdapter({ db, allowance: () => allowance.status(), homeAssistant: 'off', timeZone: 'Europe/Berlin', startedAt: 0 });
  const r = await a.read({ title: 'Home' }, { now: 3 * 3600_000 + 12 * 60_000, signal: new AbortController().signal });
  assert.ok('card' in r);
  assert.equal(r.title, 'Home');
  assert.deepEqual(r.card, { template: 'list', rows: [{ label: 'Server', value: 'Up 3 h 12 min' }, { label: 'Layout', value: 'Revision 1' }, { label: 'Kids Mode', value: 'Off' }] });
  assert.ok(r.detail?.template === 'list' && r.detail.rows.some((row) => row.label === 'TV' && row.value === null));
  assert.deepEqual([duration(59), duration(61), duration(90_000)], ['0 min', '1 min', '1 d 1 h']);
});

test('GET /api/widgets serves the working widgets next to a failing one, and the snapshot is unaffected', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sofa-widgets-'));
  writeFileSync(join(dir, 'index.html'), '<title>Companion</title>');
  const config: Config = {
    port: 0,
    dbPath: join(dir, 'test.db'),
    mediaDir: join(dir, 'media'),
    companionDir: dir,
    passwordHash: await hashSecret('correct horse'),
    secureCookies: false,
    ha: null,
    allowance: { timeZone: 'Europe/Berlin', resetMinutes: 240, graceSeconds: 0, topUpUrl: 'https://sofa.test/kids/topup' },
  };
  const db = openDb(config.dbPath);
  const layout = layoutOf([inst('good', 'good', { profiles: ['household', 'kids'] }), inst('throws', 'throws'), inst('mine', 'status', { size: 'medium' })]);
  db.prepare('INSERT INTO revisions (number, base, layout, created_at) VALUES (2, 1, ?, ?)').run(JSON.stringify(layout), Date.now());
  const allowance = createAllowance({ ...fromDb(db), ha: null, ...config.allowance });
  const server = startServer(config, db, allowance, [broken[0], broken[1], statusAdapter({ db, allowance: () => allowance.status(), homeAssistant: 'off', timeZone: 'Europe/Berlin' })]);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.equal((await fetch(base + '/api/widgets')).status, 401);
    const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'correct horse' }) });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    const get = (path: string) => fetch(base + path, { headers: { cookie } });
    await new Promise((r) => setTimeout(r, 100)); // the first tick runs at start
    const body = (await (await get('/api/widgets')).json()) as WidgetsResponse;
    assert.ok(Date.parse(body.serverTime) > 0);
    assert.deepEqual(body.widgets.map((w) => [w.id, w.status]), [['good', 'ok'], ['throws', 'unavailable'], ['mine', 'ok']]);
    assert.equal(body.widgets[2].title, 'Sofa.OS');
    const kids = (await (await get('/api/widgets?profile=kids')).json()) as WidgetsResponse;
    assert.deepEqual(kids.widgets.map((w) => w.id), ['good']);
    assert.equal((await get('/api/widgets?profile=guest')).status, 400);
    assert.equal((await get('/api/snapshot')).status, 200);
    const types = (await (await get('/api/widget-types')).json()) as { type: string }[];
    assert.deepEqual(types.map((t) => t.type), ['good', 'throws', 'status']);
    assert.equal((await fetch(base + '/api/widget-types')).status, 401);
  } finally {
    server.close();
  }
});
