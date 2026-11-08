import type { ApiError, LoginRequest, TvApproveRequest } from '@sofa/shared';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('login');
const home = $('home');
const error = $('error');
const password = $<HTMLInputElement>('password');
const tv = $('tv');
const approve = $<HTMLButtonElement>('approve');
const tvResult = $('tv-result');

// The QR code on the TV opens /tv-signin?code=... Login happens on this same page, so the code survives it.
const onTvPage = location.pathname === '/tv-signin';
const tvCode = onTvPage ? /^code=([A-Z0-9]{8})$/.exec(location.search.slice(1))?.[1] : undefined;
const dashed = (code: string) => code.slice(0, 4) + '-' + code.slice(4);

function show(signedIn: boolean): void {
  form.hidden = signedIn;
  tv.hidden = !signedIn || !onTvPage;
  home.hidden = !signedIn || onTvPage;
  if (!signedIn) password.focus();
}

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

fetch('/api/session').then((res) => show(res.ok), () => show(false));
