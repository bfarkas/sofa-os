import type { ApiError, Draft, KidsPinRequest, KidsStatus, Layout, LoginRequest, Snapshot, SystemStatus, TopUpRequest, TvApproveRequest } from '@sofa/shared';
import { KIDS_TOPUP_PATH, PIN_PATTERN } from '@sofa/shared';
import { drawQr } from '../../tv/src/qr.ts';
import { DRAFT_KEY, startEditor } from './editor.ts';
import { startRemote } from './remote.ts';
import { homeView, statusText, topupView } from './kids-view.ts';
import { backupText, outageText } from './system-banner.ts';

// Companion (Session 47): one page per tab, chosen by the path, with a tab bar. The QR code on the TV opens /tv-signin?code=...
// and the warning notification opens /kids/topup (a sheet over Home). Login happens on the same page, so both survive it.
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
type Page = 'home' | 'remote' | 'kids' | 'edit' | 'settings' | 'tv';
const PAGES: Record<string, Page> = { '/': 'home', '/remote': 'remote', '/kids': 'kids', '/edit': 'edit', '/settings': 'settings', '/tv-signin': 'tv', [KIDS_TOPUP_PATH]: 'home' };

// Makes Companion installable; sw.js caches nothing (see the file).
if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js');

const path = location.pathname.replace(/\/+$/, '') || '/';
const page: Page = PAGES[path] ?? 'home';
const onTopup = path === KIDS_TOPUP_PATH;
const tvCode = page === 'tv' ? /^code=([A-Z0-9]{8})$/.exec(location.search.slice(1))?.[1] : undefined;
const dashed = (code: string) => code.slice(0, 4) + '-' + code.slice(4);
const message = (err: unknown) => (err instanceof Error ? err.message : 'The Server is not reachable.');
const when = (iso: string) => {
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? 'today, ' + time : d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ', ' + time;
};
const hasDraft = () => { try { return !!localStorage.getItem(DRAFT_KEY); } catch { return false; } };

let timers: ReturnType<typeof setInterval>[] = [];

function show(signedIn: boolean): void {
  timers.forEach(clearInterval);
  timers = [];
  $('login').hidden = signedIn;
  for (const p of ['home', 'remote', 'kids', 'edit', 'settings', 'tv'] as Page[]) $(p).hidden = !signedIn || p !== page;
  $('topup').hidden = !signedIn || !onTopup;
  $('tabbar').hidden = !signedIn || page === 'tv';
  document.querySelectorAll<HTMLAnchorElement>('#tabbar a').forEach((a) => {
    const on = a.dataset.tab === page;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page');
  });
  $('app').classList.toggle('wide', page === 'edit');
  if (!signedIn) return $<HTMLInputElement>('password').focus();
  const every = (f: () => void, ms: number) => { f(); timers.push(setInterval(f, ms)); };
  if (page === 'home') {
    every(() => void refreshKids(), 5000); // the time left moves while the page is open
    every(() => void refreshSystem(), 15_000);
    void refreshPublished();
  }
  if (page === 'kids') {
    every(() => void refreshKids(), 5000);
    void loadApps();
  }
  if (page === 'remote') startRemote(call);
  if (page === 'edit') startEditor(call);
  if (page === 'settings') void loadSettings();
}

// A call to the Server. A 401 means the session ended: back to the login form, which keeps this URL.
async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as T & Partial<ApiError>;
  if (res.status === 401) {
    show(false);
    throw new Error('Signed out. Sign in again.');
  }
  if (!res.ok) throw Object.assign(new Error((json.error ?? 'HTTP ' + res.status) + (json.errors?.length ? ': ' + json.errors.join('; ') : '')), { status: res.status });
  return json;
}

// ---- Sign-in, the TV's code, sign-out ----

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = $('login-form').querySelector('button')!;
  const password = $<HTMLInputElement>('password');
  button.disabled = true;
  $('error').textContent = '';
  try {
    const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: password.value } satisfies LoginRequest) });
    if (res.ok) {
      password.value = '';
      show(true);
    } else $('error').textContent = ((await res.json()) as ApiError).error;
  } catch {
    $('error').textContent = 'The Server is not reachable.';
  } finally {
    button.disabled = false;
  }
});

if (tvCode) $('tv-code').textContent = dashed(tvCode);
else {
  $('tv-ask').textContent = 'This link has no sign-in code. Scan the QR code on the TV again.';
  $('approve').hidden = true;
}
$('approve').addEventListener('click', async () => {
  const approve = $<HTMLButtonElement>('approve'), result = $('tv-result');
  approve.disabled = true;
  result.textContent = '';
  try {
    const res = await fetch('/api/tv/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: tvCode! } satisfies TvApproveRequest) });
    if (res.ok) return void (result.textContent = 'Approved. The TV signs in within a few seconds.');
    result.textContent = res.status === 404 ? 'That code has expired. Look at the TV for a new QR code.' : ((await res.json()) as ApiError).error;
  } catch {
    result.textContent = 'The Server is not reachable.';
  }
  approve.disabled = false;
});

$('logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  show(false);
});

// ---- Home ----

async function refreshSystem(): Promise<void> {
  const s = await call<SystemStatus>('GET', '/api/system').catch(() => null);
  if (!s) return;
  const text = outageText(s);
  $('ha-outage').hidden = !text;
  $('ha-outage-text').textContent = text;
  $('backup-status').textContent = s.backup.lastError ? 'Failed' : s.backup.lastAt ? when(s.backup.lastAt) : 'None yet';
  $('backup-status').title = backupText(s);
}

async function refreshPublished(): Promise<void> {
  const snap = await call<Snapshot>('GET', '/api/snapshot').catch(() => null);
  $('home-layout').textContent = hasDraft() ? 'Changes not published' : 'On the TV';
  $('home-published').textContent = snap ? 'Published ' + when(snap.publishedAt) : '';
}

function paintHome(s: KidsStatus): void {
  const v = homeView(s);
  $('hero-dot').className = 'dot' + (v.dot ? ' ' + v.dot : '');
  $('hero-title').textContent = v.title;
  $('hero-big').replaceChildren(v.big, ...(v.unit ? [' ', Object.assign(document.createElement('small'), { textContent: v.unit })] : []));
  $('hero-sub').replaceChildren(...v.sub.flatMap((line, i) => (i ? [document.createElement('br'), line] : [line])));
  $('ring-fg').setAttribute('stroke-dasharray', (2 * Math.PI * 48 * v.frac).toFixed(1) + ' 999');
  $('home-topup').hidden = !v.topup;
  $('hero-foot').textContent = v.foot;
  if (onTopup) {
    const t = topupView(s);
    $('topup-left').textContent = t.left;
    $('topup-text').textContent = t.text;
    $('topup-controls').hidden = !s.active;
  }
}

// ---- Kids Mode ----

let status: KidsStatus | null = null;

async function refreshKids(): Promise<void> {
  try {
    status = await call<KidsStatus>('GET', '/api/kids');
  } catch (err) {
    if (page === 'kids') $('kids-result').textContent = message(err);
    return;
  }
  if (page === 'home') return paintHome(status);
  const s = status;
  $('kids-dot').className = 'dot' + (s.active ? ' g' : '');
  $('kids-on').textContent = s.active ? 'On' : 'Off';
  const total = s.dailySeconds + s.topUpSeconds;
  $('kids-left').textContent = Math.ceil(s.remainingSeconds / 60) + ' min of ' + Math.round(total / 60) + ' today';
  $('kids-prog').style.width = (total ? Math.min(100, (100 * s.remainingSeconds) / total) : 0) + '%';
  $('kids-status').textContent = statusText(s);
  $('kids-pin-status').textContent = s.pinSet ? 'Set' : 'Not set';
  $<HTMLButtonElement>('kids-exit').disabled = !s.active;
  $<HTMLButtonElement>('kids-end').disabled = !s.active || s.remainingSeconds <= 0;
}

// +5, +10 and a custom amount, from one template, on Home, the Kids page and the Top-up sheet.
function mountTopup(host: HTMLElement): void {
  host.appendChild($<HTMLTemplateElement>('topup-template').content.cloneNode(true));
  const result = host.querySelector('.result')!;
  const customBox = host.querySelector<HTMLElement>('.custom')!;
  const custom = customBox.querySelector('input')!;
  const add = async (minutes: number) => {
    result.textContent = '';
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) return void (result.textContent = 'Enter whole minutes from 1 to 240.');
    try {
      status = await call<KidsStatus>('POST', '/api/kids/topup', { minutes } satisfies TopUpRequest);
      result.textContent = 'Added ' + minutes + ' min.';
      custom.value = '';
      customBox.hidden = true;
      await refreshKids();
    } catch (err) {
      result.textContent = message(err);
    }
  };
  host.addEventListener('click', (e) => {
    const button = (e.target as HTMLElement).closest('button');
    if (!button) return;
    if (button.dataset.minutes) void add(Number(button.dataset.minutes));
    else if (button.hasAttribute('data-custom-open')) (customBox.hidden = !customBox.hidden), customBox.hidden || custom.focus();
    else if (button.hasAttribute('data-custom')) void add(Number(custom.value));
  });
}
mountTopup($('home-topup'));
mountTopup($('kids-topup'));
mountTopup($('topup-controls'));
$('topup-dim').addEventListener('click', () => location.assign('/'));

// Approved apps and the daily minutes publish through a draft, like any layout change. Save is on while they differ.
let approved: string[] = [], dailyMinutes = 0;
const kidsMinutes = $<HTMLInputElement>('kids-minutes');
const ticked = () => Array.from($('kids-apps').querySelectorAll<HTMLInputElement>('input')).filter((i) => i.checked).map((i) => i.value);
const kidsChanged = () => Number(kidsMinutes.value) !== dailyMinutes || ticked().sort().join() !== approved.slice().sort().join();
const paintSave = () => { $<HTMLButtonElement>('kids-save').disabled = !kidsChanged(); };

async function loadApps(): Promise<void> {
  try {
    const { layout } = await call<Snapshot>('GET', '/api/snapshot');
    approved = layout.kidsMode.apps;
    dailyMinutes = layout.kidsMode.dailyMinutes;
    kidsMinutes.value = String(dailyMinutes);
    const rows = layout.apps.filter((a) => a.kind !== 'input').map((app) => { // a console cannot be approved for Kids Mode (Session 43)
      const label = document.createElement('label');
      label.className = 'row ind';
      const badge = Object.assign(document.createElement('span'), { className: 'badge b-sage', textContent: app.name.charAt(0).toUpperCase() });
      const check = Object.assign(document.createElement('input'), { type: 'checkbox', className: 'sw', value: app.id, checked: approved.includes(app.id) });
      check.setAttribute('role', 'switch');
      label.append(badge, Object.assign(document.createElement('span'), { className: 'rt', textContent: app.name }), check);
      return label;
    });
    $('kids-apps').replaceChildren(...(rows.length ? rows : [Object.assign(document.createElement('div'), { className: 'row', textContent: 'The layout has no apps yet.' })]));
    paintSave();
  } catch (err) {
    $('kids-result').textContent = message(err);
  }
}
$('kids-apps').addEventListener('change', paintSave);
kidsMinutes.addEventListener('input', paintSave);
const step = (d: number) => { kidsMinutes.value = String(Math.max(0, Math.min(1440, (Number(kidsMinutes.value) || 0) + d))); paintSave(); };
$('kids-less').addEventListener('click', () => step(-5));
$('kids-more').addEventListener('click', () => step(5));

$('kids-save').addEventListener('click', async () => {
  const result = $('kids-result');
  const minutes = Number(kidsMinutes.value);
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) return void (result.textContent = 'Minutes a day must be a whole number from 0 to 1440.');
  const on = ticked();
  const apps = approved.filter((id) => on.includes(id)).concat(on.filter((id) => !approved.includes(id))); // keep the order; new ones at the end
  const save = $<HTMLButtonElement>('kids-save');
  save.disabled = true;
  result.textContent = 'Saving…';
  let draft: Draft | undefined;
  try {
    draft = await call<Draft>('POST', '/api/drafts');
    const layout = draft.layout as Layout;
    await call('PUT', '/api/drafts/' + draft.id, { base: draft.base, layout: { ...layout, kidsMode: { ...layout.kidsMode, apps, dailyMinutes: minutes } } });
    await call<Snapshot>('POST', `/api/drafts/${draft.id}/publish`);
    draft = undefined;
    result.textContent = 'Saved. The TV picks it up within a few seconds.';
    await loadApps();
    await refreshKids();
  } catch (err) {
    if (draft) await call('DELETE', '/api/drafts/' + draft.id).catch(() => {});
    result.textContent = message(err);
    paintSave();
  }
});

$('kids-pin-set').addEventListener('click', async () => {
  const input = $<HTMLInputElement>('kids-pin');
  const result = $('kids-result');
  if (!PIN_PATTERN.test(input.value)) return void (result.textContent = 'The PIN must be four digits.');
  try {
    await call('PUT', '/api/kids/pin', { pin: input.value } satisfies KidsPinRequest);
    input.value = '';
    result.textContent = 'PIN set.';
    await refreshKids();
  } catch (err) {
    result.textContent = message(err);
  }
});

$('kids-end').addEventListener('click', async () => {
  if (!window.confirm('End today’s Kids Mode time now? The TV says goodbye and turns off.')) return;
  try {
    await call('POST', '/api/kids/end', {});
    $('kids-result').textContent = 'Time is up. The TV is saying goodbye.';
    await refreshKids();
  } catch (err) {
    $('kids-result').textContent = message(err);
  }
});

$('kids-exit').addEventListener('click', async () => {
  if (!window.confirm('Turn off Kids Mode? The TV shows the Dashboard.')) return;
  try {
    await call('POST', '/api/kids/exit', {});
    $('kids-result').textContent = 'Kids Mode is off.';
    await refreshKids();
  } catch (err) {
    $('kids-result').textContent = message(err);
  }
});

// ---- Settings ----

async function loadSettings(): Promise<void> {
  $('server-url').textContent = location.origin;
  drawQr($<HTMLCanvasElement>('server-qr'), location.origin);
  const [kids, snap] = await Promise.all([call<KidsStatus>('GET', '/api/kids').catch(() => null), call<Snapshot>('GET', '/api/snapshot').catch(() => null)]);
  $('set-tv').textContent = !kids ? 'Not known' : kids.tv === 'pending' ? 'Starting' : kids.tv === 'on' ? 'On' : 'Off';
  $('set-layout').textContent = snap ? 'Published ' + when(snap.publishedAt) : 'Not known';
}

fetch('/api/session').then((res) => show(res.ok), () => show(false));
