import { isPhoneKey, REMOTE_KEYS, type ApiError, type ServerMessage, type TvMessage } from '@sofa/shared';
import type { WebSocket } from 'ws';
import type { HaClient } from './ha.ts';
import { log } from './log.ts';

// Phone Remote. A Companion session posts a key; the Server forwards it through the write guard (ha.sendKey), or, for Menu,
// signals Sofa Home over the WebSocket it already holds. Rules for Kids Mode are in the plan, Session 18.
export const RATE_LIMIT = 10; // key presses per session
export const RATE_WINDOW_MS = 1000;

export interface PhoneRemote {
  /** Follows a Sofa Home socket: its `visible` messages say whether Sofa Home is in front, which Menu needs. */
  track(ws: WebSocket): void;
  /** The newest Sofa Home socket said Sofa Home is in front. Only then do its requests prove the screen is on: in standby
   *  the TV keeps a hidden Sofa Home running that still makes requests (seen live 2026-11-09). False while nothing is known. */
  visible(): boolean;
  press(session: string, body: unknown): Promise<{ status: number; body: object; headers?: Record<string, string> }>;
}

export function createPhoneRemote(o: { ha: HaClient | null; kidsActive(): boolean; onVisible?(): void; now?(): number }): PhoneRemote {
  const now = o.now ?? Date.now;
  const tvs = new Map<WebSocket, boolean | undefined>(); // socket -> Sofa Home is in front (undefined: not said yet), oldest first
  const recent = new Map<string, number[]>(); // session -> press times in the window
  let queue: Promise<unknown> = Promise.resolve(); // keys reach the TV in the order they were pressed
  const fail = (status: number, error: string, headers?: Record<string, string>) => ({ status, body: { error } satisfies ApiError, headers });

  return {
    track(ws) {
      tvs.set(ws, undefined); // unknown until Sofa Home says so
      ws.on('close', () => tvs.delete(ws));
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(String(raw)) as Partial<TvMessage>;
          if (msg.type === 'visible' && typeof msg.visible === 'boolean' && tvs.get(ws) !== msg.visible) {
            tvs.set(ws, msg.visible);
            log.info('sofa home', { visible: msg.visible });
            if (msg.visible) o.onVisible?.();
          }
        } catch {
          /* ignored: the socket only signals */
        }
      });
    },

    visible: () => [...tvs.values()].pop() === true, // a stale socket from before standby may still say true until the heartbeat ends it

    async press(session, body) {
      const key = (body as { key?: unknown } | null)?.key;
      if (!isPhoneKey(key)) return fail(400, 'unknown key');
      const t = now();
      const times = (recent.get(session) ?? []).filter((x) => t - x < RATE_WINDOW_MS);
      if (times.length >= RATE_LIMIT) return fail(429, 'too many key presses', { 'Retry-After': '1' });
      times.push(t);
      recent.set(session, times);
      if (recent.size > 50) for (const [s, ts] of recent) if (ts.every((x) => t - x >= RATE_WINDOW_MS)) recent.delete(s);

      // Kids Mode: an adult may navigate, but Home would leave the approved app for Samsung's own launcher, and Menu edits the layout.
      if (o.kidsActive() && (key === 'home' || key === 'menu')) return fail(403, 'Home and Menu are off in Kids Mode');

      if (key === 'menu') {
        const front = [...tvs].filter(([, visible]) => visible === true);
        if (!front.length) return fail(409, 'Sofa Home is not on screen');
        const msg = JSON.stringify({ type: 'menu' } satisfies ServerMessage);
        for (const [ws] of front) ws.send(msg);
        return { status: 200, body: {} };
      }

      if (!o.ha) return fail(503, 'Home Assistant is not set up');
      const ha = o.ha;
      const sent = queue.then(() => ha.sendKey(REMOTE_KEYS[key]));
      queue = sent.catch(() => {});
      try {
        await sent;
      } catch (err) {
        log.warn('phone remote key failed', { key, err: String(err) });
        return fail(502, 'Home Assistant did not take the key');
      }
      return { status: 200, body: {} };
    },
  };
}
