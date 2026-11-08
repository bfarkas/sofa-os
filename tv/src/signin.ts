// TV Sign-in, the TV's side (spec: TV Sign-in). Asks the Server for a code, shows it as a QR code for the phone, and
// polls until a Companion session approves it. `secret` stays in this closure: it is the only thing that lets this TV
// (and not someone who saw the QR code) collect the device token.
import type { TvCode, TvTokenResponse } from '@sofa/shared';

export const SERVER_KEY = 'sofahome.server';
export const TOKEN_KEY = 'sofahome.token';

/** The Server address as typed: http(s) and a host, nothing else. Null if it is not that. */
export function normalizeServer(input: string): string | null {
  const s = input.trim().replace(/\/+$/, '');
  return /^https?:\/\/[^\s/?#]+$/i.test(s) ? s : null;
}

export const dashed = (code: string) => code.slice(0, 4) + '-' + code.slice(4);

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ status: number; json(): Promise<unknown> }>;

export interface SignInState {
  code: string; // '' until the Server has issued one
  url: string; // what the QR code encodes
  error: string;
}

export interface SignInOptions {
  server: string;
  fetch: FetchLike;
  onChange(state: SignInState): void;
  onToken(token: string): void; // called once; sign-in has stopped
  intervalMs?: number;
}

export function startSignIn(o: SignInOptions): { stop(): void } {
  const interval = o.intervalMs || 2000;
  const state: SignInState = { code: '', url: '', error: '' };
  let current: TvCode | null = null;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const emit = () => o.onChange({ code: state.code, url: state.url, error: state.error });
  const later = (fn: () => void) => {
    if (!stopped) timer = setTimeout(fn, interval);
  };
  const post = (path: string, body: unknown) =>
    o.fetch(o.server + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const fail = (err: unknown) => {
    state.error = 'Server unreachable: ' + (err && (err as Error).message ? (err as Error).message : String(err));
    emit();
  };

  function request(): void {
    post('/api/tv/codes', {})
      .then((res) => {
        if (res.status !== 201) throw new Error('HTTP ' + res.status);
        return res.json() as Promise<TvCode>;
      })
      .then(
        (c) => {
          if (stopped) return;
          current = c;
          state.code = c.code;
          state.url = o.server + '/tv-signin?code=' + c.code;
          state.error = '';
          emit();
          later(poll);
        },
        (err) => {
          if (stopped) return;
          fail(err);
          later(request);
        },
      );
  }

  function poll(): void {
    if (!current) return request();
    post('/api/tv/token', { code: current.code, secret: current.secret })
      .then((res) => {
        if (res.status === 404) return null; // expired, or pushed out by newer codes
        if (res.status !== 200) throw new Error('HTTP ' + res.status);
        return res.json() as Promise<TvTokenResponse>;
      })
      .then(
        (r) => {
          if (stopped) return;
          if (!r) {
            current = null;
            request();
          } else if (r.status === 'approved') {
            stopped = true;
            o.onToken(r.token);
          } else {
            if (state.error) {
              state.error = '';
              emit();
            }
            later(poll);
          }
        },
        (err) => {
          if (stopped) return;
          fail(err);
          later(poll);
        },
      );
  }

  emit();
  request();
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
