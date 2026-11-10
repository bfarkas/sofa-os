// Companion's Home Screen editor (/edit): Dashboard, Apps, Widgets and Settings over one working copy of the layout, with a
// 16:9 preview made by Sofa Home's own drawing code (preview.ts). The working copy is saved to a Server draft as you go and
// published through the Session 05 API. Every change goes through edit.ts; this file is forms and plumbing.
import { checkWidgets, fieldApplies, FRESHNESS, ROW_UNITS, STREAM, validateLayout, widgetProblems, type ConfigField, type Draft, type KidsStatus, type Layout, type Snapshot, type WidgetInstance, type WidgetType, type WidgetsResponse } from '@sofa/shared';
import * as E from './edit.ts';
import type { PreviewApi } from './preview.ts';

export type Call = <T>(method: string, url: string, body?: unknown) => Promise<T>;
type Tab = 'dashboard' | 'apps' | 'widgets' | 'settings';
type Child = Node | string | null | false | undefined;

const DRAFT_KEY = 'sofa.companion.draft';
const TABS: [Tab, string][] = [['dashboard', 'Dashboard'], ['apps', 'Apps'], ['widgets', 'Widgets'], ['settings', 'Settings']];
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
  let types: WidgetType[] = [], live: WidgetsResponse | null = null, tv: KidsStatus | null = null;
  let draftId: number | null = null;
  let tab: Tab = 'dashboard', kids = false, selected: string | null = null;
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
      const [snap, kinds, now, status] = await Promise.all([
        call<Snapshot>('GET', '/api/snapshot'),
        call<WidgetType[]>('GET', '/api/widget-types').catch(() => [] as WidgetType[]),
        call<WidgetsResponse>('GET', '/api/widgets').catch(() => null),
        call<KidsStatus>('GET', '/api/kids').catch(() => null),
      ]);
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
    bar.replaceChildren(
      h('div', { class: 'ed-status', role: 'status' }, busy || (conflict ? 'Out of date' : errs.length ? errs.length + (errs.length === 1 ? ' problem to fix' : ' problems to fix') : !layout ? '' : changed() ? (dirty ? 'Saving…' : 'Draft saved') + ' · based on revision ' + base : 'Revision ' + base + ' is published')),
      btn('Discard', () => void discard(), 'small ghost', { disabled: !!busy || !layout || (!changed() && draftId === null) }),
      btn('Publish', () => void publish(), 'small', { disabled: !can }),
    );
    notice.replaceChildren(
      ...(conflict ? [h('div', { class: 'notice error' }, message, btn('Reload', () => void reload(), 'small'))] : message ? [h('div', { class: 'notice' + (/^(Not|Could)/.test(message) ? ' error' : '') }, message)] : []),
      ...(errs.length ? [h('div', { class: 'notice error' }, h('strong', null, 'Fix before publishing'), h('ul', null, ...errs.slice(0, 8).map((e) => h('li', null, e))))] : []),
    );
  }

  function paintAll(): void {
    if (!layout) return paintBar();
    $('ed-tabs').replaceChildren(...TABS.map(([id, label]) => h('button', { type: 'button', class: id === tab ? 'tab on' : 'tab', onclick: () => { tab = id; selected = null; paintAll(); } }, label)));
    ($('preview-kids') as HTMLInputElement).checked = kids;
    pane.replaceChildren(...(tab === 'dashboard' ? dashboard() : tab === 'apps' ? apps() : tab === 'widgets' ? widgets() : settings()).filter((c): c is Node | string => !!c));
    paintBar();
    pushPreview();
  }

  const rowLabel = (i: number) => layout.rows[i].title || 'Row ' + (i + 1);
  const itemName = (it: E.Item) => (it.kind === 'app' ? appName(it.id) : widgetName(layout.widgets.find((w) => w.id === it.id)!));

  function dashboard(): Child[] {
    const free: [string, string][] = [['', 'Add an app or widget…']];
    for (const a of layout.apps) if (!E.rowOf(layout, { kind: 'app', id: a.id })) free.push(['app:' + a.id, 'App · ' + a.name]);
    for (const w of layout.widgets) if (!E.rowOf(layout, { kind: 'widget', id: w.id })) free.push(['widget:' + w.id, 'Widget · ' + widgetName(w)]);
    const where: [string, string][] = layout.rows.map((r, i) => [r.id, rowLabel(i)]);
    return [
      h('p', { class: 'hint' }, 'Rows run top to bottom on the TV. Tap a name to see it in the preview.'),
      ...layout.rows.map((r, i) =>
        h('div', { class: 'card' },
          h('div', { class: 'line' },
            h('input', { type: 'text', value: r.title, placeholder: 'Row ' + (i + 1) + ' (no title)', maxLength: 80, 'aria-label': 'Row title', oninput: (e: Event) => edit(E.renameRow(layout, r.id, (e.target as HTMLInputElement).value), false) }),
            btn('↑', () => edit(E.moveRow(layout, r.id, -1)), 'small ghost', { 'aria-label': 'Move row up', disabled: i === 0 }),
            btn('↓', () => edit(E.moveRow(layout, r.id, 1)), 'small ghost', { 'aria-label': 'Move row down', disabled: i === layout.rows.length - 1 }),
            btn('Remove', () => edit(E.removeRow(layout, r.id)), 'small ghost danger', { 'aria-label': 'Remove row' }),
          ),
          ...r.items.map((it, j) =>
            h('div', { class: 'line item wrapline' },
              h('button', { type: 'button', class: 'name', onclick: () => pick(it.kind + ':' + it.id) }, h('span', { class: 'kind' }, it.kind === 'app' ? 'App' : 'Widget'), itemName(it)),
              btn('←', () => edit(E.moveItem(layout, it, -1)), 'small ghost', { 'aria-label': 'Move left', disabled: j === 0 }),
              btn('→', () => edit(E.moveItem(layout, it, 1)), 'small ghost', { 'aria-label': 'Move right', disabled: j === r.items.length - 1 }),
              layout.rows.length > 1 ? select(where, r.id, (to) => edit(E.placeInRow(layout, it, to)), { 'aria-label': 'Move to row', class: 'compact' }) : null,
              btn('✕', () => edit(E.removeFromRows(layout, it)), 'small ghost', { 'aria-label': 'Take off the Dashboard' }),
            ),
          ),
          !r.items.length && h('p', { class: 'hint' }, 'Empty rows are not shown on the TV.'),
          E.rowTooWide(layout, r.id) && h('p', { class: 'hint' }, 'The TV fits ' + ROW_UNITS + ' small widgets in a row (a medium counts 2, a large 3). The last widgets here are cut off.'),
          free.length > 1 && select(free, '', (v) => v && edit(E.placeInRow(layout, { kind: v.startsWith('app:') ? 'app' : 'widget', id: v.slice(v.indexOf(':') + 1) }, r.id)), { 'aria-label': 'Add to this row' }),
        ),
      ),
      btn('Add a row', () => edit(E.addRow(layout)), 'ghost'),
    ];
  }

  function apps(): Child[] {
    const onDash = (id: string) => E.rowOf(layout, { kind: 'app', id }) !== null;
    const known: [string, string][] = [['', 'Pick a known app…'], ...E.KNOWN_APPS.filter((k) => !layout.apps.some((a) => a.id === k.id)).map((k): [string, string] => [k.id, k.name])];
    const name = h('input', { type: 'text', placeholder: 'Name', maxLength: 80, 'aria-label': 'New app name' });
    const id = h('input', { type: 'text', placeholder: 'Tizen app ID, like org.tizen.netflix-app', maxLength: 128, 'aria-label': 'New app ID', autocapitalize: 'off', spellcheck: 'false' });
    return [
      h('p', { class: 'hint' }, 'All Apps lists these in this order. Turn “On the Dashboard” off to keep an app in All Apps only.'),
      ...layout.apps.map((a, i) =>
        h('div', { class: 'card' },
          h('div', { class: 'line' },
            h('input', { type: 'text', value: a.name, maxLength: 80, 'aria-label': 'App name', onfocus: () => pick('app:' + a.id), oninput: (e: Event) => edit(E.renameApp(layout, a.id, (e.target as HTMLInputElement).value), false) }),
            btn('↑', () => edit(E.moveApp(layout, a.id, -1)), 'small ghost', { 'aria-label': 'Move up', disabled: i === 0 }),
            btn('↓', () => edit(E.moveApp(layout, a.id, 1)), 'small ghost', { 'aria-label': 'Move down', disabled: i === layout.apps.length - 1 }),
          ),
          h('div', { class: 'line spread' },
            h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: onDash(a.id), onchange: (e: Event) => edit(E.showOnDashboard(layout, { kind: 'app', id: a.id }, (e.target as HTMLInputElement).checked)) }), 'On the Dashboard'),
            btn('Remove', () => edit(E.removeApp(layout, a.id)), 'small ghost danger', { 'aria-label': 'Remove ' + a.name }),
          ),
          h('p', { class: 'hint mono' }, a.id + (layout.kidsMode.apps.includes(a.id) ? ' · approved for Kids Mode' : '')),
        ),
      ),
      h('div', { class: 'card' },
        h('h3', null, 'Add an app'),
        select(known, '', (v) => { const k = E.KNOWN_APPS.find((x) => x.id === v); if (k) { name.value = k.name; id.value = k.id; } }, { 'aria-label': 'Known apps' }),
        name, id,
        btn('Add app', () => edit(E.addApp(layout, { id: id.value, name: name.value })), ''),
        h('p', { class: 'hint' }, 'Companion cannot list what is installed on the TV. The IDs above are the ones Sofa Home is known to launch; others need the exact Tizen ID. An app that fails to launch shows as Unavailable on the TV.'),
      ),
    ];
  }

  function widgets(): Child[] {
    const picker = select([['', 'Add a widget…'], ...types.map((t): [string, string] => [t.type, t.title])], '', (v) => { const t = types.find((x) => x.type === v); if (t) edit(E.addWidget(layout, t)); }, { 'aria-label': 'Widget type' });
    return [
      h('p', { class: 'hint' }, 'A widget has a type, a size and its own settings. It shows on the TV once it is on the Dashboard (or in the Widgets tab).'),
      ...layout.widgets.map((w, i) => widgetCard(w, i)),
      h('div', { class: 'card' }, h('h3', null, 'Add a widget'), types.length ? picker : h('p', { class: 'hint' }, 'The Server offers no widget types right now.'),
        ...types.map((t) => h('p', { class: 'hint' }, h('strong', null, t.title + ': '), t.description))),
    ];
  }

  function widgetCard(w: WidgetInstance, i: number): HTMLElement {
    const type = typeOf(w);
    const errs = widgetProblems(w, type);
    const errorBox = h('ul', { class: 'field-errors', role: 'status' });
    const showErrors = () => {
      const now = widgetProblems(layout.widgets.find((x) => x.id === w.id) ?? w, type);
      errorBox.replaceChildren(...now.map((e) => h('li', null, (type?.fields.find((f) => e.startsWith(f.key + ':'))?.label ?? e.split(':')[0]) + e.slice(e.indexOf(':')))));
    };
    if (errs.length) showErrors();
    const set = (key: string, v: unknown, rerender = false) => { edit(E.setConfig(layout, w.id, key, v), rerender); showErrors(); };
    return h('div', { class: 'card' },
      h('div', { class: 'line' },
        h('button', { type: 'button', class: 'name', onclick: () => pick('widget:' + w.id) }, h('span', { class: 'kind' }, type?.title ?? w.type), widgetName(w)),
        btn('↑', () => edit(E.moveWidget(layout, w.id, -1)), 'small ghost', { 'aria-label': 'Move up', disabled: i === 0 }),
        btn('↓', () => edit(E.moveWidget(layout, w.id, 1)), 'small ghost', { 'aria-label': 'Move down', disabled: i === layout.widgets.length - 1 }),
        btn('Remove', () => edit(E.removeWidget(layout, w.id)), 'small ghost danger', { 'aria-label': 'Remove widget' }),
      ),
      !type && h('p', { class: 'hint error' }, 'This Server does not know the widget type “' + w.type + '”. It shows as unavailable on the TV; you can still move or remove it.'),
      ...(type ? type.fields.filter((f) => fieldApplies(f, type.fields, w.config)).map((f) => fieldInput(f, w, set)) : []),
      type && h('div', { class: 'line two' },
        h('label', null, 'Size', select(type.sizes.map((s) => [s, s[0].toUpperCase() + s.slice(1)] as [string, string]), w.size, (s) => edit(E.updateWidget(layout, w.id, { size: s as WidgetInstance['size'] })))),
        h('label', null, 'Refresh', select(FRESHNESS.map((f) => [f, { live: 'Live (every 30 s)', hourly: 'Hourly', daily: 'Daily' }[f]] as [string, string]), w.freshness, (f) => edit(E.updateWidget(layout, w.id, { freshness: f as WidgetInstance['freshness'] })))),
      ),
      h('div', { class: 'line wrapline' },
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: E.rowOf(layout, { kind: 'widget', id: w.id }) !== null, onchange: (e: Event) => edit(E.showOnDashboard(layout, { kind: 'widget', id: w.id }, (e.target as HTMLInputElement).checked)) }), 'On the Dashboard'),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: w.profiles.includes('kids'), onchange: (e: Event) => { const on = (e.target as HTMLInputElement).checked; edit(E.updateWidget(layout, w.id, { profiles: on ? ['household', 'kids'] : ['household'] })); } }), 'Allow in Kids Mode'),
      ),
      w.profiles.includes('kids') && h('p', { class: 'hint' }, 'Sofa Home does not show widgets in Kids Mode yet; this only records that the widget is allowed there.'),
      errorBox,
    );
  }

  /** One config field of a widget type, whatever its kind. Typing updates the layout without redrawing the field. */
  function fieldInput(f: ConfigField, w: WidgetInstance, set: (key: string, v: unknown, rerender?: boolean) => void): HTMLElement {
    const v = w.config[f.key];
    const help = f.help ? h('span', { class: 'hint' }, f.help) : null;
    const wrapField = (control: Child, extra?: Child) => h('label', { class: 'field' }, f.label + ('required' in f && f.required ? ' *' : ''), control, extra, help);
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
        return h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: typeof v === 'boolean' ? v : f.default, onchange: (e: Event) => set(f.key, (e.target as HTMLInputElement).checked) }), f.label, help);
      case 'album': // shortcut: a typed Immich album id; upgrade to a picker over GET /api/photos/albums
        return wrapField(text(v, 'album id', (s) => set(f.key, s.trim() === '' ? undefined : s.trim())), h('span', { class: 'hint' }, 'The Immich album id (from the album page address).'));
      case 'entity':
        return wrapField(text(v, f.domains[0] + '.name', (s) => set(f.key, s.trim() === '' ? undefined : s.trim())), h('span', { class: 'hint' }, 'A Home Assistant entity id (' + f.domains.join(', ') + ').'));
      case 'entities': {
        const list = Array.isArray(v) ? (v as unknown[]).map(String) : [];
        const put = (next: string[], rerender: boolean) => set(f.key, next.length ? next : undefined, rerender);
        return h('div', { class: 'field' },
          h('span', null, f.label + ('required' in f && f.required ? ' *' : '') + ' (' + list.length + ' of ' + f.max + ', in card order)'),
          ...list.map((e, j) =>
            h('div', { class: 'line' },
              text(e, f.domains[0] + '.name', (s) => { list[j] = s.trim(); put(list.slice(), false); }, { 'aria-label': f.label + ' ' + (j + 1) }),
              btn('↑', () => { const n = list.slice(); [n[j - 1], n[j]] = [n[j], n[j - 1]]; put(n, true); }, 'small ghost', { 'aria-label': 'Move up', disabled: j === 0 }),
              btn('↓', () => { const n = list.slice(); [n[j + 1], n[j]] = [n[j], n[j + 1]]; put(n, true); }, 'small ghost', { 'aria-label': 'Move down', disabled: j === list.length - 1 }),
              btn('✕', () => put(list.filter((_, k) => k !== j), true), 'small ghost', { 'aria-label': 'Remove entity' }),
            ),
          ),
          btn('Add an entity', () => put(list.concat(''), true), 'small ghost', { disabled: list.length >= f.max }),
          h('span', { class: 'hint' }, 'Entity ids of ' + f.domains.join(', ') + '. Readings only: the card never controls anything.'),
          help,
        );
      }
    }
  }

  function settings(): Child[] {
    const bg = layout.background;
    const color = bg.kind === 'color' ? bg.color : '#f6f1e7';
    const when = publishedAt ? new Date(publishedAt).toLocaleString() : '';
    return [
      h('div', { class: 'card' },
        h('h3', null, 'Appearance'),
        bg.kind !== 'color' && h('p', { class: 'hint' }, 'The layout uses a ' + bg.kind + ' background. Choosing a colour replaces it.'),
        h('div', { class: 'line swatches' },
          ...SWATCHES.map((c) => h('button', { type: 'button', class: 'swatch' + (c === color ? ' on' : ''), 'aria-label': 'Background ' + c, style: 'background:' + c, onclick: () => edit(E.setBackgroundColor(layout, c)) })),
          h('input', { type: 'color', value: color, 'aria-label': 'Background colour', onchange: (e: Event) => edit(E.setBackgroundColor(layout, (e.target as HTMLInputElement).value)) }),
        ),
        h('p', { class: 'hint' }, 'The Dashboard background on the TV. Text outside the tiles follows it.'),
        h('div', { class: 'line' }, btn('Time of day', () => edit(E.setBackgroundDayCycle(layout)), 'small ghost', { disabled: bg.kind === 'daycycle' })),
        h('p', { class: 'hint' }, 'Four mountain lake pictures by the TV’s clock: morning 6 to 10, midday 10 to 17, evening 17 to 21, night 21 to 6.'),
        h('div', { class: 'line' }, btn('Slideshow of the newest photos', () => edit(E.setBackgroundStream(layout)), 'small ghost', { disabled: bg.kind === 'slideshow' && bg.album === STREAM })),
        h('p', { class: 'hint' }, 'Needs Immich. The household Dashboard only; Kids Mode keeps its own background.'),
      ),
      h('div', { class: 'card' },
        h('h3', null, 'TV'),
        h('p', null, tv ? 'The Server sees the TV as ' + (tv.tv === 'pending' ? 'on, not confirmed yet' : tv.tv) + '.' : 'The TV’s state is not available.'),
        h('p', null, 'Revision ' + base + (when ? ', published ' + when : '') + '.'),
        h('p', { class: 'hint' }, 'To sign the TV in again, open Settings on the TV, choose Sign in again, and scan the QR code with this phone.'),
      ),
      h('div', { class: 'card' },
        h('h3', null, 'Kids Mode'),
        h('p', { class: 'hint' }, 'Approved apps, daily minutes, Top-up and the PIN have their own page.'),
        h('a', { class: 'button', href: '/kids' }, 'Kids Mode'),
      ),
      h('div', { class: 'card' },
        h('h3', null, 'Integrations'),
        h('p', { class: 'hint' }, 'Home Assistant, the calendar and photo sources are set up on the Server (its environment), not here. A widget that cannot reach its source says so on its card.'),
      ),
    ];
  }

  // ---- Wiring ----
  $('preview-kids').addEventListener('change', (e) => { kids = (e.target as HTMLInputElement).checked; pushPreview(); });
  window.addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && dirty) void save(); }); // leaving the page (a phone switching apps) saves
  void load();
}
