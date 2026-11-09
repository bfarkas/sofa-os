// The shell of Sofa Home without the DOM: tabs, what each tab shows, and focus. view.ts draws it, main.ts feeds it keys.
//   Dashboard: the layout's rows, plus an All Apps tile that opens the Apps tab.
//   Apps: every app in household order (All Apps).   Widgets: every widget instance as its card (cards.ts).
// Focus order: a bar on top (Dashboard, Apps, Widgets, Settings), then the tab's rows. Focusing a tab shows it. Down goes into
// the first tile, Back comes back to the bar, and Back on the Apps or Widgets tab goes to Dashboard. Overlays (Settings) sit
// on top and Back closes them first.
// Kids Mode is a screen of its own over the same shell: large tiles for the approved apps only, or the Done Screen. Back never
// leaves it; only the PIN does (main.ts asks the Server). The Server decides which screen shows (kids.ts `screenFor`).
// Arranging widgets (Session 16): a long press on a widget asks for its context menu (Move, Remove from Dashboard on the
// Dashboard; Add to Dashboard in the Widgets tab for one not there). Move lifts it: left and right reorder it in its row, OK
// places it as a `move` operation for the Server, Back cancels. A long press anywhere else is a select, as before.
import { applyOp, type Layout, type LayoutOp, type PhotoAlbum, type Profile, type WidgetSize } from '@sofa/shared';
import { createFocus } from './focus.ts';
import type { RemoteEvent } from './keys.ts';
import type { Screen } from './kids.ts';

export type Tab = 'dashboard' | 'apps' | 'widgets';
export const TABS: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'apps', label: 'Apps' },
  { id: 'widgets', label: 'Widgets' },
];
/** The profile Sofa Home shows. Session 09 makes it switchable; today only widgets are filtered by it. */
export const PROFILE: Profile = 'household';
const UNITS: Record<WidgetSize, number> = { small: 1, medium: 2, large: 3 };
const ROW_UNITS = 6; // a Widgets-tab row holds six units, matching SIZES.widgetSmall/Medium/Large
const APP_COLUMNS = 7;

export interface Tile {
  id: string; // focus id: app:<app id>, widget:<widget id>, album:<album id> (Kids Mode) or allapps
  kind: 'app' | 'widget' | 'allapps' | 'kids' | 'album';
  label: string;
  detail: string; // may hold a line break
  size?: WidgetSize;
  unavailable?: boolean;
  lifted?: boolean; // the widget being moved
}
export interface Section {
  title: string;
  tiles: Tile[]; // one visual row, and one row of the focus grid
}
export interface View {
  mode: 'signin' | 'home' | 'kids' | 'done';
  tab: Tab;
  sections: Section[];
  message: string; // shown instead of the sections when there is nothing to show
}

export type Activation =
  | { type: 'launch'; appId: string }
  | { type: 'settings' }
  | { type: 'select'; id: string } // OK on an overlay row
  | { type: 'digit'; digit: string } // a number key while an overlay (the PIN pad) is open
  | { type: 'kids-enter' }
  | { type: 'kids-unavailable' }
  | { type: 'pin' } // the Adults button: open the PIN pad
  | { type: 'album'; id: string; name: string } // OK on an approved album in Kids Mode: its slideshow
  | { type: 'widget'; id: string; title: string } // OK on a widget: its full-screen view (title until the Server names it)
  | { type: 'menu'; widget: string; title: string; items: MenuItem[] } // a long press on a widget: its context menu
  | { type: 'op'; op: LayoutOp }; // OK on a lifted widget that moved: send this to the Server

export type MenuItem = 'move' | 'remove' | 'add';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const BAR = TABS.map((t) => 'tab:' + t.id).concat('settings');

const KIDS_COLUMNS = 5;

/** Kids Mode: the approved apps, in the approved order, then the approved albums the Server listed, five large tiles to a row. Nothing else. */
export function kidsSections(layout: Layout, albums: PhotoAlbum[] = []): Section[] {
  const byId: Record<string, string> = {};
  for (const a of layout.apps) byId[a.id] = a.name;
  const tiles: Tile[] = layout.kidsMode.apps.filter((id) => byId[id] !== undefined).map((id) => ({ id: 'app:' + id, kind: 'app' as const, label: byId[id], detail: '' }));
  const approved = layout.kidsMode.albums || [];
  for (const a of albums) if (approved.indexOf(a.id) >= 0) tiles.push({ id: 'album:' + a.id, kind: 'album', label: a.name, detail: a.count + (a.count === 1 ? ' photo' : ' photos') }); // the Server lists only approved ones; this checks again
  const out: Section[] = [];
  for (let i = 0; i < tiles.length; i += KIDS_COLUMNS) out.push({ title: '', tiles: tiles.slice(i, i + KIDS_COLUMNS) });
  return out;
}

/** The sections of one tab. `unavailable` holds app ids that failed to launch; `kidsTile` is whether Kids Mode can be entered. */
export function sectionsFor(layout: Layout, tab: Tab, unavailable: Set<string>, profile: Profile = PROFILE, kidsTile = true): Section[] {
  const apps: Record<string, Tile> = {};
  for (const a of layout.apps) apps[a.id] = { id: 'app:' + a.id, kind: 'app', label: a.name, detail: unavailable.has(a.id) ? 'Unavailable' : '', unavailable: unavailable.has(a.id) };
  const shown = layout.widgets.filter((w) => w.profiles.indexOf(profile) >= 0);
  const placed: Record<string, boolean> = {};
  const widgetTile = (w: (typeof shown)[number], detail: string): Tile => ({ id: 'widget:' + w.id, kind: 'widget', label: cap(w.type), detail, size: w.size });

  if (tab === 'apps') {
    const out: Section[] = [];
    const tiles = layout.apps.map((a) => apps[a.id]);
    for (let i = 0; i < tiles.length; i += APP_COLUMNS) out.push({ title: i ? '' : 'All Apps', tiles: tiles.slice(i, i + APP_COLUMNS) });
    return out;
  }
  if (tab === 'widgets') {
    for (const r of layout.rows) for (const i of r.items) if (i.kind === 'widget') placed[i.id] = true;
    const out: Section[] = [];
    let used = ROW_UNITS;
    for (const w of shown) {
      if (used + UNITS[w.size] > ROW_UNITS) {
        out.push({ title: out.length ? '' : 'Widgets', tiles: [] });
        used = 0;
      }
      used += UNITS[w.size];
      out[out.length - 1].tiles.push(widgetTile(w, placed[w.id] ? 'On Dashboard' : 'Not on Dashboard'));
    }
    return out;
  }
  // The Kids Mode tile leads the Dashboard: one selection opens the child profile.
  const out: Section[] = [{ title: '', tiles: [{ id: 'kids', kind: 'kids', label: 'Kids Mode', detail: kidsTile ? '' : 'Not available right now', unavailable: !kidsTile }] }];
  for (const r of layout.rows) {
    const tiles: Tile[] = [];
    for (const i of r.items) {
      const w = i.kind === 'widget' ? shown.filter((x) => x.id === i.id)[0] : null;
      if (i.kind === 'app' && apps[i.id]) tiles.push(apps[i.id]);
      else if (w) tiles.push(widgetTile(w, ''));
    }
    if (tiles.length) out.push({ title: r.title, tiles });
  }
  const more: Tile = { id: 'allapps', kind: 'allapps', label: 'All Apps', detail: layout.apps.length + ' apps' };
  const last = out.filter((s) => s.tiles.some((t) => t.kind === 'app')).pop();
  if (last) last.tiles.push(more);
  else out.push({ title: '', tiles: [more] });
  return out;
}

const EMPTY: Record<Tab, string> = {
  dashboard: '',
  apps: 'No apps yet. Add apps in Companion.',
  widgets: 'No widgets yet. Add widgets in Companion.',
};

const two = (n: number) => (n < 10 ? '0' : '') + n;
export const clockText = (d: Date) => two(d.getHours()) + ':' + two(d.getMinutes());
export const dateText = (d: Date) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()] + ' ' + d.getDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];

export interface ShellHooks {
  onView(view: View): void; // the sections, tab or mode changed: draw again
  onFocus(id: string | null): void; // highlight this id
}

export function createShell(hooks: ShellHooks) {
  let layout: Layout | null = null;
  let tab: Tab = 'dashboard';
  let signedIn = false; // false: the sign-in screen
  let screen: Screen = 'household';
  let kidsTile = true;
  let albums: PhotoAlbum[] = [];
  let unavailable = new Set<string>();
  let lift: { widget: string; layout: Layout; from: string } | null = null; // the widget being moved, the layout as it shows now, and its row's tiles at the start

  const mode = (): View['mode'] => (!signedIn ? 'signin' : screen === 'household' ? 'home' : screen);
  const sections = () => {
    if (!layout || !signedIn) return [];
    if (screen === 'kids') return kidsSections(layout, albums);
    if (screen !== 'household') return [];
    const out = sectionsFor(lift ? lift.layout : layout, tab, unavailable, PROFILE, kidsTile);
    if (lift) for (const s of out) for (const t of s.tiles) if (t.id === 'widget:' + lift.widget) t.lifted = true;
    return out;
  };
  const rowOf = (l: Layout, widget: string) => l.rows.filter((r) => r.items.some((i) => i.kind === 'widget' && i.id === widget))[0];
  const indexIn = (l: Layout, widget: string) => {
    const r = rowOf(l, widget);
    return r ? r.items.map((i) => i.kind + ':' + i.id).indexOf('widget:' + widget) : -1;
  };
  const shows = (l: Layout) => (i: { kind: string; id: string }) => (i.kind === 'app' ? l.apps.some((a) => a.id === i.id) : l.widgets.some((w) => w.id === i.id && w.profiles.indexOf(PROFILE) >= 0));
  const tilesOf = (l: Layout, widget: string) => rowOf(l, widget).items.filter(shows(l)).map((i) => i.kind + ':' + i.id).join();

  // One step left or right past the next tile that shows (an app, or a widget of this profile), so hidden ones never block it.
  function shift(dir: 'left' | 'right'): void {
    if (!lift) return;
    const l = lift.layout, row = rowOf(l, lift.widget);
    if (!row) return;
    const at = indexIn(l, lift.widget);
    let j = at;
    do j += dir === 'left' ? -1 : 1;
    while (j >= 0 && j < row.items.length && !shows(l)(row.items[j]));
    if (j < 0 || j >= row.items.length) return;
    const next = applyOp(l, { op: 'move', widget: lift.widget, index: j });
    if (next) lift.layout = next;
    rebuild();
  }

  /** The context menu a long press on the focused tile opens, or null where a long press is a select. */
  function menu(): Activation | null {
    const id = focus.current();
    if (!layout || mode() !== 'home' || focus.depth() > 1 || !id || id.indexOf('widget:') !== 0) return null;
    const widget = id.slice(7);
    const w = layout.widgets.filter((x) => x.id === widget)[0];
    const placed = !!rowOf(layout, widget);
    const title = w ? cap(w.type) : '';
    if (tab === 'dashboard' && placed) return { type: 'menu', widget, title, items: ['move', 'remove'] };
    if (tab === 'widgets' && !placed) return { type: 'menu', widget, title, items: ['add'] };
    return null;
  }

  /** While a widget is lifted the remote moves it: left and right reorder, OK places, Back cancels. */
  function liftKey(e: RemoteEvent): Activation | null {
    if (!lift) return null;
    if (e.key === 'left' || e.key === 'right') shift(e.key);
    else if (e.key === 'ok' || e.key === 'back') {
      const done = lift;
      lift = null;
      if (e.key === 'ok' && tilesOf(done.layout, done.widget) !== done.from) {
        layout = done.layout; // shown at once; main.ts sends it and puts the Server's answer in its place
        rebuild();
        return { type: 'op', op: { op: 'move', widget: done.widget, index: indexIn(done.layout, done.widget) } };
      }
      rebuild();
    }
    return null;
  }
  const focus = createFocus((id) => {
    if (id && id.indexOf('tab:') === 0 && focus.depth() === 1 && id.slice(4) !== tab) {
      tab = id.slice(4) as Tab;
      rebuild();
    }
    hooks.onFocus(id);
  });

  function rebuild(): void {
    const m = mode();
    const grid = sections().map((s) => s.tiles.map((t) => t.id));
    if (m === 'signin') focus.setBase([['settings']]);
    else if (m === 'done') focus.setBase([['done:adults']]);
    else focus.setBase([m === 'kids' ? ['kids:exit'] : BAR].concat(grid), { bar: true });
    hooks.onView(view());
  }

  function view(): View {
    const s = sections();
    const m = mode();
    const waiting = !layout ? 'Waiting for the first layout from the Server.' : '';
    return { mode: m, tab, sections: s, message: m === 'home' ? (layout ? (s.length ? '' : EMPTY[tab]) : waiting) : m === 'kids' ? (s.length ? '' : layout ? 'No apps are approved yet. Ask a grown-up.' : waiting) : '' };
  }

  function showTab(next: Tab, id?: string): void {
    tab = next;
    rebuild();
    if (!id || !focus.focus(id)) focus.focus('tab:' + next); // a tile that is gone falls back to the tab itself
  }

  /** Back's meaning for the shell: true if it did something. */
  function back(): boolean {
    if (focus.pop()) return true;
    const id = focus.current();
    if (mode() !== 'home' || !id) return false; // Kids Mode and the Done Screen: Back does nothing
    if (BAR.indexOf(id) < 0) return focus.focus('tab:' + tab);
    return tab !== 'dashboard' && focus.focus('tab:dashboard');
  }

  function activate(): Activation | null {
    const id = focus.current();
    if (!id) return null;
    if (id === 'settings') return { type: 'settings' };
    if (focus.depth() > 1) return { type: 'select', id };
    if (id === 'kids') return { type: kidsTile ? 'kids-enter' : 'kids-unavailable' };
    if (id === 'kids:exit' || id === 'done:adults') return { type: 'pin' };
    if (id.indexOf('tab:') === 0) focus.move('down');
    else if (id === 'allapps') {
      const first = layout && layout.apps[0];
      showTab('apps', first ? 'app:' + first.id : undefined);
    } else if (id.indexOf('app:') === 0) return { type: 'launch', appId: id.slice(4) };
    else if (id.indexOf('album:') === 0) {
      const a = albums.filter((x) => 'album:' + x.id === id)[0];
      return a ? { type: 'album', id: a.id, name: a.name } : null;
    }
    else if (id.indexOf('widget:') === 0) {
      const w = layout && layout.widgets.filter((x) => 'widget:' + x.id === id)[0];
      return { type: 'widget', id: id.slice(7), title: w ? cap(w.type) : '' };
    }
    return null;
  }

  // Where a screen starts: the tab, the first approved app, or the Adults button.
  function firstId(): string {
    if (screen === 'done') return 'done:adults';
    if (screen === 'kids') return (sections()[0] && sections()[0].tiles[0].id) || 'kids:exit';
    return 'tab:' + tab;
  }

  rebuild();
  return {
    focus,
    setMode(m: 'signin' | 'home'): void {
      const changed = (m === 'home') !== signedIn;
      signedIn = m === 'home';
      rebuild();
      if (changed) focus.focus(signedIn ? firstId() : 'settings'); // a new screen starts at its top
    },
    /** Which screen the signed-in TV shows: the household Dashboard, Kids Mode or the Done Screen. */
    setScreen(next: Screen): void {
      if (next === screen) return;
      screen = next;
      lift = null;
      rebuild();
      focus.focus(firstId());
    },
    /** Whether the Kids Mode tile can be used; false while the Server is unreachable. */
    setKidsTile(available: boolean): void {
      if (available === kidsTile) return;
      kidsTile = available;
      rebuild();
    },
    /** The albums Kids Mode may open, as the Server listed them. */
    setAlbums(list: PhotoAlbum[]): void {
      if (JSON.stringify(list) === JSON.stringify(albums)) return;
      albums = list;
      rebuild();
    },
    /** The layout from the Server. A widget being moved keeps moving on the layout it was lifted from; the Server refuses the move if that is stale. */
    setLayout(l: Layout | null): void {
      layout = l;
      if (!l) lift = null;
      rebuild();
    },
    /** Move from the context menu: lifts the widget on the Dashboard. False if it is not there. */
    lift(widget: string): boolean {
      if (!layout || mode() !== 'home' || tab !== 'dashboard' || indexIn(layout, widget) < 0) return false;
      lift = { widget, layout, from: tilesOf(layout, widget) };
      rebuild();
      focus.focus('widget:' + widget);
      return true;
    },
    lifting: () => lift !== null,
    /** An app that failed to launch shows as unavailable; one that launched shows as normal again. */
    setUnavailable(appId: string, value: boolean): void {
      if (unavailable.has(appId) === value) return;
      unavailable = new Set(unavailable);
      if (value) unavailable.add(appId);
      else unavailable.delete(appId);
      rebuild();
    },
    view,
    /** Arrows move, Back goes back, OK activates. A long OK on a widget asks for its menu; a lifted widget takes the keys. */
    key(e: RemoteEvent): Activation | null {
      if (lift) return liftKey(e);
      if (e.key === 'ok') return (e.long && menu()) || activate();
      if (e.key === 'digit') return focus.depth() > 1 && e.digit !== undefined ? { type: 'digit', digit: e.digit } : null;
      if (e.key === 'back') back();
      else focus.move(e.key);
      return null;
    },
    /** The Phone Remote's Menu: the focused widget's context menu, or null where there is none. Never selects, unlike a long OK. */
    menuKey: (): Activation | null => (lift ? null : menu()),
    /** Where focus is, for restoring it after the app was away. Null while an overlay is open. */
    where(): { tab: Tab; id: string } | null {
      const id = focus.current();
      return id && focus.depth() === 1 ? { tab, id } : null;
    },
    restore(w: { tab: Tab; id: string }): void {
      if (focus.depth() !== 1) return;
      if (screen === 'kids') focus.focus(w.id);
      else if (screen === 'household' && signedIn) showTab(w.tab, w.id);
    },
  };
}

export type Shell = ReturnType<typeof createShell>;
