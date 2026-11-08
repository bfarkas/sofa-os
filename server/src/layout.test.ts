import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { promisify } from 'node:util';
import { validateSnapshot, type Draft, type Layout, type Snapshot } from '@sofa/shared';
import WebSocket from 'ws';
import { hashSecret } from './auth.ts';
import type { Config } from './config.ts';
import { openDb } from './db.ts';
import { createDraft, currentSnapshot, publishDraft, saveDraft } from './layout.ts';
import { startServer } from './server.ts';

const dir = mkdtempSync(join(tmpdir(), 'sofa-layout-'));
let dbN = 0;
const freshDb = () => openDb(join(dir, `db${++dbN}.db`));

const layout = (title = 'Apps'): Layout => ({
  schema: 1,
  apps: [{ id: 'mvOizTfhQn.KiKAplayer', name: 'KiKA' }],
  widgets: [],
  rows: [{ id: 'apps', title, items: [{ kind: 'app', id: 'mvOizTfhQn.KiKAplayer' }] }],
  background: { kind: 'color', color: '#f6f1e7' },
  kidsMode: { apps: ['mvOizTfhQn.KiKAplayer'], dailyMinutes: 45 },
});
const broken = () => ({ ...layout(), rows: [{ id: 'apps', title: '', items: [{ kind: 'app', id: 'missing.App' }] }] });

test('a new database starts at a valid revision 1', () => {
  const snap = currentSnapshot(freshDb());
  assert.equal(snap.revision, 1);
  assert.deepEqual(validateSnapshot(snap), []);
});

test('publishing numbers revisions without gaps and records each base', () => {
  const db = freshDb();
  for (const expected of [2, 3]) {
    const d = createDraft(db);
    saveDraft(db, d.id, d.base, layout('r' + expected));
    const r = publishDraft(db, d.id);
    assert.ok(r.ok);
    assert.equal(r.snapshot.revision, expected);
    assert.equal(r.snapshot.layout.rows[0].title, 'r' + expected);
  }
  const rows = db.prepare('SELECT number, base FROM revisions ORDER BY number').all().map((r) => ({ ...r }));
  assert.deepEqual(rows, [{ number: 1, base: null }, { number: 2, base: 1 }, { number: 3, base: 2 }]);
  assert.equal((db.prepare('SELECT count(*) AS n FROM drafts').get() as { n: number }).n, 0);
});

test('a draft from an older revision is refused and changes nothing', () => {
  const db = freshDb();
  const a = createDraft(db), b = createDraft(db);
  saveDraft(db, a.id, a.base, layout('a'));
  saveDraft(db, b.id, b.base, layout('b'));
  assert.ok(publishDraft(db, a.id).ok);
  const r = publishDraft(db, b.id);
  assert.deepEqual(r.ok ? null : r.reason, 'stale');
  assert.equal(currentSnapshot(db).revision, 2);
  assert.equal(currentSnapshot(db).layout.rows[0].title, 'a');
  assert.equal(saveDraft(db, b.id, 2, layout()), 'stale'); // an editor holding the wrong base cannot save over it
});

test('an invalid draft is refused and changes nothing', () => {
  const db = freshDb();
  const d = createDraft(db);
  const saved = saveDraft(db, d.id, d.base, broken()) as Draft;
  assert.match(saved.errors.join(), /unknown app/); // invalid drafts are kept, with their errors
  const r = publishDraft(db, d.id);
  assert.equal(r.ok ? null : r.reason, 'invalid');
  assert.equal(currentSnapshot(db).revision, 1);
});

test('a publish that fails midway leaves the current revision unchanged', () => {
  const db = freshDb();
  const d = createDraft(db);
  saveDraft(db, d.id, d.base, layout('lost'));
  // Fail after the revision row is written, when the draft is deleted.
  db.exec("CREATE TRIGGER fail BEFORE DELETE ON drafts BEGIN SELECT RAISE(ABORT, 'disk on fire'); END;");
  assert.throws(() => publishDraft(db, d.id), /disk on fire/);
  assert.equal(currentSnapshot(db).revision, 1);
  assert.equal((db.prepare('SELECT count(*) AS n FROM revisions').get() as { n: number }).n, 1);
  db.exec('DROP TRIGGER fail');
  assert.equal((publishDraft(db, d.id) as { snapshot: Snapshot }).snapshot.revision, 2);
});

// Over HTTP, with a real Server.
let base = '';
let cookie = '';
const servers: ReturnType<typeof startServer>[] = [];
const config = async (dbPath: string): Promise<Config> => ({
  port: 0,
  dbPath,
  mediaDir: join(dir, 'media'),
  companionDir: dir,
  passwordHash: await hashSecret('correct horse'),
  secureCookies: false,
  ha: null,
  allowance: { timeZone: 'Europe/Berlin', resetMinutes: 240, graceSeconds: 0 },
});
async function start(c: Config): Promise<string> {
  const server = startServer(c, openDb(c.dbPath));
  servers.push(server);
  await once(server, 'listening');
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

before(async () => {
  base = await start(await config(join(dir, 'http.db')));
  const res = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'correct horse' }) });
  cookie = res.headers.get('set-cookie')!.split(';')[0];
});
after(() => servers.forEach((s) => s.close()));

const api = (method: string, path: string, body?: unknown, c = cookie) =>
  fetch(base + path, { method, headers: { cookie: c, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const snapshot = async () => (await (await api('GET', '/api/snapshot')).json()) as Snapshot;

test('snapshot and drafts need a Companion session', async () => {
  assert.equal((await api('GET', '/api/snapshot', undefined, '')).status, 401);
  assert.equal((await api('POST', '/api/drafts', undefined, '')).status, 401);
  assert.equal((await api('GET', '/api/drafts/1', undefined, '')).status, 401);
});

test('draft, save, publish and fetch over HTTP', async () => {
  const before = await snapshot();
  const created = await api('POST', '/api/drafts');
  assert.equal(created.status, 201);
  const draft = (await created.json()) as Draft;
  assert.equal(draft.base, before.revision);
  assert.deepEqual(draft.layout, before.layout);

  assert.equal((await api('PUT', `/api/drafts/${draft.id}`, { base: draft.base + 7, layout: layout() })).status, 409);
  assert.equal((await api('PUT', `/api/drafts/${draft.id}`, { layout: layout() })).status, 400);
  const saved = await api('PUT', `/api/drafts/${draft.id}`, { base: draft.base, layout: layout('http') });
  assert.equal(saved.status, 200);
  assert.deepEqual(((await saved.json()) as Draft).errors, []);
  assert.deepEqual(((await (await api('GET', `/api/drafts/${draft.id}`)).json()) as Draft).layout, layout('http'));

  const published = await api('POST', `/api/drafts/${draft.id}/publish`);
  assert.equal(published.status, 200);
  const snap = await snapshot();
  assert.equal(snap.revision, before.revision + 1);
  assert.equal(snap.layout.rows[0].title, 'http');
  assert.equal((await api('GET', `/api/drafts/${draft.id}`)).status, 404); // publishing used the draft up
});

test('an invalid publish is refused with its errors and leaves the snapshot alone', async () => {
  const before = await snapshot();
  const draft = (await (await api('POST', '/api/drafts')).json()) as Draft;
  await api('PUT', `/api/drafts/${draft.id}`, { base: draft.base, layout: broken() });
  const res = await api('POST', `/api/drafts/${draft.id}/publish`);
  assert.equal(res.status, 422);
  assert.match(((await res.json()) as { errors: string[] }).errors.join(), /unknown app "missing.App"/);
  assert.deepEqual(await snapshot(), before);
  assert.equal((await api('DELETE', `/api/drafts/${draft.id}`)).status, 200);
});

test('a WebSocket client gets the revision signal within a second', async () => {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws', { headers: { cookie } });
  await once(ws, 'message'); // hello
  const draft = (await (await api('POST', '/api/drafts')).json()) as Draft;
  await api('PUT', `/api/drafts/${draft.id}`, { base: draft.base, layout: layout('signal') });
  const t0 = Date.now();
  const signal = once(ws, 'message');
  await api('POST', `/api/drafts/${draft.id}/publish`);
  const [data] = await Promise.race([signal, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('no signal within 1 s')), 1000))]);
  assert.ok(Date.now() - t0 < 1000);
  assert.deepEqual(JSON.parse(String(data)), { type: 'revision', revision: (await snapshot()).revision });
  ws.close();
});

test('the publish script publishes, and its broken layout is refused', async () => {
  const run = promisify(execFile);
  const env = { ...process.env, SOFA_URL: base, SOFA_PASSWORD: 'correct horse' };
  const script = new URL('./publish-layout.ts', import.meta.url).pathname;
  const before = await snapshot();
  const { stdout } = await run(process.execPath, [script], { env });
  assert.match(stdout, new RegExp(`published revision ${before.revision + 1}`));
  await assert.rejects(run(process.execPath, [script, '--broken'], { env }), /refused \(422\)/);
  assert.equal((await snapshot()).revision, before.revision + 1);
});
