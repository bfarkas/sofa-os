// The widget framework (ADR 0003): each widget type is one adapter in Server code, and this service reads every widget
// instance of the current layout on its freshness policy and keeps the last good display model.
//
// Failure isolation: each instance is read on its own, with a timeout, and everything an adapter can do wrong (throw, reject,
// hang, return a malformed model, be unknown or misconfigured) ends in that one widget being unavailable or stale. Nothing
// here throws into the caller, so the snapshot, Kids Mode and every other widget carry on. An adapter that blocks the event
// loop cannot be stopped this way; adapters must only do asynchronous I/O.
import { FRESHNESS_POLICY, readConfig, validateDisplay, type Display, type Layout, type Profile, type WidgetData, type WidgetInstance, type WidgetSize, type WidgetType } from '@sofa/shared';
import { log } from './log.ts';

/** What a read returns: a card and optionally a richer full-screen view, or nothing to show (with the words for it). */
export type WidgetResult = { title?: string; card: Display; detail?: Display } | { title?: string; empty: string };

export interface ReadContext {
  now: number; // ms since the epoch
  signal: AbortSignal; // aborted when the read times out; pass it to fetch
  size?: WidgetSize; // the instance's size, for a card that is built differently per size (the calendar)
}

/**
 * One widget type. The catalogue fields are what Companion sees (GET /api/widget-types). `read` gets the instance's
 * config already checked against `fields`, with defaults filled in, and only the declared keys. It may throw; throw
 * `Unavailable` for a reason the household should read on the card. `forKids` turns a result into what the Kids Mode
 * profile may see (e.g. a calendar without event details); without it, kids get the same result.
 */
export interface WidgetAdapter extends WidgetType {
  read(config: Record<string, unknown>, ctx: ReadContext): WidgetResult | Promise<WidgetResult>;
  forKids?(result: WidgetResult): WidgetResult;
}

/** An adapter's way of saying why it has nothing, in words for the card ("Home Assistant is not reachable"). */
export class Unavailable extends Error {}

const GENERIC = 'Not available right now';
const RETRY_MAX_S = 60; // a failed read is tried again after at most a minute

interface Entry {
  key: string; // what the data depends on: type, size, freshness, config. A change starts the entry over.
  instance: WidgetInstance;
  adapter: WidgetAdapter | null;
  config: Record<string, unknown>;
  problem: string; // set when the instance cannot be read at all (unknown type, bad config): shown, never read
  result: WidgetResult | null; // the last good result
  updatedAt: number | null;
  failing: boolean;
  message: string; // why the last read failed, for the card
  nextAt: number;
  reading: boolean;
}

export interface WidgetsOptions {
  adapters: WidgetAdapter[];
  layout(): Layout; // the current layout, read on every tick, so a publish is picked up
  onChange?(): void; // what GET /api/widgets returns may have changed; coalesced
  now?(): number;
  timeoutMs?: number; // per read (default 10 s)
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function resultProblems(r: unknown): string[] {
  if (!isObj(r)) return ['result: must be an object'];
  if (r.title !== undefined && (typeof r.title !== 'string' || r.title.length > 120)) return ['title: must be a string of at most 120 characters'];
  if ('empty' in r) return typeof r.empty === 'string' && r.empty.length <= 120 ? [] : ['empty: must be a string of at most 120 characters'];
  return validateDisplay(r.card, 'card').concat(r.detail === undefined ? [] : validateDisplay(r.detail, 'detail'));
}

export function createWidgets(o: WidgetsOptions) {
  const now = o.now ?? Date.now;
  const timeoutMs = o.timeoutMs ?? 10_000;
  const byType = new Map(o.adapters.map((a) => [a.type, a]));
  const entries = new Map<string, Entry>();
  let signal: ReturnType<typeof setTimeout> | undefined;

  const changed = () => {
    if (!o.onChange || signal) return;
    signal = setTimeout(() => {
      signal = undefined;
      o.onChange!();
    }, 200);
    signal.unref?.();
  };

  function layout(): Layout | null {
    try {
      return o.layout();
    } catch (err) {
      log.error('widgets: cannot read the layout', { err: String(err) });
      return null;
    }
  }

  // Brings the entries in line with the layout's instances; returns them in layout order.
  function sync(): Entry[] {
    const l = layout();
    if (!l) return [...entries.values()];
    const seen = new Set<string>();
    const list = l.widgets.map((w) => {
      seen.add(w.id);
      const key = JSON.stringify([w.type, w.size, w.freshness, w.config]);
      const old = entries.get(w.id);
      if (old && old.key === key) {
        old.instance = w; // profiles may change without a re-read
        return old;
      }
      const adapter = byType.get(w.type) ?? null;
      const { config, errors } = adapter ? readConfig(adapter.fields, w.config) : { config: {}, errors: [] };
      if (adapter && adapter.sizes.indexOf(w.size) < 0) errors.push('size: must be one of ' + adapter.sizes.join(', '));
      const problem = !adapter ? 'This widget type is not available' : errors.length ? 'Check this widget in Companion' : '';
      if (!adapter) log.warn('widget type unknown', { id: w.id, type: w.type });
      else if (errors.length) log.warn('widget config invalid', { id: w.id, type: w.type, errors });
      const e: Entry = { key, instance: w, adapter, config, problem, result: null, updatedAt: null, failing: false, message: '', nextAt: 0, reading: false };
      entries.set(w.id, e);
      if (old || problem) changed();
      return e;
    });
    for (const id of [...entries.keys()]) {
      if (!seen.has(id)) {
        entries.delete(id);
        changed();
      }
    }
    return list;
  }

  async function read(e: Entry): Promise<void> {
    const adapter = e.adapter!;
    const refreshS = FRESHNESS_POLICY[e.instance.freshness].refreshSeconds;
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    e.reading = true;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          ac.abort();
          reject(new Error('timed out after ' + timeoutMs + ' ms'));
        }, timeoutMs);
      });
      // Promise.resolve().then runs the adapter inside the chain, so a synchronous throw is caught like a rejection.
      const result = await Promise.race([Promise.resolve().then(() => adapter.read(e.config, { now: now(), signal: ac.signal, size: e.instance.size })), timeout]);
      const problems = resultProblems(result);
      if (problems.length) throw new Error('malformed display model: ' + problems.slice(0, 3).join('; '));
      if (entries.get(e.instance.id) !== e) return; // replaced while reading: this answer is for the old config
      if (e.failing) log.info('widget recovered', { id: e.instance.id, type: e.instance.type });
      e.result = result;
      e.updatedAt = now();
      e.failing = false;
      e.message = '';
      e.nextAt = now() + refreshS * 1000;
    } catch (err) {
      if (entries.get(e.instance.id) !== e) return;
      if (!e.failing) log.warn('widget failing', { id: e.instance.id, type: e.instance.type, err: String(err) });
      e.failing = true;
      e.message = err instanceof Unavailable ? err.message.slice(0, 120) : GENERIC;
      e.nextAt = now() + Math.min(refreshS, RETRY_MAX_S) * 1000;
    } finally {
      clearTimeout(timer);
      e.reading = false;
      changed();
    }
  }

  /** Reads every instance that is due, in parallel, and resolves when those reads are done. Never rejects. */
  function tick(): Promise<void> {
    const due = sync().filter((e) => !e.problem && !e.reading && e.nextAt <= now());
    return Promise.all(due.map(read)).then(() => undefined);
  }

  // The kids view of a result. If the adapter's filter fails, kids get nothing rather than the household's data.
  function forProfile(e: Entry, result: WidgetResult, profile: Profile): WidgetResult | null {
    if (profile !== 'kids' || !e.adapter?.forKids) return result;
    try {
      const r = e.adapter.forKids(result);
      return resultProblems(r).length ? null : r;
    } catch (err) {
      log.warn('widget kids filter failed', { id: e.instance.id, type: e.instance.type, err: String(err) });
      return null;
    }
  }

  function toData(e: Entry, profile: Profile): WidgetData | null {
    const base = {
      id: e.instance.id,
      title: e.adapter?.title ?? e.instance.type,
      updatedAt: e.updatedAt === null ? null : new Date(e.updatedAt).toISOString(),
      failing: e.failing,
      staleAfterSeconds: FRESHNESS_POLICY[e.instance.freshness].staleAfterSeconds,
    };
    if (e.problem) return { ...base, status: 'unavailable', message: e.problem };
    if (!e.result) return e.failing ? { ...base, status: 'unavailable', message: e.message } : null; // not read yet: Sofa Home shows it loading
    const r = forProfile(e, e.result, profile);
    if (!r) return { ...base, status: 'unavailable', message: GENERIC };
    const title = r.title || base.title;
    if ('empty' in r) return { ...base, title, status: 'empty', message: r.empty };
    return { ...base, title, status: 'ok', card: r.card, ...(r.detail ? { detail: r.detail } : {}), ...(e.failing ? { message: e.message } : {}) };
  }

  return {
    tick,
    /** GET /api/widgets: every instance visible to the profile that has something to show, in layout order. */
    data(profile: Profile): WidgetData[] {
      const out: WidgetData[] = [];
      for (const e of sync()) {
        if (e.instance.profiles.indexOf(profile) < 0) continue;
        const d = toData(e, profile);
        if (d) out.push(d);
      }
      return out;
    },
    /** Reads every instance of a type again now, e.g. when a Home Assistant subscription reports a change. */
    refreshType(type: string): Promise<void> {
      for (const e of entries.values()) if (e.instance.type === type) e.nextAt = 0;
      return tick();
    },
    /** GET /api/widget-types: the catalogue, without the code. */
    types(): WidgetType[] {
      return o.adapters.map(({ type, title, description, templates, sizes, defaultSize, defaultFreshness, fields }) => ({ type, title, description, templates, sizes, defaultSize, defaultFreshness, fields }));
    },
    /** Ticks every few seconds until the returned function is called. */
    start(intervalMs = 5000): () => void {
      void tick();
      const t = setInterval(() => void tick(), intervalMs);
      t.unref?.();
      return () => {
        clearInterval(t);
        clearTimeout(signal);
      };
    },
  };
}

export type Widgets = ReturnType<typeof createWidgets>;
