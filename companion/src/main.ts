import type { ApiError, Draft, KidsPinRequest, KidsStatus, Layout, LoginRequest, Snapshot, TopUpRequest, TvApproveRequest } from '@sofa/shared';
import { KIDS_TOPUP_PATH, PIN_PATTERN } from '@sofa/shared';
import { statusText, topupView } from './kids-view.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('login');
const home = $('home');
const error = $('error');
const password = $<HTMLInputElement>('password');
const tv = $('tv');
const approve = $<HTMLButtonElement>('approve');
const tvResult = $('tv-result');
const kidsPage = $('kids');
const topupPage = $('topup');

// The QR code on the TV opens /tv-signin?code=... and the warning notification opens /kids/topup. Login happens on the
// same page, so the code and the tap target both survive it.
const path = location.pathname.replace(/\/+$/, '') || '/';
const onTvPage = path === '/tv-signin';
const onKidsPage = path === '/kids';
const onTopupPage = path === KIDS_TOPUP_PATH;
const tvCode = onTvPage ? /^code=([A-Z0-9]{8})$/.exec(location.search.slice(1))?.[1] : undefined;
const dashed = (code: string) => code.slice(0, 4) + '-' + code.slice(4);

let poll: ReturnType<typeof setInterval> | undefined;

function show(signedIn: boolean): void {
  clearInterval(poll);
  form.hidden = signedIn;
  tv.hidden = !signedIn || !onTvPage;
  kidsPage.hidden = !signedIn || !onKidsPage;
  topupPage.hidden = !signedIn || !onTopupPage;
  home.hidden = !signedIn || onTvPage || onKidsPage || onTopupPage;
  if (!signedIn) return password.focus();
  if (onKidsPage || onTopupPage) {
    void refresh();
    poll = setInterval(refresh, 5000); // the remaining time moves while the page is open
  }
  if (onKidsPage) void loadApps();
}

// A call to the Server. A 401 means the session ended: back to the login form, which keeps this URL.
async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as T & Partial<ApiError>;
  if (res.status === 401) {
    show(false);
    throw new Error('Signed out. Sign in again.');
  }
  if (!res.ok) throw new Error([json.error ?? 'HTTP ' + res.status].concat(json.errors ?? []).join(': '));
  return json;
}
const message = (err: unknown) => (err instanceof Error ? err.message : 'The Server is not reachable.');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = form.querySelector('button')!;
  button.disabled = true;
  error.textContent = '';
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password.value } satisfies LoginRequest),
    });
    if (res.ok) {
      password.value = '';
      show(true);
    } else {
      error.textContent = ((await res.json()) as ApiError).error;
    }
  } catch {
    error.textContent = 'The Server is not reachable.';
  } finally {
    button.disabled = false;
  }
});

if (tvCode) {
  $('tv-code').textContent = dashed(tvCode);
} else {
  $('tv-ask').textContent = 'This link has no sign-in code. Scan the QR code on the TV again.';
  approve.hidden = true;
}

approve.addEventListener('click', async () => {
  approve.disabled = true;
  tvResult.textContent = '';
  try {
    const res = await fetch('/api/tv/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: tvCode! } satisfies TvApproveRequest),
    });
    if (res.ok) {
      tvResult.textContent = 'Approved. The TV signs in within a few seconds.';
      return;
    }
    tvResult.textContent = res.status === 404 ? 'That code has expired. Look at the TV for a new QR code.' : ((await res.json()) as ApiError).error;
  } catch {
    tvResult.textContent = 'The Server is not reachable.';
  }
  approve.disabled = false;
});

$('logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  show(false);
});

// ---- Kids Mode and the Top-up page ----
let status: KidsStatus | null = null;

async function refresh(): Promise<void> {
  try {
    status = await call<KidsStatus>('GET', '/api/kids');
  } catch (err) {
    if (onKidsPage) $('kids-result').textContent = message(err);
    else $('topup-text').textContent = message(err);
    return;
  }
  if (onKidsPage) {
    $('kids-status').textContent = statusText(status);
    $('kids-pin-status').textContent = status.pinSet ? 'A PIN is set. The TV asks for it to leave Kids Mode.' : 'No PIN is set. The TV cannot leave Kids Mode until you set one.';
    $<HTMLButtonElement>('kids-exit').disabled = !status.active;
  } else {
    const v = topupView(status);
    $('topup-left').textContent = v.left;
    $('topup-text').textContent = v.text;
    topupControls.hidden = v.kind !== 'running';
  }
}

// +5, +10 and a custom amount, from one template, on both pages.
function mountTopup(host: HTMLElement): void {
  host.appendChild(($<HTMLTemplateElement>('topup-template')).content.cloneNode(true));
  const result = host.querySelector('.result')!;
  const custom = host.querySelector('input')!;
  const add = async (minutes: number) => {
    result.textContent = '';
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) {
      result.textContent = 'Enter whole minutes from 1 to 240.';
      return;
    }
    try {
      status = await call<KidsStatus>('POST', '/api/kids/topup', { minutes } satisfies TopUpRequest);
      result.textContent = 'Added ' + minutes + ' min.';
      custom.value = '';
      await refresh();
    } catch (err) {
      result.textContent = message(err);
    }
  };
  host.addEventListener('click', (e) => {
    const button = (e.target as HTMLElement).closest('button');
    if (!button) return;
    if (button.dataset.minutes) void add(Number(button.dataset.minutes));
    else if (button.hasAttribute('data-custom')) void add(Number(custom.value));
  });
}
const topupControls = $(onTopupPage ? 'topup-controls' : 'kids-topup');
mountTopup(topupControls);
topupControls.hidden = onTopupPage; // until the status says time is running

// Approved apps and the daily minutes publish through a draft, like any layout change (the full editor is Session 15).
async function loadApps(): Promise<void> {
  try {
    const { layout } = await call<Snapshot>('GET', '/api/snapshot');
    const box = $('kids-apps');
    box.querySelectorAll('label').forEach((l) => l.remove());
    $<HTMLInputElement>('kids-minutes').value = String(layout.kidsMode.dailyMinutes);
    for (const app of layout.apps) {
      const label = document.createElement('label');
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.value = app.id;
      check.checked = layout.kidsMode.apps.includes(app.id);
      label.append(check, app.name);
      box.appendChild(label);
    }
    if (!layout.apps.length) box.appendChild(Object.assign(document.createElement('label'), { textContent: 'The layout has no apps yet.' }));
    approved = layout.kidsMode.apps;
  } catch (err) {
    $('kids-result').textContent = message(err);
  }
}
let approved: string[] = [];

$('kids-save').addEventListener('click', async () => {
  const result = $('kids-result');
  const minutes = Number($<HTMLInputElement>('kids-minutes').value);
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) {
    result.textContent = 'Daily minutes must be a whole number from 0 to 1440.';
    return;
  }
  const ticked = Array.from($('kids-apps').querySelectorAll('input')).filter((i) => i.checked).map((i) => i.value);
  // Keep the approved order; newly ticked apps join at the end.
  const apps = approved.filter((id) => ticked.includes(id)).concat(ticked.filter((id) => !approved.includes(id)));
  result.textContent = 'Publishing...';
  let draft: Draft | undefined;
  try {
    draft = await call<Draft>('POST', '/api/drafts');
    const layout = draft.layout as Layout;
    await call('PUT', '/api/drafts/' + draft.id, { base: draft.base, layout: { ...layout, kidsMode: { apps, dailyMinutes: minutes } } });
    const snap = await call<Snapshot>('POST', `/api/drafts/${draft.id}/publish`);
    draft = undefined;
    result.textContent = 'Published as revision ' + snap.revision + '. The TV picks it up within a few seconds.';
    await loadApps();
    await refresh();
  } catch (err) {
    if (draft) await call('DELETE', '/api/drafts/' + draft.id).catch(() => {});
    result.textContent = message(err);
  }
});

$('kids-pin-set').addEventListener('click', async () => {
  const input = $<HTMLInputElement>('kids-pin');
  const result = $('kids-result');
  if (!PIN_PATTERN.test(input.value)) {
    result.textContent = 'The PIN must be four digits.';
    return;
  }
  try {
    await call('PUT', '/api/kids/pin', { pin: input.value } satisfies KidsPinRequest);
    input.value = '';
    result.textContent = 'PIN set.';
    await refresh();
  } catch (err) {
    result.textContent = message(err);
  }
});

$('kids-exit').addEventListener('click', async () => {
  try {
    await call('POST', '/api/kids/exit', {});
    $('kids-result').textContent = 'Kids Mode is off.';
    await refresh();
  } catch (err) {
    $('kids-result').textContent = message(err);
  }
});

fetch('/api/session').then((res) => show(res.ok), () => show(false));
