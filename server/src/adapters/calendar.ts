// The family calendar widget (spec: Family calendar). Home Assistant's CalDAV integration holds the Apple credential; the
// Server reads upcoming events with calendar.get_events (a read, not one of the three writes) from an allowlist of calendar
// entities, because Home Assistant may import every calendar on the Apple Account.
import type { AgendaDay, AgendaEvent } from '@sofa/shared';
import type { HaConfig } from '../config.ts';
import { Unavailable, type WidgetAdapter, type WidgetResult } from '../widgets.ts';

/** Only these calendar entities are ever read. The first is the default. Duplicates of other iCloud calendars stay out. */
export const CALENDAR_ALLOWLIST = ['calendar.family'];

/** One event as calendar.get_events returns it. start and end are strings: 'YYYY-MM-DD' (all day, end exclusive) or an ISO datetime with offset. */
export interface RawEvent {
  start: string | { date?: string; dateTime?: string }; // the object form is what the Home Assistant MCP tool shows; the REST service sends strings
  end: string | { date?: string; dateTime?: string };
  summary?: string | null;
  description?: string | null;
  location?: string | null;
  uid?: string | null;
  recurrence_id?: string | null;
}

export type CalendarReader = (entity: string, start: Date, end: Date, signal: AbortSignal) => Promise<RawEvent[]>;

/** POST /api/services/calendar/get_events?return_response. A read: it never goes through the write guard. */
export function createCalendarReader(ha: HaConfig, fetchFn: typeof fetch = fetch): CalendarReader {
  return async (entity, start, end, signal) => {
    if (!CALENDAR_ALLOWLIST.includes(entity)) throw new Error('calendar not allowed: ' + entity);
    const res = await fetchFn(ha.url + '/api/services/calendar/get_events?return_response', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ha.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity_id: entity, start_date_time: start.toISOString(), end_date_time: end.toISOString() }),
      signal,
    });
    if (!res.ok) throw new Error(`Home Assistant calendar.get_events: HTTP ${res.status}`);
    const body = (await res.json()) as { service_response?: Record<string, { events?: RawEvent[] }> };
    const events = body.service_response?.[entity]?.events;
    if (!Array.isArray(events)) throw new Error('calendar.get_events: no events list for ' + entity);
    return events;
  };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (key: string, n: number) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

interface Occurrence {
  id: string; // uid plus recurrence_id: the identity of one occurrence
  title: string;
  location: string;
  allDay: boolean;
  startMs: number;
  startDay: string; // local date the event begins on
  endDay: string; // local date of its last day (inclusive)
  startTime: string; // 'HH:MM' for a timed event
  endTime: string;
}

export function calendarAdapter(deps: { read: CalendarReader; timeZone: string; allowlist?: string[] }): WidgetAdapter {
  const allowlist = deps.allowlist ?? CALENDAR_ALLOWLIST;
  const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: deps.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: deps.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const titleFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
  const dayOf = (ms: number) => dayFmt.format(new Date(ms));

  function parse(e: RawEvent): Occurrence | null {
    const s = typeof e.start === 'string' ? e.start : e.start?.date ?? e.start?.dateTime;
    const en = typeof e.end === 'string' ? e.end : e.end?.date ?? e.end?.dateTime;
    if (!s || !en) return null;
    const id = text(e.uid) + '|' + text(e.recurrence_id);
    const title = text(e.summary) || 'Event';
    const location = text(e.location).replace(/\s*\n\s*/g, ', ');
    if (DATE.test(s) && DATE.test(en)) {
      // All day: date-only values, the end date exclusive, so a one-day event ends the next day.
      const last = addDays(en, -1);
      return { id, title, location, allDay: true, startMs: Date.parse(s + 'T00:00:00Z'), startDay: s, endDay: last < s ? s : last, startTime: '', endTime: '' };
    }
    const a = Date.parse(s), b = Date.parse(en);
    if (isNaN(a) || isNaN(b)) return null;
    // A timed event ending exactly at midnight does not run into the next day.
    return { id, title, location, allDay: false, startMs: a, startDay: dayOf(a), endDay: dayOf(Math.max(a, b - 1)), startTime: timeFmt.format(new Date(a)), endTime: timeFmt.format(new Date(b)) };
  }

  /** Occurrences sorted by start (Home Assistant sends them grouped by series, not by date), one per uid plus recurrence_id. */
  function occurrences(raw: RawEvent[]): Occurrence[] {
    const seen = new Map<string, Occurrence>();
    for (const e of raw) {
      const o = parse(e);
      // Measured 2026-11-09: calendar.get_events itself sends no uid or recurrence_id, so without them the occurrence is
      // identified by its start, end and title (two identical events then count as one).
      if (o) seen.set(o.id === '|' ? `x|${JSON.stringify([e.start, e.end])}|${o.title}` : o.id, o);
    }
    return [...seen.values()].sort((x, y) => x.startMs - y.startMs || (x.allDay === y.allDay ? 0 : x.allDay ? -1 : 1) || x.title.localeCompare(y.title));
  }

  function build(raw: RawEvent[], today: string, days: number, max: number): AgendaDay[] {
    const lastDay = addDays(today, days - 1);
    const byDay = new Map<string, AgendaEvent[]>();
    // Sort first, limit second: the limit then keeps the soonest events.
    for (const o of occurrences(raw).filter((x) => x.endDay >= today && x.startDay <= lastDay).slice(0, max)) {
      for (let d = o.startDay < today ? today : o.startDay; d <= o.endDay && d <= lastDay; d = addDays(d, 1)) {
        const time = o.allDay ? 'All day' : d === o.startDay ? o.startTime : d === o.endDay ? 'Until ' + o.endTime : 'All day';
        const list = byDay.get(d) ?? [];
        list.push({ time, title: o.title, ...(o.location ? { detail: o.location } : {}) });
        byDay.set(d, list);
      }
    }
    return [...byDay.keys()].sort().slice(0, 14).map((d) => ({
      title: d === today ? 'Today' : d === addDays(today, 1) ? 'Tomorrow' : titleFmt.format(new Date(d + 'T12:00:00Z')),
      events: byDay.get(d)!.slice(0, 30),
    }));
  }

  return {
    type: 'calendar',
    title: 'Family calendar',
    description: 'Upcoming events from a calendar in Home Assistant. Kids Mode shows only that something is planned.',
    templates: ['agenda'],
    sizes: ['medium', 'large'],
    defaultSize: 'large',
    defaultFreshness: 'hourly',
    fields: [
      { key: 'calendar', label: 'Calendar', kind: 'choice', options: allowlist.map((v) => ({ value: v, label: v })), default: allowlist[0] },
      { key: 'days', label: 'Days ahead', kind: 'number', min: 1, max: 14, integer: true, default: 7 },
    ],
    async read(config, ctx) {
      const entity = String(config.calendar);
      if (!allowlist.includes(entity)) throw new Unavailable('This calendar is not allowed');
      const days = Number(config.days);
      const today = dayOf(ctx.now);
      // A day either side of the window, so no zone offset can lose an event; build() cuts to the exact local days.
      const raw = await deps.read(entity, new Date(ctx.now - 86_400_000), new Date(ctx.now + (days + 1) * 86_400_000), ctx.signal);
      const agenda = build(raw, today, days, 40);
      if (!agenda.length) return { empty: days === 1 ? 'No events today' : 'No events in the next ' + days + ' days' };
      return { card: { template: 'agenda', days: agenda } };
    },
    // Kids Mode: when something is on, never what. No summary, location or description reaches the TV.
    forKids(result: WidgetResult): WidgetResult {
      if ('empty' in result || result.card.template !== 'agenda') return 'empty' in result ? result : { empty: 'Nothing planned' };
      return { card: { template: 'agenda', days: result.card.days.map((d) => ({ title: d.title, events: d.events.map((e) => ({ time: e.time, title: 'Something planned' })) })) } };
    },
  };
}
