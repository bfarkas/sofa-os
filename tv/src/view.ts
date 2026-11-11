// Draws the shell (shell.ts) into tv/app/index.html and shows which id has focus. No decisions are made here.
import { drawCard } from './cards.ts';
import type { Icons } from './icons.ts';
import { PAD_ROWS } from './kids.ts';
import { clockText, greetingText, longDateText, TABS, type Tile, type View } from './shell.ts';

const $ = (id: string) => document.getElementById(id)!;
function h(tag: string, cls: string, text?: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

const fixed: Record<string, HTMLElement> = {}; // the bar, the sign-in button and the Settings rows: always in the page
let tiles: Record<string, HTMLElement> = {}; // the tiles of the current tab, redrawn with it
let cards: Record<string, Tile> = {}; // its widget tiles, redrawn on their own when widget data changes
let mode: View['mode'] = 'signin';
let tab = '';
let focusId: string | null = null;
let icons: Icons | undefined; // the app icons (icons.ts); without them every app shows its letter

export function initView(appIcons?: Icons): void {
  icons = appIcons;
  for (const t of TABS) {
    const el = h('div', 'pill', t.label);
    $('tabs').appendChild(el);
    fixed['tab:' + t.id] = el;
  }
  ['set:server', 'set:again', 'set:close', 'kids:exit', 'done:adults', 'full:close', 'menu:move', 'menu:remove', 'menu:add'].forEach((id) => (fixed[id] = $(id)));
  // The PIN pad: three keys to a row, the ids are the focus grid (kids.ts PAD_ROWS).
  for (const ids of PAD_ROWS) {
    const row = $('pin-keys').appendChild(h('div', 'pin-row'));
    for (const id of ids) {
      const key = row.appendChild(h('div', 'pkey', id === 'pin:del' ? 'Delete' : id === 'pin:close' ? 'Close' : id.slice(4)));
      if (id.length > 5) key.className += ' word';
      fixed[id] = key;
    }
  }
  for (let i = 0; i < 4; i++) $('pin-dots').appendChild(h('span', 'dot'));
}

/** The PIN pad's dots and the line under them. */
export function renderPad(count: number, note: string): void {
  const dots = $('pin-dots').children;
  for (let i = 0; i < dots.length; i++) dots[i].className = 'dot' + (i < count ? ' on' : '');
  $('pin-note').textContent = note;
}

const find = (id: string): HTMLElement | undefined => (id === 'settings' ? $(mode === 'home' ? 'bar-settings' : 'signin-settings') : tiles[id] || fixed[id]);

/** The letter stays until the TV's own icon has loaded; if it never does, nothing changes. */
function showIcon(badge: HTMLElement, appId: string): void {
  const first = icons && icons.src(appId);
  if (!icons || !first) return;
  const img = new Image();
  img.alt = '';
  img.onload = () => {
    icons!.loaded(appId, img.getAttribute('src') || '');
    badge.textContent = '';
    badge.appendChild(img);
    badge.className += ' icon';
    if (badge.parentElement) badge.parentElement.className += ' iconed';
  };
  img.onerror = () => {
    const next = icons!.failed(appId, img.getAttribute('src') || '');
    if (next) img.src = next;
  };
  img.src = first;
}

function tileEl(t: Tile): HTMLElement {
  const el = h('div', 'tile ' + t.kind + (t.size ? ' ' + t.size : '') + (t.unavailable ? ' unavailable' : '') + (t.lifted ? ' lifted' : ''));
  if (t.kind === 'kids') {
    // Composed here, not a picture: a lavender panel, the forest fading in on the right, the unicorn, live text.
    const uni = h('img', 'uni');
    uni.setAttribute('src', t.unavailable ? 'img/unicorn-sleeping.png' : 'img/unicorn-welcome.png');
    uni.setAttribute('alt', '');
    el.appendChild(uni);
    const text = el.appendChild(h('div', 'kt'));
    text.appendChild(h('div', 'label', t.label));
    if (t.detail) text.appendChild(h('div', 'detail', t.detail));
    if (!t.unavailable) el.appendChild(h('div', 'go', '\u2192'));
    return el;
  }
  if (t.kind === 'widget') {
    drawCard(el, t.id.slice(7), t.label, t.size || 'medium', t.detail);
    return el;
  }
  const badge = el.appendChild(h('div', 'badge', t.kind === 'allapps' ? '+' : t.label.charAt(0).toUpperCase()));
  if (t.kind === 'app') showIcon(badge, t.id.slice(4));
  el.appendChild(h('div', 'label', t.label));
  if (t.detail) el.appendChild(h('div', 'detail', t.detail));
  return el;
}

export function render(v: View): void {
  mode = v.mode;
  const kids = v.mode === 'kids';
  $('bar').hidden = v.mode !== 'home';
  $('content').hidden = v.mode !== 'home' && !kids;
  $('content').className = kids ? 'kidsview' : v.tab === 'dashboard' ? 'dashview' : '';
  $('kids-head').hidden = !kids;
  $('done').hidden = v.mode !== 'done';
  $('foot').hidden = kids || v.mode === 'done'; // the Server line is for adults
  $('signin').hidden = v.mode !== 'signin';
  TABS.forEach((t) => fixed['tab:' + t.id].classList.toggle('sel', t.id === v.tab));

  const content = $('content');
  const keepScroll = content.scrollTop;
  content.innerHTML = '';
  tiles = {};
  cards = {};
  if (v.mode === 'home' || kids) {
    if (v.mode === 'home' && v.tab === 'dashboard') updateClock(new Date());
    // On the Dashboard and in Kids Mode the rows sit at the bottom, with the wallpaper or the forest showing above them.
    const host = v.tab === 'dashboard' || kids ? content.appendChild(h('div', '')) : content;
    if (host !== content) host.id = 'dash';
    for (const s of v.sections) {
      const sec = h('div', 'section');
      // Layout B: the Dashboard's first row is the greeting on the left, the Kids Mode tile on the right.
      const hello = v.mode === 'home' && v.tab === 'dashboard' && s.tiles[0].kind === 'kids';
      const row = sec.appendChild(h('div', 'row' + (hello ? ' hello' : '')));
      if (hello) {
        const greet = row.appendChild(h('div', 'greet'));
        greet.appendChild(h('h1', '', greetingText(new Date()))).id = 'greet-hello';
        greet.appendChild(h('p', '', longDateText(new Date()))).id = 'greet-date';
      }
      for (const t of s.tiles) {
        row.appendChild((tiles[t.id] = tileEl(t)));
        if (t.kind === 'widget') cards[t.id] = t;
      }
      host.appendChild(sec);
    }
    if (v.message) {
      const m = h('div', '', v.message);
      m.id = 'message';
      host.appendChild(m);
    }
  }
  $('lift-hint').hidden = !v.sections.some((s) => s.tiles.some((t) => !!t.lifted));
  content.scrollTop = v.tab === 'dashboard' && !kids ? content.scrollHeight : v.tab === tab ? keepScroll : 0; // the Dashboard starts with its last row (the apps) in view
  tab = v.tab;
  setFocus(focusId);
}

/** Draws the widget cards again in place (new data, or time made one stale); focus and scroll stay. */
export function redrawCards(): void {
  for (const id in cards) drawCard(tiles[id], id.slice(7), cards[id].label, cards[id].size || 'medium', cards[id].detail);
}

export function updateClock(d: Date): void {
  $('time').textContent = clockText(d);
  const hello = document.getElementById('greet-hello'), day = document.getElementById('greet-date');
  if (hello && day) {
    hello.textContent = greetingText(d);
    day.textContent = longDateText(d);
  }
}

/** Highlights `id` and scrolls its row into view: its section vertically (the first one all the way up), the tile horizontally. */
export function setFocus(id: string | null): void {
  for (const el of document.querySelectorAll('.focus')) el.classList.remove('focus');
  focusId = id;
  const el = id ? find(id) : undefined;
  if (!el) return;
  el.classList.add('focus');
  const sec = el.closest('.section');
  const content = $('content');
  if (!sec) {
    if (content.className === 'dashview') content.scrollTop = content.scrollHeight; // back on the bar: the apps row is in view again
    return;
  }
  const c = content.getBoundingClientRect(), s = sec.getBoundingClientRect();
  if (sec === content.querySelector('.section')) content.scrollTop = 0;
  else if (s.top < c.top) content.scrollTop += s.top - c.top;
  else if (s.bottom > c.bottom) content.scrollTop += s.bottom - c.bottom;
  const row = el.parentElement!, r = row.getBoundingClientRect(), t = el.getBoundingClientRect();
  if (t.left < r.left + 40) row.scrollLeft -= r.left + 40 - t.left;
  else if (t.right > r.right - 40) row.scrollLeft += t.right - (r.right - 40);
}
