// Widget data on the TV without the DOM: fetching GET /api/widgets, keeping the last answer, and deciding what each card
// shows. cards.ts draws it. Sofa Home knows only the display templates (ADR 0003), never the widget types.
//
// States of a card: loading (no data yet), ok, empty, unavailable, and ok or empty marked stale. Stale means the data is
// older than its freshness policy allows, the Server's last read of the source failed, or the Server cannot be reached.
// The age is measured on the Server's clock at the time of the answer plus the TV's own clock since, so a TV clock that is
// off does not matter. The last answer is stored, so after a restart without the Server the cards show it, stale.
import { validateWidgetData, type Display, type WidgetData } from '@sofa/shared';
import { clockText, dateText } from './shell.ts';

export const WIDGETS_KEY = 'sofahome.widgets';

export interface WidgetsState {
  byId: Record<string, WidgetData>;
  invalid: Record<string, boolean>; // ids that arrived malformed: shown as unavailable
  serverTime: number; // the Server's clock at the last answer
  receivedAt: number; // the TV's clock when that answer arrived
  reachable: boolean | null; // the last request got an answer; null until the first one
}

export type CardView =
  | { state: 'loading'; title: string }
  | { state: 'unavailable'; title: string; message: string }
  | { state: 'empty'; title: string; message: string; stale: boolean; updated: string }
  | { state: 'ok'; title: string; card: Display; detail: Display; stale: boolean; updated: string };

export const emptyState = (): WidgetsState => ({ byId: {}, invalid: {}, serverTime: 0, receivedAt: 0, reachable: null });

const UNAVAILABLE = 'Not available right now';

/** Reads an answer of GET /api/widgets; null if it is not one. Malformed widgets are listed apart, the rest are kept. */
export function parseWidgets(value: unknown, receivedAt: number): WidgetsState | null {
  const v = value as { serverTime?: unknown; widgets?: unknown };
  const serverTime = v && typeof v.serverTime === 'string' ? Date.parse(v.serverTime) : NaN;
  if (isNaN(serverTime) || !Array.isArray(v.widgets)) return null;
  const s = emptyState();
  s.serverTime = serverTime;
  s.receivedAt = receivedAt;
  s.reachable = true;
  for (const w of v.widgets as WidgetData[]) {
    if (!validateWidgetData(w).length) s.byId[w.id] = w;
    else if (w && typeof w.id === 'string') s.invalid[w.id] = true;
  }
  return s;
}

/** "Updated 14:05", or with the day when it was not today. */
export function updatedText(local: Date, now: Date): string {
  return 'Updated ' + (local.toDateString() === now.toDateString() ? '' : dateText(local) + ' ') + clockText(local);
}

/** What the card for widget `id` shows now. `fallbackTitle` is used until the Server has named it. */
export function cardView(s: WidgetsState, id: string, fallbackTitle: string, now: number): CardView {
  const d = s.byId[id];
  if (s.invalid[id]) return { state: 'unavailable', title: fallbackTitle, message: UNAVAILABLE };
  if (!d) return s.reachable === false ? { state: 'unavailable', title: fallbackTitle, message: UNAVAILABLE } : { state: 'loading', title: fallbackTitle };
  if (d.status === 'unavailable') return { state: 'unavailable', title: d.title, message: d.message || UNAVAILABLE };
  const updatedAt = d.updatedAt === null ? s.serverTime : Date.parse(d.updatedAt);
  const age = s.serverTime - updatedAt + (now - s.receivedAt);
  const stale = d.failing || s.reachable === false || age > d.staleAfterSeconds * 1000;
  const updated = updatedText(new Date(s.receivedAt - (s.serverTime - updatedAt)), new Date(now));
  if (d.status === 'empty' || !d.card) return { state: 'empty', title: d.title, message: d.message || 'Nothing to show', stale, updated };
  return { state: 'ok', title: d.title, card: d.card, detail: d.detail || d.card, stale, updated };
}

/** GET /api/widgets with the device token (household profile: Kids Mode shows no widgets). */
export function widgetsFetcher(fetchFn: typeof fetch, server: string, token: string): () => Promise<unknown> {
  return () =>
    fetchFn(server + '/api/widgets', { headers: { Authorization: 'Bearer ' + token } }).then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
}

export interface WidgetsOptions {
  fetchWidgets(): Promise<unknown>;
  storage: { getItem(key: string): string | null; setItem(key: string, value: string): void };
  onChange(state: WidgetsState): void; // also called every interval, so cards can turn stale as time passes
  intervalMs?: number; // polling, in case a socket signal was missed (default 30 s)
  now?(): number;
}

/** Fetches now, on every refresh() (a `widgets` signal, a new revision, a resume) and every interval. */
export function startWidgets(o: WidgetsOptions): { stop(): void; refresh(): void } {
  const now = o.now || Date.now;
  let state = load();
  let fetching = false, again = false, stopped = false;

  function load(): WidgetsState {
    try {
      const saved = JSON.parse(o.storage.getItem(WIDGETS_KEY) || 'null');
      const s = saved && parseWidgets(saved.answer, saved.receivedAt);
      if (s) {
        s.reachable = null; // stored, not answered in this run
        return s;
      }
    } catch {
      /* unreadable: start empty */
    }
    return emptyState();
  }

  function refresh(): void {
    if (stopped) return;
    if (fetching) {
      again = true;
      return;
    }
    fetching = true;
    o.fetchWidgets()
      .then(
        (answer) => {
          const s = parseWidgets(answer, now());
          if (!s) throw new Error('not a widgets answer');
          state = s;
          try {
            o.storage.setItem(WIDGETS_KEY, JSON.stringify({ answer, receivedAt: s.receivedAt }));
          } catch {
            /* storage full or off: still show it */
          }
        },
      )
      .then(null, () => {
        state.reachable = false; // keep what we have; it shows as stale
      })
      .then(() => {
        fetching = false;
        if (!stopped) o.onChange(state);
        if (again) {
          again = false;
          refresh();
        }
      });
  }

  o.onChange(state);
  refresh();
  const timer = setInterval(refresh, o.intervalMs || 30_000);
  return {
    stop(): void {
      stopped = true;
      clearInterval(timer);
    },
    refresh,
  };
}
