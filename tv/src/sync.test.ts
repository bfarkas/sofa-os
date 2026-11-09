import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Layout, Snapshot } from '@sofa/shared';
import { KIDS_STORAGE_KEY, snapshotFetcher, startSync, STORAGE_KEY, Unauthorized, type SocketHandlers, type SyncOptions, type SyncState } from './sync.ts';

const layout = (title: string): Layout => ({
  schema: 1,
  apps: [{ id: 'mvOizTfhQn.KiKAplayer', name: 'KiKA' }],
  widgets: [],
  rows: [{ id: 'apps', title, items: [{ kind: 'app', id: 'mvOizTfhQn.KiKAplayer' }] }],
  background: { kind: 'color', color: '#f6f1e7' },
  kidsMode: { apps: [], dailyMinutes: 60 },
});
const snap = (revision: number): Snapshot => ({ revision, publishedAt: '2026-11-08T12:00:00.000Z', layout: layout('r' + revision) });

const tick = () => new Promise((r) => setTimeout(r, 0));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A fake Server: `current` is what GET /api/snapshot returns, `up` whether it answers at all.
function harness(stored?: string) {
  const store = new Map<string, string>();
  if (stored !== undefined) store.set(STORAGE_KEY, stored);
  const server = { up: true, refuse: false, current: snap(1) as unknown, fetches: 0, unauthorized: 0 };
  const sockets: { h: SocketHandlers; closed: boolean }[] = [];
  const states: SyncState[] = [];
  let clock = 1_000_000;
  const options: SyncOptions = {
    fetchSnapshot: async () => {
      server.fetches++;
      if (!server.up) throw new Error('connection refused');
      if (server.refuse) throw new Unauthorized('HTTP 401');
      return JSON.parse(JSON.stringify(server.current));
    },
    openSocket: (h) => {
      const s = { h, closed: false };
      sockets.push(s);
      return { close: () => { s.closed = true; } };
    },
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) },
    onChange: (s) => states.push(s),
    onUnauthorized: () => void server.unauthorized++,
    intervalMs: 20,
    now: () => clock,
  };
  return {
    store, server, sockets, states, options,
    last: () => states[states.length - 1],
    jumpClock: (ms: number) => { clock += ms; },
    socket: () => sockets[sockets.length - 1],
  };
}

test('shows the stored snapshot at once, with the Server stopped', async () => {
  const h = harness(JSON.stringify(snap(4)));
  h.server.up = false;
  const sync = startSync(h.options);
  assert.equal(h.states[0].snapshot?.revision, 4); // before any network answer
  await tick();
  h.socket().h.close(); // the socket cannot connect either
  await wait(50);
  assert.equal(h.last().snapshot?.revision, 4);
  assert.equal(h.last().live, false);
  assert.match(h.last().error, /unreachable/);
  assert.ok(h.server.fetches >= 2, 'keeps polling');
  sync.stop();
});

test('ignores a corrupt or invalid stored snapshot', () => {
  for (const stored of ['{nope', JSON.stringify({ revision: 2, layout: { schema: 9 } })]) {
    const h = harness(stored);
    h.server.up = false;
    startSync(h.options).stop();
    assert.equal(h.states[0].snapshot, null);
  }
});

test('goes live only after fetching on socket open, and stores the snapshot', async () => {
  const h = harness();
  const sync = startSync(h.options);
  await tick();
  assert.equal(h.last().live, false); // fetched, but the socket is not open yet
  h.socket().h.open();
  await tick();
  assert.equal(h.last().live, true);
  assert.equal(h.last().snapshot?.revision, 1);
  assert.equal(JSON.parse(h.store.get(STORAGE_KEY)!).revision, 1);
  sync.stop();
});

test('fetches a new revision on the signal', async () => {
  const h = harness();
  const sync = startSync(h.options);
  h.socket().h.open();
  await tick();
  h.server.current = snap(2);
  h.socket().h.message(JSON.stringify({ type: 'revision', revision: 2 }));
  await tick();
  await tick();
  assert.equal(h.last().snapshot?.revision, 2);
  assert.equal(h.last().snapshot?.layout.rows[0].title, 'r2');
  assert.equal(JSON.parse(h.store.get(STORAGE_KEY)!).revision, 2);
  sync.stop();
});

test('keeps the last valid snapshot when a new revision fails validation', async () => {
  const h = harness();
  const sync = startSync(h.options);
  h.socket().h.open();
  await tick();
  h.server.current = { ...snap(3), layout: { ...layout('bad'), schema: 2 } };
  h.socket().h.message(JSON.stringify({ type: 'revision', revision: 3 }));
  await tick();
  await tick();
  assert.equal(h.last().snapshot?.revision, 1);
  assert.match(h.last().error, /Kept revision 1.*schema/);
  assert.equal(JSON.parse(h.store.get(STORAGE_KEY)!).revision, 1);
  sync.stop();
});

test('polls over REST while the socket is down, then reconnects', async () => {
  const h = harness();
  const sync = startSync(h.options);
  h.socket().h.open();
  await tick();
  h.socket().h.close();
  assert.equal(h.last().live, false);
  h.server.current = snap(5);
  await wait(50);
  assert.equal(h.last().snapshot?.revision, 5, 'picked up by polling');
  assert.equal(h.last().live, false);
  assert.ok(h.sockets.length >= 2, 'tried to reconnect');
  h.socket().h.open();
  await tick();
  assert.equal(h.last().live, true);
  sync.stop();
});

test('a clock jump (TV standby) drops the socket and reconnects', async () => {
  const h = harness();
  const sync = startSync(h.options);
  const first = h.socket();
  first.h.open();
  await tick();
  h.jumpClock(10 * 60_000);
  await wait(30);
  assert.equal(first.closed, true);
  assert.equal(h.last().live, false);
  assert.ok(h.sockets.length >= 2);
  first.h.message(JSON.stringify({ type: 'revision', revision: 9 })); // the dead socket is ignored
  sync.stop();
});

test('a 401 stops sync, keeps the stored snapshot and reports once', async () => {
  const h = harness(JSON.stringify(snap(4)));
  h.server.refuse = true;
  startSync(h.options);
  await wait(80); // several ticks
  assert.equal(h.server.unauthorized, 1);
  assert.equal(h.store.get(STORAGE_KEY), JSON.stringify(snap(4)));
  assert.equal(h.last().snapshot?.revision, 4);
  const fetches = h.server.fetches;
  h.socket().h.open();
  await wait(50);
  assert.equal(h.server.fetches, fetches); // no more requests with the dead token
  assert.equal(h.sockets.every((s) => s.closed), true);
});

test('the snapshot request carries the token and maps 401 to Unauthorized', async () => {
  const seen: { url: string; auth: string }[] = [];
  const fake = (status: number) =>
    (async (url: string, init: { headers: Record<string, string> }) => {
      seen.push({ url, auth: init.headers.Authorization });
      return { status, ok: status < 300, json: async () => snap(2) };
    }) as unknown as typeof fetch;
  assert.deepEqual(await snapshotFetcher(fake(200), 'https://sofa.test', 'tok')(), snap(2));
  assert.deepEqual(seen[0], { url: 'https://sofa.test/api/snapshot', auth: 'Bearer tok' });
  await assert.rejects(snapshotFetcher(fake(401), 'https://sofa.test', 'tok')(), Unauthorized);
  await assert.rejects(snapshotFetcher(fake(500), 'https://sofa.test', 'tok')(), (e: Error) => !(e instanceof Unauthorized) && /500/.test(e.message));
});

test('the kids view is fetched with ?profile=kids, kept under its own key, and a kids signal reaches onKids', async () => {
  const urls: string[] = [];
  const fetchFn = (async (url: string) => (urls.push(url), { status: 200, ok: true, json: async () => snap(1) })) as unknown as typeof fetch;
  await snapshotFetcher(fetchFn, 'https://s.test', 't')();
  await snapshotFetcher(fetchFn, 'https://s.test', 't', true)();
  assert.deepEqual(urls, ['https://s.test/api/snapshot', 'https://s.test/api/snapshot?profile=kids']);

  const h = harness();
  let signals = 0;
  const sync = startSync({ ...h.options, storageKey: KIDS_STORAGE_KEY, onKids: () => void signals++ });
  await tick();
  assert.ok(h.store.has(KIDS_STORAGE_KEY) && !h.store.has(STORAGE_KEY));
  h.socket().h.open();
  h.socket().h.message(JSON.stringify({ type: 'kids' }));
  assert.equal(signals, 1);
  sync.stop();
});

test('the Phone Remote Menu signal reaches onMenu', async () => {
  const h = harness();
  let menus = 0;
  const sync = startSync({ ...h.options, onMenu: () => void menus++ });
  await tick();
  h.socket().h.open();
  h.socket().h.message(JSON.stringify({ type: 'menu' }));
  assert.equal(menus, 1);
  sync.stop();
});
