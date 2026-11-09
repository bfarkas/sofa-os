// Keeps Sofa Home's layout in step with the Server (spec: Edit and sync).
// The WebSocket only signals new revisions; snapshots come over REST. The last valid snapshot is stored,
// shown at once on start, and kept when the Server is gone or sends one that fails validation.
import { validateSnapshot, type ServerMessage, type Snapshot } from '@sofa/shared';

export const STORAGE_KEY = 'sofahome.snapshot';
export const KIDS_STORAGE_KEY = 'sofahome.snapshot.kids'; // the kids view of the layout, kept apart from the household one

/** The Server answered 401: the device token is unknown, e.g. replaced by a newer sign-in. */
export class Unauthorized extends Error {}

/** GET /api/snapshot with the device token. In Kids Mode `kids` asks for the view with only the approved apps. */
export function snapshotFetcher(fetchFn: typeof fetch, server: string, token: string, kids = false): () => Promise<unknown> {
  return () =>
    fetchFn(server + '/api/snapshot' + (kids ? '?profile=kids' : ''), { headers: { Authorization: 'Bearer ' + token } }).then((r) => {
      if (r.status === 401) throw new Unauthorized('HTTP 401');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
}

export interface SocketHandlers {
  open(): void;
  message(data: string): void;
  close(): void;
}

export interface SyncOptions {
  fetchSnapshot(): Promise<unknown>; // GET /api/snapshot as parsed JSON; rejects when the Server cannot be reached
  openSocket(handlers: SocketHandlers): { close(): void };
  storage: { getItem(key: string): string | null; setItem(key: string, value: string): void };
  storageKey?: string; // where the last valid snapshot is kept (default STORAGE_KEY)
  onKids?(): void; // the Server signalled that Kids Mode or the Watch Allowance changed
  onWidgets?(): void; // the Server signalled that widget data changed
  onChange(state: SyncState): void;
  onUnauthorized(): void; // sync has stopped itself; the stored snapshot is untouched
  intervalMs?: number; // polling and reconnecting while the socket is down
  now?(): number;
}

export interface SyncState {
  snapshot: Snapshot | null; // the last valid snapshot
  live: boolean; // socket open and the snapshot fetched since it opened
  error: string; // the last problem, '' when none
}

export function startSync(o: SyncOptions): { stop(): void; refresh(): void } {
  const storageKey = o.storageKey || STORAGE_KEY;
  const intervalMs = o.intervalMs || 10_000;
  const now = o.now || Date.now;
  const state: SyncState = { snapshot: load(), live: false, error: '' };
  let socket: { close(): void } | null = null;
  let connected = false;
  let generation = 0; // ignores events from sockets already given up on
  let stopped = false;
  let fetching = false;
  let again = false;
  let lastTick = now();

  function load(): Snapshot | null {
    try {
      const value: unknown = JSON.parse(o.storage.getItem(storageKey) || 'null');
      return validateSnapshot(value).length ? null : (value as Snapshot);
    } catch {
      return null;
    }
  }

  const emit = () => o.onChange({ snapshot: state.snapshot, live: state.live, error: state.error });

  function apply(value: unknown, fetchedLive: boolean): void {
    const errors = validateSnapshot(value);
    if (errors.length) {
      state.error = 'Kept revision ' + (state.snapshot ? state.snapshot.revision : '-') + ', the new one is invalid: ' + errors[0];
    } else {
      const snap = value as Snapshot;
      if (!state.snapshot || state.snapshot.revision !== snap.revision) {
        state.snapshot = snap;
        try {
          o.storage.setItem(storageKey, JSON.stringify(snap));
        } catch {
          /* storage full or off: still show it */
        }
      }
      state.error = '';
      state.live = fetchedLive;
    }
    emit();
  }

  // One fetch at a time, so answers arrive in order; a request during a fetch runs once more after it.
  function refresh(): void {
    if (stopped) return;
    if (fetching) {
      again = true;
      return;
    }
    fetching = true;
    const gen = generation, wasConnected = connected;
    o.fetchSnapshot()
      .then(
        (value) => apply(value, wasConnected && connected && gen === generation),
        (err) => {
          if (err instanceof Unauthorized) {
            stop();
            o.onUnauthorized();
            return;
          }
          state.error = 'Server unreachable: ' + (err && err.message ? err.message : String(err));
          emit();
        },
      )
      .then(() => {
        fetching = false;
        if (again) {
          again = false;
          refresh();
        }
      });
  }

  function connect(): void {
    if (socket) return;
    const gen = ++generation;
    const current = () => gen === generation;
    try {
      socket = o.openSocket({
        open: () => {
          if (!current()) return;
          connected = true;
          refresh(); // fetch the current revision before showing anything as live
        },
        message: (data) => {
          if (!current()) return;
          let msg: ServerMessage;
          try {
            msg = JSON.parse(data);
          } catch {
            return;
          }
          if (msg.type === 'revision' && (!state.snapshot || msg.revision !== state.snapshot.revision)) refresh();
          else if (msg.type === 'kids' && o.onKids) o.onKids();
          else if (msg.type === 'widgets' && o.onWidgets) o.onWidgets();
        },
        close: () => {
          if (current()) drop();
        },
      });
    } catch (err) {
      socket = null;
      state.error = 'Cannot open the socket: ' + err;
      emit();
    }
  }

  function drop(): void {
    generation++;
    const s = socket;
    socket = null;
    connected = false;
    if (state.live) {
      state.live = false;
      emit();
    }
    if (s) s.close();
  }

  // Standby kills the socket without telling the page (spec: TV network transport), so a clock jump means reconnect.
  function tick(): void {
    const t = now();
    if (t - lastTick > 3 * intervalMs) drop();
    lastTick = t;
    if (!connected) {
      refresh();
      connect();
    }
  }

  emit();
  refresh();
  connect();
  const timer = setInterval(tick, intervalMs);
  function stop(): void {
    stopped = true;
    clearInterval(timer);
    generation++;
    if (socket) socket.close();
    socket = null;
  }
  return { stop, refresh };
}
