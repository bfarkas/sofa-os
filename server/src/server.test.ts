import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import WebSocket from 'ws';
import { hashSecret, verifySecret } from './auth.ts';
import type { Config } from './config.ts';
import { openDb } from './db.ts';
import { startServer } from './server.ts';

const dir = mkdtempSync(join(tmpdir(), 'sofa-test-'));
writeFileSync(join(dir, 'index.html'), '<title>Companion</title>');
writeFileSync(join(tmpdir(), 'sofa-secret.txt'), 'outside');
let base = '';
let server: ReturnType<typeof startServer>;

before(async () => {
  const config: Config = {
    port: 0,
    dbPath: join(dir, 'test.db'),
    mediaDir: join(dir, 'media'),
    companionDir: dir,
    passwordHash: await hashSecret('correct horse'),
    secureCookies: true,
    ha: null,
  };
  server = startServer(config, openDb(config.dbPath));
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const login = (password: string) =>
  fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });

test('hashSecret salts and verifySecret checks', async () => {
  const a = await hashSecret('1234'), b = await hashSecret('1234');
  assert.notEqual(a, b);
  assert.equal(await verifySecret('1234', a), true);
  assert.equal(await verifySecret('1235', a), false);
  assert.equal(await verifySecret('1234', 'garbage'), false);
});

test('migrations run once and reopen cleanly', () => {
  const path = join(dir, 'migrate.db');
  openDb(path).close();
  const db = openDb(path);
  assert.deepEqual({ ...(db.prepare('PRAGMA user_version').get() as object) }, { user_version: 1 });
  db.close();
});

test('wrong password is refused without a cookie', async () => {
  const res = await login('wrong');
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('set-cookie'), null);
});

test('login requires JSON', async () => {
  const res = await fetch(base + '/api/login', { method: 'POST', body: 'password=correct horse', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert.equal(res.status, 415);
});

test('login, session, websocket and logout', async () => {
  assert.equal((await fetch(base + '/api/session')).status, 401);

  const res = await login('correct horse');
  assert.equal(res.status, 200);
  const setCookie = res.headers.get('set-cookie')!;
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Strict/);
  const cookie = setCookie.split(';')[0];

  const session = await fetch(base + '/api/session', { headers: { cookie } });
  assert.equal(session.status, 200);
  assert.equal((await session.json()).signedIn, true);

  const ws = new WebSocket(base.replace('http', 'ws') + '/ws', { headers: { cookie } });
  const [hello] = await once(ws, 'message');
  assert.equal(JSON.parse(String(hello)).type, 'hello');
  ws.close();

  await fetch(base + '/api/logout', { method: 'POST', headers: { cookie } });
  assert.equal((await fetch(base + '/api/session', { headers: { cookie } })).status, 401);
});

test('websocket without a session is refused', async () => {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws');
  const [err] = await once(ws, 'error');
  assert.match(String(err), /401/);
});

test('serves Companion and its routes, never files outside it', async () => {
  assert.match(await (await fetch(base + '/')).text(), /Companion/);
  assert.match(await (await fetch(base + '/settings')).text(), /Companion/);
  assert.equal((await fetch(base + '/missing.js')).status, 404);
  assert.equal((await fetch(base + '/..%2fsofa-secret.txt')).status, 404);
  assert.equal((await fetch(base + '/healthz')).status, 200);
});
