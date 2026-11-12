// Draws widget cards and the full-screen view from the display templates (ADR 0003). No decisions are made here: widgets.ts
// says what a card shows, this file lays it out. Text goes in with textContent only. A card that fails to draw shows as
// unavailable, so one bad widget never breaks the Dashboard.
import { DASH, ITEM_LIMITS, TONES, type CardSize, type Column, type Display, type Reading } from '@sofa/shared';

const SVG = 'http://www.w3.org/2000/svg';
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
  if (unit) el.appendChild(h('span', 'u' + (unit === '\u00b0' ? ' deg' : ''), unit));
  return el;
}

/** The chart's line as SVG path data in a 0..1000 by 0..100 box; each gap (null) starts a new stretch. Also the closed shape under it. */
export function chartPaths(points: (number | null)[]): { line: string; fill: string } {
  let line = '', fill = '', start = -1;
  const x = (i: number) => (points.length < 2 ? 500 : Math.round((i / (points.length - 1)) * 1000));
  const y = (v: number) => Math.round((1 - v) * 100);
  const close = (end: number) => {
    if (start >= 0) fill += 'L' + x(end) + ',100L' + x(start) + ',100Z';
    start = -1;
  };
  points.forEach((v, i) => {
    if (v === null) return close(i - 1);
    line += (start < 0 ? 'M' : 'L') + x(i) + ',' + y(v);
    if (start < 0) {
      fill += 'M' + x(i) + ',' + y(v);
      start = i;
    } else fill += 'L' + x(i) + ',' + y(v);
  });
  close(points.length - 1);
  return { line, fill };
}

/** A column's classes. A tone makes it a tile with a lid in that colour; a word ("Today") is drawn smaller than a count. */
export function columnClass(c: Column): string {
  return 'c' + (c.tint !== undefined ? ' tinted' : '') + (c.tone ? ' toned tone-' + c.tone : '') + (c.tone && c.value !== null && !/^\d+$/.test(c.value) ? ' word' : '');
}

/** The class that fills a whole card with a bin colour, or '' (only a `value` display has a tone). */
export const toneClass = (d: Display): string => (d.template === 'value' && d.tone ? 'tone-' + d.tone : '');

function template(d: Display, size: CardSize): HTMLElement {
  if (d.template === 'stack' && size !== 'full') return template(d.parts[0].display, size); // a card has room for the first part only
  const body = h('div', 'w-body t-' + d.template);
  if (d.template === 'value') {
    reading(body.appendChild(h('div', 'v-main')), 'v-num', d.value, d.unit);
    if (d.note) body.appendChild(h('div', 'v-note', d.note));
    for (const line of (d.lines ?? []).slice(0, ITEM_LIMITS.lines[size])) body.appendChild(h('div', 'v-line', line));
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
      // A tone makes the column a tile with a lid in that colour; a word ("Today") is drawn smaller than a count.
      const col = cols.appendChild(h('div', columnClass(c)));
      if (c.tint) col.style.backgroundColor = 'rgba(110, 175, 240, ' + (c.tint * 0.42).toFixed(2) + ')';
      col.appendChild(h('div', 'c-l', c.label));
      if (bars) {
        const bar = col.appendChild(h('div', 'c-bar')).appendChild(h('div', 'c-fill'));
        bar.style.height = (c.value === null || c.level === undefined ? 0 : Math.round(c.level * 100)) + '%';
      }
      reading(col.appendChild(h('div', 'c-v')), '', c.value, c.unit);
      if (c.note) col.appendChild(h('div', 'c-n', c.note));
      if (c.badge) col.appendChild(h('div', 'c-b' + (c.tint !== undefined && c.tint < 0.2 ? ' dim' : ''), c.badge)); // a low chance is dimmed
    }
    if (d.note) body.appendChild(h('div', 'v-note', d.note));
  } else if (d.template === 'agenda') {
    // Day titles and events share the lines; a day title with no event after it is dropped.
    const lines: HTMLElement[] = [];
    for (const day of d.days) {
      if (!day.events.length && !day.note) continue; // a day with only a note (an all-day event, "+2 more") still has its header
      const head = h('div', 'a-day' + (day.note ? ' has-note' : ''));
      head.appendChild(h('span', 'a-dt', day.title));
      if (day.note) head.appendChild(h('span', 'a-dn', day.note));
      lines.push(head);
      for (const e of day.events) {
        // An event with no time is the Server's own quiet line ("Nothing more today", "and 2 more"); `now` lights the time, `past` fades the row.
        const line = h('div', 'a-ev' + (e.time ? '' : ' q') + (e.now ? ' now' : '') + (e.past ? ' past' : ''));
        if (e.time) line.appendChild(h('span', 'a-t', e.time));
        const what = line.appendChild(h('span', 'a-w', e.title));
        if (e.detail && size !== 'small') what.appendChild(h('span', 'a-d', '  ' + e.detail));
        lines.push(line);
      }
    }
    const shown = lines.slice(0, ITEM_LIMITS.agenda[size]);
    if (shown.length && shown[shown.length - 1].className === 'a-day') shown.pop();
    for (const l of shown) body.appendChild(l);
  } else if (d.template === 'days') {
    const shownDays = d.days.slice(0, ITEM_LIMITS.days[size]);
    const spans = (d.spans ?? []).filter((b) => b.from < shownDays.length);
    const lanes = spans.reduce((m, b) => Math.max(m, b.lane + 1), 0);
    for (const day of shownDays) {
      const col = body.appendChild(h('div', 'dy' + (day.today ? ' today' : '')));
      const hd = col.appendChild(h('div', 'dy-hd'));
      hd.appendChild(h('div', 'dy-h', day.title));
      if (day.subtitle) hd.appendChild(h('div', 'dy-s', day.subtitle));
      if (lanes) col.appendChild(h('div', 'dy-sp')).style.height = lanes * 46 + 6 + 'px'; // room for the bars that cross the columns (drawn below, over this)
      const cap = ITEM_LIMITS.dayEvents[size];
      // All-day events first, as the Server may send them in start order.
      const events = day.events.filter((e) => e.allDay).concat(day.events.filter((e) => !e.allDay));
      for (const e of events.slice(0, cap < events.length ? cap - 1 : cap)) {
        const ev = col.appendChild(h('div', 'dy-e' + (e.allDay ? ' all' : '') + (e.time ? '' : ' q') + (e.now ? ' now' : '') + (e.past ? ' past' : '')));
        ev.appendChild(h('div', 'dy-t', e.time));
        ev.appendChild(h('div', 'dy-w', e.title));
        if (e.detail && (size === 'full' || size === 'large')) ev.appendChild(h('div', 'dy-p', e.detail));
      }
      if (events.length > cap) col.appendChild(h('div', 'dy-more', '\u2026'));
    }
    // Bars across the columns: a column is (100% + 8px) / n wide including its 8 px margin, so the position is a calc() on the index.
    for (const b of spans) {
      const bar = body.appendChild(h('div', 'dy-bar' + (b.clipStart ? ' clip-s' : '') + (b.clipEnd ? ' clip-e' : ''), b.title));
      const to = Math.min(b.to, shownDays.length - 1);
      bar.style.left = 'calc(' + b.from + ' * (100% + 8px) / ' + shownDays.length + ')';
      bar.style.width = 'calc(' + (to - b.from + 1) + ' * (100% + 8px) / ' + shownDays.length + ' - 8px)';
      bar.style.top = 98 + b.lane * 46 + 'px';
    }
  } else if (d.template === 'chart') {
    const wrap = body.appendChild(h('div', 'ch'));
    const y = wrap.appendChild(h('div', 'ch-y'));
    y.appendChild(h('span', '', d.max ?? ''));
    y.appendChild(h('span', '', d.min ?? ''));
    const plot = wrap.appendChild(h('div', 'ch-plot'));
    const paths = chartPaths(d.points);
    const svg = plot.appendChild(document.createElementNS(SVG, 'svg'));
    svg.setAttribute('viewBox', '0 0 1000 100');
    svg.setAttribute('preserveAspectRatio', 'none');
    for (const [cls, data] of [['ch-fill', paths.fill], ['ch-line', paths.line]]) {
      const path = svg.appendChild(document.createElementNS(SVG, 'path'));
      path.setAttribute('class', cls);
      path.setAttribute('d', data);
    }
    // Rain bars (Session 35) stand on the same hours as the line: one per point, a point's x position, the full height being `barMax`.
    const n = d.bars ? d.bars.length : 0;
    (d.bars ?? []).forEach((v, i) => {
      if (!v) return;
      const bar = plot.appendChild(h('div', 'ch-bar'));
      bar.style.left = (n < 2 ? 50 : (i / (n - 1)) * 100) + '%';
      bar.style.height = Math.round(v * 100) + '%';
    });
    if (d.bars && d.barMax) {
      const r = wrap.appendChild(h('div', 'ch-r'));
      r.appendChild(h('span', '', d.barMax));
      r.appendChild(h('span', '', '0'));
    }
    const last = d.points.length - 1;
    if (d.now && last >= 0 && d.points[last] !== null) {
      const dot = plot.appendChild(h('div', 'ch-now'));
      dot.style.left = (last === 0 ? 50 : 100) + '%';
      dot.style.bottom = Math.round((d.points[last] as number) * 100) + '%';
    }
    if (d.axis && d.axis.length) {
      const x = body.appendChild(h('div', d.bars ? 'ch-x br' : 'ch-x'));
      for (const a of d.axis) x.appendChild(h('span', '', a));
    }
    if (d.note) body.appendChild(h('div', 'v-note', d.note));
  } else if (d.template === 'stack') {
    for (const part of d.parts) {
      const box = body.appendChild(h('div', 'sk'));
      if (part.title) box.appendChild(h('div', 'sk-t', part.title));
      box.appendChild(template(part.display, size));
    }
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
  const when = stale || (size === 'full' && (v.state === 'ok' || v.state === 'empty')) ? (v as { updated: string }).updated : note;
  // A small tile has no room for the mark beside the title, so it gets a line of its own (on a photo, a shade at the top).
  const onOwnLine = stale && size === 'small';
  if (when && !onOwnLine) head.appendChild(h('div', 'w-when', when));
  if (when && onOwnLine) el.appendChild(h('div', 'w-stale-line', when.replace(/^(Updated) \w{3} /, '$1 '))); // 'Updated Tue 10 Nov 21:02' loses its weekday to fit 271 px
  if (v.state === 'ok') el.appendChild(template(size === 'full' ? v.detail : v.card, size));
  else el.appendChild(h('div', 'w-body w-msg', v.state === 'loading' ? 'Loading…' : v.message));
}

const STATES = ['w-ok', 'w-empty', 'w-unavailable', 'w-loading', 'w-stale', 'w-photo', 'w-tall'].concat(TONES.map((t) => 'tone-' + t));

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
  if (v.state === 'ok') {
    const d = size === 'full' ? v.detail : v.card;
    if (d.template === 'photo') el.classList.add('w-photo');
    if (size === 'full' && d.template === 'stack') el.classList.add('w-tall'); // a chart over days needs more height than the other full views
    if (toneClass(d)) el.classList.add(toneClass(d));
  }
}
