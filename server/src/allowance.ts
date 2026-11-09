import type { DatabaseSync } from 'node:sqlite';
import type { KidsStatus } from '@sofa/shared';
import type { HaConfig } from './config.ts';
import { subscribeEvents, type HaClient } from './ha.ts';
import { currentSnapshot } from './layout.ts';
import { log } from './log.ts';

// The Watch Allowance clock (spec: Kids Mode > Watch Allowance; rules in the plan's Session 08 note).
// Time is counted in whole seconds, and only between two observations of the TV's state that both say it is on.
// The state is saved after every change, so a restart resumes from it without losing or double-counting time.

export const TICK_MS = 5_000; // how often the Server reads the TV's state and acts
export const GAP_MS = 60_000; // two "on" observations further apart than this prove nothing about the time between
export const HOLD_MS = 240_000; // Home Assistant's false "on" after a remote standby lasted about 3 minutes
export const WARN_SECONDS = 300;
export const MAX_TOPUP_MINUTES = 240;
export const DONE_SCREEN_MS = 60_000; // how long the Done Screen may stay up on a TV that is on again at zero
export const WARNING_TAG = 'sofa-kids-warning'; // a new warning replaces the old one on the phone

/** The notification actions (spec Known results: a tap arrives as mobile_app_notification_action with { action }). */
export const TOPUP_ACTIONS = [
  { action: 'SOFA_TOPUP_5', title: '+5 min' },
  { action: 'SOFA_TOPUP_10', title: '+10 min' },
  { action: 'SOFA_TOPUP_CUSTOM', title: 'Custom', behavior: 'textInput', textInputButtonTitle: 'Add', textInputPlaceholder: 'Minutes' },
];

export const isTopUpMinutes = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= MAX_TOPUP_MINUTES;

/** Minutes to add for a notification action event's data, or null when it is not a valid Sofa.OS Top-up. */
export function actionMinutes(data: Record<string, unknown>): number | null {
  if (data.action === 'SOFA_TOPUP_5') return 5;
  if (data.action === 'SOFA_TOPUP_10') return 10;
  if (data.action !== 'SOFA_TOPUP_CUSTOM') return null;
  const text = String(data.reply_text ?? '').trim(); // the iOS app sends the typed text as reply_text
  return /^\d{1,3}$/.test(text) && isTopUpMinutes(Number(text)) ? Number(text) : null;
}

/** Allowance days in a time zone. A day runs from the reset time on its date to the reset time on the next date. */
export function allowanceDays(timeZone: string, resetMinutes: number) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
  // The local wall-clock time of an instant, written as if it were UTC.
  const wall = (ms: number) => {
    const p: Record<string, number> = {};
    for (const { type, value } of fmt.formatToParts(ms)) p[type] = Number(value);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  };
  const reset = resetMinutes * 60_000;
  return {
    /** The day an instant belongs to, as YYYY-MM-DD. Read off the wall clock, so DST days last 23 or 25 hours. */
    of: (ms: number) => new Date(wall(ms) - reset).toISOString().slice(0, 10),
    /** The instant a day starts: the reset time on its date, local. */
    // shortcut: a reset time inside the skipped spring hour (02:00-02:59 in Berlin) starts that day up to an hour late; fine for 04:00.
    start(day: string): number {
      const target = Date.parse(day) + reset;
      const guess = target - (wall(target) - target);
      return target - (wall(guess) - guess);
    },
  };
}
const nextDay = (day: string) => new Date(Date.parse(day) + 86_400_000).toISOString().slice(0, 10);

export type TvPower = 'on' | 'off';

/** The TV's media player state as power. Only "off" is off; unavailable or unknown proves nothing either way. */
export function tvPower(entity: unknown): TvPower | null {
  const state = (entity as { state?: unknown } | null)?.state;
  if (state === 'off') return 'off';
  return typeof state === 'string' && state !== 'unavailable' && state !== 'unknown' ? 'on' : null;
}

interface State {
  day: string; // the allowance day the counters belong to
  used: number; // seconds counted today
  topUp: number; // seconds added today
  kids: boolean; // Kids Mode is active
  tv: 'on' | 'off' | 'pending'; // pending: Home Assistant says on, but that is not proven yet
  since: number; // ms; while counting, time is counted up to here. A pending on counts from here once confirmed
  onAt: number; // ms; when the current pending on began
  offAt: number; // ms; when Home Assistant last reported off
  seenAt: number; // ms; the last observation of the TV's state
  provenAt: number; // ms; the last time the TV itself showed it is on (a Sofa Home request)
  warned: boolean; // the 5-minute warning for the current approach to zero is sent
  zeroed: boolean; // the TV was switched off for the current zero
  donePending: boolean; // show the Done Screen at the next power-on
  doneAt: number; // ms; when Sofa Home showed the Done Screen at zero (0: not yet); the TV goes off again DONE_SCREEN_MS later
}
const INITIAL: State = { day: '', used: 0, topUp: 0, kids: false, tv: 'off', since: 0, onAt: 0, offAt: 0, seenAt: 0, provenAt: 0, warned: false, zeroed: false, donePending: false, doneAt: 0 };

/** Where the state is kept between restarts: one JSON document. */
export interface Store {
  load(): string | undefined;
  save(json: string): void;
}

/** The state in SQLite, and the daily allowance from the current layout. */
export const fromDb = (db: DatabaseSync) => ({
  store: {
    load: () => (db.prepare('SELECT state FROM allowance WHERE id = 1').get() as { state: string } | undefined)?.state,
    save: (json: string) => void db.prepare('INSERT INTO allowance (id, state) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET state = excluded.state').run(json),
  } satisfies Store,
  budgetSeconds: () => currentSnapshot(db).layout.kidsMode.dailyMinutes * 60,
});

export interface AllowanceOptions {
  store: Store;
  budgetSeconds: () => number; // the daily allowance, read on every use so a published layout applies at once
  ha: Pick<HaClient, 'turnOffTv' | 'notifyAdults'> | null;
  timeZone: string;
  resetMinutes: number; // local time of the overnight reset, in minutes after midnight
  graceSeconds: number; // time between zero and the switch-off
  topUpUrl?: string; // the Companion Top-up page: the tap target of the warning notification
  now?: () => number;
}

/** The clock's part of KidsStatus; the server adds whether a PIN is set. */
export type AllowanceStatus = Omit<KidsStatus, 'pinSet'>;
export type Allowance = ReturnType<typeof createAllowance>;

export function createAllowance(o: AllowanceOptions) {
  const clock = o.now ?? Date.now;
  const days = allowanceDays(o.timeZone, o.resetMinutes);
  let saved = o.store.load();
  const s: State = { ...INITIAL, ...(saved ? (JSON.parse(saved) as Partial<State>) : {}) };
  const listeners = new Set<() => void>();
  const signature = () => [s.kids, s.donePending, s.topUp, s.day, s.zeroed].join();
  let signalled = signature();

  const counting = () => s.kids && s.tv === 'on';
  const allowance = () => o.budgetSeconds() + s.topUp;
  const remaining = () => allowance() - s.used; // below 0 only during a grace period

  function roll(now: number): void {
    const day = days.of(now);
    if (day <= s.day) return; // date order; never back, so a reset inside the repeated DST hour happens once
    if (s.day) log.info('allowance reset', { day });
    Object.assign(s, { day, used: 0, topUp: 0, warned: false, zeroed: false, donePending: false, doneAt: 0 });
    s.since = Math.max(s.since, days.start(day));
  }

  function accrue(now: number): void {
    const secs = Math.floor((now - s.since) / 1000);
    if (!s.kids || secs <= 0) return;
    s.since += secs * 1000;
    s.used = Math.min(s.used + secs, Math.max(s.used, allowance() + o.graceSeconds)); // the clock stops at zero (plus grace)
  }

  /** The Done Screen minute of a TV that is on at zero. It starts when the TV is proven on, or when Sofa Home shows the Done Screen on it. */
  function startMinute(now: number): void {
    if (s.kids && s.zeroed && remaining() <= 0 && !s.doneAt) s.doneAt = now;
  }

  function commit(): void {
    const rem = remaining();
    if (rem > WARN_SECONDS) s.warned = false; // time was added: warn again on the way down
    if (rem > 0) Object.assign(s, { zeroed: false, donePending: false, doneAt: 0 });
    const json = JSON.stringify(counting() ? s : { ...s, seenAt: 0 }); // only a running clock needs its last observation
    if (json !== saved) o.store.save((saved = json));
    if (signature() !== signalled) {
      signalled = signature();
      for (const fn of listeners) fn();
    }
  }

  function status(): AllowanceStatus {
    return {
      active: s.kids,
      tv: s.tv,
      dailySeconds: o.budgetSeconds(),
      topUpSeconds: s.topUp,
      usedSeconds: s.used,
      remainingSeconds: Math.max(0, remaining()),
      donePending: s.donePending,
      resetsAt: new Date(days.start(nextDay(s.day))).toISOString(),
    };
  }

  /** Applies a change at the current time, after rolling the day over, and saves it. */
  function change(fn: (now: number) => void = () => {}): AllowanceStatus {
    const now = clock();
    roll(now);
    fn(now);
    commit();
    return status();
  }

  return {
    status: () => change(),
    onChange: (fn: () => void) => listeners.add(fn),

    /** One reading of the TV's state from Home Assistant; null when it could not be read. */
    observe: (power: TvPower | null) =>
      change((now) => {
        if (!power) return; // nothing proven: the clock waits
        const was = s.tv, prev = s.seenAt;
        s.seenAt = now;
        if (power === 'off') {
          if (s.tv !== 'off') {
            Object.assign(s, { tv: 'off', offAt: now, doneAt: 0 });
            if (s.kids && s.zeroed) s.donePending = true; // off before the minute was up: the next power-on shows the Done Screen again
          }
        } else if (s.tv === 'off') {
          // Right after an off, Home Assistant reports a false on for about 3 minutes, unless the TV has spoken since.
          Object.assign(s, { onAt: now, since: now, tv: now - s.offAt < HOLD_MS && s.provenAt < s.offAt ? 'pending' : 'on' });
        } else if (now - prev > GAP_MS) {
          Object.assign(s, { tv: 'pending', onAt: now, since: now }); // lost sight of the TV: the on must prove itself again
        } else if (s.tv === 'pending') {
          if (now - s.onAt >= HOLD_MS) {
            s.tv = 'on'; // outlasted a false on, so it was real all along
            accrue(now);
          }
        } else accrue(now);
        if (s.tv !== was) log.info('tv', { state: s.tv });
        if (s.tv === 'on' && was !== 'on') startMinute(now);
      }),

    /** The TV itself showed it is on (a request from Sofa Home). Confirms a pending on at once. */
    tvSeen: () =>
      change((now) => {
        s.provenAt = now;
        if (s.tv !== 'pending') return;
        Object.assign(s, { tv: 'on', since: now });
        startMinute(now);
        log.info('tv', { state: 'on', proof: 'sofa home' });
      }),

    enter: () =>
      change((now) => {
        if (s.kids) return;
        Object.assign(s, { kids: true, since: now });
        if (remaining() <= 0) s.donePending = true; // entered with nothing left: the Done Screen, not the tiles
        log.info('kids mode entered');
      }),

    /** An adult leaves Kids Mode. The Server checks the PIN before this for the TV; a Companion session needs none. */
    exit: () =>
      change(() => {
        if (!s.kids) return;
        Object.assign(s, { kids: false, donePending: false, doneAt: 0 });
        log.info('kids mode exited');
      }),

    topUp: (minutes: number, source: string) =>
      change(() => {
        if (!isTopUpMinutes(minutes)) throw new RangeError(`not a Top-up: ${minutes}`);
        s.topUp += minutes * 60;
        log.info('top-up', { minutes, source });
      }),

    /** Sofa Home showed the Done Screen. At zero, that starts the 60 seconds after which a TV that is on again goes off again. */
    doneShown: () =>
      change((now) => {
        s.donePending = false;
        if (s.tv === 'on') startMinute(now); // a Done Screen shown while the TV is off (standby is slow) must not start the minute
      }),

    /** Sends the warning and switches the TV off when due. Called after each observation. */
    async act(): Promise<void> {
      change();
      if (!o.ha || !counting()) return;
      const rem = remaining();
      if (!s.warned && rem > 0 && rem <= WARN_SECONDS) {
        s.warned = true; // once, even if it fails: a retry would repeat it on the phone that did get it
        const minutes = Math.ceil(rem / 60);
        try {
          await o.ha.notifyAdults(`${minutes} minute${minutes === 1 ? '' : 's'} of Kids Mode left.`, { title: 'Sofa.OS', data: { actions: TOPUP_ACTIONS, ...(o.topUpUrl ? { url: o.topUpUrl } : {}), tag: WARNING_TAG } });
          log.info('allowance warning sent', { remainingSeconds: rem });
        } catch (err) {
          log.warn('allowance warning failed', { err: String(err) });
        }
      }
      // A TV switched on again at zero: once Sofa Home has shown the Done Screen for a minute, off again, unless a Top-up came.
      if (s.zeroed && s.doneAt && rem <= 0 && clock() - s.doneAt >= DONE_SCREEN_MS) {
        try {
          await o.ha.turnOffTv();
          Object.assign(s, { doneAt: 0, donePending: true });
          log.info('allowance still at zero: tv switched off again');
        } catch (err) {
          log.warn('switching the tv off again failed', { err: String(err) });
        }
      }
      if (!s.zeroed && rem <= -o.graceSeconds) {
        try {
          await o.ha.turnOffTv(); // retried on the next tick if it fails; turning off a TV that is off is harmless
          Object.assign(s, { zeroed: true, warned: true, donePending: true });
          log.info('allowance at zero: tv switched off');
        } catch (err) {
          log.warn('switching the tv off failed', { err: String(err) });
        }
      }
      commit();
    },
  };
}

/**
 * Runs the clock against Home Assistant: reads the TV's state every tick, then acts, and applies Top-ups from the
 * notification actions. Returns a stop function.
 */
export function startAllowance(engine: Allowance, ha: HaConfig, client: Pick<HaClient, 'getState'>, tickMs = TICK_MS, onReach: (ok: boolean) => void = () => {}): () => void {
  const stopEvents = subscribeEvents(ha, 'mobile_app_notification_action', (data) => {
    const minutes = actionMinutes(data);
    if (minutes) engine.topUp(minutes, 'notification');
    else if (data.action === 'SOFA_TOPUP_CUSTOM') log.warn('top-up ignored: not 1 to 240 minutes', { reply: String(data.reply_text ?? '').slice(0, 20) });
  }, tickMs);
  let stopped = false;
  let reachable: boolean | undefined; // log changes only
  let timer: ReturnType<typeof setTimeout> | undefined;
  const step = async () => {
    let power: TvPower | null = null;
    try {
      const entity = await client.getState(ha.tvEntity);
      power = tvPower(entity);
      if (reachable !== true) log.info('home assistant reachable', { entity: ha.tvEntity, state: (entity as { state?: string }).state });
      reachable = true;
    } catch (err) {
      if (reachable !== false) log.warn('home assistant tv state failed', { entity: ha.tvEntity, err: String(err) });
      reachable = false;
    }
    onReach(reachable === true);
    try {
      engine.observe(power);
      await engine.act();
    } catch (err) {
      log.error('allowance tick failed', { err: String(err) });
    }
    if (!stopped) timer = setTimeout(step, tickMs);
  };
  void step();
  return () => {
    stopped = true;
    clearTimeout(timer);
    stopEvents();
  };
}
