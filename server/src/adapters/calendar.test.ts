import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { validateDisplay, type AgendaDay, type Layout, type WidgetInstance, type WidgetSize } from '@sofa/shared';
import { createWidgets } from '../widgets.ts';
import { calendarAdapter, createCalendarReader, type RawEvent } from './calendar.ts';

// A real response recorded from calendar.family on 2026-11-09, anonymised (see the fixture's _about).
const fixture = JSON.parse(readFileSync(new URL('./fixtures/calendar-family.json', import.meta.url), 'utf8'));
const events: RawEvent[] = fixture.service_response['calendar.family'].events;
const NOW = Date.parse('2026-11-11T06:00:00Z'); // Wed 11 Nov, 07:00 in Berlin
const at = (iso: string) => Date.parse(iso);

const adapter = (raw: RawEvent[]) => calendarAdapter({ read: async () => raw, timeZone: 'Europe/Berlin' });
const signal = new AbortController().signal;
const ctx = { now: NOW, signal };
const CONFIG = { calendar: 'calendar.family', days: 7 };
async function read(raw: RawEvent[], o: { now?: number; size?: WidgetSize; config?: Record<string, unknown> } = {}) {
  const r = await adapter(raw).read(o.config ?? CONFIG, { now: o.now ?? NOW, signal, size: o.size });
  assert.ok('card' in r && r.card.template === 'days', JSON.stringify(r));
  const problems = [...validateDisplay(r.card), ...validateDisplay(r.detail)];
  assert.deepEqual(problems, []);
  return r as { card: { template: 'days'; days: AgendaDay[] }; detail: { template: 'days'; days: AgendaDay[] } };
}
/** The full-screen view: seven day columns from today. */
const week = async (raw: RawEvent[], now = NOW) => (await read(raw, { now })).detail.days;
const card = async (raw: RawEvent[], size: WidgetSize, now = NOW) => (await read(raw, { now, size })).card.days;
const flat = (d: AgendaDay[]) => d.map((x) => [x.title + (x.subtitle ? ' ' + x.subtitle : '') + (x.today ? '*' : ''), ...x.events.map((e) => `${e.time} ${e.title}`.trim())]);

test('the detail is seven day columns from today, today marked, in start order whatever order Home Assistant sent', async () => {
  assert.equal(events[0].summary, 'Choir practice'); // the fixture lists series by series, as Home Assistant did
  assert.deepEqual(flat(await week(events)), [
    ['Today 11*', '07:45 Cleaner'],
    ['Thu 12', '15:30 Dance class', '16:15 Choir practice'],
    ['Fri 13'],
    ['Sat 14', '11:45 Haircut', '14:00 Open day'],
    ['Sun 15'],
    ['Mon 16', '16:45 Music class'],
    ['Tue 17', 'All day Trip away'],
  ]);
});

test('sorting happens before the limit, so the limit keeps the soonest events', async () => {
  const late = { uid: 'late', start: '2026-11-17T10:00:00+01:00', end: '2026-11-17T11:00:00+01:00', summary: 'Late' };
  const soon = Array.from({ length: 40 }, (_, i) => ({ uid: 's' + i, start: '2026-11-12T10:00:00+01:00', end: '2026-11-12T11:00:00+01:00', summary: 'Soon ' + i }));
  const d = await week([late, ...soon]);
  assert.equal(d[1].events.length, 30); // a column holds at most 30
  assert.equal(d[6].events.length, 0); // the later event, listed first, is what the limit of 40 drops
});

test('a moved occurrence keeps its identity and is shown once at its new time', async () => {
  assert.deepEqual(flat(await week(events, at('2026-11-19T05:00:00Z')))[0], ['Today 19*', 'All day Trip away', '08:30 Dentist', '15:30 Dance class', '17:00 Choir practice']);
});

test('occurrences of one series are told apart by uid plus recurrence_id, and the same one twice counts once', async () => {
  const one = events[0];
  const count = async (raw: RawEvent[]) => (await week(raw)).reduce((n, x) => n + x.events.length, 0);
  assert.equal(await count([one, one]), 1); // e.g. two overlapping queries
  assert.equal(await count([one, { ...one, recurrence_id: '2026-11-12 10:00:00+01:00' }]), 2); // same uid and start, other recurrence_id
});

test('date-only events: exclusive end, multi-day spans every day, one-day ends the next day', async () => {
  const d = await week(events, at('2026-11-17T05:00:00Z'));
  assert.deepEqual(flat(d), [
    ['Today 17*', 'All day Trip away'],
    ['Wed 18', 'All day Trip away', '07:45 Cleaner'],
    ['Thu 19', 'All day Trip away', '08:30 Dentist', '15:30 Dance class', '17:00 Choir practice'],
    ['Fri 20', 'All day School closed'], // "Trip away" ends exclusively on the 20th
    ['Sat 21'],
    ['Sun 22'],
    ['Mon 23', '16:45 Music class'],
  ]);
  assert.ok(d[0].events[0].allDay && !d[1].events[1].allDay);
});

test('the REST string form and the object form of start and end give the same days', async () => {
  const wrapped = events.map((e) => {
    const f = (v: string) => (/^\d{4}-\d\d-\d\d$/.test(v) ? { date: v } : { dateTime: v });
    return { ...e, start: f(e.start as string), end: f(e.end as string) };
  });
  for (const now of [NOW, at('2026-11-17T05:00:00Z')]) assert.deepEqual(await week(wrapped, now), await week(events, now));
});

test('a timed event past midnight continues on the next day; one ending at midnight does not', async () => {
  const d = await week([
    { uid: 'a', start: '2026-11-11T22:00:00+01:00', end: '2026-11-12T01:30:00+01:00', summary: 'Late' },
    { uid: 'b', start: '2026-11-12T20:00:00+01:00', end: '2026-11-13T00:00:00+01:00', summary: 'Early' },
  ]);
  assert.deepEqual(flat(d).slice(0, 3), [['Today 11*', '22:00 Late'], ['Thu 12', 'Until 01:30 Late', '20:00 Early'], ['Fri 13']]);
});

test('nothing in range is an empty widget, and the window stops after the configured days', async () => {
  const r = await adapter(events).read({ calendar: 'calendar.family', days: 1 }, { now: at('2027-01-05T10:00:00Z'), signal });
  assert.deepEqual(r, { empty: 'No events today' });
  assert.deepEqual(await adapter([]).read(CONFIG, { now: NOW, signal }), { empty: 'No events in the next 7 days' });
  assert.deepEqual((await week(events)).length, 7);
  assert.deepEqual((await read(events, { config: { calendar: 'calendar.family', days: 3 } })).detail.days.length, 3);
});

test('small card: the next event with its time and title, and how many more that day', async () => {
  // 07:00 Wednesday: the cleaner (07:45 to 10:45) is the only event today.
  assert.deepEqual(flat(await card(events, 'small')), [['Today*', '07:45 Cleaner']]); // the small card shows one day, titled, with no date number
  // Tomorrow has two events; with nothing today (cleaner over) the card moves on and says so.
  assert.deepEqual(flat(await card(events, 'small', at('2026-11-11T10:00:00Z'))), [['Tomorrow', '15:30 Dance class', 'and 1 more tomorrow']]);
  const day = [1, 2, 3, 4].map((i) => ({ uid: 'x' + i, start: `2026-11-11T1${i}:00:00+01:00`, end: `2026-11-11T1${i}:30:00+01:00`, summary: 'E' + i }));
  assert.deepEqual(flat(await card(day, 'small')), [['Today*', '11:00 E1', 'and 3 more today']]);
  // An event that is over drops off the card but not the detail.
  assert.deepEqual(flat(await card(day, 'small', at('2026-11-11T10:45:00Z'))), [['Today*', '12:00 E2', 'and 2 more today']]);
  assert.equal((await week(day, at('2026-11-11T10:45:00Z')))[0].events.length, 4);
  // All day events are not "next" while a timed one is on; on their own they are.
  const mixed = [{ uid: 'a', start: '2026-11-11', end: '2026-11-12', summary: 'Birthday' }, day[0]];
  assert.deepEqual(flat(await card(mixed, 'small')), [['Today*', '11:00 E1', 'and 1 more today']]);
  assert.deepEqual(flat(await card([mixed[0]], 'small')), [['Today*', 'All day Birthday']]);
  // Nothing left today and nothing later in the window.
  assert.deepEqual(flat(await card([day[0]], 'small', at('2026-11-11T12:00:00Z'))), [['Today*', 'Nothing more today']]);
});

test('medium shows today and tomorrow, large three days, each a day column', async () => {
  assert.deepEqual(flat(await card(events, 'medium')), [['Today 11*', '07:45 Cleaner'], ['Thu 12', '15:30 Dance class', '16:15 Choir practice']]);
  assert.deepEqual(flat(await card(events, 'large')).map((x) => x[0]), ['Today 11*', 'Thu 12', 'Fri 13']);
  // No size given reads as small (the default size).
  assert.equal((await read(events)).card.days.length, 1);
  // Nothing in the first days: the card shows the next event instead of empty columns.
  assert.deepEqual(flat(await card(events, 'large', at('2026-11-13T06:00:00Z'))), [['Today 13*'], ['Sat 14', '11:45 Haircut', '14:00 Open day'], ['Sun 15']]);
  // Nothing in the first days: the card shows the next event, with its day, instead of empty columns.
  const music = events.filter((e) => e.summary === 'Music class');
  assert.deepEqual(flat(await card(music, 'large', at('2026-11-12T06:00:00Z'))), [['Mon 16 Nov', '16:45 Music class']]);
});

test('long titles and places are cut with an ellipsis within the display limit', async () => {
  const long = { uid: 'l', start: '2026-11-11T12:00:00+01:00', end: '2026-11-11T13:00:00+01:00', summary: 'x'.repeat(300), location: 'y'.repeat(300) };
  const e = (await week([long]))[0].events[0];
  assert.equal(e.title.length, 120);
  assert.ok(e.title.endsWith('\u2026') && e.detail?.endsWith('\u2026'));
});

test('only allowlisted calendars are read', async () => {
  await assert.rejects(async () => adapter(events).read({ calendar: 'calendar.work', days: 7 }, ctx), /not allowed/);
  const reader = createCalendarReader({ url: 'http://ha.test', token: 't', tvEntity: '', remoteEntity: '', notifyServices: [] }, (async () => {
    throw new Error('must not call');
  }) as unknown as typeof fetch);
  await assert.rejects(() => reader('calendar.work', new Date(), new Date(), ctx.signal), /not allowed/);
});

test('the reader asks calendar.get_events for a response and unwraps it', async () => {
  const calls: { url: string; body: Record<string, string> }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ changed_states: [], service_response: fixture.service_response }));
  }) as unknown as typeof fetch;
  const got = await createCalendarReader({ url: 'http://ha.test:8123', token: 't', tvEntity: '', remoteEntity: '', notifyServices: [] }, fetchFn)('calendar.family', new Date(NOW), new Date(NOW + 1000), ctx.signal);
  assert.equal(got.length, events.length);
  assert.equal(calls[0].url, 'http://ha.test:8123/api/services/calendar/get_events?return_response');
  assert.deepEqual(Object.keys(calls[0].body).sort(), ['end_date_time', 'entity_id', 'start_date_time']);
});

test("the Server's own calendar.get_events response (no uid, no recurrence_id) still gives an ordered, de-duplicated week", async () => {
  const raw: RawEvent[] = JSON.parse(readFileSync(new URL('./fixtures/get-events-raw.json', import.meta.url), 'utf8')).service_response['calendar.family'].events;
  assert.ok(raw.every((e) => !('uid' in e)));
  const d = await week([...raw, raw[0]], at('2026-11-16T06:00:00Z'));
  assert.deepEqual(flat(d), [
    ['Today 16*', '16:45 Music class'],
    ['Tue 17', 'All day Trip away'],
    ['Wed 18', 'All day Trip away', '07:45 Cleaner'],
    ['Thu 19', 'All day Trip away', '08:30 Dentist', '15:30 Dance class', '16:15 Choir practice'],
    ['Fri 20', 'All day School closed', '15:15 Gymnastics'],
    ['Sat 21'],
    ['Sun 22'],
  ]);
});

// ---- Kids Mode: nothing about an event but that it exists ----

const SECRETS = ['Choir practice', 'Haircut', 'Dentist', 'Trip away', 'Sample Street', 'Community centre', '+49 000', 'booking.example', 'Room 1', 'Open day'];
const layout = (profiles: ('household' | 'kids')[]): Layout => ({
  schema: 1, apps: [], rows: [], background: { kind: 'color', color: '#f6f1e7' }, kidsMode: { apps: [], dailyMinutes: 40 },
  widgets: [{ id: 'cal', type: 'calendar', size: 'large', config: { days: 7 }, profiles, freshness: 'hourly' } as WidgetInstance],
});

test('the kids response carries no summary, location or description at all', async () => {
  const w = createWidgets({ adapters: [adapter(events)], layout: () => layout(['household', 'kids']), now: () => NOW });
  await w.tick();
  const household = JSON.stringify(w.data('household'));
  assert.ok(household.includes('Choir practice') && household.includes('Sample Street 1'), 'the household sees details');
  assert.ok(!household.includes('+49 000') && !household.includes('booking.example'), 'descriptions are never sent to the TV');
  const kids = w.data('kids');
  assert.equal(kids[0].status, 'ok');
  const json = JSON.stringify(kids);
  for (const s of SECRETS) assert.ok(!json.includes(s), s);
  assert.ok(!json.includes('"detail"'));
  assert.ok(kids[0].card?.template === 'days' && kids[0].card.days[0].events[0].title === 'Something planned');
  assert.equal(kids[0].card.days.length, 3); // the instance's size (large) reaches the adapter
  assert.equal(kids[0].detail, undefined); // no full-screen view for kids
});

test('kids small card keeps only the count line, never a title', () => {
  const a = adapter(events);
  const small = { card: { template: 'days' as const, days: [{ title: 'Today', today: true, events: [{ time: '07:45', title: 'Cleaner', detail: 'Sample Street 1' }, { time: '', title: 'and 3 more today' }] }] } };
  assert.deepEqual(a.forKids!(small), { card: { template: 'days', days: [{ title: 'Today', today: true, events: [{ time: '07:45', title: 'Something planned' }, { time: '', title: 'and 3 more today' }] }] } });
  // Anything else without a time (not the Server's own line) is still hidden.
  const sneaky = { card: { template: 'days' as const, days: [{ title: 'Today', events: [{ time: '', title: 'Dentist' }] }] } };
  assert.equal(JSON.stringify(a.forKids!(sneaky)).includes('Dentist'), false);
  assert.deepEqual(a.forKids!({ empty: 'No events today' }), { empty: 'No events today' });
});
