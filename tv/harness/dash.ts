// The whole Dashboard in the desktop browser: Sofa Home's own index.html, shell.ts, view.ts and cards.ts with a fixture layout and
// fixture widget data (no Server, no TV). The arrow keys, Enter and Escape drive it like the remote. Not part of the signed package.
//   npm run harness -w tv, serve tv/ (python3 -m http.server 8077 -d tv), open /harness/dash.html at 1920 x 1080.
// Query: ?tab=apps|widgets, ?focus=<id> (kids, widget:weather, app:org.tizen.netflix-app, allapps), ?screen=kids, ?apps=N (more apps),
//   ?icons=<image url> (Session 30: Netflix, Plex and ARD get that picture as their icon, YouTube a path that does not load, ZDF an API error and KiKA none: the letter stays), ?day=H (0 to 23: the day-cycle background as at that hour, through the real photoview; setDayHour(h) in the console changes it), ?rows=N (more widget rows, to see the column give way), ?bg=<css colour or url>, ?state=stale|unavailable|mixed (one stale, one unavailable, one empty), ?still (no transitions, for screenshots), ?cal=now|night|busy (the calendar card in three situations), ?full=weather|calendar|energy|home (the full-screen view open, as OK on that widget does).
import { dayFootInk, dayInk, dayShadow, periodAt, tokensCss, type Layout, type WidgetData } from '@sofa/shared';
import { cardOptions, drawCard, setWidgetsState } from '../src/cards.ts';
import type { RemoteEvent, RemoteKey } from '../src/keys.ts';
import { createIcons } from '../src/icons.ts';
import { createPhotoView } from '../src/photoview.ts';
import { createShell } from '../src/shell.ts';
import { initView, redrawCards, render, setFocus, setKidsLeft, updateClock } from '../src/view.ts';
import { parseWidgets } from '../src/widgets.ts';

const q = new URLSearchParams(location.search);
const now = Date.now();
const ago = (s: number) => new Date(now - s * 1000).toISOString();
const w = (id: string, title: string, over: Partial<WidgetData>): WidgetData => ({ id, title, status: 'ok', updatedAt: ago(20), failing: false, staleAfterSeconds: 180, ...over });
const stale = q.get('state') === 'stale', down = q.get('state') === 'unavailable', mixed = q.get('state') === 'mixed';

// Detail fixtures as the Server sends them (weather: a 24 hour chart over days, calendar: a week, energy: a chart).
const rainDay = [0.1, 0.8, 0.7, 0.3, 0.05, 0.2, 0.4];
const wdays = ['Today', 'Fri', 'Sat', 'Sun', 'Mon'].map((label, i) => ({ label, value: String(6 - (i % 3)), unit: '\u00b0 / 2\u00b0', note: ['Cloudy', 'Rain', 'Rain', 'Partly cloudy', 'Sunny'][i], tint: rainDay[i], badge: ['0.1 mm', '4 mm', '1.4 mm', '0.1 mm', '2 mm'][i] }));
// Session 35: 25 hourly temperatures from 13:00, rain per hour as a share of 2 mm.
const temps = Array.from({ length: 25 }, (_, i) => Math.round((0.45 + 0.35 * Math.sin((i - 4) / 3.8)) * 1000) / 1000);
const rainBars = [0, 0, 0, 0, 0, 0, 0, 0.1, 0.25, 0.6, 0.9, 0.5, 0.3, 0.1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
// Session 36: the week board (Thu 19 Nov 08:45: the trip began on the 17th, the Dentist is on) and the small card in three situations (?cal=night|busy|now).
const ev = (time: string, title: string, o: object = {}) => ({ time, title, ...o });
const weekDays = [
  { title: 'Today', subtitle: '19', today: true, events: [ev('Now\u201309:30', 'Dentist', { now: true, detail: 'Dr. Sample, Sample Street 1' }), ev('15:30\u201316:15', 'Dance class'), ev('17:00\u201317:45', 'Choir practice', { detail: 'Room 1' }), ev('19:00\u201321:00', 'Elternabend der Klasse 2b mit dem langen Titel', { detail: 'Schule' })] },
  { title: 'Fri', subtitle: '20', events: [] },
  { title: 'Sat', subtitle: '21', events: [ev('', 'Free')] },
  { title: 'Sun', subtitle: '22', events: [ev('', 'Free')] },
  { title: 'Mon', subtitle: '23', events: [ev('16:45\u201317:30', 'Music class')] },
  { title: 'Tue', subtitle: '24', events: [ev('', 'Free')] },
  { title: 'Wed', subtitle: '25', events: [ev('07:45\u201310:45', 'Cleaner')] },
];
const weekSpans = [
  { title: 'Trip away', from: 0, to: 0, lane: 0, clipStart: true },
  { title: 'School closed', from: 1, to: 1, lane: 0 },
  { title: 'Grandparents visit \u00b7 4 days', from: 3, to: 6, lane: 0, clipEnd: true },
];
const calCards = {
  night: { template: 'agenda' as const, days: [{ title: 'Today', today: true, events: [ev('', 'Nothing more today')] }, { title: 'Tomorrow', events: [ev('15:30', 'Dance class'), ev('16:15', 'Choir practice')] }] },
  busy: { template: 'agenda' as const, days: [{ title: 'Today', today: true, events: [ev('15:30', 'Dance class'), ev('16:15', 'Choir practice')] }, { title: 'Sat 14', note: '+2 more', events: [] }] },
  now: { template: 'agenda' as const, days: [{ title: 'Today', today: true, note: 'Trip away', events: [ev('08:30', 'Dentist', { now: true }), ev('15:30', 'Dance class'), ev('17:00', 'Choir practice')] }] },
};
const calCard = calCards[(q.get('cal') ?? 'now') as keyof typeof calCards] ?? calCards.now;
const power = Array.from({ length: 72 }, (_, i) => Math.min(1, 0.15 + 0.12 * Math.sin(i / 5) + (i % 23 === 0 ? 0.6 : 0) + (i > 50 ? 0.25 : 0)));
const widgets: WidgetData[] = [
  w('weather', 'Weather', {
    card: { template: 'value', value: '4°', note: 'Cloudy', lines: ['Feels 1° · NE 12 km/h', 'Light rain Fri 08:00'] },
    detail: { template: 'stack', parts: [
      { title: 'Next 24 hours', display: { template: 'chart', points: temps, max: '8°', min: '0°', axis: ['13:00', '19:00', '01:00', '07:00', '13:00'], bars: rainBars, barMax: '2 mm', note: 'Now 4°, feels 1° · wind NE 12 km/h, gusts to 31 · 2.1 mm rain, 22:00 to 01:00, peak 23:00' } },
      { title: 'Next 5 days', display: { template: 'columns', columns: wdays } },
    ] },
  }),
  w('calendar', 'Calendar', {
    card: calCard,
    detail: { template: 'days', days: weekDays, spans: weekSpans },
  }),
  w('energy', 'Power', {
    card: { template: 'value', value: '1807', unit: 'W', note: 'Right now' },
    detail: { template: 'chart', now: true, max: '1807 W', min: '216 W', axis: ['17:35', '19:35', '21:35', '23:39'], note: 'Now 1807 W \u00b7 Last 6 h: min 216 W, avg 640 W, max 1807 W', points: power },
  }),
  w('photos', 'Summer 2026', { card: { template: 'photo', image: '/app/img/kids-tile-forest.jpg', caption: 'Forest walk' } }),
  w('home', 'Living room', { card: { template: 'list', rows: [{ label: 'Temperature', value: '21.5', unit: '°C' }, { label: 'Humidity', value: '48', unit: '%' }, { label: 'CO2', value: '640', unit: 'ppm' }] } }),
];
// ?waste=5|1|0 (days to the next pickup: six days, tomorrow, today) swaps the last card for the waste widget, ?full=waste opens its tiles.
if (q.has('waste')) {
  const n = Number(q.get('waste'));
  const word = (d: number) => (d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : String(d));
  const bins: [string, string, number, 'brown' | 'yellow' | 'grey' | 'blue', string][] = [['Bioabfall', 'Tue 17 Nov', n, 'brown', 'Then 1 Dec \u00b7 15 Dec'], ['Gelber Sack', 'Wed 18 Nov', n + 1, 'yellow', 'Then 2 Dec \u00b7 16 Dec'], ['Restabfall', 'Tue 24 Nov', n + 7, 'grey', 'Then 8 Dec \u00b7 21 Dec'], ['Papier', 'Wed 25 Nov', n + 8, 'blue', 'Then 9 Dec \u00b7 22 Dec']];
  widgets[4] = w('waste', 'Waste', {
    card: { template: 'value', value: word(n), ...(n === 0 ? {} : { unit: n === 1 ? 'day' : 'days' }), note: bins[0][0], tone: bins[0][3] },
    detail: { template: 'columns', columns: bins.map(([label, note, d, tone, badge], i) => ({ label: (i === 0 ? 'Next \u00b7 ' : '') + label, value: word(d), ...(d > 1 ? { unit: 'days' } : {}), note, badge, tone })) },
  });
}
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
  if (kids) setKidsLeft(q.get('left') || '25 min left'); // ?left=<text> to try other wordings
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
