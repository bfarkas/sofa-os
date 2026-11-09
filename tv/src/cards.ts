// Draws widget cards and the full-screen view from the display templates (ADR 0003). No decisions are made here: widgets.ts
// says what a card shows, this file lays it out. Text goes in with textContent only. A card that fails to draw shows as
// unavailable, so one bad widget never breaks the Dashboard.
import { DASH, ITEM_LIMITS, type CardSize, type Display, type Reading } from '@sofa/shared';
import { cardView, emptyState, type CardView, type WidgetsState } from './widgets.ts';

/** The Server address, for photo paths. main.ts sets it. */
export const cardOptions = { server: '' };
let state: WidgetsState = emptyState();

export function setWidgetsState(s: WidgetsState): void {
  state = s;
}

/** What widget `id` (the layout's id) shows now. */
export const viewFor = (id: string, fallbackTitle: string): CardView => cardView(state, id, fallbackTitle, Date.now());

function h(tag: string, cls: string, text?: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

function reading(parent: HTMLElement, cls: string, value: Reading, unit?: string): HTMLElement {
  const el = parent.appendChild(h('span', cls + (value === null ? ' missing' : ''), value === null ? DASH : value));
  if (unit) el.appendChild(h('span', 'u', unit));
  return el;
}

function template(d: Display, size: CardSize): HTMLElement {
  const body = h('div', 'w-body t-' + d.template);
  if (d.template === 'value') {
    reading(body.appendChild(h('div', 'v-main')), 'v-num', d.value, d.unit);
    if (d.note) body.appendChild(h('div', 'v-note', d.note));
  } else if (d.template === 'list') {
    for (const r of d.rows.slice(0, ITEM_LIMITS.list[size])) {
      const row = body.appendChild(h('div', 'r'));
      row.appendChild(h('span', 'r-l', r.label));
      reading(row, 'r-v', r.value, r.unit);
    }
  } else if (d.template === 'columns') {
    const bars = d.columns.some((c) => c.level !== undefined);
    const cols = body.appendChild(h('div', 'cols'));
    for (const c of d.columns.slice(0, ITEM_LIMITS.columns[size])) {
      const col = cols.appendChild(h('div', 'c'));
      col.appendChild(h('div', 'c-l', c.label));
      if (bars) {
        const bar = col.appendChild(h('div', 'c-bar')).appendChild(h('div', 'c-fill'));
        bar.style.height = (c.value === null || c.level === undefined ? 0 : Math.round(c.level * 100)) + '%';
      }
      reading(col.appendChild(h('div', 'c-v')), '', c.value, c.unit);
      if (c.note) col.appendChild(h('div', 'c-n', c.note));
    }
    if (d.note) body.appendChild(h('div', 'v-note', d.note));
  } else if (d.template === 'agenda') {
    // Day titles and events share the lines; a day title with no event after it is dropped.
    const lines: HTMLElement[] = [];
    for (const day of d.days) {
      if (!day.events.length) continue;
      lines.push(h('div', 'a-day', day.title));
      for (const e of day.events) {
        const line = h('div', 'a-ev');
        line.appendChild(h('span', 'a-t', e.time));
        const what = line.appendChild(h('span', 'a-w', e.title));
        if (e.detail && size !== 'small') what.appendChild(h('span', 'a-d', '  ' + e.detail));
        lines.push(line);
      }
    }
    const shown = lines.slice(0, ITEM_LIMITS.agenda[size]);
    if (shown.length && shown[shown.length - 1].className === 'a-day') shown.pop();
    for (const l of shown) body.appendChild(l);
  } else if (d.template === 'photo') {
    const img = body.appendChild(h('img', 'ph')) as HTMLImageElement;
    img.onerror = () => body.classList.add('noimg');
    img.src = cardOptions.server + d.image;
    if (d.caption) body.appendChild(h('div', 'ph-cap', d.caption));
  }
  return body;
}

function draw(el: HTMLElement, v: CardView, size: CardSize, note: string): void {
  el.innerHTML = '';
  const head = el.appendChild(h('div', 'w-head'));
  head.appendChild(h('div', 'w-title', v.title));
  const stale = (v.state === 'ok' || v.state === 'empty') && v.stale;
  // The stale mark says when the data is from; the full-screen view always says it.
  let when = stale || (size === 'full' && (v.state === 'ok' || v.state === 'empty')) ? (v as { updated: string }).updated : note;
  if (stale && size === 'small') when = when.replace('Updated ', ''); // a small tile has no room for the word and the title
  if (when) head.appendChild(h('div', 'w-when', when));
  if (v.state === 'ok') el.appendChild(template(size === 'full' ? v.detail : v.card, size));
  else el.appendChild(h('div', 'w-body w-msg', v.state === 'loading' ? 'Loading…' : v.message));
}

const STATES = ['w-ok', 'w-empty', 'w-unavailable', 'w-loading', 'w-stale', 'w-photo'];

/** Fills a widget tile (or the full-screen panel) with its card. `note` shows in the corner when nothing more urgent does. */
export function drawCard(el: HTMLElement, id: string, fallbackTitle: string, size: CardSize, note = ''): void {
  let v = viewFor(id, fallbackTitle);
  for (const c of STATES) el.classList.remove(c);
  try {
    draw(el, v, size, note);
  } catch {
    v = { state: 'unavailable', title: fallbackTitle, message: 'Not available right now' };
    draw(el, v, size, note);
  }
  el.classList.add('w-' + v.state);
  if ((v.state === 'ok' || v.state === 'empty') && v.stale) el.classList.add('w-stale');
  if (v.state === 'ok' && (size === 'full' ? v.detail : v.card).template === 'photo') el.classList.add('w-photo');
}
