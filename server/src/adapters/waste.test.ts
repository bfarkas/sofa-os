import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { validateDisplay, type Display } from '@sofa/shared';
import { HaHttpError } from '../ha.ts';
import type { HaReader } from './homeassistant.ts';
import { displayNames, toneOf, wasteAdapter, wasteRows } from './waste.ts';

// The four real sensors, recorded 2026-11-12.
const states: Record<string, unknown> = JSON.parse(readFileSync(new URL('./fixtures/waste-sensors.json', import.meta.url), 'utf8'));
const IDS = ['bioabfall', 'leichtverpackungen', 'restabfall', 'papier'].map((n) => 'sensor.kitchen_waste_collection_schedule_' + n);
const sensorsOf = (ids = IDS) =>
  ids.map((id) => {
    const a = (states[id] as { attributes: Record<string, string> }).attributes;
    const dates = Object.keys(a).filter((k) => /^\d{4}-/.test(k));
    return { name: a[dates[0]], dates };
  });
const at = (iso: string) => Date.parse(iso);
const signal = new AbortController().signal;
const reader = (over: Record<string, 'down' | 'gone'> = {}): HaReader => ({
  async getState(id) {
    if (over[id] === 'gone') throw new HaHttpError('not found', 404);
    if (over[id] === 'down' || !states[id]) throw new Error('boom');
    return states[id];
  },
});
const CONFIG = { title: 'Waste', entities: IDS, names: 'Leichtverpackungen=Gelber Sack' };
const read = async (ha: HaReader, now: number, config: Record<string, unknown> = CONFIG) => wasteAdapter(ha, { timeZone: 'Europe/Berlin' }).read(config, { now, signal });
const NOON = at('2026-11-12T11:00:00Z');

test('wasteRows counts whole days, sorts by next pickup, drops past dates and keeps today', () => {
  const rows = wasteRows(sensorsOf(), '2026-11-12');
  assert.deepEqual(rows.map((b) => [b.name, b.days]), [['Bioabfall', 5], ['Leichtverpackungen', 6], ['Restabfall', 12], ['Papier', 13]]);
  assert.deepEqual(wasteRows(sensorsOf(), '2026-11-17').map((b) => [b.name, b.days]), [['Bioabfall', 0], ['Leichtverpackungen', 1], ['Restabfall', 7], ['Papier', 8]]);
  // After the 17th Bioabfall's next pickup is 1 Dec; a sensor whose dates are all past drops out.
  const later = wasteRows(sensorsOf(), '2026-11-18');
  assert.deepEqual(later.map((b) => [b.name, b.days, b.dates[0]]), [['Leichtverpackungen', 0, '2026-11-18'], ['Restabfall', 6, '2026-11-24'], ['Papier', 7, '2026-11-25'], ['Bioabfall', 13, '2026-12-01']]);
  assert.deepEqual(wasteRows([{ name: 'Old', dates: ['2026-11-01', 'junk'] }], '2026-11-12'), []);
  // The year and the clock change do not matter: days come from date keys.
  assert.equal(wasteRows([{ name: 'A', dates: ['2027-01-02'] }], '2026-12-30')[0].days, 3);
  assert.equal(wasteRows([{ name: 'A', dates: ['2026-10-26'] }], '2026-10-24')[0].days, 2);
  // Equal days keep the sensor order.
  assert.deepEqual(wasteRows([{ name: 'B', dates: ['2026-11-13'] }, { name: 'A', dates: ['2026-11-13'] }], '2026-11-12').map((b) => b.name), ['B', 'A']);
});

test('display names: any separator, case-insensitive on the sensor name, empty ignored', () => {
  assert.deepEqual([...displayNames('Leichtverpackungen=Gelber Sack; restabfall = Graue Tonne\nPapier=')], [['leichtverpackungen', 'Gelber Sack'], ['restabfall', 'Graue Tonne']]);
  assert.equal(displayNames(undefined).size, 0);
  assert.equal(wasteRows(sensorsOf(), '2026-11-12', displayNames('RESTABFALL=Graue Tonne')).find((b) => b.name === 'Restabfall')?.label, 'Graue Tonne');
});

test('a bin takes its colour from keywords in its name or display name; an unknown bin has none', () => {
  const t = (name: string, label = name) => toneOf({ name, label });
  assert.deepEqual([t('Restabfall'), t('Bioabfall'), t('Papier'), t('Leichtverpackungen'), t('Glas')], ['grey', 'brown', 'blue', 'yellow', undefined]);
  assert.equal(t('Leichtverpackungen', 'Gelber Sack'), 'yellow');
  assert.equal(t('Wertstoffe', 'Gelbe Tonne'), 'yellow');
});

test('card: the next bin with its count and colour; Today says the word; one day is "1 day"', async () => {
  const r = await read(reader(), NOON);
  assert.ok('card' in r);
  assert.deepEqual(r.card, { template: 'value', value: '5', unit: 'days', note: 'Bioabfall', tone: 'brown' });
  const eve = await read(reader(), at('2026-11-16T20:00:00Z')); // the evening before, 21:00 in Berlin
  assert.ok('card' in eve);
  assert.deepEqual(eve.card, { template: 'value', value: '1', unit: 'day', note: 'Bioabfall', tone: 'brown' });
  const today = await read(reader(), at('2026-11-17T06:00:00Z'));
  assert.ok('card' in today);
  assert.deepEqual(today.card, { template: 'value', value: 'Today', note: 'Bioabfall', tone: 'brown' });
  // 23:30 in Berlin is already the next local day, whatever the UTC date says.
  const late = await read(reader(), at('2026-11-16T23:30:00Z'));
  assert.ok('card' in late && late.card.template === 'value' && late.card.value === 'Today');
});

test('detail: one tile per bin with the date, the pickups after it and the colour; the first reads Next', async () => {
  const r = await read(reader(), NOON);
  assert.ok('detail' in r && r.detail?.template === 'columns');
  assert.deepEqual(r.detail.columns[0], { label: 'Next · Bioabfall', value: '5', unit: 'days', note: 'Tue 17 Nov', badge: 'Then 1 Dec · 15 Dec', tone: 'brown' });
  assert.deepEqual(r.detail.columns[1], { label: 'Gelber Sack', value: '6', unit: 'days', note: 'Wed 18 Nov', badge: 'Then 2 Dec · 16 Dec', tone: 'yellow' });
  assert.equal(r.detail.columns[3].label, 'Papier');
  const eve = await read(reader(), at('2026-11-16T20:00:00Z'));
  assert.ok('detail' in eve && eve.detail?.template === 'columns');
  assert.deepEqual(eve.detail.columns.slice(0, 2).map((c) => [c.value, c.unit]), [['Tomorrow', undefined], ['2', 'days']]);
  assert.equal(eve.detail.columns[0].label, 'Next · Bioabfall');
  for (const d of [r.card, r.detail, eve.card, eve.detail] as Display[]) assert.deepEqual(validateDisplay(d), []);
});

test('one failing sensor drops only its bin; none readable is unavailable; Home Assistant down is unavailable', async () => {
  const r = await read(reader({ [IDS[0]]: 'down', [IDS[3]]: 'gone' }), NOON);
  assert.ok('detail' in r && r.detail?.template === 'columns');
  assert.deepEqual(r.detail.columns.map((c) => c.label), ['Next · Gelber Sack', 'Restabfall']);
  await assert.rejects(() => read(reader(Object.fromEntries(IDS.map((i) => [i, 'down' as const]))), NOON), /not reachable/);
  await assert.rejects(() => read(null as never, NOON), /not set up/);
  // Sensors Home Assistant does not know: nothing to show, said plainly.
  assert.deepEqual(await read(reader(Object.fromEntries(IDS.map((i) => [i, 'gone' as const]))), NOON), { empty: 'No bin sensors found' });
  // Known but with every date past: nothing coming up.
  assert.deepEqual(await read(reader(), at('2027-02-01T10:00:00Z')), { empty: 'No collections coming up' });
});

test('the config form: sensors required, at most six, names optional', () => {
  const a = wasteAdapter(null);
  assert.deepEqual(a.sizes, ['small']);
  const entities = a.fields.find((f) => f.key === 'entities');
  assert.ok(entities?.kind === 'entities' && entities.max === 6 && entities.required);
  assert.ok(a.fields.find((f) => f.key === 'names' && f.kind === 'text' && !('required' in f && f.required)));
});
