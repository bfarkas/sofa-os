import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { validateDisplay, type AgendaDay, type DaySpan, type Layout, type WidgetInstance, type WidgetSize } from '@sofa/shared';
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
  assert.ok('card' in r, JSON.stringify(r));
  assert.deepEqual([...validateDisplay(r.card), ...validateDisplay(r.detail)], []);
  assert.ok(r.card.template === 'days' || r.card.template === 'agenda');
  assert.ok(r.detail?.template === 'days');
  return { card: r.card, detail: r.detail };
}
/** The full-screen view: seven day columns from today, and the bars across them. */
const week = async (raw: RawEvent[], now = NOW) => (await read(raw, { now })).detail.days;
const bars = async (raw: RawEvent[], now = NOW): Promise<DaySpan[] | undefined> => (await read(raw, { now })).detail.spans;
const card = async (raw: RawEvent[], size: WidgetSize, now = NOW) => (await read(raw, { now, size })).card.days;
const flat = (d: AgendaDay[]) => d.map((x) => [x.title + (x.subtitle ? ' ' + x.subtitle : '') + (x.today ? '*' : '') + (x.note ? ' (' + x.note + ')' : ''), ...x.events.map((e) => `${e.time} ${e.title}`.trim())]);
const timed = (d: AgendaDay[]) => d.reduce((n, x) => n + x.events.filter((e) => e.time).length, 0);

test('the detail is seven day columns from today with time ranges, free days named and the trip as a bar', async () => {
  assert.equal(events[0].summary, 'Choir practice'); // the fixture lists series by series, as Home Assistant did
  assert.deepEqual(flat(await week(events)), [
    ['Today 11*', '07:45–10:45 Cleaner'],
    ['Thu 12', '15:30–16:15 Dance class', '16:15–17:00 Choir practice'],
    ['Fri 13', 'Free'],
    ['Sat 14', '11:45–12:45 Haircut', '14:00–17:00 Open day'],
    ['Sun 15', 'Free'],
    ['Mon 16', '16:45–17:30 Music class'],
    ['Tue 17'], // the trip starts here: a bar over the column, not a free day
  ]);
  assert.deepEqual(await bars(events), [{ title: 'Trip away', from: 6, to: 6, lane: 0, clipEnd: true }]);
  const d = await week(events);
  assert.equal(d[1].events[1].detail, 'Room 1'); // the place
});

test('now and past: the event on now reads "Now–end", ended ones of today are faded, later days never', async () => {
  const d = await week(events, at('2026-11-19T07:45:00Z')); // Thu 19 08:45, the Dentist (08:30 to 09:30) is on
  assert.deepEqual(d[0].events.map((e) => [e.time, !!e.now, !!e.past]), [['Now–09:30', true, false], ['15:30–16:15', false, false], ['17:00–17:45', false, false]]);
  const after = await week(events, at('2026-11-19T10:00:00Z')); // 11:00: the Dentist is over
  assert.deepEqual(after[0].events.map((e) => [e.time, !!e.now, !!e.past]), [['08:30–09:30', false, true], ['15:30–16:15', false, false], ['17:00–17:45', false, false]]);
  assert.ok(after.slice(1).every((x) => x.events.every((e) => !e.past && !e.now)));
});

test('a day holds at most 30 events, and an event on another day still shows', async () => {
  const late = { uid: 'late', start: '2026-11-17T10:00:00+01:00', end: '2026-11-17T11:00:00+01:00', summary: 'Late' };
  const soon = Array.from({ length: 40 }, (_, i) => ({ uid: 's' + i, start: '2026-11-12T10:00:00+01:00', end: '2026-11-12T11:00:00+01:00', summary: 'Soon ' + i }));
  const d = await week([late, ...soon]);
  assert.equal(d[1].events.length, 30);
  assert.deepEqual(flat(d)[6], ['Tue 17', '10:00–11:00 Late']);
});

test('a moved occurrence keeps its identity and is shown once at its new time', async () => {
  const d = await week(events, at('2026-11-19T05:00:00Z'));
  assert.deepEqual(flat(d)[0], ['Today 19*', '08:30–09:30 Dentist', '15:30–16:15 Dance class', '17:00–17:45 Choir practice']);
});

test('occurrences of one series are told apart by uid plus recurrence_id, and the same one twice counts once', async () => {
  const one = events[0];
  const count = async (raw: RawEvent[]) => timed(await week(raw));
  assert.equal(await count([one, one]), 1); // e.g. two overlapping queries
  assert.equal(await count([one, { ...one, recurrence_id: '2026-11-12 10:00:00+01:00' }]), 2); // same uid and start, other recurrence_id
});

test('date-only events: exclusive end, a multi-day one is a bar with its length, a one-day one a bar of one column', async () => {
  const now = at('2026-11-17T05:00:00Z');
  const d = await week(events, now);
  assert.deepEqual(flat(d), [
    ['Today 17*'],
    ['Wed 18', '07:45–10:45 Cleaner'],
    ['Thu 19', '08:30–09:30 Dentist', '15:30–16:15 Dance class', '17:00–17:45 Choir practice'],
    ['Fri 20'], // "School closed"
    ['Sat 21', 'Free'],
    ['Sun 22', 'Free'],
    ['Mon 23', '16:45–17:30 Music class'],
  ]);
  // "Trip away" ends exclusively on the 20th; both bars share lane 0 as they do not overlap.
  assert.deepEqual(await bars(events, now), [{ title: 'Trip away · 3 days', from: 0, to: 2, lane: 0 }, { title: 'School closed', from: 3, to: 3, lane: 0 }]);
});

test('bars: "day 3 of 4" for a trip already under way, clip flags, overlapping bars in their own lanes, at most 8', async () => {
  const trips: RawEvent[] = [
    { uid: 't', start: '2026-11-10', end: '2026-11-14', summary: 'Trip' },
    { uid: 'u', start: '2026-11-12', end: '2026-11-16', summary: 'Camp' },
    { uid: 'v', start: '2026-11-15', end: '2026-11-18', summary: 'Visit' },
  ];
  assert.deepEqual(await bars(trips, at('2026-11-12T06:00:00Z')), [
    { title: 'Camp · 4 days', from: 0, to: 3, lane: 0 },
    { title: 'Trip · day 3 of 4', from: 0, to: 1, lane: 1, clipStart: true },
    { title: 'Visit · 3 days', from: 3, to: 5, lane: 1 },
  ]);
  // A trip that runs past the window is clipped at the right; one that began long before and ends today shows its bare title.
  assert.deepEqual(await bars([{ uid: 'l', start: '2026-11-12', end: '2026-11-30', summary: 'Long' }], at('2026-11-12T06:00:00Z')), [{ title: 'Long · 18 days', from: 0, to: 6, lane: 0, clipEnd: true }]);
  assert.deepEqual(await bars([{ uid: 'e', start: '2026-11-09', end: '2026-11-13', summary: 'Ending' }], at('2026-11-12T06:00:00Z')), [{ title: 'Ending', from: 0, to: 0, lane: 0, clipStart: true }]);
  const many = Array.from({ length: 10 }, (_, i) => ({ uid: 'm' + i, start: '2026-11-12', end: '2026-11-13', summary: 'M' + i }));
  assert.equal((await bars(many, at('2026-11-12T06:00:00Z')))?.length, 8);
  assert.equal(await bars([events[0]]), undefined); // no all-day event: no spans at all
});

test('the REST string form and the object form of start and end give the same days', async () => {
  const wrapped = events.map((e) => {
    const f = (v: string) => (/^\d{4}-\d\d-\d\d$/.test(v) ? { date: v } : { dateTime: v });
    return { ...e, start: f(e.start as string), end: f(e.end as string) };
  });
  for (const now of [NOW, at('2026-11-17T05:00:00Z')]) assert.deepEqual(await read(wrapped, { now }), await read(events, { now }));
});

test('a timed event past midnight stays one row on its start day; one ending at midnight ends there', async () => {
  const d = await week([
    { uid: 'a', start: '2026-11-11T22:00:00+01:00', end: '2026-11-12T01:30:00+01:00', summary: 'Late' },
    { uid: 'b', start: '2026-11-12T20:00:00+01:00', end: '2026-11-13T00:00:00+01:00', summary: 'Early' },
  ]);
  assert.deepEqual(flat(d).slice(0, 3), [['Today 11*', '22:00–01:30 Late'], ['Thu 12', '20:00–00:00 Early'], ['Fri 13', 'Free']]);
  // Over 24 hours it is a bar.
  assert.equal((await bars([{ uid: 'c', start: '2026-11-11T20:00:00+01:00', end: '2026-11-13T09:00:00+01:00', summary: 'Camp' }]))?.[0].title, 'Camp · 3 days');
});

test('nothing in range is an empty widget, and the window stops after the configured days', async () => {
  const r = await adapter(events).read({ calendar: 'calendar.family', days: 1 }, { now: at('2027-01-05T10:00:00Z'), signal });
  assert.deepEqual(r, { empty: 'No events today' });
  assert.deepEqual(await adapter([]).read(CONFIG, { now: NOW, signal }), { empty: 'No events in the next 7 days' });
  assert.deepEqual((await week(events)).length, 7);
  assert.deepEqual((await read(events, { config: { calendar: 'calendar.family', days: 3 } })).detail.days.length, 3);
});

test('small card: the rest of today with its times, then the next day when a header and a row still fit', async () => {
  const note = (d: AgendaDay[]) => d.map((x) => x.note ?? null);
  // Wed 07:00: one event today (26 + 40), and room for a header and one row, so tomorrow's first and the count in the note.
  const wed = await card(events, 'small');
  assert.deepEqual(flat(wed), [['Today*', '07:45 Cleaner'], ['Tomorrow (+1 more)', '15:30 Dance class']]);
  assert.equal((await read(events)).card.template, 'agenda'); // no size given reads as small
  // Wed 21:30: the cleaner is over: the quiet line, then tomorrow with both events.
  assert.deepEqual(flat(await card(events, 'small', at('2026-11-11T20:30:00Z'))), [['Today*', 'Nothing more today'], ['Tomorrow', '15:30 Dance class', '16:15 Choir practice']]);
  // Thu 14:20: two rows today fill the budget; the next day with something is Saturday, whose count goes in the note.
  assert.deepEqual(flat(await card(events, 'small', at('2026-11-12T13:20:00Z'))), [['Today*', '15:30 Dance class', '16:15 Choir practice'], ['Sat 14 (+2 more)']]);
  // Thu 19 08:45: the trip is the header's note, the Dentist is on now, three rows leave no room for another day.
  const thu = await card(events, 'small', at('2026-11-19T07:45:00Z'));
  assert.deepEqual(flat(thu), [['Today* (Trip away)', '08:30 Dentist', '15:30 Dance class', '17:00 Choir practice']]);
  assert.ok(thu[0].events[0].now && !thu[0].events[1].now);
  // Four events today: two rows and "and 2 more"; an event that is over drops off the card but not the detail.
  const day = [1, 2, 3, 4].map((i) => ({ uid: 'x' + i, start: `2026-11-11T1${i}:00:00+01:00`, end: `2026-11-11T1${i}:30:00+01:00`, summary: 'E' + i }));
  assert.deepEqual(flat(await card(day, 'small')), [['Today*', '11:00 E1', '12:00 E2', 'and 2 more']]);
  assert.deepEqual(flat(await card(day, 'small', at('2026-11-11T10:45:00Z'))), [['Today*', '12:00 E2', '13:00 E3', '14:00 E4']]);
  assert.equal(timed(await week(day, at('2026-11-11T10:45:00Z'))), 4);
  // An all-day event never takes a row; with more than one the note counts the rest.
  const two = [{ uid: 'a', start: '2026-11-11', end: '2026-11-12', summary: 'Birthday' }, { uid: 'b', start: '2026-11-11', end: '2026-11-12', summary: 'Holiday' }, day[0]];
  assert.deepEqual(flat(await card(two, 'small')), [['Today* (Birthday +1)', '11:00 E1']]);
  assert.deepEqual(note(await card([two[0]], 'small')), ['Birthday']);
  // Nothing left today and nothing later in the window.
  assert.deepEqual(flat(await card([day[0]], 'small', at('2026-11-11T12:00:00Z'))), [['Today*', 'Nothing more today']]);
});

test('medium shows today and tomorrow, large three days, each a day column', async () => {
  assert.deepEqual(flat(await card(events, 'medium')), [['Today 11*', '07:45 Cleaner'], ['Thu 12', '15:30 Dance class', '16:15 Choir practice']]);
  assert.deepEqual(flat(await card(events, 'large')).map((x) => x[0]), ['Today 11*', 'Thu 12', 'Fri 13']);
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
    ['Today 16*', '16:45–17:30 Music class'],
    ['Tue 17'],
    ['Wed 18', '07:45–10:45 Cleaner'],
    ['Thu 19', '08:30–09:30 Dentist', '15:30–16:15 Dance class', '16:15–17:00 Choir practice'],
    ['Fri 20', '15:15–16:00 Gymnastics'],
    ['Sat 21', 'Free'],
    ['Sun 22', 'Free'],
  ]);
  assert.deepEqual((await bars([...raw, raw[0]], at('2026-11-16T06:00:00Z')))?.map((b) => b.title), ['Trip away · 3 days', 'School closed']);
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

test('kids small agenda card: groups and times stay, no title, note or span title; an all-day event is a row', async () => {
  const small = (await adapter(events).read(CONFIG, { now: at('2026-11-19T07:45:00Z'), signal, size: 'small' })) as { card: never; detail: never };
  assert.equal((small.card as { template: string }).template, 'agenda');
  const kids = adapter(events).forKids!(small as never);
  const json = JSON.stringify(kids);
  for (const s of SECRETS) assert.ok(!json.includes(s), s);
  assert.ok(!json.includes('"note"') && !json.includes('"detail"') && !json.includes('spans'));
  assert.deepEqual(flat((kids as { card: { days: AgendaDay[] } }).card.days), [['Today*', 'All day Something planned', '08:30 Something planned', '15:30 Something planned', '17:00 Something planned']]);
  // A "+N more" note is a count, not an event: it is dropped, not turned into a row.
  const counted = adapter(events).forKids!({ card: { template: 'agenda', days: [{ title: 'Sat 14', note: '+2 more', events: [] }] } });
  assert.deepEqual(counted, { card: { template: 'agenda', days: [{ title: 'Sat 14', events: [] }] } });
});
