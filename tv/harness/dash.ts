// The whole Dashboard in the desktop browser: Sofa Home's own index.html, shell.ts, view.ts and cards.ts with a fixture layout and
// fixture widget data (no Server, no TV). The arrow keys, Enter and Escape drive it like the remote. Not part of the signed package.
//   npm run harness -w tv, serve tv/ (python3 -m http.server 8077 -d tv), open /harness/dash.html at 1920 x 1080.
// Query: ?tab=apps|widgets, ?focus=<id> (kids, widget:weather, app:org.tizen.netflix-app, allapps), ?screen=kids, ?apps=N (more apps),
//   ?icons=<image url> (Session 30: Netflix, Plex and ARD get that picture as their icon, YouTube a path that does not load, ZDF an API error and KiKA none: the letter stays), ?day=H (0 to 23: the day-cycle background as at that hour, through the real photoview; setDayHour(h) in the console changes it), ?rows=N (more widget rows, to see the column give way), ?bg=<css colour or url>, ?state=stale|unavailable|mixed (one stale, one unavailable, one empty), ?still (no transitions, for screenshots), ?full=weather|calendar|energy|home (the full-screen view open, as OK on that widget does).
import { dayFootInk, dayInk, dayShadow, periodAt, tokensCss, type Layout, type WidgetData } from '@sofa/shared';
import { cardOptions, drawCard, setWidgetsState } from '../src/cards.ts';
import type { RemoteEvent, RemoteKey } from '../src/keys.ts';
import { createIcons } from '../src/icons.ts';
import { createPhotoView } from '../src/photoview.ts';
import { createShell } from '../src/shell.ts';
import { initView, redrawCards, render, setFocus, updateClock } from '../src/view.ts';
import { parseWidgets } from '../src/widgets.ts';

const q = new URLSearchParams(location.search);
const now = Date.now();
const ago = (s: number) => new Date(now - s * 1000).toISOString();
const w = (id: string, title: string, over: Partial<WidgetData>): WidgetData => ({ id, title, status: 'ok', updatedAt: ago(20), failing: false, staleAfterSeconds: 180, ...over });
const stale = q.get('state') === 'stale', down = q.get('state') === 'unavailable', mixed = q.get('state') === 'mixed';

// Detail fixtures as the Server sends them (weather: stack of hours over days, calendar: a week, energy: a chart).
const rainOf = [0, 0, 0.2, 0.3, 0.55, 0.7, 0.6, 0.4, 0.25, 0.15, 0, 0];
const hours = rainOf.map((t, i) => ({ label: String((19 + i) % 24).padStart(2, '0') + ':00', value: String(4 - Math.round(i / 3)), unit: '\u00b0', level: 0.8 - i * 0.04, tint: t, ...(t ? { badge: Math.round(t * 100) + ' %' } : {}) }));
const rainDay = [0.1, 0.8, 0.7, 0.3, 0.05, 0.2, 0.4];
const wdays = ['Today', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon'].map((label, i) => ({ label, value: String(6 - (i % 3)), unit: '\u00b0 / 2\u00b0', note: ['Cloudy', 'Rain', 'Rain', 'Partly cloudy', 'Sunny', 'Cloudy', 'Snow'][i], tint: rainDay[i], badge: Math.round(rainDay[i] * 100) + ' %' }));
const weekDays = ['Today', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon'].map((title, i) => ({
  title,
  subtitle: String(11 + i),
  today: i === 0,
  events: [
    ...(i === 1 ? [{ time: 'All day', title: "St. Martin's Day", allDay: true }] : []),
    { time: '09:15', title: i === 2 ? 'Elternabend der Klasse 2b mit dem langen Titel' : 'Dentist', detail: i === 2 ? 'Schule' : undefined },
    { time: '16:30', title: 'Piano lesson' },
    ...(i % 3 === 0 ? [{ time: '18:00', title: 'Football training' }, { time: '19:30', title: 'Dinner' }, { time: '21:00', title: 'Call' }, { time: '22:00', title: 'Late' }] : []),
  ],
}));
const power = Array.from({ length: 72 }, (_, i) => Math.min(1, 0.15 + 0.12 * Math.sin(i / 5) + (i % 23 === 0 ? 0.6 : 0) + (i > 50 ? 0.25 : 0)));
const widgets: WidgetData[] = [
  w('weather', 'Weather', {
    card: { template: 'value', value: '4', unit: '°C', note: 'Cloudy, high 7°, low 2°' },
    detail: { template: 'stack', parts: [{ title: 'Next 12 hours', display: { template: 'columns', columns: hours } }, { title: 'Next 7 days', display: { template: 'columns', columns: wdays } }] },
  }),
  w('calendar', 'Calendar', {
    card: { template: 'days', days: [{ title: 'Today', today: true, events: [{ time: '16:30', title: 'Elternabend der Klasse 2b mit dem langen Titel, der abgeschnitten wird' }, { time: '', title: 'and 3 more today' }] }] },
    detail: { template: 'days', days: weekDays },
  }),
  w('energy', 'Power', {
    card: { template: 'value', value: '1807', unit: 'W', note: 'Right now' },
    detail: { template: 'chart', now: true, max: '1807 W', min: '216 W', axis: ['17:35', '19:35', '21:35', '23:39'], note: 'Now 1807 W \u00b7 Last 6 h: min 216 W, avg 640 W, max 1807 W', points: power },
  }),
  w('photos', 'Summer 2026', { card: { template: 'photo', image: '/app/img/kids-tile-forest.jpg', caption: 'Forest walk' } }),
  w('home', 'Living room', { card: { template: 'list', rows: [{ label: 'Temperature', value: '21.5', unit: '°C' }, { label: 'Humidity', value: '48', unit: '%' }, { label: 'CO2', value: '640', unit: 'ppm' }] } }),
];
if (down) for (const x of widgets) Object.assign(x, { status: 'unavailable', message: 'Home Assistant is not reachable', updatedAt: null, card: undefined });
if (stale) for (const x of widgets) Object.assign(x, { updatedAt: ago(3 * 3600) });
if (mixed) {
  Object.assign(widgets[1], { updatedAt: ago(3 * 3600) });
  Object.assign(widgets[2], { status: 'unavailable', message: 'Home Assistant is not reachable', updatedAt: null, card: undefined, detail: undefined });
  Object.assign(widgets[4], { status: 'empty', message: 'No readings yet', card: undefined });
}

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
  if (q.has('still')) document.head.appendChild(document.createElement('style')).textContent = '*, #bg .pl { transition: none !important; }'; // ?still: no fades, for screenshots
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
      document.getElementById('stage')!.style.setProperty('--on-shadow', dayShadow(p));
      view.setBackground({ day: p });
    };
    setDayHour(Number(day));
    (window as unknown as { setDayHour: typeof setDayHour }).setDayHour = setDayHour;
  }
  cardOptions.server = '';
  const icon = q.get('icons');
  const iconPaths: Record<string, string> = { 'org.tizen.netflix-app': icon || '', 'kIciSQlYEM.plex': icon || '', 'SrAoJxGQUf.ARD': icon || '', 'com.samsung.tv.cobalt-yt': '/nowhere.png' };
  initView(icon ? createIcons({ application: { getAppInfo: (id) => { if (id.indexOf('ZDF') >= 0) throw new Error('boom'); return { iconPath: iconPaths[id] }; } } }, (r) => console.log('icon', JSON.stringify(r))) : undefined);
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
  const full = q.get('full');
  if (full) {
    document.getElementById('full')!.hidden = false;
    drawCard(document.getElementById('full-card')!, full, full, 'full');
  }

})();
