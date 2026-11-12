// Editing operations on a layout, pure and immutable: each takes a layout and returns the next one (an equal layout when
// nothing changes). The editor (editor.ts) only calls these, so every rule about rows, apps and widgets is tested here.
import { readConfig, ROW_UNITS, STREAM, UNITS, widgetProblems, type AppTile, type Layout, type RowItem, type SchemeId, type WidgetInstance, type WidgetType, type WidgetsResponse, type WidgetData } from '@sofa/shared';

export type Item = RowItem;
const same = (a: Item, b: Item) => a.kind === b.kind && a.id === b.id;

function swap<T>(list: T[], i: number, delta: number): T[] {
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const out = list.slice();
  out[i] = list[j];
  out[j] = list[i];
  return out;
}

/** `base`, or `base-2`, `base-3` … when taken. */
export function newId(taken: string[], base: string): string {
  let id = base;
  for (let n = 2; taken.indexOf(id) >= 0; n++) id = base + '-' + n;
  return id;
}

// ---- Dashboard rows ----

export function addRow(l: Layout, title = ''): Layout {
  const taken = l.rows.map((r) => r.id);
  let n = l.rows.length + 1;
  while (taken.indexOf('row-' + n) >= 0) n++;
  return { ...l, rows: l.rows.concat({ id: 'row-' + n, title, items: [] }) };
}
export const removeRow = (l: Layout, rowId: string): Layout => ({ ...l, rows: l.rows.filter((r) => r.id !== rowId) });
export const renameRow = (l: Layout, rowId: string, title: string): Layout => ({ ...l, rows: l.rows.map((r) => (r.id === rowId ? { ...r, title } : r)) });
export const moveRow = (l: Layout, rowId: string, delta: number): Layout => ({ ...l, rows: swap(l.rows, l.rows.findIndex((r) => r.id === rowId), delta) });

/** The id of the row an app or widget sits in on the Dashboard, or null. */
export const rowOf = (l: Layout, item: Item): string | null => l.rows.find((r) => r.items.some((i) => same(i, item)))?.id ?? null;

/** True when a row's widgets are wider than the TV's widget row (ROW_UNITS small widgets): the TV cuts off the last one. */
export const rowTooWide = (l: Layout, rowId: string): boolean =>
  (l.rows.find((r) => r.id === rowId)?.items ?? []).reduce((n, i) => n + (i.kind === 'widget' ? UNITS[l.widgets.find((w) => w.id === i.id)?.size ?? 'small'] : 0), 0) > ROW_UNITS;

export const removeFromRows = (l: Layout, item: Item): Layout => ({ ...l, rows: l.rows.map((r) => (r.items.some((i) => same(i, item)) ? { ...r, items: r.items.filter((i) => !same(i, item)) } : r)) });

/** Puts a tile at the end of a row, taking it out of any other (a tile is on the Dashboard at most once). */
export function placeInRow(l: Layout, item: Item, rowId: string): Layout {
  const cleared = removeFromRows(l, item);
  return { ...cleared, rows: cleared.rows.map((r) => (r.id === rowId ? { ...r, items: r.items.concat({ kind: item.kind, id: item.id }) } : r)) };
}

/** Moves a tile one place along its row. */
export function moveItem(l: Layout, item: Item, delta: number): Layout {
  return { ...l, rows: l.rows.map((r) => (r.items.some((i) => same(i, item)) ? { ...r, items: swap(r.items, r.items.findIndex((i) => same(i, item)), delta) } : r)) };
}

/** Shows or hides a tile on the Dashboard. Showing puts it in the first row that already holds tiles of its kind, or a new row. */
export function showOnDashboard(l: Layout, item: Item, on: boolean): Layout {
  if (!on) return removeFromRows(l, item);
  if (rowOf(l, item)) return l;
  const row = l.rows.find((r) => r.items.some((i) => i.kind === item.kind));
  if (row) return placeInRow(l, item, row.id);
  const added = addRow(l, item.kind === 'app' ? 'Apps' : 'Widgets');
  return placeInRow(added, item, added.rows[added.rows.length - 1].id);
}

// ---- Apps ----

/** App IDs this household's TV is known to launch (tv/ launch adapter, publish-layout sample). Anything else is a custom app. */
export const KNOWN_APPS: AppTile[] = [
  { id: 'org.tizen.netflix-app', name: 'Netflix' },
  { id: 'com.samsung.tv.cobalt-yt', name: 'YouTube' },
  { id: 'kIciSQlYEM.plex', name: 'Plex' },
  { id: 'SrAoJxGQUf.ARD', name: 'ARD' },
  { id: 'yPSlpvfeTf.ZDFmediathek', name: 'ZDF' },
  { id: 'mvOizTfhQn.KiKAplayer', name: 'KiKA' },
];

export function addApp(l: Layout, app: AppTile): Layout {
  const id = app.id.trim(), name = app.name.trim();
  if (!id || !name || l.apps.some((a) => a.id === id)) return l;
  return { ...l, apps: l.apps.concat({ id, name }) };
}
export const renameApp = (l: Layout, id: string, name: string): Layout => ({ ...l, apps: l.apps.map((a) => (a.id === id ? { ...a, name } : a)) });
export const moveApp = (l: Layout, id: string, delta: number): Layout => ({ ...l, apps: swap(l.apps, l.apps.findIndex((a) => a.id === id), delta) });

/** Removes an app everywhere: All Apps, the Dashboard and the Kids Mode approval. */
export function removeApp(l: Layout, id: string): Layout {
  const cleared = removeFromRows(l, { kind: 'app', id });
  return { ...cleared, apps: l.apps.filter((a) => a.id !== id), kidsMode: { ...l.kidsMode, apps: l.kidsMode.apps.filter((a) => a !== id) } };
}

// ---- Widgets ----

/** A new instance of a type with its default size, freshness and config. It is not on the Dashboard yet. */
export function addWidget(l: Layout, type: WidgetType): Layout {
  const w: WidgetInstance = { id: newId(l.widgets.map((x) => x.id), type.type), type: type.type, size: type.defaultSize, config: readConfig(type.fields, {}).config, profiles: ['household'], freshness: type.defaultFreshness };
  return { ...l, widgets: l.widgets.concat(w) };
}
export function removeWidget(l: Layout, id: string): Layout {
  return { ...removeFromRows(l, { kind: 'widget', id }), widgets: l.widgets.filter((w) => w.id !== id) };
}
export const moveWidget = (l: Layout, id: string, delta: number): Layout => ({ ...l, widgets: swap(l.widgets, l.widgets.findIndex((w) => w.id === id), delta) });

const patchWidget = (l: Layout, id: string, f: (w: WidgetInstance) => WidgetInstance): Layout => ({ ...l, widgets: l.widgets.map((w) => (w.id === id ? f(w) : w)) });

export const updateWidget = (l: Layout, id: string, patch: Partial<Pick<WidgetInstance, 'size' | 'freshness' | 'profiles'>>): Layout => patchWidget(l, id, (w) => ({ ...w, ...patch }));

/** Sets one config value; `undefined` clears it (a cleared field falls back to its default, or is reported as required). */
export function setConfig(l: Layout, id: string, key: string, value: unknown): Layout {
  return patchWidget(l, id, (w) => {
    const config = { ...w.config };
    if (value === undefined) delete config[key];
    else config[key] = value;
    return { ...w, config };
  });
}

// ---- Appearance ----

export const setBackgroundStream = (l: Layout): Layout => ({ ...l, background: { kind: 'slideshow', album: STREAM } });
export const setBackgroundDayCycle = (l: Layout): Layout => ({ ...l, background: { kind: 'daycycle' } });
export const setScheme = (l: Layout, scheme: SchemeId): Layout => ({ ...l, scheme });
export const setBackgroundColor = (l: Layout, color: string): Layout => ({ ...l, background: { kind: 'color', color } });

// ---- What the preview shows for widgets ----

const same2 = (a: WidgetInstance | undefined, b: WidgetInstance) => !!a && a.type === b.type && a.size === b.size && a.freshness === b.freshness && JSON.stringify(a.config) === JSON.stringify(b.config);

/**
 * The widget data the preview draws. An instance unchanged since the published layout shows the Server's live data; a new or
 * changed one shows what the TV will show once it is published and read; a bad one shows what the TV shows for it.
 */
export function previewWidgets(layout: Layout, published: Layout, types: WidgetType[], live: WidgetsResponse | null): WidgetsResponse {
  const now = live?.serverTime ?? new Date().toISOString();
  const liveById: Record<string, WidgetData> = {};
  for (const w of live?.widgets ?? []) liveById[w.id] = w;
  const widgets: WidgetData[] = [];
  for (const w of layout.widgets) {
    if (w.profiles.indexOf('household') < 0) continue;
    const type = types.find((t) => t.type === w.type);
    const base = { id: w.id, title: type?.title ?? w.type, updatedAt: now, failing: false, staleAfterSeconds: 1e9 };
    if (!type) widgets.push({ ...base, status: 'unavailable', message: 'This widget type is not available', updatedAt: null });
    else if (widgetProblems(w, type).length) widgets.push({ ...base, status: 'unavailable', message: 'Check this widget in Companion', updatedAt: null });
    else if (liveById[w.id] && same2(published.widgets.find((p) => p.id === w.id), w)) widgets.push(liveById[w.id]);
    else widgets.push({ ...base, status: 'empty', message: 'Shows data once published' });
  }
  return { serverTime: now, widgets };
}
