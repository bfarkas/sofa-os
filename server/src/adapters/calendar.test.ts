import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Layout, WidgetInstance } from '@sofa/shared';
import { createWidgets } from '../widgets.ts';
import { calendarAdapter, createCalendarReader, type RawEvent } from './calendar.ts';

// A real response recorded from calendar.family on 2026-11-09, anonymised (see the fixture's _about).
const fixture = JSON.parse(readFileSync(new URL('./fixtures/calendar-family.json', import.meta.url), 'utf8'));
const events: RawEvent[] = fixture.service_response['calendar.family'].events;
const NOW = Date.parse('2026-11-11T06:00:00Z'); // Wed 11 Nov, 07:00 in Berlin

const adapter = (raw: RawEvent[]) => calendarAdapter({ read: async () => raw, timeZone: 'Europe/Berlin' });
const ctx = { now: NOW, signal: new AbortController().signal };
async function days(raw: RawEvent[], config: Record<string, unknown> = { calendar: 'calendar.family', days: 14 }) {
  const r = await adapter(raw).read(config, ctx);
  assert.ok('card' in r && r.card.template === 'agenda', JSON.stringify(r));
  return r.card.days;
}
const flat = (d: Awaited<ReturnType<typeof days>>) => d.map((x) => [x.title, ...x.events.map((e) => `${e.time} ${e.title}`)]);

test('events are ordered by start, whatever order Home Assistant sent them in', async () => {
  assert.equal(events[0].summary, 'Choir practice'); // the fixture lists series by series, as Home Assistant did
  assert.deepEqual(flat(await days(events)).slice(0, 3), [
    ['Today', '07:45 Cleaner'],
    ['Tomorrow', '15:30 Dance class', '16:15 Choir practice'],
    ['Sat 14 Nov', '11:45 Haircut', '14:00 Open day'],
  ]);
});

test('sorting happens before the limit, so the limit keeps the soonest events', async () => {
  // Two events are first in the list and last in time; a limit of 40 would not show it, so shrink the list.
  const late = { uid: 'late', start: '2026-11-20T10:00:00+01:00', end: '2026-11-20T11:00:00+01:00', summary: 'Late' };
  const soon = Array.from({ length: 40 }, (_, i) => ({ uid: 's' + i, start: '2026-11-12T10:00:00+01:00', end: '2026-11-12T11:00:00+01:00', summary: 'Soon ' + i }));
  const d = await days([late, ...soon]);
  assert.deepEqual(d.map((x) => x.title), ['Tomorrow']); // the later event, listed first, is what the limit drops
});

test('a moved occurrence keeps its identity and is shown once at its new time', async () => {
  const d = await days(events);
  const day = d.find((x) => x.title === 'Thu 19 Nov');
  assert.ok(day);
  assert.deepEqual(day.events.map((e) => e.time + ' ' + e.title), ['All day Trip away', '08:30 Dentist', '15:30 Dance class', '17:00 Choir practice']);
});

test('occurrences of one series are told apart by uid plus recurrence_id, and the same one twice counts once', async () => {
  const series = events.filter((e) => e.uid === '5CC03476-DDAE-40FE-BA58-958588DE9DDF');
  const count = async (raw: RawEvent[]) => (await days(raw)).reduce((n, x) => n + x.events.length, 0);
  assert.equal(await count([...series, ...series]), 2); // two in the 14-day window; e.g. two overlapping queries
  // Same uid and start, different recurrence_id: two occurrences, not one.
  assert.equal(await count([series[0], { ...series[0], recurrence_id: '2026-11-12 10:00:00+01:00' }]), 2);
});

test('date-only events: exclusive end, multi-day spans every day, one-day ends the next day', async () => {
  const d = await days(events);
  const on = (title: string) => d.find((x) => x.title === title)?.events.map((e) => e.time + ' ' + e.title) ?? [];
  // "Trip away" is 2026-11-17 to 2026-11-20 exclusive: the 17th, 18th and 19th, not the 20th.
  for (const t of ['Tue 17 Nov', 'Wed 18 Nov', 'Thu 19 Nov']) assert.ok(on(t).includes('All day Trip away'), t);
  assert.ok(!on('Fri 20 Nov').includes('All day Trip away'));
  // "School closed" is 2026-11-20 to 2026-11-21 exclusive: the 20th only.
  assert.deepEqual(on('Fri 20 Nov'), ['All day School closed']);
  assert.ok(!d.some((x) => x.title === 'Sat 21 Nov'));
  // All day sorts before timed events of the same day.
  assert.equal(on('Thu 19 Nov')[0], 'All day Trip away');
});

test('the REST string form and the object form of start and end give the same agenda', async () => {
  const wrapped = events.map((e) => {
    const f = (v: string) => (/^\d{4}-\d\d-\d\d$/.test(v) ? { date: v } : { dateTime: v });
    return { ...e, start: f(e.start as string), end: f(e.end as string) };
  });
  assert.deepEqual(await days(wrapped), await days(events));
});

test('a timed event past midnight continues on the next day; one ending at midnight does not', async () => {
  const d = await days(
    [
      { uid: 'a', start: '2026-11-11T22:00:00+01:00', end: '2026-11-12T01:30:00+01:00', summary: 'Late' },
      { uid: 'b', start: '2026-11-12T20:00:00+01:00', end: '2026-11-13T00:00:00+01:00', summary: 'Early' },
    ],
    { calendar: 'calendar.family', days: 7 },
  );
  assert.deepEqual(flat(d), [['Today', '22:00 Late'], ['Tomorrow', 'Until 01:30 Late', '20:00 Early']]);
});

test('nothing in range is an empty widget, and the window stops after the configured days', async () => {
  const r = await adapter(events).read({ calendar: 'calendar.family', days: 1 }, { ...ctx, now: Date.parse('2027-01-05T10:00:00Z') });
  assert.deepEqual(r, { empty: 'No events today' });
  const none = await adapter([]).read({ calendar: 'calendar.family', days: 7 }, ctx);
  assert.deepEqual(none, { empty: 'No events in the next 7 days' });
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

// ---- Kids Mode: nothing about an event but that it exists ----

const SECRETS = ['Choir practice', 'Haircut', 'Dentist', 'Trip away', 'Sample Street', 'Community centre', '+49 000', 'booking.example', 'Room 1', 'Open day'];
const layout = (profiles: ('household' | 'kids')[]): Layout => ({
  schema: 1, apps: [], rows: [], background: { kind: 'color', color: '#f6f1e7' }, kidsMode: { apps: [], dailyMinutes: 40 },
  widgets: [{ id: 'cal', type: 'calendar', size: 'large', config: { days: 14 }, profiles, freshness: 'hourly' } as WidgetInstance],
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
  assert.ok(kids[0].card?.template === 'agenda' && kids[0].card.days[0].events[0].title === 'Something planned');
});
