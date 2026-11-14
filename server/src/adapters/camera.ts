// The front door camera widget (Session 41): the last snapshot of the Bosch Eyes Outdoor on the photo template, captioned with the
// last event ("Person · 2 h ago"). The picture is proxied through the Server (GET /api/camera/<secret>.jpg), so the TV never holds
// a Home Assistant token. When the widget is read, Sofa Home is in front and the snapshot is older than 2 minutes, the Server
// presses Home Assistant's refresh_snapshot button; there is no timer of its own.
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Display } from '@sofa/shared';
import { FRONTDOOR_SNAPSHOT, type HaClient } from '../ha.ts';
import { log } from '../log.ts';
import { Unavailable, type WidgetAdapter } from '../widgets.ts';
import { load, type HaReader } from './homeassistant.ts';

const EVENT_TYPE = 'sensor.bosch_frontdoor_bosch_frontdoor_last_event_type';
const EVENT_TIME = 'sensor.bosch_frontdoor_last_event';
export const STALE_MS = 2 * 60_000; // a snapshot older than this is refreshed when the widget is read
export const PRESS_GAP_MS = 60_000; // never press twice within this, however many reads (or widgets) there are

export interface Camera {
  ha: HaReader;
  secret: string; // part of the image path: an <img> on the TV cannot send credentials, so the path is the capability
  press(): Promise<unknown>;
  looking(): Promise<boolean>; // Sofa Home is in front on the TV
  image(): Promise<{ body: Buffer; type: string }>;
  live(on: boolean): Promise<unknown>; // the live stream switch (Session 42)
  streamUrl(): Promise<string>; // Home Assistant's HLS playlist, an absolute URL with a short-lived token
}
export const createCamera = (ha: HaClient, secret = randomBytes(16).toString('hex')): Camera => ({ ha, secret, press: () => ha.pressFrontdoorRefresh(), looking: () => ha.sofaHomeVisible(), image: () => ha.getImage(FRONTDOOR_SNAPSHOT), live: (on) => ha.setFrontdoorLive(on), streamUrl: () => ha.frontdoorStreamUrl() });
export const LIVE_MS = 2 * 60_000; // the Server turns the stream off this long after the last open, even if the TV never closes

export interface LiveView {
  /** Switches the stream on if it is not (once, however many opens) and returns the HLS URL; every open restarts the timeout. */
  open(): Promise<string>;
  /** Switches the stream off if it is on. Closing while nothing runs does nothing. */
  close(): Promise<void>;
}
/** One live session at a time, serialised so a close cannot cross an open. `timers` are injectable for tests. */
export function createLiveView(camera: Camera, timeoutMs = LIVE_MS, timers: { set: typeof setTimeout; clear: typeof clearTimeout } = { set: setTimeout, clear: clearTimeout }): LiveView {
  let on = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let chain: Promise<unknown> = Promise.resolve();
  const queue = <T>(f: () => Promise<T>): Promise<T> => {
    const r = chain.then(f, f);
    chain = r.catch(() => {});
    return r;
  };
  const arm = () => {
    timers.clear(timer);
    timer = timers.set(() => { void stop().catch((err) => log.warn('camera: live timeout switch-off failed', { err: String(err) })); }, timeoutMs);
  };
  const off = async () => {
    timers.clear(timer);
    if (!on) return;
    try {
      await camera.live(false);
      on = false;
    } catch (err) {
      arm(); // still on: try again at the next timeout
      throw err;
    }
  };
  const stop = () => queue(off);
  return {
    open: () => queue(async () => {
      const started = !on;
      if (started) {
        await camera.live(true);
        on = true;
      }
      arm();
      try {
        return await camera.streamUrl();
      } catch (err) {
        if (started) await off().catch(() => {}); // already inside the queue
        throw err;
      }
    }),
    close: stop,
  };
}
export interface CameraDeps { camera?: Camera | null }

const time = (s: string | undefined | null): number | null => {
  const t = s ? Date.parse(s.replace(/\[.*\]$/, '')) : NaN; // the event type sensor's attribute carries a "[Europe/Berlin]" suffix
  return isNaN(t) ? null : t;
};

/** Press the refresh button? Only for a snapshot we can read that is older than STALE_MS, and not again within PRESS_GAP_MS. Pure. */
export function shouldRefresh(snapshotAt: number | null, now: number, lastPressAt: number | null): boolean {
  if (snapshotAt === null || now - snapshotAt <= STALE_MS) return false;
  return lastPressAt === null || now - lastPressAt >= PRESS_GAP_MS;
}

const TYPES: Record<string, string> = { movement: 'Movement', person: 'Person', audio_alarm: 'Sound', trouble: 'Camera trouble', trouble_disconnect: 'Camera trouble', trouble_reconnect: 'Camera trouble', trouble_connect: 'Camera trouble' };
/** "Person · 2 h ago". An unknown type is "Activity"; no type and no time (or type none) is no caption. Pure. */
export function caption(type: string | undefined | null, eventAt: number | null, now: number): string | undefined {
  const t = (type ?? '').toLowerCase();
  const word = t === 'none' || t === 'unavailable' || t === 'unknown' || t === '' ? null : (TYPES[t] ?? 'Activity');
  if (!word && eventAt === null) return undefined;
  if (eventAt === null) return word!;
  const min = Math.max(0, Math.floor((now - eventAt) / 60_000));
  const ago = min < 1 ? 'just now' : min < 60 ? min + ' min ago' : min < 48 * 60 ? Math.floor(min / 60) + ' h ago' : Math.floor(min / 1440) + ' d ago';
  return (word ?? 'Activity') + ' · ' + ago;
}

export function cameraAdapter({ camera }: CameraDeps, wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): WidgetAdapter {
  let lastPressAt: number | null = null;
  return {
    type: 'camera',
    title: 'Front door',
    description: 'The last picture of the front door camera with what it saw last. While Sofa Home is open the Server asks the camera for a new picture when this one is older than 2 minutes.',
    templates: ['photo'],
    sizes: ['small', 'medium', 'large'],
    defaultSize: 'small',
    defaultFreshness: 'live',
    fields: [{ key: 'title', label: 'Title', kind: 'text', maxLength: 40, help: 'Front door if empty.' }],
    async read(config, ctx) {
      if (!camera) throw new Unavailable('Home Assistant is not set up');
      const snap = async () => {
        const s = await load(camera.ha, FRONTDOOR_SNAPSHOT);
        if (!s) throw new Unavailable('The camera is not in Home Assistant');
        const at = time(s.state);
        if (at === null) throw new Unavailable('The camera is offline'); // unavailable or unknown
        return at;
      };
      let snapshotAt = await snap();
      if (shouldRefresh(snapshotAt, ctx.now, lastPressAt)) {
        const before = lastPressAt;
        lastPressAt = ctx.now; // claimed before any await, so a read that starts meanwhile does not press again
        try {
          if (!(await camera.looking())) {
            lastPressAt = before; // nobody is looking: no press, ask again at the next read
          } else {
            await camera.press();
            for (let i = 0; i < 5 && !ctx.signal.aborted; i++) { // the new picture arrives a few seconds later
              await wait(1000);
              const at = await snap();
              if (at !== snapshotAt) { snapshotAt = at; break; }
            }
          }
        } catch (err) {
          if (err instanceof Unavailable) throw err;
          log.warn('camera: refresh failed', { err: String(err) });
        }
      }
      const [type, event] = await Promise.all([load(camera.ha, EVENT_TYPE), load(camera.ha, EVENT_TIME)]);
      const card: Display = { template: 'photo', image: `/api/camera/${camera.secret}.jpg?v=${snapshotAt}`, caption: caption(type?.state, time(event?.state), ctx.now) };
      return { title: typeof config.title === 'string' && config.title ? config.title : 'Front door', card, detail: card };
    },
    // The front door is the household's: Kids Mode never shows it.
    forKids: () => ({ empty: 'Nothing to show' }),
  };
}

/** GET /api/camera/<secret>.jpg: the current snapshot. False if the path is not this camera's. */
export async function cameraRoute(camera: Camera | null, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const m = /^\/api\/camera\/([0-9a-f]+)\.jpg$/.exec(new URL(req.url ?? '/', 'http://localhost').pathname);
  if (!m) return false;
  const send = (status: number, type: string, body: Buffer | string) => (res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }), res.end(req.method === 'HEAD' ? undefined : body), true);
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'application/json', '{"error":"method not allowed"}');
  if (!camera || m[1] !== camera.secret) return send(404, 'application/json', '{"error":"no such picture"}');
  try {
    const img = await camera.image();
    return send(200, img.type, img.body);
  } catch (err) {
    log.warn('camera: picture unavailable', { err: String(err) });
    return send(502, 'application/json', '{"error":"camera not reachable"}');
  }
}
