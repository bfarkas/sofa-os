import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { readConfig, validateDisplay, type Layout, type WidgetInstance } from '@sofa/shared';
import { WebSocketServer } from 'ws';
import type { HaConfig } from '../config.ts';
import { createHaClient, subscribeEvents } from '../ha.ts';
import { createWidgets } from '../widgets.ts';
import { cachedHistory, createForecastReader, createHistoryReader, energyAdapter, compass, dayColumns, entitiesAdapter, forecastChart, formatState, historyChart, historyWindow, homeAssistantAdapters, rainOutlook, upcomingHours, watchHomeAssistant, weatherAdapter, type ForecastItem, type HistoryEntry } from './homeassistant.ts';

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

const ctx = () => ({ now: Date.parse('2026-11-12T12:40:00Z'), signal: new AbortController().signal });
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
// Real hourly data from 2026-11-12 (07:00Z on, all dry); the daily list is the one recorded on the 10th.
const live = (JSON.parse(readFileSync(new URL('./fixtures/weather-hourly-live.json', import.meta.url), 'utf8')) as { hourly: ForecastItem[] }).hourly;
const NOW = Date.parse('2026-11-12T12:40:00Z'); // 13:40 in Berlin on Thursday the 12th
const BERLIN = 'Europe/Berlin';
const hour = (iso: string, mm: number, temperature = 5): ForecastItem => ({ datetime: iso, temperature, precipitation: mm });

test('compass: the point the wind comes from', () => {
  assert.deepEqual([0, 77, 180, 315, 359, 360, -45].map(compass), ['N', 'E', 'S', 'NW', 'N', 'N', 'NW']);
});

test('rain outlook: raining now, next rain with its day, or how long it stays dry', () => {
  const t = (iso: string) => Date.parse(iso);
  const hours = [hour('2026-11-12T09:00:00+00:00', 0.1), hour('2026-11-12T10:00:00+00:00', 0.1), hour('2026-11-12T11:00:00+00:00', 0), hour('2026-11-12T12:00:00+00:00', 0), hour('2026-11-13T07:00:00+00:00', 1)];
  // Raining in the hour 10:40 is in: until the first dry hour (11:00 UTC is 12:00 in Berlin).
  assert.equal(rainOutlook(upcomingHours(hours, t('2026-11-12T09:40:00Z')), t('2026-11-12T09:40:00Z'), BERLIN), 'Light rain until 12:00');
  // Dry now, rain tomorrow morning: the day name appears because it is not today; the amount picks the word.
  assert.equal(rainOutlook(upcomingHours(hours, t('2026-11-12T11:40:00Z')), t('2026-11-12T11:40:00Z'), BERLIN), 'Rain Fri 08:00');
  assert.equal(rainOutlook(hours.slice(2, 4), t('2026-11-12T11:40:00Z'), BERLIN), 'Dry for 1 h');
  assert.equal(rainOutlook(upcomingHours(live, NOW), NOW, BERLIN), 'Dry for 1 day');
  assert.equal(rainOutlook([], NOW, BERLIN), null);
  assert.equal(rainOutlook([hour('2026-11-12T12:00:00+00:00', 4)], t('2026-11-12T12:10:00Z'), BERLIN), 'Heavy rain for 1 h');
});

test('forecast chart: integer axis with an even span, five labels six hours apart, rain bars only when it rains', () => {
  const c = forecastChart(upcomingHours(live, NOW), BERLIN);
  assert.ok(c && c.points.length === 25 && c.axis.length === 5);
  assert.equal(c.axis[0], '13:00');
  assert.equal(c.axis[4], '13:00');
  assert.ok(/^-?\d+°$/.test(c.max) && /^-?\d+°$/.test(c.min) && (parseInt(c.max) - parseInt(c.min)) % 2 === 0);
  assert.ok(c.points.every((p) => p !== null && p >= 0 && p <= 1));
  assert.equal(c.bars, undefined); // a dry day draws no bars
  const wet = forecastChart([hour('2026-11-12T12:00:00+00:00', 0.4, 4), hour('2026-11-12T13:00:00+00:00', 1.5, 6), hour('2026-11-12T14:00:00+00:00', 0, 5)], BERLIN);
  assert.ok(wet);
  assert.deepEqual([wet.max, wet.min, wet.barMax, wet.bars], ['7°', '3°', '2 mm', [0.2, 0.75, 0]]);
  assert.equal(forecastChart([hour('2026-11-12T12:00:00+00:00', 0)], BERLIN), null);
});

test('day columns: today first with high and low, rain as mm without a probability; after 21:00 the list starts tomorrow', () => {
  const { dayCols, today } = dayColumns(forecasts.daily, NOW, BERLIN);
  assert.equal(dayCols.length, 5); // the recorded list runs to the 16th
  assert.equal(dayCols[0].label, 'Today');
  assert.equal(dayCols[1].label, 'Fri');
  assert.ok(dayCols.every((x) => !('level' in x)));
  assert.equal(today?.datetime.slice(0, 10), '2026-11-12');
  const late = dayColumns(forecasts.daily, Date.parse('2026-11-12T20:30:00Z'), BERLIN); // 21:30 in Berlin
  assert.equal(late.dayCols[0].label, 'Fri');
});

test('weather with an hourly forecast: the card has the feels-like, wind and rain lines; the detail is a chart over days', async () => {
  const f = fakeHa();
  await f.up();
  try {
    const read = async (forecast: (e: string, t: 'hourly' | 'daily') => Promise<ForecastItem[]>, now = NOW) =>
      weatherAdapter(reader(f), { forecast, timeZone: BERLIN }).read({ title: 'Weather', entity: 'weather.home' }, { now, signal: new AbortController().signal });
    const forecast = async (_e: string, t: 'hourly' | 'daily') => (t === 'hourly' ? live : forecasts.daily);
    const r = await read(forecast);
    assert.ok('card' in r && r.card.template === 'value' && r.card.value === '6°' && r.card.note === 'Cloudy', JSON.stringify('card' in r && r.card));
    assert.ok(r.card.template === 'value' && r.card.lines?.length === 2 && /^Feels /.test(r.card.lines[0]) && r.card.lines[1] === 'Dry for 1 day', JSON.stringify(r.card));
    assert.deepEqual(validateDisplay(r.card), []);
    const detail = 'detail' in r ? r.detail : undefined;
    assert.ok(detail?.template === 'stack');
    assert.deepEqual(detail.parts.map((p) => p.title), ['Next 24 hours', 'Next 5 days']);
    assert.deepEqual(validateDisplay(detail, 'detail'), []);
    // Only the hourly forecast fails: the card is the plain reading, the days stay.
    const d = await read(async (_e, t) => (t === 'hourly' ? Promise.reject(new Error('boom')) : forecasts.daily));
    assert.ok('card' in d && d.card.template === 'value' && d.card.lines === undefined && d.card.unit === '°C' && /^Cloudy, H /.test(String(d.card.note)));
    assert.ok('detail' in d && d.detail?.template === 'stack' && d.detail.parts.length === 1 && d.detail.parts[0].title === 'Next 5 days');
    // Neither works: today's readings, as before, and the card as before.
    const n = await read(async () => Promise.reject(new Error('boom')));
    assert.ok('detail' in n && n.detail?.template === 'list');
    assert.ok('card' in n && n.card.template === 'value' && n.card.note === 'Cloudy');
    // The integration says sunny through the night: Clear.
    f.states['weather.home'] = { ...(f.states['weather.home'] as object), state: 'sunny' };
    const night = await read(forecast, Date.parse('2026-11-12T20:40:00Z'));
    assert.ok('card' in night && night.card.template === 'value' && night.card.note === 'Clear');
    const day = await read(forecast);
    assert.ok('card' in day && day.card.template === 'value' && day.card.note === 'Sunny');
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

// ---- Power history ----

const powerFixture = JSON.parse(readFileSync(new URL('./fixtures/history-power.json', import.meta.url), 'utf8')) as { history: { state: string; last_changed: string }[][] };
const powerEntries: HistoryEntry[] = powerFixture.history[0].map((r) => ({ state: r.state, at: Date.parse(r.last_changed) }));
const T = Date.parse('2026-11-10T22:40:00Z'); // on a bucket edge; 23:40 in Berlin
const HOUR = 3_600_000;

test('history window: 5 minute buckets, wider for a long window, never over the 96 point limit', () => {
  assert.deepEqual([historyWindow(T, 6).bucket, historyWindow(T, 6).n], [300_000, 72]);
  assert.equal(historyWindow(T + 60_000, 6).n, 73); // the present bucket is one more
  for (let h = 2; h <= 24; h++) assert.ok(historyWindow(T + 299_999, h).n <= 96, h + ' h');
  assert.equal(historyWindow(T, 24).bucket, 20 * 60_000);
});

test('history chart: a real sample is time-weighted into buckets, earlier buckets without data are gaps', () => {
  const c = historyChart(powerEntries, Date.parse('2026-11-10T22:14:00Z'), 2, 'Europe/Berlin');
  assert.ok(c);
  assert.equal(c.points.length, 25);
  assert.deepEqual(c.points.slice(0, 23), Array(23).fill(null)); // the sample starts at 22:05
  assert.equal(c.points[23], 1); // the 22:05 bucket is the high one, 22:10 the low one
  assert.equal(c.points[24], 0);
  assert.ok(c.min >= 438 && c.max <= 531 && c.min < c.avg && c.avg < c.max);
  assert.deepEqual(c.axis[3], '23:14'); // the present, in the configured zone
  assert.deepEqual(validateDisplay({ template: 'chart', points: c.points, axis: c.axis }), []);
});

test('history chart: a steady sensor fills every bucket; unavailable stretches are gaps, not zero', () => {
  const steady = historyChart([{ state: '100', at: T - 8 * HOUR }], T, 6, 'UTC');
  assert.ok(steady);
  assert.deepEqual(steady.points, Array(72).fill(0.5));
  const entries: HistoryEntry[] = [
    { state: '100', at: T - 8 * HOUR },
    { state: 'unavailable', at: T - 5 * HOUR },
    { state: '200', at: T - 4 * HOUR },
    { state: 'unknown', at: T - 30 * 60_000 },
  ];
  const c = historyChart(entries, T, 6, 'UTC');
  assert.ok(c);
  assert.equal(c.points.filter((p) => p === null).length, 12 + 6); // the hour unavailable and the last half hour unknown
  assert.equal(c.points[0], 0);
  assert.equal(c.points[c.points.length - 7], 1);
  assert.equal(c.points[12], null);
  assert.ok(Math.abs(c.avg - (100 * 1 + 200 * 3.5) / 4.5) < 1e-6); // 100 for 1 h, 200 for 3.5 h; the gaps do not count
});

test('history chart: nothing numeric to draw gives null, so the detail falls back to the reading', () => {
  assert.equal(historyChart([], T, 6, 'UTC'), null);
  assert.equal(historyChart([{ state: 'unavailable', at: T - HOUR }], T, 6, 'UTC'), null);
  assert.equal(historyChart([{ state: '5', at: T - 1_000 }], T, 6, 'UTC'), null); // one bucket only
});

test('history reader: asks the recorder for a minimal response and unwraps it; only entity ids', async () => {
  const calls: { url: string; auth: string | null }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, auth: new Headers(init.headers).get('authorization') });
    return new Response(JSON.stringify(powerFixture.history));
  }) as unknown as typeof fetch;
  const read = createHistoryReader({ url: 'http://ha.test:8123', token: 'tok' } as HaConfig, fetchFn);
  const out = await read('sensor.powerfox_aktuell', 6, T, new AbortController().signal);
  assert.equal(out.length, 40);
  assert.deepEqual(out[0], { state: '504', at: Date.parse('2026-11-10T22:05:45.114Z') });
  assert.equal(calls[0].auth, 'Bearer tok');
  assert.match(calls[0].url, /^http:\/\/ha\.test:8123\/api\/history\/period\/2026-11-10T16:40:00\.000Z\?filter_entity_id=sensor\.powerfox_aktuell&end_time=2026-11-10T22:40:00\.000Z&minimal_response&no_attributes/);
  await assert.rejects(read('sensor/../x', 6, T, new AbortController().signal), /not an entity id/);
  const none = createHistoryReader({ url: 'http://ha.test', token: 't' } as HaConfig, (async () => new Response('[]')) as unknown as typeof fetch);
  assert.deepEqual(await none('sensor.x', 6, T, new AbortController().signal), []);
  const bad = createHistoryReader({ url: 'http://ha.test', token: 't' } as HaConfig, (async () => new Response('no', { status: 500 })) as unknown as typeof fetch);
  await assert.rejects(bad('sensor.x', 6, T, new AbortController().signal), /HTTP 500/);
});

test('cached history: one read per entity and hours within the time to live; a failure is remembered for a minute', async () => {
  let clock = 0, calls = 0, fail = false;
  const read = cachedHistory(async () => (++calls, fail ? Promise.reject(new Error('down')) : powerEntries), 300_000, () => clock);
  const sig = new AbortController().signal;
  await read('sensor.a', 6, T, sig);
  clock += 30_000; // a live read 30 s later
  await read('sensor.a', 6, T, sig);
  await read('sensor.a', 12, T, sig); // another window is another entry
  await read('sensor.b', 6, T, sig);
  assert.equal(calls, 3);
  clock += 300_000;
  fail = true;
  await assert.rejects(read('sensor.a', 6, T, sig), /down/);
  fail = false;
  clock += 30_000;
  await assert.rejects(read('sensor.a', 6, T, sig), /down/); // still remembered
  assert.equal(calls, 4);
  clock += 31_000;
  assert.equal((await read('sensor.a', 6, T, sig)).length, 40);
  assert.equal(calls, 5);
});

test('energy with a history: the detail is the chart with the reading as its headline; the card is unchanged', async () => {
  const f = fakeHa();
  await f.up();
  try {
    const now = Date.parse('2026-11-10T22:14:00Z');
    const c = { now, signal: new AbortController().signal };
    const cfg = { title: 'Power', entity: 'sensor.powerfox_aktuell', period: 'now', hours: 2 };
    const plain = await energyAdapter(reader(f)).read(cfg, c);
    const withHistory = await energyAdapter(reader(f), { history: async () => powerEntries, timeZone: 'Europe/Berlin' }).read(cfg, c);
    assert.deepEqual('card' in withHistory && withHistory.card, 'card' in plain && plain.card);
    assert.deepEqual('card' in plain && plain.card, { template: 'value', value: '98', unit: 'W', note: 'Right now' });
    const d = 'detail' in withHistory ? withHistory.detail : undefined;
    assert.equal(d?.template, 'chart');
    if (d?.template !== 'chart') return;
    assert.equal(d.points.length, 25);
    assert.equal(d.now, true);
    assert.match(d.max ?? '', /^\d+ W$/);
    assert.match(d.note ?? '', /^Now 98 W {2}· {2}Last 2 h: min \d+ W, avg \d+ W, max \d+ W$/);
    assert.deepEqual(validateDisplay(d), []);

    // The history fails, is empty, or the sensor has no unit: the reading alone, as before, and no error.
    const list = 'detail' in plain ? plain.detail : undefined;
    for (const history of [async () => Promise.reject(new Error('boom')), async () => [], async () => [{ state: 'unavailable', at: now - HOUR }]]) {
      const r = await energyAdapter(reader(f), { history }).read(cfg, c);
      assert.deepEqual('detail' in r && r.detail, list);
    }
    f.states['sensor.bezug_powerfox'] = { entity_id: 'sensor.bezug_powerfox', state: '23212.387', attributes: {} };
    const bare = await energyAdapter(reader(f), { history: async () => powerEntries }).read({ ...cfg, entity: 'sensor.bezug_powerfox' }, c);
    assert.equal('detail' in bare && bare.detail?.template, 'list');
  } finally {
    await f.down();
  }
});

test('energy config: hours of history is 2 to 24 whole hours, 6 by default', () => {
  const fields = energyAdapter(null).fields;
  assert.deepEqual(readConfig(fields, { entity: 'sensor.p' }).config.hours, 6);
  assert.equal(readConfig(fields, { entity: 'sensor.p', hours: 24 }).errors.length, 0);
  for (const hours of [1, 25, 2.5, '6']) assert.match(readConfig(fields, { entity: 'sensor.p', hours }).errors.join(), /hours/);
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
