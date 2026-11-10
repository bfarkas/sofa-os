// The whole Dashboard in the desktop browser: Sofa Home's own index.html, shell.ts, view.ts and cards.ts with a fixture layout and
// fixture widget data (no Server, no TV). The arrow keys, Enter and Escape drive it like the remote. Not part of the signed package.
//   npm run harness -w tv, serve tv/ (python3 -m http.server 8077 -d tv), open /harness/dash.html at 1920 x 1080.
// Query: ?tab=apps|widgets, ?focus=<id> (kids, widget:weather, app:org.tizen.netflix-app, allapps), ?screen=kids, ?apps=N (more apps),
//   ?day=H (0 to 23: the day-cycle background as at that hour, through the real photoview; setDayHour(h) in the console changes it), ?rows=N (more widget rows, to see the column give way), ?bg=<css colour or url>, ?state=stale|unavailable.
import { dayFootInk, dayInk, periodAt, tokensCss, type Layout, type WidgetData } from '@sofa/shared';
import { cardOptions, setWidgetsState } from '../src/cards.ts';
import type { RemoteEvent, RemoteKey } from '../src/keys.ts';
import { createPhotoView } from '../src/photoview.ts';
import { createShell } from '../src/shell.ts';
import { initView, redrawCards, render, setFocus, updateClock } from '../src/view.ts';
import { parseWidgets } from '../src/widgets.ts';

const q = new URLSearchParams(location.search);
const now = Date.now();
const ago = (s: number) => new Date(now - s * 1000).toISOString();
const w = (id: string, title: string, over: Partial<WidgetData>): WidgetData => ({ id, title, status: 'ok', updatedAt: ago(20), failing: false, staleAfterSeconds: 180, ...over });
const stale = q.get('state') === 'stale', down = q.get('state') === 'unavailable';

const widgets: WidgetData[] = [
  w('weather', 'Weather', { card: { template: 'value', value: '4', unit: '°C', note: 'Cloudy, high 7°, low 2°' } }),
  w('calendar', 'Calendar', { card: { template: 'days', days: [{ title: 'Today', today: true, events: [{ time: '16:30', title: 'Elternabend der Klasse 2b mit dem langen Titel, der abgeschnitten wird' }, { time: '', title: 'and 3 more today' }] }] } }),
  w('energy', 'Power', { card: { template: 'value', value: '1807', unit: 'W', note: 'Right now' } }),
  w('photos', 'Summer 2026', { card: { template: 'photo', image: '/app/img/kids-tile-forest.jpg', caption: 'Forest walk' } }),
  w('home', 'Living room', { card: { template: 'list', rows: [{ label: 'Temperature', value: '21.5', unit: '°C' }, { label: 'Humidity', value: '48', unit: '%' }, { label: 'CO2', value: '640', unit: 'ppm' }] } }),
];
if (down) for (const x of widgets) Object.assign(x, { status: 'unavailable', message: 'Home Assistant is not reachable', updatedAt: null, card: undefined });
if (stale) for (const x of widgets) Object.assign(x, { updatedAt: ago(3 * 3600) });

const names: [string, string][] = [['org.tizen.netflix-app', 'Netflix'], ['com.samsung.tv.cobalt-yt', 'YouTube'], ['kIciSQlYEM.plex', 'Plex'], ['SrAoJxGQUf.ARD', 'ARD'], ['yPSlpvfeTf.ZDFmediathek', 'ZDF'], ['mvOizTfhQn.KiKAplayer', 'KiKA']];
const extra = Math.max(0, Number(q.get('apps') || 0));
const apps = names.map(([id, name]) => ({ id, name })).concat(Array.from({ length: extra }, (_, i) => ({ id: 'x.App' + i, name: 'App ' + (i + 1) })));
const extraRows = Math.max(0, Number(q.get('rows') || 0));
const item = (id: string) => ({ kind: 'widget' as const, id });
const layout: Layout = {
  schema: 1,
  apps,
  widgets: widgets.map((x) => ({ id: x.id, type: x.id, size: 'small' as const, config: {}, profiles: ['household' as const, 'kids' as const], freshness: 'hourly' as const })),
  rows: [{ id: 'today', title: 'Today', items: widgets.map((x) => item(x.id)) }]
    .concat(Array.from({ length: extraRows }, (_, i) => ({ id: 'more' + i, title: 'More ' + i, items: widgets.map((x) => item(x.id)) })))
    .concat([{ id: 'apps', title: 'My Apps', items: apps.slice(0, 8).map((a) => ({ kind: 'app' as const, id: a.id })) as never }]),
  background: { kind: 'color', color: '#f6f1e7' },
  kidsMode: { apps: names.map(([id]) => id), dailyMinutes: 40 },
};

(async () => {
  // Sofa Home's own page: its markup and stylesheet, without main.js. <base href="/app/"> in dash.html makes img/ and cards.css resolve.
  const html = await (await fetch('/app/index.html', { cache: 'no-store' })).text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const el of Array.from(doc.head.querySelectorAll('style, link[rel=stylesheet]'))) document.head.appendChild(document.importNode(el, true));
  const st = document.createElement('style');
  st.textContent = tokensCss();
  document.head.insertBefore(st, document.head.firstChild);
  document.body.innerHTML = doc.body.innerHTML.replace(/<script[\s\S]*?<\/script>/g, '');
  await new Promise((r) => setTimeout(r, 200)); // the stylesheets

  const kids = q.get('screen') === 'kids';
  const bg = q.get('bg');
  document.body.className = kids ? 'kids' : '';
  document.body.style.background = kids ? "#26331f url(img/kids-forest-midday.jpg) center / cover no-repeat" : bg ? (/^[#a-z]/i.test(bg) && !bg.includes('/') ? bg : 'url(' + bg + ') center / cover no-repeat') : '#f6f1e7';
  if (!kids && !bg) document.getElementById('stage')!.style.setProperty('--on-bg', '#2b2f2a');
  else if (!kids) document.getElementById('stage')!.style.setProperty('--on-bg', '#fffdf8');

  const day = q.get('day');
  if (day !== null && !kids) {
    const view = createPhotoView({ server: () => '', images: () => Promise.reject(new Error('no photos in the harness')) });
    const setDayHour = (h: number) => {
      const p = periodAt(h);
      document.body.style.background = '#1f241e';
      document.getElementById('stage')!.style.setProperty('--on-bg', dayInk(p));
      document.getElementById('stage')!.style.setProperty('--on-foot', dayFootInk(p));
      view.setBackground({ day: p });
    };
    setDayHour(Number(day));
    (window as unknown as { setDayHour: typeof setDayHour }).setDayHour = setDayHour;
  }
  cardOptions.server = '';
  initView();
  const shell = createShell({ onView: render, onFocus: setFocus });
  shell.setMode('home');
  shell.setScreen(kids ? 'kids' : 'household');
  setWidgetsState(parseWidgets({ serverTime: new Date(now).toISOString(), widgets }, now)!);
  shell.setLayout(layout);
  redrawCards();
  updateClock(new Date());
  document.getElementById('foot')!.textContent = 'Server sofa.familie-farkas.de   ·   Revision 46   ·   Live';
  const tab = q.get('tab');
  if (tab === 'apps' || tab === 'widgets') shell.focus.focus('tab:' + tab);
  const focus = q.get('focus');
  if (focus) shell.focus.focus(focus);

  const KEYS: Record<string, RemoteKey> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', Enter: 'ok', Escape: 'back' };
  addEventListener('keydown', (e) => {
    const key = KEYS[e.key];
    if (!key) return;
    e.preventDefault();
    shell.key({ key, long: false } as RemoteEvent);
  });
  (window as unknown as { shell: typeof shell }).shell = shell;

})();
