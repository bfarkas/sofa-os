// Home Assistant widget types (Session 12): the generic read-only entity card, weather and energy. All read through the
// Server's Home Assistant client (REST for snapshots), so the token never leaves the Server. A Home Assistant outage throws
// Unavailable, which the framework turns into a stale card (last data kept) rather than a zero. An entity Home Assistant
// itself reports as unavailable or unknown is a missing reading: a dash.
import { DASH, ENTITY_DOMAINS, ENTITY_ID, MAX_CARD_ENTITIES, type Column, type Display, type Layout, type ListRow, type StackPart } from '@sofa/shared';
import type { HaConfig } from '../config.ts';
import { HaHttpError } from '../ha.ts';
import { log } from '../log.ts';
import { Unavailable, type WidgetAdapter } from '../widgets.ts';

export interface HaReader {
  getState(entityId: string): Promise<unknown>;
}

export interface HaState {
  state: string;
  attributes: Record<string, unknown>;
}

/** The state of an entity; null if Home Assistant does not know it. Throws Unavailable if Home Assistant cannot be asked. */
export async function load(ha: HaReader | null, id: string): Promise<HaState | null> {
  if (!ha) throw new Unavailable('Home Assistant is not set up');
  try {
    const s = (await ha.getState(id)) as Partial<HaState> | null;
    if (!s || typeof s.state !== 'string') throw new Error('unexpected answer');
    return { state: s.state, attributes: s.attributes && typeof s.attributes === 'object' ? s.attributes : {} };
  } catch (err) {
    if (err instanceof HaHttpError && err.status === 404) return null;
    if (err instanceof HaHttpError && (err.status === 401 || err.status === 403)) throw new Unavailable('Home Assistant refused the Server');
    throw new Unavailable('Home Assistant is not reachable');
  }
}

const MISSING = ['unavailable', 'unknown', 'none', ''];
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** "21.46" -> "21.5", "23212.387" -> "23212": enough digits to read, never more. Not a number: words, first letter up. */
export function formatState(raw: string | undefined | null): string | null {
  if (raw === undefined || raw === null || MISSING.indexOf(raw.trim().toLowerCase()) >= 0) return null;
  if (/^-?\d+(\.\d+)?$/.test(raw.trim())) {
    const n = Number(raw);
    const digits = Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 10 ? 1 : 2;
    return String(Number(n.toFixed(digits))).replace(/^-0$/, '0');
  }
  const words = raw.replace(/_/g, ' ');
  return (words.charAt(0).toUpperCase() + words.slice(1)).slice(0, 40);
}

const unitOf = (s: HaState) => str(s.attributes.unit_of_measurement) ?? undefined;
const nameOf = (s: HaState | null, id: string) => (s && str(s.attributes.friendly_name)) || id;
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// ---- The generic read-only entity card ----

export function entitiesAdapter(ha: HaReader | null): WidgetAdapter {
  return {
    type: 'ha-entities',
    title: 'Home',
    description: 'Readings from up to six Home Assistant entities: temperatures, door and window states, power. Read-only.',
    templates: ['list'],
    sizes: ['small', 'medium', 'large'],
    defaultSize: 'medium',
    defaultFreshness: 'live',
    fields: [
      { key: 'title', label: 'Title', kind: 'text', maxLength: 40, default: 'Home' },
      { key: 'entities', label: 'Entities', kind: 'entities', domains: [...ENTITY_DOMAINS], max: MAX_CARD_ENTITIES, required: true, help: 'Shown in this order.' },
    ],
    async read(config) {
      const ids = config.entities as string[];
      const states = await Promise.all(ids.map((id) => load(ha, id)));
      const rows: ListRow[] = ids.map((id, i) => {
        const s = states[i];
        const value = s ? formatState(s.state) : null;
        return { label: cut(nameOf(s, id), 40), value, ...(value !== null && s && unitOf(s) ? { unit: unitOf(s) } : {}) };
      });
      return { title: String(config.title), card: { template: 'list', rows } };
    },
  };
}

// ---- Weather ----

const CONDITIONS: Record<string, string> = {
  'clear-night': 'Clear', partlycloudy: 'Partly cloudy', 'snowy-rainy': 'Sleet', lightning: 'Thunderstorm',
  'lightning-rainy': 'Thunderstorm with rain', pouring: 'Heavy rain', windy: 'Windy', 'windy-variant': 'Windy and cloudy',
  exceptional: 'Exceptional weather', fog: 'Fog', hail: 'Hail', rainy: 'Rain', snowy: 'Snow', sunny: 'Sunny', cloudy: 'Cloudy',
};

/** One forecast entry as weather.get_forecasts returns it. Which keys come depends on the weather integration (measured 2026-11-10 on weather.home: no precipitation_probability, only precipitation in mm). */
export interface ForecastItem {
  datetime: string; // ISO with offset; a daily forecast sends midnight
  temperature?: number | null;
  templow?: number | null; // daily only
  condition?: string | null;
  precipitation?: number | null; // mm
  precipitation_probability?: number | null; // percent
  apparent_temperature?: number | null; // feels like
  wind_gust_speed?: number | null;
}
export type ForecastReader = (entity: string, type: 'hourly' | 'daily', signal: AbortSignal) => Promise<ForecastItem[]>;

/** POST /api/services/weather/get_forecasts?return_response. A read, like calendar.get_events: it never goes through the write guard. */
export function createForecastReader(ha: HaConfig, fetchFn: typeof fetch = fetch): ForecastReader {
  return async (entity, type, signal) => {
    if (!/^weather\.[a-z0-9_]+$/.test(entity)) throw new Error('not a weather entity: ' + entity);
    const res = await fetchFn(ha.url + '/api/services/weather/get_forecasts?return_response', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ha.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity_id: entity, type }),
      signal,
    });
    if (!res.ok) throw new Error(`Home Assistant weather.get_forecasts: HTTP ${res.status}`);
    const body = (await res.json()) as { service_response?: Record<string, { forecast?: ForecastItem[] }> };
    const list = body.service_response?.[entity]?.forecast;
    if (!Array.isArray(list)) throw new Error('weather.get_forecasts: no forecast list for ' + entity);
    return list;
  };
}

const DAYS = 7;
const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);
const whole = (v: number | null) => (v === null ? null : String(Math.round(v)).replace('-0', '0'));
/** The rain figure of one daily entry: the chance in percent when the integration has one, else the amount in mm. Dry gives no figure. */
function rain(f: ForecastItem, mmFull: number): { badge?: string; tint: number } {
  const tint = (x: number) => Math.round(Math.min(x, 1) * 100) / 100;
  const p = num(f.precipitation_probability);
  if (p !== null) return p > 0 ? { badge: Math.round(p) + ' %', tint: tint(p / 100) } : { tint: 0 };
  const mm = num(f.precipitation);
  return mm !== null && mm > 0 ? { badge: String(Number(mm.toFixed(1))) + ' mm', tint: tint(mm / mmFull) } : { tint: 0 };
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
/** The compass point the wind comes from: 77° is E. */
export const compass = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

const zoneFormats = (timeZone: string) => ({
  hour: new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
  day: new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }),
  weekday: new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short' }),
});

/** The hours still to come, starting with the one `now` is in (its end has not passed). */
export const upcomingHours = (hourly: ForecastItem[], now: number): ForecastItem[] => hourly.filter((f) => Date.parse(f.datetime) > now - 3_600_000);

const rainWord = (mm: number) => (mm < 0.3 ? 'Light rain' : mm < 2.5 ? 'Rain' : 'Heavy rain');

/**
 * The line the card leads with: "Light rain until 11:00" while it rains, "Light rain Fri 08:00" for the next rain (day name
 * only when it is not today), "Dry for 4 days" when the forecast shows none, counted from the end of the forecast. Rain is an
 * amount, since there is no probability; the word comes from the heaviest hour of that spell. Null without hours.
 */
export function rainOutlook(hours: ForecastItem[], now: number, timeZone: string): string | null {
  if (!hours.length) return null;
  const f = zoneFormats(timeZone);
  const mm = hours.map((h) => num(h.precipitation) ?? 0);
  const spell = (from: number) => {
    let end = from, peak = 0;
    while (end < hours.length && mm[end] > 0) peak = Math.max(peak, mm[end++]);
    return { end, peak };
  };
  const time = (h: ForecastItem) => f.hour.format(new Date(h.datetime));
  if (Date.parse(hours[0].datetime) <= now && mm[0] > 0) {
    const r = spell(0);
    return r.end < hours.length ? rainWord(r.peak) + ' until ' + time(hours[r.end]) : rainWord(r.peak) + ' for ' + hours.length + ' h';
  }
  const i = mm.findIndex((v) => v > 0);
  if (i >= 0) {
    const sameDay = f.day.format(new Date(hours[i].datetime)) === f.day.format(new Date(now));
    return rainWord(spell(i).peak) + ' ' + (sameDay ? '' : f.weekday.format(new Date(hours[i].datetime)) + ' ') + time(hours[i]);
  }
  const left = (Date.parse(hours[hours.length - 1].datetime) + 3_600_000 - now) / 3_600_000;
  return left >= 48 ? 'Dry for ' + Math.floor(left / 24) + ' days' : left >= 24 ? 'Dry for 1 day' : 'Dry for ' + Math.floor(left) + ' h';
}

const RAIN_SCALES = [0.5, 1, 2, 3, 5, 10]; // mm per hour at the top of the rain axis: the first that holds the largest hour, so a nearly dry day still reads

/**
 * The full view's chart over the next 24 hours: the temperature as `points` on an integer axis (floor of the minimum less one
 * to ceil of the maximum plus one, widened to an even span so the middle line is a whole number), five time labels six hours
 * apart (evenly spread, as the chart draws them), and the rain per hour as `bars` when any falls. Null when there are fewer
 * than two temperatures.
 */
export function forecastChart(hours: ForecastItem[], timeZone: string) {
  const h = hours.slice(0, 25);
  const temps = h.map((x) => num(x.temperature));
  const real = temps.filter((v): v is number => v !== null);
  if (real.length < 2) return null;
  const lo = Math.floor(Math.min(...real)) - 1;
  let hi = Math.ceil(Math.max(...real)) + 1;
  if ((hi - lo) % 2) hi++;
  const f = zoneFormats(timeZone);
  const labels = h.length >= 25 ? 5 : 4;
  const mm = h.map((x) => num(x.precipitation) ?? 0);
  const top = Math.max(...mm);
  const scale = RAIN_SCALES.find((v) => v >= top) ?? 10;
  return {
    points: temps.map((t) => (t === null ? null : Math.round(((t - lo) / (hi - lo)) * 1000) / 1000)),
    max: hi + '°',
    min: lo + '°',
    axis: Array.from({ length: labels }, (_, k) => f.hour.format(new Date(h[Math.round((k * (h.length - 1)) / (labels - 1))].datetime))),
    ...(top > 0 ? { bars: mm.map((v) => Math.round(Math.min(v / scale, 1) * 1000) / 1000), barMax: scale + ' mm' } : {}),
    hours: h,
    mm,
  };
}

/** The day columns: high / low, condition and rain. After 21:00 the list starts tomorrow, when today's entry says little about what is left of it. */
export function dayColumns(daily: ForecastItem[], now: number, timeZone: string, conditions: Record<string, string> = CONDITIONS): { dayCols: Column[]; today: ForecastItem | undefined } {
  const f = zoneFormats(timeZone);
  const weekday = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short' });
  const today = f.day.format(new Date(now));
  const late = Number(f.hour.format(new Date(now)).slice(0, 2)) >= 21;
  const start = late ? new Date(Date.parse(today + 'T12:00:00Z') + 86_400_000).toISOString().slice(0, 10) : today;
  // A daily entry's own date part is its day, whatever offset the integration sends.
  const days = daily.filter((x) => typeof x.datetime === 'string' && x.datetime.slice(0, 10) >= start).slice(0, DAYS);
  const dayCols: Column[] = days.map((x) => {
    const key = x.datetime.slice(0, 10);
    const low = num(x.templow);
    return {
      label: key === today ? 'Today' : weekday.format(new Date(key + 'T12:00:00Z')),
      value: whole(num(x.temperature)),
      unit: low === null ? '°' : '° / ' + whole(low) + '°',
      ...(x.condition ? { note: conditions[x.condition] ?? formatState(x.condition) ?? undefined } : {}),
      ...rain(x, 10),
    };
  });
  return { dayCols, today: daily.find((x) => typeof x.datetime === 'string' && x.datetime.slice(0, 10) === today) };
}

/** Weather from a Home Assistant weather entity: the current reading, plus (with a forecast reader) the feels-like, wind and rain outlook on the card and a 24 hour chart over the next days in the full view. */
export function weatherAdapter(ha: HaReader | null, deps: { forecast?: ForecastReader; timeZone?: string } = {}): WidgetAdapter {
  const zone = deps.timeZone ?? 'UTC';
  return {
    type: 'weather',
    title: 'Weather',
    description: 'Current temperature and conditions from a Home Assistant weather entity, with wind and rain, a 24 hour chart and the next days when it has a forecast.',
    templates: ['value', 'list', 'stack', 'chart', 'columns'],
    sizes: ['small', 'medium', 'large'],
    defaultSize: 'small',
    defaultFreshness: 'hourly',
    fields: [
      { key: 'title', label: 'Title', kind: 'text', maxLength: 40, default: 'Weather' },
      { key: 'entity', label: 'Weather entity', kind: 'entity', domains: ['weather'], required: true },
    ],
    async read(config, ctx) {
      const id = String(config.entity);
      const forecast = deps.forecast;
      const [s, hourly, daily] = await Promise.all([
        load(ha, id),
        // A forecast that cannot be read drops only the forecast: the current reading is still shown.
        forecast ? forecast(id, 'hourly', ctx.signal).catch((err) => (log.warn('weather: no hourly forecast', { entity: id, err: String(err) }), null)) : null,
        forecast ? forecast(id, 'daily', ctx.signal).catch((err) => (log.warn('weather: no daily forecast', { entity: id, err: String(err) }), null)) : null,
      ]);
      if (!s) throw new Unavailable('Weather entity ' + id + ' not found in Home Assistant');
      const a = s.attributes;
      const attr = (k: string) => (typeof a[k] === 'number' ? formatState(String(a[k])) : null);
      const temp = attr('temperature');
      const tempUnit = str(a.temperature_unit) ?? '°C';
      const missing = MISSING.indexOf(s.state) >= 0;
      // The integration says "sunny" through the night: clear between 17:00 and 07:00 (shortcut: fixed hours, not the sun entity; upgrade if it looks wrong in December or June).
      const hourNow = Number(zoneFormats(zone).hour.format(new Date(ctx.now)).slice(0, 2));
      const condition = missing ? null : s.state === 'sunny' && (hourNow >= 17 || hourNow < 7) ? 'Clear' : CONDITIONS[s.state] ?? formatState(s.state);
      const humidity = attr('humidity');
      const hours = upcomingHours(hourly ?? [], ctx.now);
      const d = daily ? dayColumns(daily, ctx.now, zone) : null;
      const hiLo = d?.today && num(d.today.temperature) !== null ? 'H ' + whole(num(d.today.temperature)) + '° L ' + (whole(num(d.today.templow)) ?? '–') + '°' : null;
      const chart = forecastChart(hours, zone);
      const cur = hours.length && Date.parse(hours[0].datetime) <= ctx.now ? hours[0] : undefined;
      const temperature = num(a.temperature), wind = num(a.wind_speed), bearing = num(a.wind_bearing);
      const windUnit = str(a.wind_speed_unit) ?? 'km/h';
      const feels = cur && num(cur.apparent_temperature) !== null ? whole(num(cur.apparent_temperature)) + '°' : null;
      const windText = wind !== null ? (bearing !== null ? compass(bearing) + ' ' : '') + whole(wind) + ' ' + windUnit : null;
      const outlook = rainOutlook(hours, ctx.now, zone);
      // With an hourly forecast the card has the feels-like, wind and rain lines; without one it is the plain reading.
      const card: Display = hours.length
        ? {
            template: 'value',
            value: temperature === null ? null : whole(temperature) + '°',
            note: condition ?? 'No conditions',
            lines: [[feels && 'Feels ' + feels, windText].filter(Boolean).join(' · '), outlook ?? ''].filter(Boolean),
          }
        : { template: 'value', value: temp, unit: temp === null ? undefined : tempUnit, note: [condition ?? 'No conditions', hiLo ?? (humidity !== null ? humidity + ' % humidity' : '')].filter(Boolean).join(', ') };
      const withUnit = (k: string, u: string | null): ListRow => ({ label: '', value: attr(k), ...(u && attr(k) !== null ? { unit: u } : {}) });
      const readings: Display = {
        template: 'list',
        rows: [
          { label: 'Conditions', value: condition },
          { label: 'Temperature', value: temp, ...(temp !== null ? { unit: tempUnit } : {}) },
          { ...withUnit('humidity', '%'), label: 'Humidity' },
          { ...withUnit('wind_speed', str(a.wind_speed_unit)), label: 'Wind' },
          { ...withUnit('pressure', str(a.pressure_unit)), label: 'Pressure' },
          { ...withUnit('visibility', str(a.visibility_unit)), label: 'Visibility' },
        ],
      };
      const parts: StackPart[] = [];
      if (chart) {
        const total = chart.mm.reduce((x, y) => x + y, 0);
        const wet = chart.mm.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);
        const f = zoneFormats(zone);
        const at = (i: number) => f.hour.format(new Date(chart.hours[i].datetime));
        const peak = chart.mm.indexOf(Math.max(...chart.mm));
        const gust = Math.max(0, ...chart.hours.map((x) => num(x.wind_gust_speed) ?? 0));
        const rainText = wet.length
          ? Number(total.toFixed(1)) + ' mm rain, ' + (wet.length === 1 ? 'at ' + at(wet[0]) : at(wet[0]) + ' to ' + at(wet[wet.length - 1]) + ', peak ' + at(peak))
          : 'no rain in the next 24 hours';
        const note = [
          ['Now ' + (temperature === null ? DASH : whole(temperature) + '°'), feels && 'feels ' + feels].filter(Boolean).join(', '),
          [windText && 'wind ' + windText, gust > 0 && 'gusts to ' + Math.round(gust)].filter(Boolean).join(', '),
          rainText,
        ].filter(Boolean).join(' · ');
        parts.push({ title: 'Next 24 hours', display: { template: 'chart', points: chart.points, max: chart.max, min: chart.min, axis: chart.axis, ...(chart.bars ? { bars: chart.bars, barMax: chart.barMax } : {}), note: cut(note, 120) } });
      }
      if (d?.dayCols.length) parts.push({ title: 'Next ' + d.dayCols.length + ' days', display: { template: 'columns', columns: d.dayCols } });
      const detail: Display = parts.length ? { template: 'stack', parts } : readings;
      return { title: String(config.title), card, detail };
    },
  };
}

// ---- Energy ----

export const ENERGY_PERIODS: Record<string, string> = {
  now: 'Right now',
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'This week',
  month: 'This month',
  year: 'This year',
  total: 'Total since the meter started',
};

// ---- Power history ----

/** One state change from the recorder: the state (a number or a word like "unavailable") from `at` (ms) until the next entry. */
export interface HistoryEntry {
  state: string;
  at: number;
}
/** The recorder's history of one entity for the last `hours` hours up to `now`, oldest first. It holds the state in force at the window's start. */
export type HistoryReader = (entity: string, hours: number, now: number, signal: AbortSignal) => Promise<HistoryEntry[]>;

const MIN_MS = 60_000;
const BUCKET_MIN_MIN = 5;
const MAX_POINTS = 96; // the chart template's limit

/** The chart's time grid: 5 minute buckets, wider (in 5 minute steps) for a long window so that it stays under the point limit. Buckets sit on the clock, so they do not move between reads. */
export function historyWindow(now: number, hours: number): { start: number; bucket: number; n: number } {
  const bucket = BUCKET_MIN_MIN * MIN_MS * Math.ceil((hours * 60) / BUCKET_MIN_MIN / (MAX_POINTS - 1));
  const start = Math.floor((now - hours * 60 * MIN_MS) / bucket) * bucket;
  return { start, bucket, n: Math.ceil((now - start) / bucket) };
}

/** GET /api/history/period. A read, like the calendar's and the forecast's: it never goes through the write guard. */
export function createHistoryReader(ha: HaConfig, fetchFn: typeof fetch = fetch): HistoryReader {
  return async (entity, hours, now, signal) => {
    if (!ENTITY_ID.test(entity)) throw new Error('not an entity id: ' + entity);
    const w = historyWindow(now, hours);
    // significant_changes_only off: every reported value counts, not only the ones Home Assistant calls significant.
    const url = `${ha.url}/api/history/period/${new Date(w.start).toISOString()}?filter_entity_id=${entity}&end_time=${new Date(now).toISOString()}&minimal_response&no_attributes&significant_changes_only=0`;
    const res = await fetchFn(url, { headers: { Authorization: `Bearer ${ha.token}` }, signal });
    if (!res.ok) throw new Error(`Home Assistant history: HTTP ${res.status}`);
    const body = (await res.json()) as unknown;
    if (!Array.isArray(body)) throw new Error('history: unexpected answer');
    const rows: unknown[] = Array.isArray(body[0]) ? body[0] : [];
    const out: HistoryEntry[] = [];
    for (const r of rows as { state?: unknown; last_changed?: unknown; last_updated?: unknown }[]) {
      const at = Date.parse(String(r?.last_changed ?? r?.last_updated));
      if (typeof r?.state === 'string' && isFinite(at)) out.push({ state: r.state, at });
    }
    return out.sort((a, b) => a.at - b.at);
  };
}

/** Remembers each entity's history for `ttlMs` (default one bucket, since the chart only changes that often), per entity and hours. A failure is remembered for at most a minute, so a broken history is not asked every 30 seconds. */
export function cachedHistory(read: HistoryReader, ttlMs = BUCKET_MIN_MIN * MIN_MS, clock: () => number = Date.now): HistoryReader {
  const cache = new Map<string, { until: number; value?: HistoryEntry[]; error?: unknown }>();
  return async (entity, hours, now, signal) => {
    const key = entity + '|' + hours;
    const hit = cache.get(key);
    if (hit && hit.until > clock()) {
      if (hit.error) throw hit.error;
      return hit.value as HistoryEntry[];
    }
    try {
      const value = await read(entity, hours, now, signal);
      cache.set(key, { until: clock() + ttlMs, value });
      return value;
    } catch (err) {
      cache.set(key, { until: clock() + Math.min(ttlMs, MIN_MS), error: err });
      throw err;
    }
  };
}

/**
 * Averages a state history into the chart's points. A state holds until the next entry (the last one until `now`), so a
 * steady sensor that reports rarely still fills its buckets. A bucket is the time-weighted mean of its numeric states; one
 * that is less than half covered (unavailable, unknown, no data yet) is a gap, never 0. Null when fewer than two points exist.
 */
export function historyChart(entries: HistoryEntry[], now: number, hours: number, timeZone: string) {
  const { start, bucket, n } = historyWindow(now, hours);
  const sum = new Array<number>(n).fill(0);
  const cov = new Array<number>(n).fill(0);
  entries.forEach((e, i) => {
    const v = /^-?\d+(\.\d+)?$/.test(e.state.trim()) ? Number(e.state) : null;
    const a = Math.max(e.at, start);
    const z = Math.min(i + 1 < entries.length ? entries[i + 1].at : now, now);
    if (v === null || z <= a) return;
    for (let b = Math.floor((a - start) / bucket); b < n && start + b * bucket < z; b++) {
      const ov = Math.min(z, start + (b + 1) * bucket) - Math.max(a, start + b * bucket);
      sum[b] += v * ov;
      cov[b] += ov;
    }
  });
  const means = sum.map((s, b) => (cov[b] >= Math.min(bucket, now - (start + b * bucket)) / 2 ? s / cov[b] : null));
  const real = means.filter((v): v is number => v !== null);
  if (real.length < 2) return null;
  const lo = Math.min(...real), hi = Math.max(...real);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const total = cov.reduce((a, b) => a + b, 0);
  return {
    points: means.map((v) => (v === null ? null : hi === lo ? 0.5 : Math.round(((v - lo) / (hi - lo)) * 1000) / 1000)),
    min: lo,
    max: hi,
    avg: sum.reduce((a, b) => a + b, 0) / total,
    // Four labels, evenly spread like the line; the last one is the present.
    axis: [0, 1, 2, 3].map((k) => time.format(new Date(k === 3 ? now : start + Math.round((k * (n - 1)) / 3) * bucket))),
  };
}

/** One energy or power reading with its unit and the period it covers. Home Assistant does not say the period, so the household does. With a history reader the detail is a chart of the last hours. */
export function energyAdapter(ha: HaReader | null, deps: { history?: HistoryReader; timeZone?: string } = {}): WidgetAdapter {
  return {
    type: 'energy',
    title: 'Energy',
    description: 'One energy or power sensor, with its unit and the period it reports (right now, today, this month, total), and its recent history as a chart.',
    templates: ['value', 'list', 'chart'],
    sizes: ['small', 'medium', 'large'],
    defaultSize: 'small',
    defaultFreshness: 'live',
    fields: [
      { key: 'title', label: 'Title', kind: 'text', maxLength: 40, default: 'Energy' },
      { key: 'entity', label: 'Energy or power sensor', kind: 'entity', domains: ['sensor'], required: true },
      { key: 'period', label: 'Period it reports', kind: 'choice', default: 'today', options: Object.entries(ENERGY_PERIODS).map(([value, label]) => ({ value, label })), help: 'Home Assistant does not say; pick what the sensor measures.' },
      { key: 'hours', label: 'Hours of history', kind: 'number', min: 2, max: 24, integer: true, default: 6, help: 'How far back the full-screen chart goes.' },
    ],
    async read(config, ctx) {
      const id = String(config.entity);
      const hours = Number(config.hours);
      const history = deps.history;
      const [s, entries] = await Promise.all([
        load(ha, id),
        // A history that cannot be read drops only the chart: the reading is still shown, and the card is not stale for it.
        history ? history(id, hours, ctx.now, AbortSignal.any([ctx.signal, AbortSignal.timeout(5000)])).catch((err) => (log.warn('energy: no history', { entity: id, err: String(err) }), null)) : null,
      ]);
      if (!s) throw new Unavailable('Sensor ' + id + ' not found in Home Assistant');
      const period = ENERGY_PERIODS[String(config.period)] ?? ENERGY_PERIODS.today;
      const unit = unitOf(s);
      // A reading without a unit is not shown as a number: a bare figure could be Wh or kWh.
      const value = unit ? formatState(s.state) : null;
      const note = unit ? period : period + ' (no unit in Home Assistant)';
      const card: Display = { template: 'value', value, ...(value !== null ? { unit } : {}), note };
      const list: Display = {
        template: 'list',
        rows: [
          { label: 'Reading', value, ...(value !== null ? { unit } : {}) },
          { label: 'Period', value: period },
          { label: 'Sensor', value: cut(nameOf(s, id), 40) },
        ],
      };
      const c = unit && entries ? historyChart(entries, ctx.now, hours, deps.timeZone ?? 'UTC') : null;
      let detail: Display = list;
      if (c) {
        const f = (v: number) => (formatState(String(v)) ?? '') + ' ' + unit;
        // The headline is the chart's note line: a stack with a value part would need a smaller figure on the TV.
        const head = (period === 'Right now' ? 'Now' : period) + ' ' + (value === null ? DASH : value + ' ' + unit);
        detail = { template: 'chart', points: c.points, max: f(c.max), min: f(c.min), axis: c.axis, now: true, note: cut(`${head}  ·  Last ${hours} h: min ${f(c.min)}, avg ${f(c.avg)}, max ${f(c.max)}`, 120) };
      }
      return { title: String(config.title), card, detail };
    },
  };
}

export const HA_TYPES = ['ha-entities', 'weather', 'energy'];

export const homeAssistantAdapters = (ha: HaReader | null, weather: { forecast?: ForecastReader; history?: HistoryReader; timeZone?: string } = {}): WidgetAdapter[] => [entitiesAdapter(ha), weatherAdapter(ha, weather), energyAdapter(ha, weather)];

/**
 * Subscribes to Home Assistant state changes and asks for a re-read of a widget type when one of its configured entities
 * changes. Throttled to one re-read per type every `throttleMs`, because a power sensor reports every few seconds. Events
 * lost in a drop are covered by the freshness policy's polling. Returns the function that stops it.
 */
export function watchHomeAssistant(
  subscribe: (onEvent: (data: Record<string, unknown>) => void) => () => void,
  adapters: WidgetAdapter[],
  layout: () => Layout,
  refresh: (type: string) => unknown,
  throttleMs = 5000,
): () => void {
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  const entitiesOf = (l: Layout) => {
    const out: { type: string; ids: unknown[] }[] = [];
    for (const w of l.widgets) {
      const a = adapters.find((x) => x.type === w.type && HA_TYPES.indexOf(x.type) >= 0);
      if (!a || !w.config) continue;
      for (const f of a.fields) if (f.kind === 'entity' || f.kind === 'entities') out.push({ type: w.type, ids: [(w.config as Record<string, unknown>)[f.key]].flat() });
    }
    return out;
  };
  const stop = subscribe((data) => {
    const id = data.entity_id;
    if (typeof id !== 'string') return;
    let types: string[];
    try {
      types = entitiesOf(layout()).filter((e) => e.ids.indexOf(id) >= 0).map((e) => e.type);
    } catch (err) {
      return void log.warn('home assistant live: cannot read the layout', { err: String(err) });
    }
    for (const type of types) {
      if (pending.has(type)) continue;
      const t = setTimeout(() => {
        pending.delete(type);
        void refresh(type);
      }, throttleMs);
      t.unref?.();
      pending.set(type, t);
    }
  });
  return () => {
    stop();
    for (const t of pending.values()) clearTimeout(t);
  };
}
