// Session 16: Sofa Home's operations as revisions, and the merge into Companion drafts (ADR 0004).
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import type { Draft, Layout, LayoutOp, Snapshot } from '@sofa/shared';
import { hashSecret } from './auth.ts';
import type { Config } from './config.ts';
import { openDb } from './db.ts';
import { commitOp, createDraft, currentSnapshot, getDraft, publishDraft, saveDraft } from './layout.ts';
import { startServer } from './server.ts';
import { approveCode, claimToken, createCode } from './tv.ts';

const dir = mkdtempSync(join(tmpdir(), 'sofa-ops-'));
let dbN = 0;
const w = (id: string) => ({ id, type: 'status', size: 'small' as const, config: {}, profiles: ['household' as const], freshness: 'live' as const });
const layout = (): Layout => ({
  schema: 1,
  apps: [{ id: 'a.Netflix', name: 'Netflix' }],
  widgets: [w('a'), w('b'), w('c'), w('d')],
  rows: [
    { id: 'apps', title: 'Apps', items: [{ kind: 'app', id: 'a.Netflix' }] },
    { id: 'info', title: 'Info', items: [{ kind: 'widget', id: 'a' }, { kind: 'widget', id: 'b' }, { kind: 'widget', id: 'c' }] },
  ],
  background: { kind: 'color', color: '#f6f1e7' },
  kidsMode: { apps: [], dailyMinutes: 40 },
});
const row = (l: unknown, id = 'info') => (l as Layout).rows.filter((r) => r.id === id)[0]?.items.map((i) => i.id);

/** A database at revision 2 holding layout(). */
function fresh() {
  const db = openDb(join(dir, `db${++dbN}.db`));
  const d = createDraft(db);
  saveDraft(db, d.id, d.base, layout());
  assert.ok(publishDraft(db, d.id).ok);
  return db;
}
const op = (db: ReturnType<typeof fresh>, o: LayoutOp) => {
  const r = commitOp(db, currentSnapshot(db).revision, o);
  assert.ok(r.ok, JSON.stringify(r));
  return r.snapshot;
};
/** A draft started now, with `edit` applied and saved. */
function draft(db: ReturnType<typeof fresh>, edit: (l: Layout) => Layout = (l) => l): Draft {
  const d = createDraft(db);
  return saveDraft(db, d.id, d.base, edit(structuredClone(d.layout as Layout))) as Draft;
}
const publish = (db: ReturnType<typeof fresh>, id: number) => {
  const r = publishDraft(db, id);
  assert.ok(r.ok, JSON.stringify(r));
  return r.snapshot.layout;
};

test('a TV move followed by publishing an older draft keeps the TV move', () => {
  const db = fresh();
  const older = draft(db, (l) => ({ ...l, background: { kind: 'color', color: '#202020' } }));
  const snap = op(db, { op: 'move', widget: 'a', index: 2 });
  assert.equal(snap.revision, 3);
  assert.deepEqual(row(snap.layout), ['b', 'c', 'a']);
  assert.equal(getDraft(db, older.id)!.base, 3, 'the open draft moved forward with the TV change');
  const published = publish(db, older.id);
  assert.deepEqual(row(published), ['b', 'c', 'a'], 'the TV move survives the publish');
  assert.deepEqual(published.background, { kind: 'color', color: '#202020' }, 'and so does the draft');
});

test('Companion saving with the base it opened at gets the TV move merged in, then publishes it', () => {
  const db = fresh();
  const d = draft(db);
  op(db, { op: 'move', widget: 'c', index: 0 });
  // Companion's page still holds revision 2 and its own edit: d at the end of the row.
  const mine = layout();
  mine.rows[1].items.push({ kind: 'widget', id: 'd' });
  const saved = saveDraft(db, d.id, 2, mine) as Draft;
  assert.equal(saved.base, 3);
  assert.deepEqual(row(saved.layout), ['c', 'a', 'b', 'd']);
  assert.deepEqual(row(publish(db, d.id)), ['c', 'a', 'b', 'd']);
});

test('after adopting the merged draft, an adult can undo the TV change in Companion', () => {
  const db = fresh();
  const d = draft(db);
  op(db, { op: 'remove', widget: 'b' });
  const merged = saveDraft(db, d.id, 2, layout()) as Draft;
  assert.deepEqual(row(merged.layout), ['a', 'c']);
  const undone = saveDraft(db, d.id, merged.base, layout()) as Draft; // b put back, on the new base: nothing is replayed
  assert.deepEqual(row(publish(db, undone.id)), ['a', 'b', 'c']);
});

test('conflicts: the draft wins where the TV change no longer makes sense', () => {
  const offDashboard = (id: string) => (l: Layout) => ({ ...l, rows: l.rows.map((r) => ({ ...r, items: r.items.filter((i) => i.id !== id) })) });
  const deleted = (id: string) => (l: Layout) => ({ ...offDashboard(id)(l), widgets: l.widgets.filter((x) => x.id !== id) });
  const cases: { name: string; edit: (l: Layout) => Layout; tv: LayoutOp; rows: Record<string, string[]>; widgets?: number }[] = [
    { name: 'draft took it off, TV moved it: stays off', edit: offDashboard('a'), tv: { op: 'move', widget: 'a', index: 2 }, rows: { info: ['b', 'c'] } },
    { name: 'draft deleted it, TV moved it: stays deleted', edit: deleted('a'), tv: { op: 'move', widget: 'a', index: 2 }, rows: { info: ['b', 'c'] }, widgets: 3 },
    { name: 'draft deleted it, TV added it: stays deleted', edit: deleted('d'), tv: { op: 'add', widget: 'd' }, rows: { info: ['a', 'b', 'c'] }, widgets: 3 },
    {
      name: 'draft placed it, TV added it: the draft’s place stands',
      edit: (l) => ({ ...l, rows: l.rows.map((r) => (r.id === 'apps' ? { ...r, items: r.items.concat({ kind: 'widget', id: 'd' }) } : r)) }),
      tv: { op: 'add', widget: 'd' },
      rows: { apps: ['a.Netflix', 'd'], info: ['a', 'b', 'c'] },
    },
    {
      name: 'draft moved it to another row, TV moved it: the draft’s row, the TV’s position',
      edit: (l) => ({ ...offDashboard('c')(l), rows: offDashboard('c')(l).rows.map((r) => (r.id === 'apps' ? { ...r, items: r.items.concat({ kind: 'widget', id: 'c' }) } : r)) }),
      tv: { op: 'move', widget: 'c', index: 0 },
      rows: { apps: ['c', 'a.Netflix'], info: ['a', 'b'] },
    },
    {
      name: 'draft moved it along the row, TV moved it: the TV’s position wins',
      edit: (l) => ({ ...l, rows: l.rows.map((r) => (r.id === 'info' ? { ...r, items: [r.items[1], r.items[0], r.items[2]] } : r)) }), // b a c
      tv: { op: 'move', widget: 'a', index: 2 },
      rows: { info: ['b', 'c', 'a'] },
    },
    {
      name: 'draft moved it, TV removed it: removed',
      edit: (l) => ({ ...l, rows: l.rows.map((r) => (r.id === 'info' ? { ...r, items: [r.items[2], r.items[0], r.items[1]] } : r)) }), // c a b
      tv: { op: 'remove', widget: 'c' },
      rows: { info: ['a', 'b'] },
    },
    {
      name: 'draft changed other things, TV moved: both kept',
      edit: (l) => ({ ...l, rows: l.rows.map((r) => (r.id === 'apps' ? { ...r, title: 'Watch' } : r)), widgets: l.widgets.map((x) => (x.id === 'b' ? { ...x, size: 'large' as const } : x)) }),
      tv: { op: 'move', widget: 'a', index: 1 },
      rows: { apps: ['a.Netflix'], info: ['b', 'a', 'c'] },
    },
  ];
  for (const c of cases) {
    const db = fresh();
    const d = draft(db, c.edit);
    op(db, c.tv);
    const l = publish(db, d.id);
    for (const id in c.rows) assert.deepEqual(row(l, id), c.rows[id], c.name);
    assert.equal(l.widgets.length, c.widgets ?? 4, c.name);
  }
});

test('a draft left behind by a Companion publish stays stale; the TV does not bring it forward', () => {
  const db = fresh();
  const behind = draft(db), winner = draft(db, (l) => ({ ...l, background: { kind: 'color', color: '#101010' } }));
  publish(db, winner.id); // revision 3
  op(db, { op: 'remove', widget: 'a' }); // revision 4
  assert.equal(getDraft(db, behind.id)!.base, 2);
  assert.equal(saveDraft(db, behind.id, 2, layout()), 'stale', 'whole layouts do not merge');
  const r = publishDraft(db, behind.id);
  assert.equal(r.ok ? null : r.reason, 'stale');
  assert.equal(saveDraft(db, behind.id, 4, layout()), 'stale', 'nor can a newer base be claimed');
});

test('the TV is refused when its base is not current or the widget is not where it showed it, and nothing changes', () => {
  const db = fresh();
  assert.deepEqual(commitOp(db, 1, { op: 'remove', widget: 'a' }), { ok: false, status: 409, error: 'the layout changed: revision 2 is current, not 1' });
  assert.equal((commitOp(db, 2, { op: 'remove', widget: 'd' }) as { status: number }).status, 409);
  assert.equal((commitOp(db, 2, { op: 'add', widget: 'a' }) as { status: number }).status, 409);
  assert.equal(currentSnapshot(db).revision, 2);
  const rows = db.prepare('SELECT number, base, op FROM revisions ORDER BY number').all().map((r) => ({ ...r }));
  assert.deepEqual(rows, [{ number: 1, base: null, op: null }, { number: 2, base: 1, op: null }]);
  op(db, { op: 'add', widget: 'd' });
  assert.deepEqual({ ...db.prepare('SELECT base, op FROM revisions WHERE number = 3').get() }, { base: 2, op: '{"op":"add","widget":"d"}' });
});

test('an invalid draft is carried forward untouched where the operation cannot apply', () => {
  const db = fresh();
  const d = createDraft(db);
  saveDraft(db, d.id, d.base, { half: 'typed' });
  op(db, { op: 'move', widget: 'a', index: 1 });
  assert.deepEqual(getDraft(db, d.id)!.layout, { half: 'typed' });
  assert.equal(getDraft(db, d.id)!.base, 3);
});

// Over HTTP: the TV's token, Kids Mode, validation and the revision signal.
let base = '';
let cookie = '';
let tv: Record<string, string> = {};
let server: ReturnType<typeof startServer>;
before(async () => {
  const config: Config = {
    port: 0,
    dbPath: join(dir, 'http.db'),
    mediaDir: join(dir, 'media'),
    companionDir: dir,
    passwordHash: await hashSecret('correct horse'),
    secureCookies: false,
    ha: null,
    allowance: { timeZone: 'Europe/Berlin', resetMinutes: 240, graceSeconds: 0, topUpUrl: 'https://sofa.test/kids/topup' },
  };
  const db = openDb(config.dbPath);
  server = startServer(config, db, undefined, []);
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  cookie = (await post('/api/login', { password: 'correct horse' })).headers.get('set-cookie')!.split(';')[0];
  const d = (await (await post('/api/drafts', {}, { cookie })).json()) as Draft;
  await fetch(`${base}/api/drafts/${d.id}`, { method: 'PUT', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ base: d.base, layout: layout() }) });
  assert.equal((await post(`/api/drafts/${d.id}/publish`, {}, { cookie })).status, 200);
  const code = createCode(db);
  approveCode(db, code.code);
  const claimed = claimToken(db, code.code, code.secret);
  tv = { Authorization: 'Bearer ' + (claimed as { token: string }).token };
});
after(() => server.close());
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('POST /api/layout/ops: the TV token commits a revision; no token, bad ops, a stale base and Kids Mode are refused', async () => {
  const snap = (await (await fetch(base + '/api/snapshot', { headers: tv })).json()) as Snapshot;
  const move = { base: snap.revision, op: { op: 'move', widget: 'a', index: 1 } };
  assert.equal((await post('/api/layout/ops', move)).status, 401);
  assert.equal((await post('/api/layout/ops', move, { Authorization: 'Bearer nope' })).status, 401);
  assert.equal((await post('/api/layout/ops', { base: snap.revision, op: { op: 'delete', widget: 'a' } }, tv)).status, 400);
  assert.equal((await post('/api/layout/ops', { op: move.op }, tv)).status, 400);
  assert.equal((await post('/api/kids/enter', {}, tv)).status, 200);
  assert.equal((await post('/api/layout/ops', move, tv)).status, 403, 'no editing in Kids Mode');
  assert.equal((await post('/api/kids/exit', {}, { cookie })).status, 200);
  const res = await post('/api/layout/ops', move, tv);
  assert.equal(res.status, 200);
  const next = (await res.json()) as Snapshot;
  assert.equal(next.revision, snap.revision + 1);
  assert.deepEqual(row(next.layout), ['b', 'a', 'c']);
  assert.equal((await post('/api/layout/ops', move, tv)).status, 409, 'the same request again is on an old base');
});
