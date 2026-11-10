import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { validateDisplay, type Layout, type WidgetInstance } from '@sofa/shared';
import { WebSocketServer } from 'ws';
import type { HaConfig } from '../config.ts';
import { createHaClient, subscribeEvents } from '../ha.ts';
import { createWidgets } from '../widgets.ts';
import { createForecastReader, energyAdapter, entitiesAdapter, forecastColumns, formatState, homeAssistantAdapters, watchHomeAssistant, weatherAdapter, type ForecastItem } from './homeassistant.ts';

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/ha-states.json', import.meta.url), 'utf8')) as Record<string, { state: string }>;

// A fake Home Assistant: REST states, the WebSocket event stream, and a switch that takes it off the network.
function fakeHa() {
  const states: Record<string, unknown> = { ...fixtures };
  const sockets = new Set<import('ws').WebSocket>();
  let server: Server;
  let port = 0;
  const up = async () => {
    server = createServer((req, res) => {
      const id = /^\/api\/states\/(.+)$/.exec(req.url ?? '')?.[1] ?? '';
      if (req.headers.authorization !== 'Bearer t') return void res.writeHead(401).end();
      const s = states[id];
      res.writeHead(s ? 200 : 404, { 'Content-Type': 'application/json' }).end(JSON.stringify(s ?? { message: 'Entity not found.' }));
    });
    const wss = new WebSocketServer({ server, path: '/api/websocket' });
    wss.on('connection', (ws) => {
      sockets.add(ws);
      ws.on('close', () => sockets.delete(ws));
      ws.send(JSON.stringify({ type: 'auth_required' }));
      ws.on('message', (raw) => {
        const m = JSON.parse(String(raw));
        if (m.type === 'auth') ws.send(JSON.stringify({ type: 'auth_ok' }));
        if (m.type === 'subscribe_events') ws.send(JSON.stringify({ id: m.id, type: 'result', success: true }));
      });
    });
    await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  };
  const down = async () => {
    for (const ws of sockets) ws.terminate();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  };
  const config = (): HaConfig => ({ url: `http://127.0.0.1:${port}`, token: 't', tvEntity: 'media_player.tv', remoteEntity: 'remote.tv', notifyServices: [] });
  const emit = (entity_id: string) => {
    for (const ws of sockets) ws.send(JSON.stringify({ id: 1, type: 'event', event: { event_type: 'state_changed', data: { entity_id } } }));
  };
  return { states, up, down, config, emit, sockets };
}

const ctx = () => ({ now: Date.now(), signal: new AbortController().signal });
const reader = (f: ReturnType<typeof fakeHa>) => createHaClient(f.config());

test('formatState: digits to read, missing as null, words capitalised', () => {
  assert.equal(formatState('23212.387'), '23212');
  assert.equal(formatState('24.508659'), '24.5');
  assert.equal(formatState('1.668'), '1.67');
  assert.equal(formatState('0.0'), '0');
  assert.equal(formatState('unavailable'), null);
  assert.equal(formatState('unknown'), null);
  assert.equal(formatState('on'), 'On');
  assert.equal(formatState('partly_open'), 'Partly open');
});

test('weather: real weather entity becomes temperature and conditions; missing attributes are dashes', async () => {
  const f = fakeHa();
  await f.up();
  try {
    const r = await weatherAdapter(reader(f)).read({ title: 'Weather', entity: 'weather.home' }, ctx());
    assert.deepEqual('card' in r && r.card, { template: 'value', value: '5.8', unit: '°C', note: 'Cloudy' });
    const detail = 'detail' in r && r.detail?.template === 'list' ? r.detail.rows : [];
    assert.deepEqual(detail.find((x) => x.label === 'Humidity')?.value, null); // weather.home has no humidity
    assert.deepEqual(detail.find((x) => x.label === 'Wind'), { label: 'Wind', value: '6.3', unit: 'km/h' });
    const t = await weatherAdapter(reader(f)).read({ title: 'Weather', entity: 'weather.tomorrow_io_home_daily' }, ctx());
    assert.equal('card' in t && t.card.template === 'value' && t.card.note, 'Sunny, 93 % humidity');
    // Home Assistant reports the entity unavailable: a dash, not 0.
    f.states['weather.home'] = { entity_id: 'weather.home', state: 'unavailable', attributes: {} };
    const u = await weatherAdapter(reader(f)).read({ title: 'Weather', entity: 'weather.home' }, ctx());
    assert.deepEqual('card' in u && u.card, { template: 'value', value: null, unit: undefined, note: 'No conditions' });
  } finally {
    await f.down();
  }
});

const forecasts = JSON.parse(readFileSync(new URL('./fixtures/weather-forecasts.json', import.meta.url), 'utf8')) as { hourly: ForecastItem[]; daily: ForecastItem[] };
const NIGHT = Date.parse('2026-11-10T22:40:00Z'); // 23:40 in Berlin on Tuesday the 10th

test('forecast columns: local hours with bars, day names, high and low, rain as mm when there is no probability', () => {
  const f = forecastColumns(forecasts.hourly, forecasts.daily, NIGHT, 'Europe/Berlin');
  assert.equal(f.hourCols.length, 12);
  assert.deepEqual(f.hourCols[0], { label: '00:00', value: '1', unit: '°', level: 0.15, tint: 0 });
  assert.equal(f.hourCols[11].level, 1); // the warmest of the twelve
  assert.deepEqual(f.dayCols[0], { label: 'Today', value: '5', unit: '° / 1°', note: 'Fog', tint: 0 });
  assert.equal(f.dayCols[1].label, 'Wed');
  assert.deepEqual(f.dayCols[3], { label: 'Fri', value: '8', unit: '° / 2°', note: 'Partly cloudy', badge: '0.1 mm', tint: 0.01 });
  assert.deepEqual(f.dayCols[6], { label: 'Mon', value: '13', unit: '° / 7°', note: 'Rain', badge: '1.4 mm', tint: 0.14 });
  assert.equal(f.today?.temperature, 5.4);
});

test('forecast columns: a rain probability wins over the amount, and hours already over are dropped', () => {
  const hours: ForecastItem[] = [
    { datetime: '2026-11-10T21:00:00+00:00', temperature: 9 }, // ended before now
    { datetime: '2026-11-10T22:00:00+00:00', temperature: 4, precipitation_probability: 70, precipitation: 0 }, // the current hour
    { datetime: '2026-11-10T23:00:00+00:00', temperature: -0.4, precipitation_probability: 0 },
  ];
  const f = forecastColumns(hours, [], NIGHT, 'Europe/Berlin');
  assert.deepEqual(f.hourCols.map((c) => [c.label, c.value, c.badge, c.tint]), [['23:00', '4', '70 %', 0.7], ['00:00', '0', undefined, 0]]);
  assert.deepEqual(forecastColumns([], [], NIGHT, 'Europe/Berlin').hourCols, []);
});

test('weather with a forecast: the card gains the high and low and the detail is hours over days', async () => {
  const f = fakeHa();
  await f.up();
  try {
    const read = async (forecast: (e: string, t: 'hourly' | 'daily') => Promise<ForecastItem[]>) =>
      weatherAdapter(reader(f), { forecast, timeZone: 'Europe/Berlin' }).read({ title: 'Weather', entity: 'weather.home' }, { now: NIGHT, signal: new AbortController().signal });
    const r = await read(async (_e, t) => forecasts[t]);
    assert.ok('card' in r && r.card.template === 'value' && r.card.note === 'Cloudy, H 5° L 1°', JSON.stringify('card' in r && r.card));
    const detail = 'detail' in r ? r.detail : undefined;
    assert.ok(detail?.template === 'stack');
    assert.deepEqual(detail.parts.map((p) => p.title), ['Next 12 hours', 'Next 7 days']);
    assert.deepEqual(validateDisplay(detail, 'detail'), []);
    // Only the hourly forecast fails: the days stay.
    const d = await read(async (_e, t) => (t === 'hourly' ? Promise.reject(new Error('boom')) : forecasts.daily));
    assert.ok('detail' in d && d.detail?.template === 'stack' && d.detail.parts.length === 1 && d.detail.parts[0].title === 'Next 7 days');
    // Neither works: today's readings, as before, and the card as before.
    const n = await read(async () => Promise.reject(new Error('boom')));
    assert.ok('detail' in n && n.detail?.template === 'list');
    assert.ok('card' in n && n.card.template === 'value' && n.card.note === 'Cloudy');
  } finally {
    await f.down();
  }
});

test('the forecast reader asks weather.get_forecasts for a response and unwraps it; only weather entities', async () => {
  const calls: { url: string; body: Record<string, string> }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ service_response: { 'weather.home': { forecast: forecasts.daily } } }));
  }) as unknown as typeof fetch;
  const read = createForecastReader({ url: 'http://ha.test:8123', token: 't', tvEntity: '', remoteEntity: '', notifyServices: [] }, fetchFn);
  const got = await read('weather.home', 'daily', new AbortController().signal);
  assert.equal(got.length, 7);
  assert.equal(calls[0].url, 'http://ha.test:8123/api/services/weather/get_forecasts?return_response');
  assert.deepEqual(calls[0].body, { entity_id: 'weather.home', type: 'daily' });
  await assert.rejects(() => read('light.kitchen', 'daily', new AbortController().signal), /not a weather entity/);
});

test('energy: names its unit and period; no unit means no number', async () => {
  const f = fakeHa();
  await f.up();
  try {
    const a = energyAdapter(reader(f));
    const now = await a.read({ title: 'Grid', entity: 'sensor.powerfox_aktuell', period: 'now' }, ctx());
    assert.deepEqual('card' in now && now.card, { template: 'value', value: '98', unit: 'W', note: 'Right now' });
    const today = await a.read({ title: 'Solar', entity: 'sensor.energy_production_today', period: 'today' }, ctx());
    assert.deepEqual('card' in today && today.card, { template: 'value', value: '1.67', unit: 'kWh', note: 'Today' });
    f.states['sensor.bezug_powerfox'] = { entity_id: 'sensor.bezug_powerfox', state: '23212.387', attributes: {} };
    const bare = await a.read({ title: 'Grid', entity: 'sensor.bezug_powerfox', period: 'total' }, ctx());
    assert.deepEqual('card' in bare && bare.card, { template: 'value', value: null, note: 'Total since the meter started (no unit in Home Assistant)' });
  } finally {
    await f.down();
  }
});

test('entity card: rows in order, missing entity and unavailable state are dashes', async () => {
  const f = fakeHa();
  await f.up();
  try {
    f.states['sensor.average_indoor_temperature'] = { entity_id: 'x', state: 'unavailable', attributes: { friendly_name: 'Indoor' } };
    const r = await entitiesAdapter(reader(f)).read({ title: 'House', entities: ['sensor.average_outdoor_temperature', 'sensor.average_indoor_temperature', 'sensor.nope'] }, ctx());
    assert.deepEqual('card' in r && r.card.template === 'list' && r.card.rows, [
      { label: 'Average Outdoor Temperature', value: '8.34', unit: '°C' },
      { label: 'Indoor', value: null },
      { label: 'sensor.nope', value: null },
    ]);
  } finally {
    await f.down();
  }
});

test('without Home Assistant configured the cards say so', async () => {
  await assert.rejects(async () => weatherAdapter(null).read({ title: 'W', entity: 'weather.home' }, ctx()), /not set up/);
});

test('Home Assistant down: cards go stale with their last readings, never to 0; they recover', async () => {
  const f = fakeHa();
  await f.up();
  const ha = reader(f);
  let t = Date.parse('2026-11-09T10:00:00Z');
  const inst = (id: string, type: string, config: Record<string, unknown>): WidgetInstance => ({ id, type, size: 'medium', config, profiles: ['household'], freshness: 'live' });
  const layout: Layout = {
    schema: 1, apps: [], rows: [], background: { kind: 'color', color: '#f6f1e7' }, kidsMode: { apps: [], dailyMinutes: 40 },
    widgets: [
      inst('w', 'weather', { entity: 'weather.home' }),
      inst('e', 'energy', { entity: 'sensor.powerfox_aktuell', period: 'now' }),
      inst('h', 'ha-entities', { entities: ['sensor.average_outdoor_temperature'] }),
    ],
  };
  const widgets = createWidgets({ adapters: homeAssistantAdapters(ha), layout: () => layout, now: () => t, timeoutMs: 2000 });
  try {
    await widgets.tick();
    const live = widgets.data('household');
    assert.deepEqual(live.map((w) => [w.id, w.status, w.failing]), [['w', 'ok', false], ['e', 'ok', false], ['h', 'ok', false]]);
    const before = JSON.stringify(live.map((w) => w.card));

    await f.down();
    t += 31_000; // past the live refresh interval
    await widgets.tick();
    const stale = widgets.data('household');
    assert.deepEqual(stale.map((w) => [w.status, w.failing, w.message]), Array(3).fill(['ok', true, 'Home Assistant is not reachable']));
    assert.equal(JSON.stringify(stale.map((w) => w.card)), before); // the last readings, not a zero or a dash
    assert.equal(stale[0].updatedAt, live[0].updatedAt); // so Sofa Home ages them and marks them stale

    await f.up();
    t += 61_000;
    await widgets.tick();
    assert.deepEqual(widgets.data('household').map((w) => w.failing), [false, false, false]);
  } finally {
    await f.down().catch(() => {});
  }
});

test('Home Assistant down from the start: unavailable with the reason, no number', async () => {
  const f = fakeHa();
  await f.up();
  const cfg = f.config();
  await f.down();
  const layout: Layout = { schema: 1, apps: [], rows: [], background: { kind: 'color', color: '#f6f1e7' }, kidsMode: { apps: [], dailyMinutes: 40 }, widgets: [{ id: 'e', type: 'energy', size: 'small', config: { entity: 'sensor.powerfox_aktuell' }, profiles: ['household'], freshness: 'live' }] };
  const widgets = createWidgets({ adapters: homeAssistantAdapters(createHaClient(cfg)), layout: () => layout, timeoutMs: 2000 });
  await widgets.tick();
  const [w] = widgets.data('household');
  assert.equal(w.status, 'unavailable');
  assert.equal(w.message, 'Home Assistant is not reachable');
  assert.equal(w.card, undefined);
});

test('state_changed for a configured entity refreshes that type, throttled; others are ignored; survives a drop', async () => {
  const f = fakeHa();
  await f.up();
  const layout: Layout = {
    schema: 1, apps: [], rows: [], background: { kind: 'color', color: '#f6f1e7' }, kidsMode: { apps: [], dailyMinutes: 40 },
    widgets: [
      { id: 'e', type: 'energy', size: 'small', config: { entity: 'sensor.powerfox_aktuell' }, profiles: ['household'], freshness: 'live' },
      { id: 'h', type: 'ha-entities', size: 'small', config: { entities: ['sensor.a', 'sensor.b'] }, profiles: ['household'], freshness: 'live' },
    ],
  };
  const refreshed: string[] = [];
  const stop = watchHomeAssistant((on) => subscribeEvents(f.config(), 'state_changed', on, 50), homeAssistantAdapters(null), () => layout, (type) => void refreshed.push(type), 30);
  const until = async (cond: () => boolean) => {
    for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 20));
    assert.ok(cond());
  };
  try {
    await until(() => f.sockets.size === 1);
    await new Promise((r) => setTimeout(r, 50)); // auth and subscribe
    f.emit('light.unrelated');
    f.emit('sensor.powerfox_aktuell');
    f.emit('sensor.powerfox_aktuell'); // coalesced
    f.emit('sensor.b');
    await until(() => refreshed.length === 2);
    await new Promise((r) => setTimeout(r, 80));
    assert.deepEqual(refreshed.sort(), ['energy', 'ha-entities']);

    for (const ws of f.sockets) ws.terminate(); // a drop: the client reconnects
    await until(() => f.sockets.size === 0);
    await until(() => f.sockets.size === 1);
    await new Promise((r) => setTimeout(r, 50));
    f.emit('sensor.a');
    await until(() => refreshed.length === 3);
  } finally {
    stop();
    await f.down();
  }
});
