// The layout schema: what the Server publishes as numbered revisions and Sofa Home renders.
// This file also runs on the TV (Chromium 56), so it uses no runtime API newer than ES2017.

/** Bump only with a matching Sofa Home release: the TV rejects any other schema and keeps its last snapshot. */
export const LAYOUT_SCHEMA = 1;
export const WIDGET_SIZES = ['small', 'medium', 'large'] as const;
export const PROFILES = ['household', 'kids'] as const;
/** How old a widget's data may get before its card shows as stale; the thresholds are FRESHNESS_POLICY in widgets.ts. */
export const FRESHNESS = ['live', 'hourly', 'daily'] as const;

export type WidgetSize = (typeof WIDGET_SIZES)[number];
export type Profile = (typeof PROFILES)[number];
export type Freshness = (typeof FRESHNESS)[number];

export interface AppTile {
  id: string; // Tizen app ID, e.g. org.tizen.netflix-app
  name: string;
}

export interface WidgetInstance {
  id: string;
  type: string; // a type from the Server's widget catalogue (ADR 0003)
  size: WidgetSize;
  config: Record<string, unknown>; // checked by the type's adapter on the Server, not here
  profiles: Profile[]; // the profiles that show this widget
  freshness: Freshness;
}

/** A tile on the Dashboard: an app from `apps` or a widget from `widgets`, by id. */
export interface RowItem {
  kind: 'app' | 'widget';
  id: string;
}

export interface Row {
  id: string;
  title: string; // may be empty
  items: RowItem[];
}

export type Background =
  | { kind: 'color'; color: string } // #rrggbb
  | { kind: 'image'; image: string } // "<album id>/<asset id>": one Immich photo, from an album (Session 14)
  | { kind: 'slideshow'; album: string }; // an Immich album id: its photos fade through behind the Dashboard (Session 14)

export interface KidsModeSettings {
  apps: string[]; // approved app ids, in tile order
  dailyMinutes: number; // the Watch Allowance
  albums?: string[]; // Immich album ids approved for Kids Mode (Session 14); absent means none
}

export interface Layout {
  schema: typeof LAYOUT_SCHEMA;
  apps: AppTile[]; // All Apps, in household order
  widgets: WidgetInstance[]; // every widget instance (the Widgets tab); rows place some on the Dashboard
  rows: Row[]; // Dashboard rows, top to bottom
  background: Background;
  kidsMode: KidsModeSettings;
}

/** One published revision, as GET /api/snapshot returns it. */
export interface Snapshot {
  revision: number;
  publishedAt: string; // ISO time
  layout: Layout;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const COLOR = /^#[0-9a-fA-F]{6}$/;
const MAX_CONFIG = 4096; // characters of JSON per widget

/** Returns readable problems with a layout, or an empty list when it is valid. */
export function validateLayout(value: unknown): string[] {
  const errors: string[] = [];
  const err = (path: string, msg: string) => {
    if (errors.length < 50) errors.push(path + ': ' + msg);
  };
  const str = (v: unknown, path: string, max: number, allowEmpty = false) => {
    if (typeof v !== 'string' || v.length > max || (!allowEmpty && !v.trim())) err(path, 'must be a ' + (allowEmpty ? '' : 'non-empty ') + 'string of at most ' + max + ' characters');
  };
  const list = (v: unknown, path: string, max: number): unknown[] => {
    if (!Array.isArray(v)) {
      err(path, 'must be a list');
      return [];
    }
    if (v.length > max) err(path, 'must have at most ' + max + ' entries');
    return v;
  };
  const oneOf = (v: unknown, allowed: readonly string[], path: string) => {
    if (allowed.indexOf(v as string) < 0) err(path, 'must be one of ' + allowed.join(', '));
  };
  const unique = (seen: Set<unknown>, v: unknown, path: string) => {
    if (seen.has(v)) err(path, 'duplicate ' + JSON.stringify(v));
    seen.add(v);
  };

  if (!isObj(value)) return ['layout: must be an object'];
  if (value.schema !== LAYOUT_SCHEMA) err('schema', 'must be ' + LAYOUT_SCHEMA);

  const appIds = new Set<unknown>();
  list(value.apps, 'apps', 200).forEach((a, i) => {
    const p = 'apps[' + i + ']';
    if (!isObj(a)) return err(p, 'must be an object');
    str(a.id, p + '.id', 128);
    unique(appIds, a.id, p + '.id');
    str(a.name, p + '.name', 80);
  });

  const widgetIds = new Set<unknown>();
  list(value.widgets, 'widgets', 100).forEach((w, i) => {
    const p = 'widgets[' + i + ']';
    if (!isObj(w)) return err(p, 'must be an object');
    str(w.id, p + '.id', 64);
    unique(widgetIds, w.id, p + '.id');
    str(w.type, p + '.type', 64);
    oneOf(w.size, WIDGET_SIZES, p + '.size');
    oneOf(w.freshness, FRESHNESS, p + '.freshness');
    if (!isObj(w.config)) err(p + '.config', 'must be an object');
    else if (JSON.stringify(w.config).length > MAX_CONFIG) err(p + '.config', 'must be at most ' + MAX_CONFIG + ' characters of JSON');
    const profiles = new Set<unknown>();
    list(w.profiles, p + '.profiles', PROFILES.length).forEach((v, j) => {
      oneOf(v, PROFILES, p + '.profiles[' + j + ']');
      unique(profiles, v, p + '.profiles[' + j + ']');
    });
  });

  const rowIds = new Set<unknown>();
  const placed = new Set<unknown>(); // a tile appears on the Dashboard at most once
  list(value.rows, 'rows', 20).forEach((r, i) => {
    const p = 'rows[' + i + ']';
    if (!isObj(r)) return err(p, 'must be an object');
    str(r.id, p + '.id', 64);
    unique(rowIds, r.id, p + '.id');
    str(r.title, p + '.title', 80, true);
    list(r.items, p + '.items', 50).forEach((item, j) => {
      const q = p + '.items[' + j + ']';
      if (!isObj(item)) return err(q, 'must be an object');
      if (item.kind !== 'app' && item.kind !== 'widget') return err(q + '.kind', 'must be one of app, widget');
      if (typeof item.id !== 'string' || !(item.kind === 'app' ? appIds : widgetIds).has(item.id)) return err(q + '.id', 'unknown ' + item.kind + ' ' + JSON.stringify(item.id));
      unique(placed, item.kind + ':' + item.id, q);
    });
  });

  const bg = value.background;
  if (!isObj(bg)) err('background', 'must be an object');
  else if (bg.kind === 'color') {
    if (typeof bg.color !== 'string' || !COLOR.test(bg.color)) err('background.color', 'must be #rrggbb');
  } else if (bg.kind === 'image') str(bg.image, 'background.image', 128);
  else if (bg.kind === 'slideshow') str(bg.album, 'background.album', 128);
  else err('background.kind', 'must be one of color, image, slideshow');

  const kids = value.kidsMode;
  if (!isObj(kids)) err('kidsMode', 'must be an object');
  else {
    const m = kids.dailyMinutes;
    if (typeof m !== 'number' || !Number.isInteger(m) || m < 0 || m > 1440) err('kidsMode.dailyMinutes', 'must be a whole number from 0 to 1440');
    const approved = new Set<unknown>();
    list(kids.apps, 'kidsMode.apps', 200).forEach((id, i) => {
      const p = 'kidsMode.apps[' + i + ']';
      if (typeof id !== 'string' || !appIds.has(id)) return err(p, 'unknown app ' + JSON.stringify(id));
      unique(approved, id, p);
    });
    if (kids.albums !== undefined) {
      const albums = new Set<unknown>();
      list(kids.albums, 'kidsMode.albums', 100).forEach((id, i) => {
        str(id, 'kidsMode.albums[' + i + ']', 64);
        unique(albums, id, 'kidsMode.albums[' + i + ']');
      });
    }
  }
  return errors;
}

/** Validates a snapshot as Sofa Home receives it, layout included. */
export function validateSnapshot(value: unknown): string[] {
  if (!isObj(value)) return ['snapshot: must be an object'];
  const errors: string[] = [];
  const r = value.revision;
  if (typeof r !== 'number' || !Number.isInteger(r) || r < 1) errors.push('revision: must be a positive whole number');
  if (typeof value.publishedAt !== 'string') errors.push('publishedAt: must be a string');
  return errors.concat(validateLayout(value.layout));
}
