// Widgets (ADR 0003): the display templates Sofa Home can draw, the display model the Server sends for each widget instance,
// the freshness policy, and the config schema Companion builds its forms from. Types live in Server code; Sofa Home knows
// only these templates, so adding one means a new signed package.
// This file also runs on the TV (Chromium 56), so it uses no runtime API newer than ES2017.
import type { Freshness, WidgetSize } from './layout.ts';
import { UUID } from './photos.ts';

/** The fixed set of display templates in Sofa Home 0.x. Changing it needs a Sofa Home release (ADR 0003). */
export const TEMPLATES = ['value', 'list', 'columns', 'agenda', 'photo', 'chart', 'days', 'stack'] as const;
export type TemplateName = (typeof TEMPLATES)[number];

/** The fixed colour names a card or column may be filled with (the waste bins, Session 34). The Server sends the name, Sofa Home owns the colour (tokens.ts `tone*`). */
export const TONES = ['grey', 'brown', 'blue', 'yellow'] as const;
export type Tone = (typeof TONES)[number];

/** A reading as the Server formats it ("21.5", "Closed", "3 h 12 min"). null is a missing reading: Sofa Home shows a dash, never 0. */
export type Reading = string | null;
export const DASH = '\u2013';

export interface ListRow {
  label: string;
  value: Reading;
  unit?: string;
}
export interface Column {
  label: string; // "Tue", "14:00"
  value: Reading;
  unit?: string;
  note?: string; // a second, smaller line, e.g. the low of a forecast
  level?: number; // 0 to 1: draws a bar of that height, e.g. energy per hour; a missing value draws none
  badge?: string; // a bold highlighted line under the note, e.g. the chance of rain "70 %"
  tint?: number; // 0 to 1: tints the column's background with the highlight colour, in proportion (rain)
  tone?: Tone; // draws the column as a tile with a lid in this colour carrying the label
}
export interface AgendaEvent {
  time: string; // "18:00", "All day"
  title: string;
  detail?: string; // a place or note; the Server leaves it out for Kids Mode
  allDay?: boolean; // the `days` template sets an all-day event apart (and lists it first)
}
export interface AgendaDay {
  title: string; // "Today", "Tue 10 Nov"
  subtitle?: string; // `days` only: a second line under the title, e.g. the date number "11"
  today?: boolean; // `days` only: the column is marked
  events: AgendaEvent[];
}
export interface StackPart {
  title?: string; // a section heading, "Next 12 hours"
  display: Leaf;
}

/**
 * What one card (or the full-screen view) shows. The Server does all formatting: Sofa Home only lays out strings.
 *   value    one large reading with its unit and a note (a temperature, today's energy and its period, a status)
 *   list     label and reading rows (several Home Assistant entities, a status page)
 *   columns  a row of short columns, optionally with bars (a forecast, energy per hour)
 *   agenda   days with timed events (the family calendar)
 *   photo    one image from the Server and a caption
 *   chart    one series over time as a line with a soft fill (power over the last hours); `points` are 0 to 1, null is a gap
 *   days     day columns side by side, each with its events (the calendar's week); the same days as `agenda`, laid out as columns
 *   stack    two or three of the above, one over the other, in the full-screen view (hours over days); a card shows the first only
 */
export type Leaf =
  | { template: 'value'; value: Reading; unit?: string; note?: string; lines?: string[]; tone?: Tone } // lines: short rows under the note, the last one bold (a card shows at most ITEM_LIMITS.lines); tone: the whole card is filled with that colour
  | { template: 'list'; rows: ListRow[] }
  | { template: 'columns'; columns: Column[]; note?: string }
  | { template: 'agenda'; days: AgendaDay[] }
  | { template: 'photo'; image: string; caption?: string } // image: a path on the Server, loadable without headers
  | { template: 'chart'; points: (number | null)[]; max?: Reading; min?: Reading; axis?: string[]; now?: boolean; note?: string; bars?: (number | null)[]; barMax?: Reading } // max, min: the labels of the top and bottom of the scale; axis: labels spread under the line, with a grid line at each; now: marks the last point; bars: a second series, one per point (0 to 1, translucent columns behind the line, e.g. rain) on its own scale at the right whose top label is barMax
  | { template: 'days'; days: AgendaDay[] };
export type Display = Leaf | { template: 'stack'; parts: StackPart[] };

/** A card's size, or the full-screen view. */
export type CardSize = WidgetSize | 'full';

/** How many rows, columns or agenda lines (day titles count) each size shows. The Server may send more; the rest is cut. */
export const ITEM_LIMITS: Record<'list' | 'columns' | 'agenda' | 'days' | 'dayEvents' | 'lines', Record<CardSize, number>> = {
  list: { small: 2, medium: 3, large: 6, full: 16 },
  columns: { small: 2, medium: 4, large: 6, full: 12 },
  agenda: { small: 2, medium: 3, large: 6, full: 16 },
  days: { small: 1, medium: 2, large: 3, full: 7 }, // day columns; each shows at most `dayEvents` events, the rest is cut with an ellipsis
  dayEvents: { small: 2, medium: 2, large: 2, full: 4 },
  lines: { small: 2, medium: 3, large: 3, full: 4 }, // the extra rows of a value card
};

/**
 * The freshness policy of a widget instance (its layout `freshness`). The Server reads the source every `refreshSeconds`
 * (a failed read is retried after at most a minute), and Sofa Home marks a card stale once its data is older than
 * `staleAfterSeconds`, or at once when the last read failed or the Server cannot be reached.
 */
export const FRESHNESS_POLICY: Record<Freshness, { refreshSeconds: number; staleAfterSeconds: number }> = {
  live: { refreshSeconds: 30, staleAfterSeconds: 180 },
  hourly: { refreshSeconds: 600, staleAfterSeconds: 7200 },
  daily: { refreshSeconds: 3600, staleAfterSeconds: 30 * 3600 },
};

export type WidgetStatus = 'ok' | 'empty' | 'unavailable';

/** One widget instance as GET /api/widgets returns it. */
export interface WidgetData {
  id: string; // the widget instance's id in the layout
  title: string; // the card's heading
  status: WidgetStatus;
  card?: Display; // with status ok
  detail?: Display; // with status ok: the full-screen view; the card's display when absent
  message?: string; // empty: what there is none of ("No events today"); unavailable: why, for the household to read
  updatedAt: string | null; // ISO time the Server last read the source successfully; null if it never has
  failing: boolean; // the last read failed, so what is shown is older data
  staleAfterSeconds: number; // from the instance's freshness policy
}

/** GET /api/widgets?profile=household|kids. `serverTime` lets Sofa Home age the data with its own clock, whatever the skew. */
export interface WidgetsResponse {
  serverTime: string;
  widgets: WidgetData[];
}

// ---- The config schema: each type's fields, from which Companion builds the instance form ----

/**
 * The entity domains the generic Home Assistant card may show (ADR 0003). Only readings: the card shows the state, its unit
 * and the friendly name, and never offers an action. Weather, calendars and photos have their own types. Cameras, media
 * players, presence (person, device_tracker), alarm panels and anything else are not offered.
 */
export const ENTITY_DOMAINS = ['sensor', 'binary_sensor', 'input_boolean', 'input_number', 'input_select', 'counter', 'light', 'switch', 'cover', 'lock'] as const;
/** At most this many entities on one generic card: the large list's rows. */
export const MAX_CARD_ENTITIES = 6;
export const ENTITY_ID = /^[a-z_]+\.[a-z0-9_]+$/;

interface FieldBase {
  key: string;
  label: string;
  help?: string;
  when?: { key: string; value: string }; // the field applies only while that other field (declared before it) has this value
}
export type ConfigField = FieldBase &
  (
    | { kind: 'text'; maxLength: number; required?: boolean; default?: string }
    | { kind: 'number'; min: number; max: number; integer?: boolean; required?: boolean; default?: number }
    | { kind: 'choice'; options: { value: string; label: string }[]; default: string }
    | { kind: 'boolean'; default: boolean }
    | { kind: 'entity'; domains: string[]; required?: boolean } // one entity id of these domains
    | { kind: 'entities'; domains: string[]; max: number; required?: boolean } // a list of them, in card order
    | { kind: 'album'; required?: boolean } // an Immich album id; Companion lists them from GET /api/photos/albums
  );

/** One entry of GET /api/widget-types, the catalogue Companion builds its widget forms from. */
export interface WidgetType {
  type: string;
  title: string;
  description: string;
  templates: TemplateName[]; // the templates its cards use, for Companion's preview
  sizes: WidgetSize[]; // the sizes it may be placed in
  defaultSize: WidgetSize;
  defaultFreshness: Freshness;
  fields: ConfigField[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isEntity = (v: unknown, domains: string[]) => typeof v === 'string' && ENTITY_ID.test(v) && domains.indexOf(v.split('.')[0]) >= 0;

/** Whether a field applies to a config: a field with `when` only while the field it names has that value (its default if unset). */
export function fieldApplies(f: ConfigField, fields: ConfigField[], cfg: Record<string, unknown>): boolean {
  if (!f.when) return true;
  const k = f.when.key;
  const other = fields.filter((x) => x.key === k)[0];
  return (cfg[k] ?? (other && 'default' in other ? other.default : undefined)) === f.when.value;
}

/** Checks an instance's config against its type's fields and fills in defaults. Keys the type does not declare are dropped. */
export function readConfig(fields: ConfigField[], raw: unknown): { config: Obj; errors: string[] } {
  const config: Obj = {};
  const errors: string[] = [];
  const src = isObj(raw) ? raw : {};
  if (!isObj(raw)) errors.push('config: must be an object');
  for (const f of fields) {
    if (!fieldApplies(f, fields, config)) continue;
    const v = src[f.key];
    const missing = v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
    const err = (msg: string) => errors.push(f.key + ': ' + msg);
    if (missing) {
      if ('default' in f && f.default !== undefined) config[f.key] = f.default;
      else if ('required' in f && f.required) err('is required');
      continue;
    }
    if (f.kind === 'text') {
      if (typeof v !== 'string' || v.length > f.maxLength) err('must be text of at most ' + f.maxLength + ' characters');
    } else if (f.kind === 'number') {
      if (typeof v !== 'number' || !isFinite(v) || v < f.min || v > f.max || (f.integer && Math.floor(v) !== v)) err('must be a ' + (f.integer ? 'whole ' : '') + 'number from ' + f.min + ' to ' + f.max);
    } else if (f.kind === 'choice') {
      if (!f.options.some((o) => o.value === v)) err('must be one of ' + f.options.map((o) => o.value).join(', '));
    } else if (f.kind === 'boolean') {
      if (typeof v !== 'boolean') err('must be true or false');
    } else if (f.kind === 'album') {
      if (typeof v !== 'string' || !UUID.test(v)) err('must be an Immich album id');
    } else if (f.kind === 'entity') {
      if (!isEntity(v, f.domains)) err('must be an entity of ' + f.domains.join(', '));
    } else if (!Array.isArray(v) || v.length > f.max || !v.every((e) => isEntity(e, f.domains)) || new Set(v).size !== v.length) {
      err('must be at most ' + f.max + ' different entities of ' + f.domains.join(', '));
    }
    config[f.key] = v;
  }
  return { config, errors };
}

// ---- Publish-time checks: the Server refuses a layout whose widgets cannot work; Companion shows the same problems while editing ----

/** What is wrong with one widget instance against its type. A type the catalogue does not know is no problem here (ADR 0003: it shows as unavailable). */
export function widgetProblems(w: { size: string; config: unknown }, type: WidgetType | undefined): string[] {
  if (!type) return [];
  const problems = readConfig(type.fields, w.config).errors;
  if ((type.sizes as string[]).indexOf(w.size) < 0) problems.unshift('size: ' + type.title + ' comes in ' + type.sizes.join(', ') + ', not ' + w.size);
  return problems;
}

/** Problems of every widget in a layout, as `widgets[i] (id): problem`. Empty when all instances of known types are fine. */
export function checkWidgets(layout: { widgets: { id: string; type: string; size: string; config: unknown }[] }, types: WidgetType[]): string[] {
  const out: string[] = [];
  layout.widgets.forEach((w, i) => {
    for (const p of widgetProblems(w, types.filter((t) => t.type === w.type)[0])) out.push('widgets[' + i + '] (' + w.id + '): ' + p);
  });
  return out;
}

// ---- Checking display models: the Server checks every adapter result, Sofa Home every widget it receives ----

const SHORT = 40; // labels, readings, units, times
const TEXT = 120; // titles, notes, details, captions, messages
const IMAGE = /^\/(?!\/)[^\s"'\\]{0,511}$/; // a path on the Server: never another host, so the TV cannot be sent elsewhere

/** Returns readable problems with a display model, or an empty list. */
export function validateDisplay(value: unknown, path = 'display'): string[] {
  const errors: string[] = [];
  const err = (p: string, msg: string) => {
    if (errors.length < 20) errors.push(p + ': ' + msg);
  };
  const str = (v: unknown, p: string, max: number, optional = false) => {
    if (optional && v === undefined) return;
    if (typeof v !== 'string' || v.length > max) err(p, 'must be a string of at most ' + max + ' characters');
  };
  const reading = (v: unknown, p: string) => {
    if (v !== null) str(v, p, SHORT);
  };
  const tone = (v: unknown, p: string) => {
    if (v !== undefined && (TONES as readonly unknown[]).indexOf(v) < 0) err(p, 'must be one of ' + TONES.join(', '));
  };
  const list = (v: unknown, p: string, max: number): unknown[] => {
    if (!Array.isArray(v) || v.length > max) {
      err(p, 'must be a list of at most ' + max);
      return [];
    }
    return v;
  };
  const agendaDays = (v: unknown, p0: string) =>
    list(v, p0, 14).forEach((day, i) => {
      const p = p0 + '[' + i + ']';
      if (!isObj(day)) return err(p, 'must be an object');
      str(day.title, p + '.title', SHORT);
      str(day.subtitle, p + '.subtitle', SHORT, true);
      if (day.today !== undefined && typeof day.today !== 'boolean') err(p + '.today', 'must be true or false');
      list(day.events, p + '.events', 30).forEach((e, j) => {
        const q = p + '.events[' + j + ']';
        if (!isObj(e)) return err(q, 'must be an object');
        str(e.time, q + '.time', SHORT);
        str(e.title, q + '.title', TEXT);
        str(e.detail, q + '.detail', TEXT, true);
        if (e.allDay !== undefined && typeof e.allDay !== 'boolean') err(q + '.allDay', 'must be true or false');
      });
    });
  const one = (d: Obj, path: string, nested: boolean): void => {
  if (d.template === 'value') {
    reading(d.value, path + '.value');
    str(d.unit, path + '.unit', SHORT, true);
    str(d.note, path + '.note', TEXT, true);
    tone(d.tone, path + '.tone');
    if (d.lines !== undefined) list(d.lines, path + '.lines', 4).forEach((v, i) => str(v, path + '.lines[' + i + ']', TEXT));
  } else if (d.template === 'list') {
    list(d.rows, path + '.rows', 24).forEach((r, i) => {
      const p = path + '.rows[' + i + ']';
      if (!isObj(r)) return err(p, 'must be an object');
      str(r.label, p + '.label', SHORT);
      reading(r.value, p + '.value');
      str(r.unit, p + '.unit', SHORT, true);
    });
  } else if (d.template === 'columns') {
    str(d.note, path + '.note', TEXT, true);
    list(d.columns, path + '.columns', 24).forEach((c, i) => {
      const p = path + '.columns[' + i + ']';
      if (!isObj(c)) return err(p, 'must be an object');
      str(c.label, p + '.label', SHORT);
      reading(c.value, p + '.value');
      str(c.unit, p + '.unit', SHORT, true);
      str(c.note, p + '.note', SHORT, true);
      str(c.badge, p + '.badge', SHORT, true);
      if (c.level !== undefined && (typeof c.level !== 'number' || !(c.level >= 0 && c.level <= 1))) err(p + '.level', 'must be a number from 0 to 1');
      if (c.tint !== undefined && (typeof c.tint !== 'number' || !(c.tint >= 0 && c.tint <= 1))) err(p + '.tint', 'must be a number from 0 to 1');
      tone(c.tone, p + '.tone');
    });
  } else if (d.template === 'agenda' || d.template === 'days') {
    agendaDays(d.days, path + '.days');
  } else if (d.template === 'photo') {
    if (typeof d.image !== 'string' || !IMAGE.test(d.image)) err(path + '.image', 'must be a path on the Server, like /api/media/1.jpg');
    str(d.caption, path + '.caption', TEXT, true);
  } else if (d.template === 'chart') {
    list(d.points, path + '.points', 96).forEach((v, i) => {
      if (v !== null && (typeof v !== 'number' || !(v >= 0 && v <= 1))) err(path + '.points[' + i + ']', 'must be a number from 0 to 1, or null for a gap');
    });
    reading(d.max ?? null, path + '.max');
    reading(d.min ?? null, path + '.min');
    if (d.axis !== undefined) list(d.axis, path + '.axis', 8).forEach((v, i) => str(v, path + '.axis[' + i + ']', SHORT));
    if (d.now !== undefined && typeof d.now !== 'boolean') err(path + '.now', 'must be true or false');
    str(d.note, path + '.note', TEXT, true);
    if (d.bars !== undefined) {
      if (!Array.isArray(d.bars) || d.bars.length !== (Array.isArray(d.points) ? d.points.length : -1)) err(path + '.bars', 'must be a list as long as points');
      else d.bars.forEach((v, i) => {
        if (v !== null && (typeof v !== 'number' || !(v >= 0 && v <= 1))) err(path + '.bars[' + i + ']', 'must be a number from 0 to 1, or null for none');
      });
    }
    if (d.barMax !== undefined) reading(d.barMax, path + '.barMax');
  } else if (d.template === 'stack' && !nested) {
    const parts = list(d.parts, path + '.parts', 3);
    if (Array.isArray(d.parts) && !d.parts.length) err(path + '.parts', 'must hold at least one display');
    parts.forEach((part, i) => {
      const p = path + '.parts[' + i + ']';
      if (!isObj(part)) return err(p, 'must be an object');
      str(part.title, p + '.title', SHORT, true);
      if (!isObj(part.display)) return err(p + '.display', 'must be an object');
      if (part.display.template === 'stack') return err(p + '.display', 'a stack cannot hold a stack');
      one(part.display, p + '.display', true);
    });
  } else err(path + '.template', 'must be one of ' + TEMPLATES.join(', '));
  };
  if (!isObj(value)) return [path + ': must be an object'];
  one(value, path, false);
  return errors;
}

/** Checks one widget as Sofa Home receives it. Sofa Home shows an invalid one as unavailable and the rest as usual. */
export function validateWidgetData(value: unknown): string[] {
  if (!isObj(value)) return ['widget: must be an object'];
  const w = value;
  const errors: string[] = [];
  if (typeof w.id !== 'string' || !w.id) errors.push('id: must be a non-empty string');
  if (typeof w.title !== 'string' || w.title.length > TEXT) errors.push('title: must be a string of at most ' + TEXT + ' characters');
  if (w.status !== 'ok' && w.status !== 'empty' && w.status !== 'unavailable') errors.push('status: must be ok, empty or unavailable');
  if (w.status === 'ok') errors.push.apply(errors, validateDisplay(w.card, 'card'));
  if (w.detail !== undefined) errors.push.apply(errors, validateDisplay(w.detail, 'detail'));
  if (w.message !== undefined && (typeof w.message !== 'string' || w.message.length > TEXT)) errors.push('message: must be a string of at most ' + TEXT + ' characters');
  if (w.updatedAt !== null && (typeof w.updatedAt !== 'string' || isNaN(Date.parse(w.updatedAt)))) errors.push('updatedAt: must be an ISO time or null');
  if (typeof w.failing !== 'boolean') errors.push('failing: must be true or false');
  if (typeof w.staleAfterSeconds !== 'number' || !(w.staleAfterSeconds > 0)) errors.push('staleAfterSeconds: must be a positive number');
  return errors;
}
