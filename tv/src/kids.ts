// Kids Mode on the TV without the DOM: what the Server says, what to show, the PIN pad and the calls. Fetch is injected.
// The Server is the source of truth: Sofa Home shows Kids Mode whenever it is active, the Done Screen whenever it is active
// with nothing left, and the household Dashboard otherwise. GET /api/kids on start and on resume is also the Server's proof
// that the TV is on (Watch Allowance, plan Session 08), so main.ts calls refresh() there and nowhere on a timer.
import type { KidsStatus } from '@sofa/shared';

export const PIN_LENGTH = 4;
export type Screen = 'household' | 'kids' | 'done';
export type Forest = 'morning' | 'midday' | 'late-afternoon';

/** The forest for the hour: morning until 11:00, midday until 16:00, late afternoon after that (evenings too). */
export function forestFor(d: Date): Forest {
  const h = d.getHours();
  return h < 11 ? 'morning' : h < 16 ? 'midday' : 'late-afternoon';
}

export function screenFor(s: KidsStatus | null): Screen {
  if (!s || !s.active) return 'household';
  return s.remainingSeconds <= 0 ? 'done' : 'kids';
}

export interface KidsState {
  status: KidsStatus | null; // the last answer
  reachable: boolean; // the last request got an answer; false until the first one
}

/** The Kids Mode tile is unavailable until the Server has answered, and whenever its last request failed. */
export const tileAvailable = (s: KidsState) => s.status !== null && s.reachable;

export type Send = (method: string, path: string, body?: unknown) => Promise<{ status: number; body: any }>;
export type ExitResult = { ok: true } | { ok: false; message: string };

export interface KidsOptions {
  send: Send; // rejects when the Server cannot be reached
  onChange(state: KidsState): void;
  onUnauthorized(): void; // the device token was refused
}

export function createKids(o: KidsOptions) {
  const state: KidsState = { status: null, reachable: false };
  let doneSent = false;
  const emit = () => o.onChange({ status: state.status, reachable: state.reachable });

  async function request(method: string, path: string, body?: unknown): Promise<{ status: number; body: any } | null> {
    let res: { status: number; body: any };
    try {
      res = await o.send(method, path, body);
    } catch {
      if (state.reachable) {
        state.reachable = false;
        emit();
      }
      return null;
    }
    if (res.status === 401) o.onUnauthorized();
    return res;
  }

  function apply(s: KidsStatus): void {
    state.status = s;
    state.reachable = true;
    emit();
    // Showing the Done Screen tells the Server once; that starts its minute for a TV that is on again at zero.
    if (s.donePending && screenFor(s) === 'done' && !doneSent) {
      doneSent = true;
      request('POST', '/api/kids/done-shown', {}).then((r) => {
        if (r && r.status === 200) apply(r.body);
        else doneSent = false;
      });
    }
    if (!s.donePending) doneSent = false;
  }

  return {
    state,
    /** GET /api/kids. */
    async refresh(): Promise<void> {
      const r = await request('GET', '/api/kids');
      if (r && r.status === 200) apply(r.body);
    },
    async enter(): Promise<boolean> {
      const r = await request('POST', '/api/kids/enter', {});
      if (r && r.status === 200) {
        apply(r.body);
        return true;
      }
      return false;
    },
    /** Leaving Kids Mode from the TV takes the PIN. */
    async exit(pin: string): Promise<ExitResult> {
      const r = await request('POST', '/api/kids/exit', { pin });
      if (!r) return { ok: false, message: 'The Server is not reachable.' };
      if (r.status === 200) {
        apply(r.body);
        return { ok: true };
      }
      if (r.status === 403) {
        const n = r.body && r.body.triesLeft;
        return { ok: false, message: 'Wrong PIN.' + (typeof n === 'number' ? ' ' + n + (n === 1 ? ' try' : ' tries') + ' left.' : '') };
      }
      if (r.status === 429) {
        const s = r.body && r.body.retryAfterSeconds;
        const mins = typeof s === 'number' ? Math.ceil(s / 60) : 5;
        return { ok: false, message: 'Too many tries. Try again in ' + mins + (mins === 1 ? ' minute.' : ' minutes.') };
      }
      if (r.status === 409) return { ok: false, message: 'No PIN is set yet. Set one in Companion.' };
      return { ok: false, message: 'Something went wrong (' + r.status + ').' };
    },
  };
}

/** The PIN pad: digits fill four dots, the fourth sends the PIN, and input waits until `reset` after the answer. */
export function createPad(submit: (pin: string) => void) {
  let digits = '';
  let busy = false;
  return {
    count: () => digits.length,
    push(d: string): void {
      if (busy || digits.length >= PIN_LENGTH || !/^[0-9]$/.test(d)) return;
      digits += d;
      if (digits.length === PIN_LENGTH) {
        busy = true;
        submit(digits);
      }
    },
    del(): void {
      if (!busy) digits = digits.slice(0, -1);
    },
    reset(): void {
      digits = '';
      busy = false;
    },
  };
}

/** Keys of the pad as focus rows: 1 2 3 / 4 5 6 / 7 8 9 / Delete 0 Close. */
export const PAD_ROWS = [['pin:1', 'pin:2', 'pin:3'], ['pin:4', 'pin:5', 'pin:6'], ['pin:7', 'pin:8', 'pin:9'], ['pin:del', 'pin:0', 'pin:close']];
