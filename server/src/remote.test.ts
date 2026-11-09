import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { REMOTE_KEYS, TV_PROTOCOL_PREFIX } from '@sofa/shared';
import WebSocket from 'ws';
import { hashSecret } from './auth.ts';
import type { Config } from './config.ts';
import { openDb } from './db.ts';
import type { HaClient } from './ha.ts';
import { createPhoneRemote, RATE_LIMIT, RATE_WINDOW_MS } from './remote.ts';
import { startServer } from './server.ts';
import { approveCode, claimToken, createCode } from './tv.ts';

class FakeSocket extends EventEmitter {
  sent: string[] = [];
  send(data: string) {
    this.sent.push(data);
  }
}
const fakeHa = (fail = false) => {
  const keys: string[] = [];
  const ha = { sendKey: async (k: string) => (fail ? Promise.reject(new Error('down')) : void keys.push(k)) } as unknown as HaClient;
  return { ha, keys };
};
const tvSocket = (phone: ReturnType<typeof createPhoneRemote>) => {
  const ws = new FakeSocket();
  phone.track(ws as never);
  return ws;
};

test('every key maps to its Samsung code and is forwarded', async () => {
  const { ha, keys } = fakeHa();
  let t = 0;
  const phone = createPhoneRemote({ ha, kidsActive: () => false, now: () => (t += RATE_WINDOW_MS) });
  for (const key of Object.keys(REMOTE_KEYS)) assert.equal((await phone.press('s', { key })).status, 200);
  assert.deepEqual(keys, Object.values(REMOTE_KEYS));
  assert.ok(!keys.some((k) => /POWER|VOL|MUTE|SOURCE|CH/.test(k)));
});

test('unknown keys and bad bodies are 400 and reach nothing', async () => {
  const { ha, keys } = fakeHa();
  const phone = createPhoneRemote({ ha, kidsActive: () => false });
  for (const body of [null, {}, { key: 'power' }, { key: 'KEY_POWER' }, { key: 'toString' }, { key: ['up'] }, 'up']) {
    assert.equal((await phone.press('s', body)).status, 400, JSON.stringify(body));
  }
  assert.deepEqual(keys, []);
});

test('rate limit: per session, rolling window, 429 with Retry-After', async () => {
  const { ha, keys } = fakeHa();
  let t = 1000;
  const phone = createPhoneRemote({ ha, kidsActive: () => false, now: () => t });
  for (let i = 0; i < RATE_LIMIT; i++) assert.equal((await phone.press('a', { key: 'up' })).status, 200);
  const over = await phone.press('a', { key: 'up' });
  assert.equal(over.status, 429);
  assert.equal(over.headers?.['Retry-After'], '1');
  assert.equal((await phone.press('b', { key: 'up' })).status, 200, 'another session is not limited');
  t += RATE_WINDOW_MS;
  assert.equal((await phone.press('a', { key: 'up' })).status, 200);
  assert.equal(keys.length, RATE_LIMIT + 2);
});

test('keys reach the TV in the order pressed, and an HA failure is a 502', async () => {
  const order: string[] = [];
  let slow = true;
  const ha = {
    sendKey: async (k: string) => {
      if (slow) {
        slow = false;
        await new Promise((r) => setTimeout(r, 30));
      }
      order.push(k);
    },
  } as unknown as HaClient;
  const phone = createPhoneRemote({ ha, kidsActive: () => false });
  await Promise.all([phone.press('s', { key: 'down' }), phone.press('s', { key: 'ok' })]);
  assert.deepEqual(order, ['KEY_DOWN', 'KEY_ENTER']);
  const bad = createPhoneRemote({ ha: fakeHa(true).ha, kidsActive: () => false });
  assert.equal((await bad.press('s', { key: 'up' })).status, 502);
  assert.equal((await createPhoneRemote({ ha: null, kidsActive: () => false }).press('s', { key: 'up' })).status, 503);
});

test('Kids Mode: navigation and media keys work, Home and Menu are refused', async () => {
  const { ha, keys } = fakeHa();
  const phone = createPhoneRemote({ ha, kidsActive: () => true });
  const tv = tvSocket(phone);
  tv.emit('message', JSON.stringify({ type: 'visible', visible: true }));
  for (const key of ['up', 'ok', 'back', 'pause', 'forward']) assert.equal((await phone.press('s', { key })).status, 200);
  for (const key of ['home', 'menu']) assert.equal((await phone.press('s', { key })).status, 403);
  assert.deepEqual(keys, ['KEY_UP', 'KEY_ENTER', 'KEY_RETURN', 'KEY_PAUSE', 'KEY_FF']);
  assert.deepEqual(tv.sent, []);
});

test('Menu goes to Sofa Home only while it is in front, and sends no TV key', async () => {
  const { ha, keys } = fakeHa();
  const phone = createPhoneRemote({ ha, kidsActive: () => false });
  assert.equal((await phone.press('s', { key: 'menu' })).status, 409, 'no socket');
  const tv = tvSocket(phone);
  assert.equal((await phone.press('s', { key: 'menu' })).status, 409, 'visibility unknown counts as not in front');
  tv.emit('message', JSON.stringify({ type: 'visible', visible: true }));
  assert.equal((await phone.press('s', { key: 'menu' })).status, 200);
  assert.deepEqual(tv.sent.map((m) => JSON.parse(m)), [{ type: 'menu' }]);
  tv.emit('message', JSON.stringify({ type: 'visible', visible: false })); // a provider app has the screen
  assert.equal((await phone.press('s', { key: 'menu' })).status, 409);
  tv.emit('message', 'not json');
  tv.emit('message', JSON.stringify({ type: 'visible', visible: 'yes' }));
  assert.equal(tv.sent.length, 1);
  tv.emit('message', JSON.stringify({ type: 'visible', visible: true }));
  tv.emit('close');
  assert.equal((await phone.press('s', { key: 'menu' })).status, 409, 'closed socket');
  assert.deepEqual(keys, []);
});

// Over HTTP and a real WebSocket, with Home Assistant in dry run.
const dir = mkdtempSync(join(tmpdir(), 'sofa-remote-'));
let base = '';
let server: ReturnType<typeof startServer>;
let cookie = '';
let token = '';
before(async () => {
  const config = {
    port: 0,
    dbPath: join(dir, 'r.db'),
    mediaDir: join(dir, 'media'),
    companionDir: dir,
    passwordHash: await hashSecret('correct horse'),
    secureCookies: false,
    ha: { url: 'http://ha.invalid:8123', token: 't', tvEntity: 'media_player.samung_tv', remoteEntity: 'remote.samung_tv', notifyServices: [], dryRun: true },
    allowance: { timeZone: 'Europe/Berlin', resetMinutes: 240, graceSeconds: 0, topUpUrl: 'https://sofa.test/kids/topup' },
  } as Config;
  const db = openDb(config.dbPath);
  const c = createCode(db);
  approveCode(db, c.code);
  const claimed = claimToken(db, c.code, c.secret);
  token = claimed?.status === 'approved' ? claimed.token : '';
  server = startServer(config, db);
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  cookie = (await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'correct horse' }) })).headers.get('set-cookie')!.split(';')[0];
});
after(() => {
  server.close();
  server.closeAllConnections();
});

const press = (key: unknown, headers: Record<string, string>) =>
  fetch(base + '/api/remote', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ key }) });

test('POST /api/remote needs a Companion session: the TV token and no credentials are 401', async () => {
  assert.equal((await press('up', {})).status, 401);
  assert.equal((await press('up', { Authorization: 'Bearer ' + token })).status, 401);
  assert.equal((await press('up', { cookie })).status, 200); // dry run: guarded, logged, not sent
  assert.equal((await press('power', { cookie })).status, 400);
});

test('Menu over the real WebSocket: needs a visible report, then Sofa Home receives it', async () => {
  assert.equal((await press('menu', { cookie })).status, 409);
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws', [TV_PROTOCOL_PREFIX + token]);
  const got: unknown[] = [];
  ws.on('message', (m) => got.push(JSON.parse(String(m))));
  await once(ws, 'message'); // hello
  ws.send(JSON.stringify({ type: 'visible', visible: true }));
  let res = await press('menu', { cookie });
  for (let i = 0; res.status === 409 && i < 20; i++) {
    await new Promise((r) => setTimeout(r, 25));
    res = await press('menu', { cookie });
  }
  assert.equal(res.status, 200);
  for (let i = 0; got.length < 2 && i < 20; i++) await new Promise((r) => setTimeout(r, 25));
  assert.deepEqual(got.slice(1), [{ type: 'menu' }]);
  ws.close();
});

test('in Kids Mode over HTTP, Home and Menu are 403 and Back still works', async () => {
  assert.equal((await fetch(base + '/api/kids/enter', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: '{}' })).status, 200);
  assert.equal((await press('home', { cookie })).status, 403);
  assert.equal((await press('menu', { cookie })).status, 403);
  assert.equal((await press('back', { cookie })).status, 200);
});
