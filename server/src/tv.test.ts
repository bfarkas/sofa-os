import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { TV_PROTOCOL_PREFIX, type KidsStatus, type TvCode } from '@sofa/shared';
import WebSocket from 'ws';
import { hashSecret, sha256 } from './auth.ts';
import type { Config } from './config.ts';
import { openDb } from './db.ts';
import { startServer } from './server.ts';
import { approveCode, checkDeviceToken, claimToken, CODE_TTL_MS, createCode, MAX_PENDING } from './tv.ts';

const dir = mkdtempSync(join(tmpdir(), 'sofa-tv-'));
const freshDb = () => openDb(':memory:');
const T0 = 1_800_000_000_000;
const approved = (r: ReturnType<typeof claimToken>) => (r?.status === 'approved' ? r.token : assert.fail('not approved: ' + JSON.stringify(r)));

test('a code is short, readable, unique and expires in a few minutes', () => {
  const db = freshDb();
  const a = createCode(db, T0), b = createCode(db, T0);
  assert.match(a.code, /^[A-HJKMNP-Z2-9]{8}$/);
  assert.notEqual(a.code, b.code);
  assert.notEqual(a.secret, b.secret);
  assert.equal(Date.parse(a.expiresAt) - T0, CODE_TTL_MS);
  assert.ok(CODE_TTL_MS <= 10 * 60_000);
});

test('the Server keeps only a hash of the secret', () => {
  const db = freshDb();
  const { code, secret } = createCode(db, T0);
  const row = db.prepare('SELECT * FROM tv_codes WHERE code = ?').get(code) as { secret_hash: string };
  assert.equal(row.secret_hash, sha256(secret));
  assert.ok(!JSON.stringify(row).includes(secret));
});

test('a code is pending until approved, then yields the token exactly once', () => {
  const db = freshDb();
  const { code, secret } = createCode(db, T0);
  assert.deepEqual(claimToken(db, code, secret, T0 + 1), { status: 'pending' });
  assert.equal(approveCode(db, code, T0 + 2), true);
  const token = approved(claimToken(db, code, secret, T0 + 3));
  assert.equal(checkDeviceToken(db, token), true);
  assert.equal(claimToken(db, code, secret, T0 + 4), null); // single-use
  assert.equal(approveCode(db, code, T0 + 5), false);
});

test('an expired code cannot be approved or claimed', () => {
  const db = freshDb();
  const { code, secret } = createCode(db, T0);
  assert.equal(approveCode(db, code, T0 + CODE_TTL_MS), false);
  const approvedCode = createCode(db, T0);
  approveCode(db, approvedCode.code, T0 + 1);
  assert.equal(claimToken(db, approvedCode.code, approvedCode.secret, T0 + CODE_TTL_MS + 1), null);
  assert.equal(claimToken(db, code, secret, T0 + CODE_TTL_MS + 1), null);
  assert.equal(approveCode(db, 'NOSUCHCD'), false);
});

test('the code alone, or a wrong secret, collects nothing', () => {
  const db = freshDb();
  const tv = createCode(db, T0), other = createCode(db, T0);
  approveCode(db, tv.code, T0 + 1);
  assert.equal(claimToken(db, tv.code, other.secret, T0 + 2), null);
  assert.equal(claimToken(db, tv.code, '', T0 + 2), null);
  assert.equal(db.prepare('SELECT count(*) AS n FROM tv_device').get()!.n, 0);
  approved(claimToken(db, tv.code, tv.secret, T0 + 3)); // the real TV is not affected
});

test('pending codes are bounded: the oldest is dropped', () => {
  const db = freshDb();
  const codes = Array.from({ length: MAX_PENDING + 5 }, (_, i) => createCode(db, T0 + i));
  assert.equal(db.prepare('SELECT count(*) AS n FROM tv_codes').get()!.n, MAX_PENDING);
  assert.equal(claimToken(db, codes[0].code, codes[0].secret, T0 + 100), null);
  assert.deepEqual(claimToken(db, codes.at(-1)!.code, codes.at(-1)!.secret, T0 + 100), { status: 'pending' });
  createCode(db, T0 + CODE_TTL_MS + 100); // expired codes are swept
  assert.equal(db.prepare('SELECT count(*) AS n FROM tv_codes').get()!.n, 1);
});

test('only the token hash is stored, and signing in again replaces the token', () => {
  const db = freshDb();
  const signIn = (at: number) => {
    const c = createCode(db, at);
    approveCode(db, c.code, at);
    return approved(claimToken(db, c.code, c.secret, at));
  };
  const first = signIn(T0), second = signIn(T0 + 1000);
  assert.notEqual(first, second);
  const rows = db.prepare('SELECT * FROM tv_device').all();
  assert.equal(rows.length, 1);
  assert.equal((rows[0] as { token_hash: string }).token_hash, sha256(second));
  assert.ok(!JSON.stringify(rows).includes(second));
  assert.equal(checkDeviceToken(db, first), false);
  assert.equal(checkDeviceToken(db, second), true);
  assert.equal(checkDeviceToken(db, undefined), false);
  assert.equal(checkDeviceToken(db, ''), false);
});

// Over HTTP, with a real Server.
let base = '';
let server: ReturnType<typeof startServer>;
let cookie = '';
before(async () => {
  const config: Config = {
    port: 0,
    dbPath: join(dir, 'tv.db'),
    mediaDir: join(dir, 'media'),
    companionDir: dir,
    passwordHash: await hashSecret('correct horse'),
    secureCookies: false,
    ha: null,
    allowance: { timeZone: 'Europe/Berlin', resetMinutes: 240, graceSeconds: 0 },
  };
  server = startServer(config, openDb(config.dbPath));
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const res = await post('/api/login', { password: 'correct horse' });
  cookie = res.headers.get('set-cookie')!.split(';')[0];
});
after(() => server.close());

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const newCode = async () => (await (await post('/api/tv/codes', {})).json()) as TvCode;
const poll = async (c: { code: string; secret: string }) => {
  const res = await post('/api/tv/token', c);
  return { status: res.status, body: (await res.json()) as { status?: string; token?: string } };
};
const bearer = (token: string) => ({ Authorization: 'Bearer ' + token });
const wsUrl = () => base.replace('http', 'ws') + '/ws';

async function signIn(): Promise<string> {
  const c = await newCode();
  assert.equal((await post('/api/tv/approve', { code: c.code }, { cookie })).status, 200);
  const { body } = await poll(c);
  return body.token!;
}

test('TV Sign-in over HTTP: approval needs a Companion session and only the code creator gets the token', async () => {
  const logged: string[] = [];
  const write = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array, ...rest: never[]) => (logged.push(String(chunk)), write.call(process.stdout, chunk, ...rest))) as typeof write;
  try {
    const tv = await newCode(), intruder = await newCode();
    assert.deepEqual((await poll(tv)).body, { status: 'pending' });
    assert.equal((await post('/api/tv/approve', { code: tv.code })).status, 401); // no session
    assert.equal((await post('/api/tv/approve', { code: tv.code }, { cookie: 'sofa_session=nope' })).status, 401);
    assert.equal((await post('/api/tv/approve', { code: 'NOSUCHCD' }, { cookie })).status, 404);
    assert.equal((await post('/api/tv/approve', { code: tv.code }, { cookie })).status, 200);

    // Someone who saw the QR code has the code, not the secret.
    assert.equal((await poll({ code: tv.code, secret: intruder.secret })).status, 404);
    assert.equal((await post('/api/tv/token', { code: tv.code })).status, 404);
    assert.deepEqual((await poll(intruder)).body, { status: 'pending' }); // approving one code approves no other

    const { status, body } = await poll(tv);
    assert.equal(status, 200);
    assert.equal(body.status, 'approved');
    assert.equal((await poll(tv)).status, 404); // delivered once

    const token = body.token!;
    assert.equal((await fetch(base + '/api/snapshot', { headers: bearer(token) })).status, 200);
    assert.ok(!logged.join('').includes(token), 'the token must not be logged');
    assert.ok(!logged.join('').includes(tv.secret), 'the secret must not be logged');
  } finally {
    process.stdout.write = write;
  }
});

test('snapshot and /ws need the device token', async () => {
  const token = await signIn();
  assert.equal((await fetch(base + '/api/snapshot')).status, 401);
  assert.equal((await fetch(base + '/api/snapshot', { headers: bearer('wrong') })).status, 401);
  assert.equal((await fetch(base + '/api/snapshot', { headers: { Authorization: token } })).status, 401); // not a Bearer header
  const ok = await fetch(base + '/api/snapshot', { headers: bearer(token) });
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as { revision: number }).revision >= 1, true);

  for (const protocols of [undefined, [TV_PROTOCOL_PREFIX + 'wrong'], [token]]) {
    const ws = new WebSocket(wsUrl(), protocols);
    const [err] = await once(ws, 'error');
    assert.match(String(err), /401/);
  }
  const ws = new WebSocket(wsUrl(), [TV_PROTOCOL_PREFIX + token]);
  const [hello] = await once(ws, 'message');
  assert.equal(JSON.parse(String(hello)).type, 'hello');
  assert.equal(ws.protocol, TV_PROTOCOL_PREFIX + token); // a browser needs the Server to echo it
  ws.close();
});

test('the TV token is refused on drafts and the session', async () => {
  const token = await signIn();
  for (const [method, path] of [['POST', '/api/drafts'], ['GET', '/api/drafts/1'], ['PUT', '/api/drafts/1'], ['DELETE', '/api/drafts/1'], ['POST', '/api/drafts/1/publish'], ['GET', '/api/session']]) {
    const res = await fetch(base + path, { method, headers: { ...bearer(token), 'Content-Type': 'application/json' }, body: method === 'PUT' ? '{}' : undefined });
    assert.equal(res.status, 401, `${method} ${path}`);
  }
  assert.equal((await post('/api/tv/approve', { code: 'ABCDEFGH' }, bearer(token))).status, 401);
});

test('signing in again replaces the token and closes the old TV socket', async () => {
  const oldToken = await signIn();
  const ws = new WebSocket(wsUrl(), [TV_PROTOCOL_PREFIX + oldToken]);
  await once(ws, 'message');
  const closed = once(ws, 'close');
  const newToken = await signIn();
  await closed;
  assert.equal((await fetch(base + '/api/snapshot', { headers: bearer(oldToken) })).status, 401);
  assert.equal((await fetch(base + '/api/snapshot', { headers: bearer(newToken) })).status, 200);
});

test('code requests need JSON and approvals need a string code', async () => {
  assert.equal((await fetch(base + '/api/tv/codes', { method: 'POST' })).status, 415);
  assert.equal((await post('/api/tv/approve', { code: 5 }, { cookie })).status, 404);
  assert.equal((await post('/api/tv/token', { code: 5, secret: {} })).status, 404);
});

test('Kids Mode over HTTP: Sofa Home and Companion enter, read and exit it; only Companion adds a Top-up', async () => {
  const tv = bearer(await signIn());
  const kids = async (res: Response | Promise<Response>) => {
    const r = await res;
    assert.equal(r.status, 200);
    return (await r.json()) as KidsStatus;
  };
  assert.equal((await fetch(base + '/api/kids')).status, 401);
  assert.equal((await post('/api/kids/enter', {}, bearer('wrong'))).status, 401);
  assert.equal((await fetch(base + '/api/kids/enter', { method: 'POST', headers: tv })).status, 415, 'POSTs need JSON');

  const ws = new WebSocket(wsUrl(), [TV_PROTOCOL_PREFIX + tv.Authorization.slice(7)]);
  const signals: string[] = [];
  ws.on('message', (m) => signals.push(JSON.parse(String(m)).type));
  await once(ws, 'open');

  const entered = await kids(post('/api/kids/enter', {}, tv));
  assert.equal(entered.active, true);
  assert.equal(entered.dailySeconds, 60 * 60, "revision 1's allowance");
  assert.equal(entered.remainingSeconds, 60 * 60);
  for (let i = 0; i < 100 && !signals.includes('kids'); i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(signals.includes('kids'), 'the TV hears about the change');

  assert.equal((await post('/api/kids/topup', { minutes: 5 }, tv)).status, 403, 'a child holds the remote');
  for (const minutes of [0, 241, 2.5, '5', null]) assert.equal((await post('/api/kids/topup', { minutes }, { cookie })).status, 400, String(minutes));
  assert.equal((await kids(post('/api/kids/topup', { minutes: 5 }, { cookie }))).topUpSeconds, 300);
  assert.equal((await kids(fetch(base + '/api/kids', { headers: tv }))).remainingSeconds, 65 * 60);
  assert.equal((await kids(post('/api/kids/done-shown', {}, tv))).donePending, false);
  assert.equal((await kids(post('/api/kids/exit', {}, { cookie }))).active, false);
  assert.equal((await kids(fetch(base + '/api/kids', { headers: { cookie } }))).active, false);
  assert.equal((await post('/api/kids/nothing', {}, { cookie })).status, 404);
  ws.close();
});
