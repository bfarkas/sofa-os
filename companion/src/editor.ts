// Companion's Layout tab (/edit, Session 47): Dashboard, Apps, Widgets and Look over one working copy of the layout, with a
// 16:9 preview (side by side on a wide screen, full screen behind the Preview button on a phone) made by Sofa Home's own drawing code (preview.ts). The working copy is saved to a Server draft as you go and
// published through the Session 05 API. Every change goes through edit.ts; this file is forms and plumbing.
import { checkWidgets, DEFAULT_SCREENSAVER_MINUTES, SCREENSAVER_MINUTES, fieldApplies, FRESHNESS, ROW_UNITS, SCHEME_IDS, SCHEMES, STREAM, validateLayout, widgetProblems, type ConfigField, type Draft, type InstalledApp, type KidsStatus, type Layout, type Snapshot, type TvAppsReport, type WidgetInstance, type WidgetType, type WidgetsResponse } from '@sofa/shared';
import * as E from './edit.ts';
import type { PreviewApi } from './preview.ts';

export type Call = <T>(method: string, url: string, body?: unknown) => Promise<T>;
type Tab = 'dashboard' | 'apps' | 'widgets' | 'look';
type Child = Node | string | null | false | undefined;

export const DRAFT_KEY = 'sofa.companion.draft';
const TABS: [Tab, string][] = [['dashboard', 'Dashboard'], ['apps', 'Apps'], ['widgets', 'Widgets'], ['look', 'Look']];
const SWATCHES = ['#f6f1e7', '#e4ebe1', '#dfe6ee', '#efe2d3', '#3d4a41', '#26313d'];

/** Element builder. Props are set after the children go in, so a select's value finds its options. */
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> | null, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const k of kids) if (k) el.append(k);
  for (const [key, v] of Object.entries(props ?? {})) {
    if (key.startsWith('on')) el.addEventListener(key.slice(2), v as EventListener);
    else if (/^(aria-|data-|inputmode$|autocapitalize$|spellcheck$)/.test(key)) el.setAttribute(key, String(v));
    else (el as unknown as Record<string, unknown>)[key === 'class' ? 'className' : key === 'for' ? 'htmlFor' : key] = v;
  }
  return el;
}
const btn = (label: string, onclick: () => void, cls = 'small', extra: Record<string, unknown> = {}) => h('button', { type: 'button', class: cls, onclick, ...extra }, label);
const option = (value: string, label: string) => h('option', { value }, label);
const select = (options: [string, string][], value: string, onchange: (v: string) => void, extra: Record<string, unknown> = {}) =>
  h('select', { value, onchange: (e: Event) => onchange((e.target as HTMLSelectElement).value), ...extra }, ...options.map(([v, l]) => option(v, l)));

export function startEditor(call: Call): void {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const frame = $<HTMLIFrameElement>('preview');
  const wrap = $('preview-wrap');
  const pane = $('ed-pane');
  const notice = $('ed-notice');
  const bar = $('ed-bar');
  if (pane.dataset.started) return;
  pane.dataset.started = '1';

  let layout: Layout, published: Layout; // the working copy, and the revision it started from
  let base = 0, publishedAt = '';
  let reported: InstalledApp[] = [], types: WidgetType[] = [], live: WidgetsResponse | null = null, tv: KidsStatus | null = null;
  let draftId: number | null = null;
  let tab: Tab = 'dashboard', kids = false, selected: string | null = null, open: string | null = null; // open: the app or widget whose details show
  let dirty = false, busy = '', conflict = false, message = '', restored = false;
  let saving: Promise<void> = Promise.resolve();
  let saveTimer: ReturnType<typeof setTimeout> | undefined, previewTimer: ReturnType<typeof setTimeout> | undefined;

  const store = {
    get: () => { try { return localStorage.getItem(DRAFT_KEY); } catch { return null; } },
    set: (v: string | null) => { try { v === null ? localStorage.removeItem(DRAFT_KEY) : localStorage.setItem(DRAFT_KEY, v); } catch { /* private mode: the draft is still on the Server */ } },
  };
  const typeOf = (w: WidgetInstance) => types.find((t) => t.type === w.type);
  const widgetName = (w: WidgetInstance) => (typeof w.config.title === 'string' && w.config.title) || typeOf(w)?.title || w.type;
  const appName = (id: string) => layout.apps.find((a) => a.id === id)?.name ?? id;
  const problems = () => validateLayout(layout).concat(checkWidgets(layout, types));
  const changed = () => JSON.stringify(layout) !== JSON.stringify(published);

  // ---- Loading, saving, publishing ----

  async function load(): Promise<void> {
    busy = 'Loading…';
    paintBar();
    try {
      const [snap, kinds, now, status, installed] = await Promise.all([
        call<Snapshot>('GET', '/api/snapshot'),
        call<WidgetType[]>('GET', '/api/widget-types').catch(() => [] as WidgetType[]),
        call<WidgetsResponse>('GET', '/api/widgets').catch(() => null),
        call<KidsStatus>('GET', '/api/kids').catch(() => null),
        call<TvAppsReport>('GET', '/api/tv/apps').catch(() => null),
      ]);
      reported = installed ? installed.apps : [];
      published = snap.layout;
      base = snap.revision;
      publishedAt = snap.publishedAt;
      types = kinds;
      live = now;
      tv = status;
      layout = published;
      draftId = null;
      dirty = conflict = restored = false;
      const saved = Number(store.get());
      if (saved) {
        // An unpublished draft from an earlier visit comes back if nothing was published since and it is still a layout.
        const draft = await call<Draft>('GET', '/api/drafts/' + saved).catch(() => null);
        if (draft && draft.base === base && !validateLayout(draft.layout).length) {
          layout = draft.layout as Layout;
          draftId = draft.id;
          restored = changed();
        } else if (draft) await call('DELETE', '/api/drafts/' + saved).catch(() => {});
        if (draftId === null) store.set(null);
      }
      busy = '';
      message = restored ? 'Your unpublished draft is back.' : '';
    } catch (err) {
      busy = '';
      message = err instanceof Error ? err.message : 'The Server is not reachable.';
    }
    paintAll();
  }

  const isConflict = (err: unknown) => (err as { status?: number })?.status === 409;
  function lostBase(): void {
    conflict = true;
    message = 'The layout was published from somewhere else since you started. Reload to start again from the new one.';
  }

  function save(): Promise<void> {
    clearTimeout(saveTimer);
    saving = saving.then(async () => {
      if (!dirty || conflict || !published) return;
      const sent = layout;
      try {
        if (draftId === null) {
          const draft = await call<Draft>('POST', '/api/drafts');
          draftId = draft.id;
          store.set(String(draft.id));
        }
        // Our base may be older than the draft's when the TV changed the layout since: the Server merges those changes into
        // what we send and answers with the merged draft (ADR 0004). Another publish since is a 409.
        const saved = await call<Draft>('PUT', '/api/drafts/' + draftId, { base, layout: sent });
        message = '';
        if (layout === sent) {
          dirty = false;
          // Layout and base are adopted together, or not at all: an edit made meanwhile keeps the old base, so the next save merges again.
          if (saved.base !== base) {
            const snap = await call<Snapshot>('GET', '/api/snapshot');
            layout = saved.layout as Layout;
            base = saved.base;
            published = snap.layout;
            publishedAt = snap.publishedAt;
            message = 'Changes made on the TV were added to your draft.';
            paintAll();
          }
        }
      } catch (err) {
        if (isConflict(err)) lostBase();
        else message = 'Could not save the draft: ' + (err instanceof Error ? err.message : 'the Server is not reachable.');
      }
    }).then(() => paintBar());
    return saving;
  }

  async function publish(): Promise<void> {
    if (busy || conflict || problems().length || !changed()) return;
    busy = 'Publishing…';
    paintBar();
    await save();
    try {
      if (draftId === null || conflict) throw new Error(message || 'Nothing was saved.');
      const snap = await call<Snapshot>('POST', `/api/drafts/${draftId}/publish`);
      published = layout = snap.layout;
      base = snap.revision;
      publishedAt = snap.publishedAt;
      draftId = null;
      dirty = false;
      store.set(null);
      message = 'Published as revision ' + snap.revision + '. The TV picks it up within a few seconds.';
      setTimeout(() => call<WidgetsResponse>('GET', '/api/widgets').then((w) => { live = w; pushPreview(); }, () => {}), 2500); // new widgets have been read by then
    } catch (err) {
      if (isConflict(err)) lostBase();
      else message = 'Not published: ' + (err instanceof Error ? err.message : 'the Server is not reachable.');
    }
    busy = '';
    paintAll();
  }

  /** Drops the working copy and the Server draft, and starts again from the published layout. */
  async function reload(): Promise<void> {
    if (draftId !== null) await call('DELETE', '/api/drafts/' + draftId).catch(() => {});
    store.set(null);
    await load();
  }
  const discard = async () => {
    if (changed() && !confirm('Throw away all changes that are not published?')) return;
    await reload();
  };

  // ---- Changing the layout ----

  /** Applies an edit. `rerender: false` is for typing, where the field must stay put. */
  function edit(next: Layout, rerender = true): void {
    if (next === layout) return;
    layout = next;
    dirty = true;
    message = '';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void save(), 900);
    if (rerender) paintAll();
    else {
      paintBar();
      schedulePreview();
    }
  }

  // ---- The preview ----

  function pushPreview(): void {
    const api = (frame.contentWindow as (Window & { sofaPreview?: PreviewApi }) | null)?.sofaPreview;
    if (!api || !layout) return;
    api.update({ layout, widgets: E.previewWidgets(layout, published, types, live), screen: kids ? 'kids' : 'household', tab: tab === 'apps' || tab === 'widgets' ? tab : 'dashboard', focus: selected });
  }
  function schedulePreview(): void {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(pushPreview, 120);
  }
  frame.addEventListener('load', pushPreview);
  // The page is a 1920x1080 TV screen: scale it to the width it has.
  const fit = () => { frame.style.transform = 'scale(' + wrap.clientWidth / 1920 + ')'; };
  new ResizeObserver(fit).observe(wrap);
  fit();
  const pick = (id: string) => { selected = id; pushPreview(); };

  // ---- Painting ----

  function paintBar(): void {
    const errs = layout ? problems() : [];
    const can = !busy && !conflict && !errs.length && changed();
    const show = !!layout && (changed() || !!busy || conflict);
    bar.hidden = !show;
    $('edit').classList.toggle('has-bar', show);
    bar.replaceChildren(
      h('div', { class: 'st', role: 'status' },
        h('b', null, busy || (conflict ? 'Out of date' : errs.length ? errs.length + (errs.length === 1 ? ' problem to fix' : ' problems to fix') : dirty ? 'Saving…' : 'Draft saved')),
        'Not on the TV yet · based on revision ' + base),
      btn('Discard', () => void discard(), 'btn gray sm', { disabled: !!busy || !layout }),
      btn('Publish', () => void publish(), 'btn sm', { disabled: !can }),
    );
    notice.replaceChildren(
      ...(conflict ? [h('div', { class: 'notice error' }, h('div', { class: 'rt' }, message), btn('Reload', () => void reload(), 'btn sm'))] : message ? [h('div', { class: 'notice' + (/^(Not|Could)/.test(message) ? ' error' : '') }, message)] : []),
      ...(errs.length ? [h('div', { class: 'notice error' }, h('div', null, h('strong', null, 'Fix before publishing'), h('ul', null, ...errs.slice(0, 8).map((e) => h('li', null, e)))))] : []),
    );
  }

  function paintAll(): void {
    if (!layout) return paintBar();
    $('ed-tabs').replaceChildren(...TABS.map(([id, label]) => h('button', { type: 'button', class: id === tab ? 'on' : '', onclick: () => { tab = id; selected = open = null; paintAll(); } }, label)));
    const y = window.scrollY;
    pane.replaceChildren(...(tab === 'dashboard' ? dashboard() : tab === 'apps' ? apps() : tab === 'widgets' ? widgets() : look()).filter((c): c is Node | string => !!c));
    window.scrollTo(0, y); // a redraw keeps your place in the list
    paintBar();
    pushPreview();
  }

  const ic = (name: string) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('class', 'ic');
    s.setAttribute('aria-hidden', 'true');
    const u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    u.setAttribute('href', '#' + name);
    s.append(u);
    return s;
  };
  const iconBtn = (name: string, label: string, onclick: () => void, disabled = false, cls = 'iconbtn') => h('button', { type: 'button', class: cls, 'aria-label': label, onclick, disabled }, ic(name));
  const handle = () => h('span', { class: 'handle', 'aria-hidden': 'true' }, ic('i-handle'));
  const grp = (head: Child, ...kids: Child[]) => h('div', { class: 'grp' }, head && h('div', { class: 'gh' }, head), ...kids);
  const list = (...rows: Child[]) => h('div', { class: 'list' }, ...rows);
  const foot = (text: Child, cls = 'gf') => h('p', { class: cls }, text);
  const sw = (checked: boolean, label: string, onchange: (on: boolean) => void) =>
    h('label', { class: 'row' }, h('span', { class: 'rt' }, label), h('input', { type: 'checkbox', class: 'sw', checked, onchange: (e: Event) => onchange((e.target as HTMLInputElement).checked) }));
  const BADGE: Record<string, string> = { app: 'b-tint', input: 'b-brown', widget: 'b-blue' };
  const badge = (kind: string, name: string) => h('span', { class: 'badge ' + (BADGE[kind] ?? 'b-gray') }, (name.trim()[0] ?? '?').toUpperCase());
  const UNITS = { small: 1, medium: 2, large: 3 } as const;
  const sizeName = (s: string) => s[0].toUpperCase() + s.slice(1);

  const rowLabel = (i: number) => layout.rows[i].title || 'Row ' + (i + 1);
  const itemName = (it: E.Item) => (it.kind === 'app' ? appName(it.id) : widgetName(layout.widgets.find((w) => w.id === it.id)!));
  const itemSub = (it: E.Item) => {
    if (it.kind === 'app') return layout.apps.find((a) => a.id === it.id)?.kind === 'input' ? 'Console' : 'App';
    const w = layout.widgets.find((x) => x.id === it.id)!;
    const kind = typeOf(w)?.title ?? w.type;
    return (kind === widgetName(w) ? '' : kind + ' · ') + sizeName(w.size); // no "Weather · Weather · Small" when the widget has no title of its own
  };

  /**
   * Drag to reorder: press the handle and move. Rows of every `[data-list]` under `root` are drop targets, so an item can
   * go to another list (another Dashboard row). `drop` gets the row's key, the target list and the index among its rows.
   */
  function sortable(root: HTMLElement, drop: (key: string, listId: string, index: number) => void): void {
    root.addEventListener('pointerdown', (e) => {
      const grip = (e.target as Element).closest('.handle');
      const row = grip?.closest<HTMLElement>('[data-key]');
      if (!row) return;
      e.preventDefault();
      const startY = e.clientY;
      const line = h('div', { class: 'drop-line' });
      let target: { list: HTMLElement; index: number } | null = null;
      row.classList.add('dragging');
      row.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        row.style.transform = 'translateY(' + (ev.clientY - startY) + 'px)';
        const lists = [...root.querySelectorAll<HTMLElement>('[data-list]')];
        const over = lists.find((l) => { const r = l.getBoundingClientRect(); return ev.clientY >= r.top - 22 && ev.clientY <= r.bottom + 22; });
        if (!over) { line.remove(); target = null; return; }
        const rows = [...over.querySelectorAll<HTMLElement>(':scope > [data-key]')].filter((r) => r !== row);
        const index = rows.filter((r) => { const b = r.getBoundingClientRect(); return b.top + b.height / 2 < ev.clientY; }).length;
        target = { list: over, index };
        over.insertBefore(line, rows[index] ?? over.querySelector(':scope > .add') ?? null);
      };
      const up = () => {
        row.removeEventListener('pointermove', move);
        row.removeEventListener('pointerup', up);
        row.removeEventListener('pointercancel', up);
        row.classList.remove('dragging');
        row.style.transform = '';
        line.remove();
        if (target) drop(row.dataset.key!, target.list.dataset.list!, target.index);
      };
      row.addEventListener('pointermove', move);
      row.addEventListener('pointerup', up);
      row.addEventListener('pointercancel', up);
    });
  }
  const keyItem = (key: string): E.Item => ({ kind: key.startsWith('app:') ? 'app' : 'widget', id: key.slice(key.indexOf(':') + 1) });

  function dashboard(): Child[] {
    const free: [string, string][] = [['', 'Add app or widget…']];
    for (const a of layout.apps) if (!E.rowOf(layout, { kind: 'app', id: a.id })) free.push(['app:' + a.id, 'App · ' + a.name]);
    for (const w of layout.widgets) if (!E.rowOf(layout, { kind: 'widget', id: w.id })) free.push(['widget:' + w.id, 'Widget · ' + widgetName(w)]);
    const box = h('div', null,
      foot('Rows run top to bottom on the TV. Drag ≡ to move a tile, also into another row. Tap a name to find it in the preview.', 'gf intro'),
      ...layout.rows.map((r, i) => {
        // Only widgets have a width limit on the TV; a row of apps scrolls.
        const used = r.items.reduce((n, it) => n + (it.kind === 'app' ? 0 : UNITS[layout.widgets.find((w) => w.id === it.id)?.size ?? 'small']), 0);
        const units = used > 0 && h('span', { class: 'units', 'aria-label': used + ' of ' + ROW_UNITS + ' places used' },
          ...Array.from({ length: Math.max(ROW_UNITS, used) }, (_, k) => h('i', { class: k >= ROW_UNITS ? 'x' : k < used ? '' : 'e' })));
        return grp(null,
          list(
            h('div', { class: 'row' },
              h('input', { class: 'title-in', type: 'text', value: r.title, placeholder: 'Row ' + (i + 1), maxLength: 80, 'aria-label': 'Row title', oninput: (e: Event) => edit(E.renameRow(layout, r.id, (e.target as HTMLInputElement).value), false) }),
              units,
              iconBtn('up', 'Move row up', () => edit(E.moveRow(layout, r.id, -1)), i === 0),
              iconBtn('down', 'Move row down', () => edit(E.moveRow(layout, r.id, 1)), i === layout.rows.length - 1),
              iconBtn('i-x', 'Remove row', () => edit(E.removeRow(layout, r.id)), false, 'iconbtn del'),
            ),
            h('div', { 'data-list': r.id },
              ...r.items.map((it) =>
                h('div', { class: 'row ind', 'data-key': it.kind + ':' + it.id },
                  badge(it.kind === 'app' ? (layout.apps.find((a) => a.id === it.id)?.kind === 'input' ? 'input' : 'app') : 'widget', itemName(it)),
                  h('button', { type: 'button', class: 'rt name', onclick: () => pick(it.kind + ':' + it.id) }, h('div', null, itemName(it)), h('div', { class: 'sub' }, itemSub(it))),
                  h('button', { type: 'button', class: 'x', 'aria-label': 'Take ' + itemName(it) + ' off the Dashboard', onclick: () => edit(E.removeFromRows(layout, it)) }, ic('i-minus')),
                  handle(),
                ),
              ),
              free.length > 1 && h('label', { class: 'row add' }, h('span', { class: 'plus', 'aria-hidden': 'true' }, '+'),
                select(free, '', (v) => v && edit(E.placeInRow(layout, keyItem(v), r.id)), { 'aria-label': 'Add to ' + rowLabel(i), class: 'field' })),
            ),
          ),
          !r.items.length && foot('Empty rows are not shown on the TV.'),
          E.rowTooWide(layout, r.id) && foot('The TV fits ' + ROW_UNITS + ' small widgets in a row (a medium counts 2, a large 3). The last ones here are cut off.', 'gf err'),
        );
      }),
      grp(null, list(btn('Add row', () => edit(E.addRow(layout)), 'row act c'))),
    );
    sortable(box, (key, rowId, index) => edit(E.placeAt(layout, keyItem(key), rowId, index)));
    return [box];
  }

  /** A tappable list row that opens its details below it. */
  const opener = (key: string, ...kids: Child[]) =>
    h('button', { type: 'button', class: 'rt name', 'aria-expanded': String(open === key), onclick: () => { open = open === key ? null : key; selected = key; paintAll(); } }, ...kids);

  function apps(): Child[] {
    const onDash = (id: string) => E.rowOf(layout, { kind: 'app', id }) !== null;
    const known: [string, string][] = [['', 'Pick a known app…'], ...E.pickableApps(layout, reported).map((k): [string, string] => [k.id, k.name])];
    const name = h('input', { type: 'text', class: 'field', placeholder: 'Name', maxLength: 80, 'aria-label': 'New app name' });
    const id = h('input', { type: 'text', class: 'field mono', placeholder: 'Tizen app ID, like org.tizen.netflix-app', maxLength: 128, 'aria-label': 'New app ID', autocapitalize: 'off', spellcheck: 'false' });
    const cName = h('input', { type: 'text', class: 'field', placeholder: 'Name, like PS5', maxLength: 80, 'aria-label': 'Console name' });
    const cScript = h('input', { type: 'text', class: 'field mono', placeholder: 'script.sofa_start_ps5', maxLength: 128, 'aria-label': 'Home Assistant script', autocapitalize: 'off', spellcheck: 'false' });
    const cSource = h('input', { type: 'text', class: 'field mono', value: 'HDMI4', maxLength: 5, 'aria-label': 'TV input of the Denon', autocapitalize: 'characters', spellcheck: 'false' });
    const box = h('div', null,
      foot('All Apps on the TV lists these in this order. Drag ≡ to reorder; tap an app for its settings.', 'gf intro'),
      grp(null, h('div', { class: 'list', 'data-list': 'apps' },
        ...layout.apps.flatMap((a) => {
          const key = 'app:' + a.id;
          const row = h('div', { class: 'row ind', 'data-key': key },
            badge(a.kind === 'input' ? 'input' : 'app', a.name),
            opener(key, h('div', null, a.name), h('div', { class: 'sub' }, (a.kind === 'input' ? 'Console' : 'App') + (onDash(a.id) ? ' · On the Dashboard' : ''))),
            handle());
          if (open !== key) return [row];
          return [row, h('div', { class: 'row block' },
            h('label', { class: 'fieldrow' }, h('span', null, 'Name'), h('input', { type: 'text', value: a.name, maxLength: 80, oninput: (e: Event) => edit(E.renameApp(layout, a.id, (e.target as HTMLInputElement).value), false) })),
            h('p', { class: 'gf flush mono' }, a.id + (a.kind === 'input' ? ' · console on ' + a.source + ', never in Kids Mode' : '') + (layout.kidsMode.apps.includes(a.id) ? ' · approved for Kids Mode' : ''))),
          sw(onDash(a.id), 'On the Dashboard', (on) => edit(E.showOnDashboard(layout, { kind: 'app', id: a.id }, on))),
          btn('Remove ' + a.name, () => edit(E.removeApp(layout, a.id)), 'row danger')];
        }),
      )),
      grp('Add app',
        list(
          h('label', { class: 'row' }, select(known, '', (v) => { const k = E.pickableApps(layout, reported).find((x) => x.id === v); if (k) { name.value = k.name; id.value = k.id; } }, { 'aria-label': 'Known apps', class: 'field' })),
          h('div', { class: 'row' }, name), h('div', { class: 'row' }, id),
          btn('Add app', () => edit(E.addApp(layout, { id: id.value, name: name.value })), 'row act'),
        ),
        foot((reported.length ? 'The list is what the TV reported as installed. ' : 'The TV has not reported its apps yet, so this is the short list Sofa Home is known to launch. ') + 'Not in the list? Enter its exact Tizen ID.'),
      ),
      grp('Add console',
        list(h('div', { class: 'row' }, cName), h('div', { class: 'row' }, cScript), h('div', { class: 'row' }, cSource),
          btn('Add console', () => edit(E.addInput(layout, { name: cName.value, script: cScript.value, source: cSource.value })), 'row act')),
        foot('A console behind the Denon. Its tile runs the Home Assistant script, switches the TV to the Denon’s input and leaves Sofa Home. Consoles never show in Kids Mode.'),
      ),
    );
    sortable(box, (key, _list, index) => edit(E.moveAppTo(layout, keyItem(key).id, index)));
    return [box];
  }

  function widgets(): Child[] {
    const box = h('div', null,
      foot('A widget shows on the TV once it is on the Dashboard or in the TV’s Widgets tab. Drag ≡ to reorder; tap one for its settings.', 'gf intro'),
      grp(null, h('div', { class: 'list', 'data-list': 'widgets' },
        ...layout.widgets.flatMap((w) => {
          const key = 'widget:' + w.id;
          const bad = widgetProblems(w, typeOf(w)).length > 0;
          const row = h('div', { class: 'row ind', 'data-key': key },
            badge('widget', widgetName(w)),
            opener(key, h('div', null, widgetName(w)), h('div', { class: 'sub' + (bad ? ' err' : '') }, bad ? 'Needs settings' : itemSub({ kind: 'widget', id: w.id }))),
            handle());
          return open === key ? [row, ...widgetDetails(w)] : [row];
        }),
      )),
      grp('Add widget',
        types.length ? list(h('label', { class: 'row' }, h('span', { class: 'plus', 'aria-hidden': 'true' }, '+'),
          select([['', 'Choose a type…'], ...types.map((t): [string, string] => [t.type, t.title])], '', (v) => { const t = types.find((x) => x.type === v); if (t) { const next = E.addWidget(layout, t); open = 'widget:' + next.widgets[next.widgets.length - 1].id; edit(next); } }, { 'aria-label': 'Widget type', class: 'field' })))
          : foot('The Server offers no widget types right now.'),
        ...types.map((t) => foot(h('span', null, h('strong', null, t.title + ': '), t.description))),
      ),
    );
    sortable(box, (key, _list, index) => edit(E.moveWidgetTo(layout, keyItem(key).id, index)));
    return [box];
  }

  /** The rows under an opened widget: its fields, size, refresh, where it shows, Remove. */
  function widgetDetails(w: WidgetInstance): HTMLElement[] {
    const type = typeOf(w);
    const errorBox = h('ul', { class: 'field-errors', role: 'status' });
    const showErrors = () => {
      const now = widgetProblems(layout.widgets.find((x) => x.id === w.id) ?? w, type);
      errorBox.replaceChildren(...now.map((e) => h('li', null, (type?.fields.find((f) => e.startsWith(f.key + ':'))?.label ?? e.split(':')[0]) + e.slice(e.indexOf(':')))));
    };
    showErrors();
    const set = (key: string, v: unknown, rerender = false) => { edit(E.setConfig(layout, w.id, key, v), rerender); showErrors(); };
    return [
      h('div', { class: 'row block' },
        !type && h('p', { class: 'gf flush err' }, 'This Server does not know the widget type “' + w.type + '”. It shows as unavailable on the TV; you can still move or remove it.'),
        ...(type ? type.fields.filter((f) => fieldApplies(f, type.fields, w.config)).map((f) => fieldInput(f, w, set)) : []),
        type && h('div', { class: 'minirow' },
          h('label', { class: 'fieldrow rt' }, h('span', null, 'Size'), select(type.sizes.map((s) => [s, sizeName(s)] as [string, string]), w.size, (s) => edit(E.updateWidget(layout, w.id, { size: s as WidgetInstance['size'] })))),
          h('label', { class: 'fieldrow rt' }, h('span', null, 'Refresh'), select(FRESHNESS.map((f) => [f, { live: 'Live (every 30 s)', hourly: 'Hourly', daily: 'Daily' }[f]] as [string, string]), w.freshness, (f) => edit(E.updateWidget(layout, w.id, { freshness: f as WidgetInstance['freshness'] })))),
        ),
        errorBox,
      ),
      sw(E.rowOf(layout, { kind: 'widget', id: w.id }) !== null, 'On the Dashboard', (on) => edit(E.showOnDashboard(layout, { kind: 'widget', id: w.id }, on))),
      sw(w.profiles.includes('kids'), 'Allow in Kids Mode', (on) => edit(E.updateWidget(layout, w.id, { profiles: on ? ['household', 'kids'] : ['household'] }))),
      btn('Remove widget', () => { open = null; edit(E.removeWidget(layout, w.id)); }, 'row danger'),
    ];
  }

  /** One config field of a widget type, whatever its kind. Typing updates the layout without redrawing the field. */
  function fieldInput(f: ConfigField, w: WidgetInstance, set: (key: string, v: unknown, rerender?: boolean) => void): HTMLElement {
    const v = w.config[f.key];
    const help = f.help ? h('span', { class: 'hint' }, f.help) : null;
    const wrapField = (control: Child, extra?: Child) => h('label', { class: 'fieldrow minirow-top' }, h('span', null, f.label + ('required' in f && f.required ? ' *' : '')), control, extra, help);
    const text = (value: unknown, placeholder: string, onValue: (s: string) => void, extra: Record<string, unknown> = {}) =>
      h('input', { type: 'text', value: typeof value === 'string' ? value : '', placeholder, autocapitalize: 'off', spellcheck: 'false', oninput: (e: Event) => onValue((e.target as HTMLInputElement).value), ...extra });
    switch (f.kind) {
      case 'text':
        return wrapField(text(v, f.default ?? '', (s) => set(f.key, s === '' ? undefined : s), { maxLength: f.maxLength, autocapitalize: 'sentences', spellcheck: 'true' }));
      case 'number':
        return wrapField(h('input', { type: 'number', value: typeof v === 'number' ? String(v) : '', placeholder: f.default === undefined ? '' : String(f.default), min: String(f.min), max: String(f.max), step: f.integer ? '1' : 'any', inputmode: f.integer ? 'numeric' : 'decimal', oninput: (e: Event) => { const s = (e.target as HTMLInputElement).value; set(f.key, s === '' ? undefined : Number(s)); } }), h('span', { class: 'hint' }, f.min + ' to ' + f.max));
      case 'choice':
        return wrapField(select(f.options.map((o) => [o.value, o.label] as [string, string]), typeof v === 'string' ? v : f.default, (s) => set(f.key, s, true))); // rerender: a choice may show or hide other fields
      case 'boolean':
        return h('label', { class: 'minirow' }, h('span', { class: 'rt' }, f.label, help && h('br', null), help), h('input', { type: 'checkbox', class: 'sw', checked: typeof v === 'boolean' ? v : f.default, onchange: (e: Event) => set(f.key, (e.target as HTMLInputElement).checked) }));
      case 'album': // shortcut: a typed Immich album id; upgrade to a picker over GET /api/photos/albums
        return wrapField(text(v, 'album id', (s) => set(f.key, s.trim() === '' ? undefined : s.trim())), h('span', { class: 'hint' }, 'The Immich album id (from the album page address).'));
      case 'entity':
        return wrapField(text(v, f.domains[0] + '.name', (s) => set(f.key, s.trim() === '' ? undefined : s.trim())), h('span', { class: 'hint' }, 'A Home Assistant entity id (' + f.domains.join(', ') + ').'));
      case 'entities': {
        const items = Array.isArray(v) ? (v as unknown[]).map(String) : [];
        const put = (next: string[], rerender: boolean) => set(f.key, next.length ? next : undefined, rerender);
        return h('div', { class: 'fieldrow minirow-top' },
          h('span', null, f.label + ('required' in f && f.required ? ' *' : '') + ' (' + items.length + ' of ' + f.max + ', in card order)'),
          ...items.map((e, j) =>
            h('div', { class: 'minirow' },
              text(e, f.domains[0] + '.name', (s) => { items[j] = s.trim(); put(items.slice(), false); }, { 'aria-label': f.label + ' ' + (j + 1) }),
              iconBtn('up', 'Move up', () => { const n = items.slice(); [n[j - 1], n[j]] = [n[j], n[j - 1]]; put(n, true); }, j === 0),
              iconBtn('down', 'Move down', () => { const n = items.slice(); [n[j + 1], n[j]] = [n[j], n[j + 1]]; put(n, true); }, j === items.length - 1),
              iconBtn('i-x', 'Remove entity', () => put(items.filter((_, k) => k !== j), true)),
            ),
          ),
          h('div', { class: 'minirow' }, btn('Add entity', () => put(items.concat(''), true), 'btn tinted sm', { disabled: items.length >= f.max })),
          h('span', { class: 'hint' }, 'Entity ids of ' + f.domains.join(', ') + '. Readings only: the card never controls anything.'),
          help,
        );
      }
    }
  }

  function look(): Child[] {
    const bg = layout.background;
    const color = bg.kind === 'color' ? bg.color : '#f6f1e7';
    const check = (on: boolean) => (on ? h('span', { class: 'rv tint' }, ic('i-check')) : null);
    const bgRow = (label: string, sub: string, on: boolean, onclick: () => void) =>
      h('button', { type: 'button', class: 'row', 'aria-pressed': String(on), onclick }, h('span', { class: 'rt' }, h('div', null, label), h('div', { class: 'sub' }, sub)), check(on));
    return [
      grp('Colour scheme',
        h('div', { class: 'list schemes' },
          ...SCHEME_IDS.map((id) => {
            const sc = SCHEMES[id];
            const on = (layout.scheme ?? 'sage') === id;
            const chip = h('i', null);
            chip.style.background = 'rgb(' + sc.glass.join(',') + ')';
            chip.style.borderBottomColor = sc.bar;
            return h('button', { type: 'button', class: 'sch' + (on ? ' on' : ''), 'aria-pressed': String(on), onclick: () => edit(E.setScheme(layout, id)) }, chip, sc.name);
          }),
        ),
        foot('The colour of the tiles and panels on the TV. Kids Mode keeps its own look.'),
      ),
      grp('Background',
        list(
          bgRow('Time of day', 'Mountain lake by the TV’s clock: morning, midday, evening, night', bg.kind === 'daycycle', () => edit(E.setBackgroundDayCycle(layout))),
          bgRow('Newest photos', 'A slideshow from Immich', bg.kind === 'slideshow' && bg.album === STREAM, () => edit(E.setBackgroundStream(layout))),
          bgRow('Plain colour', 'Text outside the tiles follows it', bg.kind === 'color', () => edit(E.setBackgroundColor(layout, color))),
          bg.kind === 'color' && h('div', { class: 'bgopt' },
            ...SWATCHES.map((c) => { const b = h('button', { type: 'button', class: c === color ? 'on' : '', 'aria-label': 'Background ' + c, onclick: () => edit(E.setBackgroundColor(layout, c)) }); b.style.background = c; return b; }),
            h('input', { type: 'color', value: color, 'aria-label': 'Other colour', onchange: (e: Event) => edit(E.setBackgroundColor(layout, (e.target as HTMLInputElement).value)) }),
          ),
        ),
        foot('The household Dashboard only; Kids Mode keeps its own background.'),
      ),
      grp('Photo screensaver',
        list(h('label', { class: 'row' }, h('span', { class: 'rt' }, 'Start after'),
          select(SCREENSAVER_MINUTES.map((m): [string, string] => [String(m), m ? m + ' min' : 'Off']), String(layout.screensaverMinutes ?? DEFAULT_SCREENSAVER_MINUTES), (v) => edit(E.setScreensaver(layout, Number(v))), { 'aria-label': 'Start the screensaver after' }))),
        foot('After this long without a key the TV shows the photo widget’s album full screen with the clock. The first key press only wakes it. Not in Kids Mode.'),
      ),
    ];
  }

  // ---- Wiring ----
  const side = $('ed-side');
  $('preview-open').addEventListener('click', () => { side.classList.add('open'); fit(); });
  $('preview-close').addEventListener('click', () => side.classList.remove('open'));
  $('pv-screen').addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('button[data-kids]');
    if (!b) return;
    kids = b.dataset.kids === '1';
    for (const x of $('pv-screen').querySelectorAll('button')) x.classList.toggle('on', x === b);
    pushPreview();
  });
  window.addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && dirty) void save(); }); // leaving the page (a phone switching apps) saves
  void load();
}
