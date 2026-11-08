import type { ApiError, LoginRequest } from '@sofa/shared';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('login');
const home = $('home');
const error = $('error');
const password = $<HTMLInputElement>('password');

function show(signedIn: boolean): void {
  form.hidden = signedIn;
  home.hidden = !signedIn;
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

$('logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  show(false);
});

fetch('/api/session').then((res) => show(res.ok), () => show(false));
