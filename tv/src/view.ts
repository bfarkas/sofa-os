// Draws the shell (shell.ts) into tv/app/index.html and shows which id has focus. No decisions are made here.
import { clockText, dateText, greeting, TABS, type Tile, type View } from './shell.ts';

const $ = (id: string) => document.getElementById(id)!;
function h(tag: string, cls: string, text?: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

const fixed: Record<string, HTMLElement> = {}; // the bar, the sign-in button and the Settings rows: always in the page
let tiles: Record<string, HTMLElement> = {}; // the tiles of the current tab, redrawn with it
let mode: View['mode'] = 'signin';
let tab = '';
let focusId: string | null = null;
let greetingEl: HTMLElement | null = null;

export function initView(): void {
  for (const t of TABS) {
    const el = h('div', 'pill', t.label);
    $('tabs').appendChild(el);
    fixed['tab:' + t.id] = el;
  }
  ['set:server', 'set:again', 'set:close'].forEach((id) => (fixed[id] = $(id)));
}

const find = (id: string): HTMLElement | undefined => (id === 'settings' ? $(mode === 'home' ? 'bar-settings' : 'signin-settings') : tiles[id] || fixed[id]);

function tileEl(t: Tile): HTMLElement {
  const el = h('div', 'tile ' + t.kind + (t.size ? ' ' + t.size : '') + (t.unavailable ? ' unavailable' : ''));
  if (t.kind === 'widget') {
    el.appendChild(h('div', 'label', t.label));
  } else {
    el.appendChild(h('div', 'badge', t.kind === 'allapps' ? '+' : t.label.charAt(0).toUpperCase()));
    el.appendChild(h('div', 'label', t.label));
  }
  if (t.detail) el.appendChild(h('div', 'detail', t.detail));
  return el;
}

export function render(v: View): void {
  mode = v.mode;
  $('bar').hidden = $('content').hidden = v.mode !== 'home';
  $('signin').hidden = v.mode !== 'signin';
  TABS.forEach((t) => fixed['tab:' + t.id].classList.toggle('sel', t.id === v.tab));

  const content = $('content');
  const keepScroll = content.scrollTop;
  content.innerHTML = '';
  tiles = {};
  greetingEl = null;
  if (v.mode === 'home') {
    if (v.tab === 'dashboard') {
      const g = h('div', '');
      g.id = 'greeting';
      greetingEl = g.appendChild(h('h1', ''));
      g.appendChild(h('p', '', 'Relax, discover, be at home.'));
      content.appendChild(g);
      updateClock(new Date());
    }
    for (const s of v.sections) {
      const sec = h('div', 'section');
      sec.appendChild(h('div', 'section-title', s.title));
      const row = sec.appendChild(h('div', 'row'));
      for (const t of s.tiles) row.appendChild((tiles[t.id] = tileEl(t)));
      content.appendChild(sec);
    }
    if (v.message) {
      const m = h('div', '', v.message);
      m.id = 'message';
      content.appendChild(m);
    }
  }
  content.scrollTop = v.tab === tab ? keepScroll : 0;
  tab = v.tab;
  setFocus(focusId);
}

export function updateClock(d: Date): void {
  $('time').textContent = clockText(d);
  $('date').textContent = dateText(d);
  if (greetingEl) greetingEl.textContent = greeting(d.getHours());
}

/** Highlights `id` and scrolls its row into view: its section vertically (the first one all the way up), the tile horizontally. */
export function setFocus(id: string | null): void {
  for (const el of document.querySelectorAll('.focus')) el.classList.remove('focus');
  focusId = id;
  const el = id ? find(id) : undefined;
  if (!el) return;
  el.classList.add('focus');
  const sec = el.closest('.section');
  if (!sec) return;
  const content = $('content'), c = content.getBoundingClientRect(), s = sec.getBoundingClientRect();
  if (sec === content.querySelector('.section')) content.scrollTop = 0;
  else if (s.top < c.top) content.scrollTop += s.top - c.top;
  else if (s.bottom > c.bottom) content.scrollTop += s.bottom - c.bottom;
  const row = el.parentElement!, r = row.getBoundingClientRect(), t = el.getBoundingClientRect();
  if (t.left < r.left + 40) row.scrollLeft -= r.left + 40 - t.left;
  else if (t.right > r.right - 40) row.scrollLeft += t.right - (r.right - 40);
}
