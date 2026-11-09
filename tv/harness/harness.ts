// A fixture page for the widget cards: every template at every size, every state of the sample (status) widget, and the
// full-screen view, drawn by the same cards.ts and cards.css as Sofa Home. Not part of the signed package.
//   npm run harness -w tv, then serve tv/ (python3 -m http.server -d tv 8077) and open /harness/ at 1920 wide.
import { tokensCss, type Display, type WidgetData } from '@sofa/shared';
import { cardOptions, drawCard, setWidgetsState } from '../src/cards.ts';
import { parseWidgets } from '../src/widgets.ts';

const now = Date.now();
const ago = (s: number) => new Date(now - s * 1000).toISOString();
const w = (id: string, over: Partial<WidgetData>): WidgetData => ({ id, title: 'Sofa.OS', status: 'ok', updatedAt: ago(20), failing: false, staleAfterSeconds: 180, ...over });

const status: Display = { template: 'list', rows: [{ label: 'Server', value: 'Up 3 h 12 min' }, { label: 'Layout', value: 'Revision 12' }, { label: 'Kids Mode', value: '23 min left' }] };
const statusDetail: Display = {
  template: 'list',
  rows: (status.template === 'list' ? status.rows : []).concat([
    { label: 'Published', value: 'Mon 9 Nov, 14:05' },
    { label: 'Home Assistant', value: 'Not set up' },
    { label: 'TV', value: null },
    { label: 'Database', value: '0.1', unit: 'MB' },
    { label: 'Node', value: 'v26.11.1' },
  ]),
};

const templates: [string, WidgetData][] = [
  ['value', w('value', { title: 'Living room', card: { template: 'value', value: '21.5', unit: '°C', note: 'Humidity 48 %' } })],
  ['value, missing reading', w('value-missing', { title: 'Energy today', card: { template: 'value', value: null, unit: 'kWh', note: 'Today, since 00:00' } })],
  ['list', w('list', { title: 'House', card: { template: 'list', rows: [{ label: 'Front door', value: 'Closed' }, { label: 'Washing machine', value: 'Running' }, { label: 'Kids room', value: '19.0', unit: '°C' }, { label: 'Garage', value: null }, { label: 'Back door', value: 'Locked' }, { label: 'Office', value: '20.5', unit: '°C' }] } })],
  ['columns', w('columns', { title: 'Weather', card: { template: 'columns', columns: ['Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => ({ label: d, value: String(9 + i), unit: '°', note: String(2 + (i % 3)) + '°' })) } })],
  ['columns with bars', w('bars', { title: 'Energy', card: { template: 'columns', note: 'kWh per hour, today', columns: ['14', '15', '16', '17', '18', '19'].map((h, i) => ({ label: h + ':00', value: i === 3 ? null : (0.3 + i * 0.25).toFixed(1), level: i === 3 ? undefined : (0.3 + i * 0.25) / 1.6 })) } })],
  ['agenda', w('agenda', { title: 'Family calendar', card: { template: 'agenda', days: [{ title: 'Today', events: [{ time: '16:30', title: 'Swimming', detail: 'Hallenbad' }, { time: '18:00', title: 'Elternabend Klasse 2b', detail: 'Schule' }] }, { title: 'Tue 10 Nov', events: [{ time: 'All day', title: 'Sankt Martin' }, { time: '09:00', title: 'Dentist' }] }] } })],
  ['photo', w('photo', { title: 'Summer 2026', card: { template: 'photo', image: '/img/kids-tile-forest.jpg', caption: 'Forest walk' } })],
  ['photo, image missing', w('photo-missing', { title: 'Album', card: { template: 'photo', image: '/img/missing.jpg' } })],
];

const states: [string, WidgetData | null][] = [
  ['ok', w('s-ok', { card: status, detail: statusDetail })],
  ['stale (old)', w('s-old', { card: status, detail: statusDetail, updatedAt: ago(3 * 3600) })],
  ['stale (read failed)', w('s-failing', { card: status, detail: statusDetail, updatedAt: ago(90), failing: true })],
  ['empty', w('s-empty', { title: 'Family calendar', status: 'empty', message: 'No events in the next 7 days' })],
  ['empty, stale', w('s-empty-stale', { title: 'Family calendar', status: 'empty', message: 'No events in the next 7 days', updatedAt: ago(5 * 3600) })],
  ['unavailable', w('s-unavailable', { title: 'Living room', status: 'unavailable', message: 'Home Assistant is not reachable', updatedAt: null })],
  ['unknown type', w('s-unknown', { title: 'weather', status: 'unavailable', message: 'This widget type is not available', updatedAt: null })],
  ['loading', null],
  ['malformed', { id: 's-bad', title: 'Broken', status: 'ok' } as unknown as WidgetData],
];

const all = templates.map((t) => t[1]).concat(states.map((s) => s[1]).filter((x): x is WidgetData => !!x));
setWidgetsState(parseWidgets({ serverTime: new Date(now).toISOString(), widgets: all }, now)!);
cardOptions.server = '../app';

const page = document.getElementById('stage')!;
const el = (tag: string, cls: string, text?: string) => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
function section(title: string): HTMLElement {
  page.appendChild(el('h2', '', title));
  return page.appendChild(el('div', 'grid'));
}
function card(host: HTMLElement, caption: string, id: string, size: 'small' | 'medium' | 'large', focus = false): void {
  const cell = host.appendChild(el('div', 'cell'));
  const tile = cell.appendChild(el('div', 'tile widget ' + size + (focus ? ' focus' : '')));
  drawCard(tile, id, 'Sofa.OS', size);
  cell.appendChild(el('div', 'cap', caption + ' · ' + size));
}

for (const [name, data] of templates) {
  const g = section('Template: ' + name);
  for (const size of ['small', 'medium', 'large'] as const) card(g, name, data.id, size);
}
const g = section('The sample widget (status) in every state');
for (const [name, data] of states) card(g, name, data ? data.id : 's-loading', 'medium', name === 'ok');
const gs = section('States at small and large');
for (const [name, data] of states.slice(1, 6)) {
  card(gs, name, data!.id, 'small');
  card(gs, name, data!.id, 'large');
}

page.appendChild(el('h2', '', 'Full-screen view (drawn at 1560 x 760, shown at half size)'));
const fulls = page.appendChild(el('div', 'grid'));
for (const id of ['s-ok', 's-old', 'value', 'list', 'columns', 'bars', 'agenda', 'photo', 's-empty', 's-unavailable']) {
  const box = fulls.appendChild(el('div', 'fullbox'));
  drawCard(box.appendChild(el('div', 'full')), id, 'Sofa.OS', 'full');
}

// Sofa Home's own stylesheet, so the tiles and focus ring are the real ones.
const style = document.createElement('style');
style.textContent = tokensCss();
document.head.insertBefore(style, document.head.firstChild);
fetch('../app/index.html')
  .then((r) => r.text())
  .then((html) => {
    const css = /<style>([\s\S]*?)<\/style>/.exec(html);
    const s = document.createElement('style');
    s.textContent = css ? css[1] : '';
    document.head.insertBefore(s, document.getElementById('cards-css'));
  });
