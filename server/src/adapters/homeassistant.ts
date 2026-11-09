// Home Assistant widget types (Session 12): the generic read-only entity card, weather and energy. All read through the
// Server's Home Assistant client (REST for snapshots), so the token never leaves the Server. A Home Assistant outage throws
// Unavailable, which the framework turns into a stale card (last data kept) rather than a zero. An entity Home Assistant
// itself reports as unavailable or unknown is a missing reading: a dash.
import { ENTITY_DOMAINS, MAX_CARD_ENTITIES, type Display, type Layout, type ListRow } from '@sofa/shared';
import { HaHttpError } from '../ha.ts';
import { log } from '../log.ts';
import { Unavailable, type WidgetAdapter } from '../widgets.ts';

export interface HaReader {
  getState(entityId: string): Promise<unknown>;
}

interface HaState {
  state: string;
  attributes: Record<string, unknown>;
}

/** The state of an entity; null if Home Assistant does not know it. Throws Unavailable if Home Assistant cannot be asked. */
async function load(ha: HaReader | null, id: string): Promise<HaState | null> {
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

/** Weather from a Home Assistant weather entity: today's conditions only. Forecasts need a service call, which the Server never makes. */
export function weatherAdapter(ha: HaReader | null): WidgetAdapter {
  return {
    type: 'weather',
    title: 'Weather',
    description: 'Current temperature and conditions from a Home Assistant weather entity.',
    templates: ['value', 'list'],
    sizes: ['small', 'medium', 'large'],
    defaultSize: 'small',
    defaultFreshness: 'hourly',
    fields: [
      { key: 'title', label: 'Title', kind: 'text', maxLength: 40, default: 'Weather' },
      { key: 'entity', label: 'Weather entity', kind: 'entity', domains: ['weather'], required: true },
    ],
    async read(config) {
      const id = String(config.entity);
      const s = await load(ha, id);
      if (!s) throw new Unavailable('Weather entity ' + id + ' not found in Home Assistant');
      const a = s.attributes;
      const num = (k: string) => (typeof a[k] === 'number' ? formatState(String(a[k])) : null);
      const temp = num('temperature');
      const tempUnit = str(a.temperature_unit) ?? '°C';
      const missing = MISSING.indexOf(s.state) >= 0;
      const condition = missing ? null : CONDITIONS[s.state] ?? formatState(s.state);
      const humidity = num('humidity');
      const card: Display = { template: 'value', value: temp, unit: temp === null ? undefined : tempUnit, note: [condition ?? 'No conditions', humidity !== null ? humidity + ' % humidity' : ''].filter(Boolean).join(', ') };
      const withUnit = (k: string, u: string | null): ListRow => ({ label: '', value: num(k), ...(u && num(k) !== null ? { unit: u } : {}) });
      const detail: Display = {
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

/** One energy or power reading with its unit and the period it covers. Home Assistant does not say the period, so the household does. */
export function energyAdapter(ha: HaReader | null): WidgetAdapter {
  return {
    type: 'energy',
    title: 'Energy',
    description: 'One energy or power sensor, with its unit and the period it reports (right now, today, this month, total).',
    templates: ['value', 'list'],
    sizes: ['small', 'medium', 'large'],
    defaultSize: 'small',
    defaultFreshness: 'live',
    fields: [
      { key: 'title', label: 'Title', kind: 'text', maxLength: 40, default: 'Energy' },
      { key: 'entity', label: 'Energy or power sensor', kind: 'entity', domains: ['sensor'], required: true },
      { key: 'period', label: 'Period it reports', kind: 'choice', default: 'today', options: Object.entries(ENERGY_PERIODS).map(([value, label]) => ({ value, label })), help: 'Home Assistant does not say; pick what the sensor measures.' },
    ],
    async read(config) {
      const id = String(config.entity);
      const s = await load(ha, id);
      if (!s) throw new Unavailable('Sensor ' + id + ' not found in Home Assistant');
      const period = ENERGY_PERIODS[String(config.period)] ?? ENERGY_PERIODS.today;
      const unit = unitOf(s);
      // A reading without a unit is not shown as a number: a bare figure could be Wh or kWh.
      const value = unit ? formatState(s.state) : null;
      const note = unit ? period : period + ' (no unit in Home Assistant)';
      const card: Display = { template: 'value', value, ...(value !== null ? { unit } : {}), note };
      const detail: Display = {
        template: 'list',
        rows: [
          { label: 'Reading', value, ...(value !== null ? { unit } : {}) },
          { label: 'Period', value: period },
          { label: 'Sensor', value: cut(nameOf(s, id), 40) },
        ],
      };
      return { title: String(config.title), card, detail };
    },
  };
}

export const HA_TYPES = ['ha-entities', 'weather', 'energy'];

export const homeAssistantAdapters = (ha: HaReader | null): WidgetAdapter[] => [entitiesAdapter(ha), weatherAdapter(ha), energyAdapter(ha)];

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
