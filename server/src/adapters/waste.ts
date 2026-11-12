// The waste collection widget (Session 34). Home Assistant's Waste Collection Schedule integration gives one sensor per bin: the
// state is words ("on Tue, 17.11.2026", never parsed), the attributes are keys `YYYY-MM-DD` mapping to the bin name. The Server
// reads entity states only, counts days in the household's zone and sends the bins sorted by next pickup.
import type { Column, Display, Tone } from '@sofa/shared';
import { Unavailable, type WidgetAdapter } from '../widgets.ts';
import { load, type HaReader } from './homeassistant.ts';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const dayNumber = (key: string) => Date.parse(key + 'T00:00:00Z') / 86_400_000;

export interface Bin {
  name: string; // as the sensor calls it, "Leichtverpackungen"
  label: string; // what the household reads, "Gelber Sack" (the name when no display name is set)
  days: number; // whole days from today to the next pickup; 0 is today
  dates: string[]; // upcoming pickups as YYYY-MM-DD, soonest first, today included
}

/** `Leichtverpackungen=Gelber Sack, Restabfall=Graue Tonne` -> map by lower-case sensor name. Separators: comma, semicolon, new line. */
export function displayNames(text: unknown): Map<string, string> {
  const map = new Map<string, string>();
  if (typeof text !== 'string') return map;
  for (const part of text.split(/[,;\n]/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(i + 1).trim()) map.set(part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).trim());
  }
  return map;
}

/**
 * Bins from sensors, sorted by next pickup (ties keep the sensor order). Past dates are dropped; a sensor with no upcoming
 * date drops out. Pure: `today` is the household's local date, `YYYY-MM-DD`.
 */
export function wasteRows(sensors: { name: string; dates: string[] }[], today: string, names: Map<string, string> = new Map()): Bin[] {
  const t = dayNumber(today);
  const bins: Bin[] = [];
  for (const s of sensors) {
    const dates = s.dates.filter((d) => DATE.test(d) && dayNumber(d) >= t).sort();
    if (dates.length) bins.push({ name: s.name, label: names.get(s.name.toLowerCase()) ?? s.name, days: dayNumber(dates[0]) - t, dates });
  }
  return bins.map((b, i) => ({ b, i })).sort((x, y) => x.b.days - y.b.days || x.i - y.i).map((x) => x.b);
}

// shortcut: keywords, not a per-bin setting; upgrade when a second household needs other bins.
const TONE_KEYWORDS: [RegExp, Tone][] = [
  [/rest/, 'grey'],
  [/bio/, 'brown'],
  [/papier/, 'blue'],
  [/leicht|verpack|gelb/, 'yellow'],
];
export function toneOf(bin: Pick<Bin, 'name' | 'label'>): Tone | undefined {
  const text = (bin.name + ' ' + bin.label).toLowerCase();
  return TONE_KEYWORDS.find(([re]) => re.test(text))?.[1];
}

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export function wasteAdapter(ha: HaReader | null, deps: { timeZone?: string } = {}): WidgetAdapter {
  const zone = deps.timeZone ?? 'UTC';
  const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const longFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
  const shortFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });
  const at = (f: Intl.DateTimeFormat, key: string) => f.format(new Date(key + 'T12:00:00Z'));
  return {
    type: 'waste',
    title: 'Waste collection',
    description: 'Which bin is next and in how many days, from the Waste Collection Schedule sensors in Home Assistant. Household only.',
    templates: ['value', 'columns'],
    sizes: ['small'],
    defaultSize: 'small',
    defaultFreshness: 'hourly',
    fields: [
      { key: 'title', label: 'Title', kind: 'text', maxLength: 40, default: 'Waste' },
      { key: 'entities', label: 'Bin sensors', kind: 'entities', domains: ['sensor'], max: 6, required: true, help: 'One Waste Collection Schedule sensor per bin.' },
      { key: 'names', label: 'Display names', kind: 'text', maxLength: 200, help: 'Optional, for long names: Leichtverpackungen=Gelber Sack, Restabfall=Graue Tonne' },
    ],
    async read(config, ctx) {
      const ids = config.entities as string[];
      if (!ha) throw new Unavailable('Home Assistant is not set up');
      const today = dayFmt.format(new Date(ctx.now));
      // Each sensor fails alone: it drops out and the rest show. None readable is unavailable.
      const states = await Promise.all(ids.map((id) => load(ha, id).catch(() => undefined)));
      if (states.every((s) => s === undefined)) throw new Unavailable('Home Assistant is not reachable');
      const sensors = states.flatMap((s) => {
        if (!s) return [];
        const dates = Object.keys(s.attributes).filter((k) => DATE.test(k));
        const named = dates.map((k) => s.attributes[k]).find((v): v is string => typeof v === 'string' && !!v);
        return named && dates.length ? [{ name: named, dates }] : [];
      });
      const bins = wasteRows(sensors, today, displayNames(config.names));
      if (!bins.length) return { empty: sensors.length || states.some(Boolean) ? 'No collections coming up' : 'No bin sensors found' };
      const first = bins[0];
      const word = (b: Bin) => (b.days === 0 ? 'Today' : b.days === 1 ? 'Tomorrow' : String(b.days));
      const card: Display = {
        template: 'value',
        value: first.days === 0 ? 'Today' : String(first.days),
        // "Tomorrow" is wider than a 323 px card at 60 px: the card says "1 day"
        ...(first.days === 0 ? {} : { unit: first.days === 1 ? 'day' : 'days' }),
        note: cut(first.label, 40),
        ...(toneOf(first) ? { tone: toneOf(first) } : {}),
      };
      const columns: Column[] = bins.map((b, i) => ({
        label: cut((i === 0 ? 'Next \u00b7 ' : '') + b.label, 40),
        value: word(b),
        ...(b.days > 1 ? { unit: 'days' } : {}),
        note: at(longFmt, b.dates[0]),
        ...(b.dates.length > 1 ? { badge: 'Then ' + b.dates.slice(1, 3).map((d) => at(shortFmt, d)).join(' \u00b7 ') } : {}),
        ...(toneOf(b) ? { tone: toneOf(b) } : {}),
      }));
      return { card, detail: { template: 'columns', columns } };
    },
  };
}
