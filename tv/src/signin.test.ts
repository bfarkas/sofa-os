import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dashed, normalizeServer, startSignIn, type FetchLike, type SignInState } from './signin.ts';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A fake Server for the sign-in endpoints. `codes` hands out numbered codes; `approved` is what the poll answers.
function harness() {
  const calls: { path: string; body: any }[] = [];
  const srv = { codes: 0, answer: (): { status: number; body?: unknown } => ({ status: 200, body: { status: 'pending' } }), down: false };
  const states: SignInState[] = [];
  const tokens: string[] = [];
  const fetch: FetchLike = async (url, init) => {
    const path = url.replace('https://sofa.test', '');
    const body = JSON.parse(init.body);
    calls.push({ path, body });
    if (srv.down) throw new Error('connection refused');
    if (path === '/api/tv/codes') {
      srv.codes++;
      return { status: 201, json: async () => ({ code: 'ABCDEFG' + srv.codes, secret: 'secret' + srv.codes, expiresAt: 'x' }) };
    }
    const a = srv.answer();
    return { status: a.status, json: async () => a.body };
  };
  const start = () => startSignIn({ server: 'https://sofa.test', fetch, intervalMs: 10, onChange: (s) => states.push(s), onToken: (t) => tokens.push(t) });
  return { calls, srv, states, tokens, start, last: () => states[states.length - 1] };
}

test('shows a code and QR address, polls with the secret, and stops once approved', async () => {
  const h = harness();
  const s = h.start();
  await wait(50);
  assert.equal(h.last().code, 'ABCDEFG1');
  assert.equal(h.last().url, 'https://sofa.test/tv-signin?code=ABCDEFG1');
  assert.ok(!h.last().url.includes('secret1')); // the QR code never carries the secret
  const poll = h.calls.find((c) => c.path === '/api/tv/token')!;
  assert.deepEqual(poll.body, { code: 'ABCDEFG1', secret: 'secret1' });
  assert.deepEqual(h.tokens, []);

  h.srv.answer = () => ({ status: 200, body: { status: 'approved', token: 'device-token' } });
  await wait(50);
  assert.deepEqual(h.tokens, ['device-token']);
  const n = h.calls.length;
  await wait(50);
  assert.equal(h.calls.length, n); // no more requests
  s.stop();
});

test('an expired code (404) is replaced by a new one', async () => {
  const h = harness();
  const s = h.start();
  await wait(30);
  h.srv.answer = () => ({ status: 404, body: { error: 'unknown or expired code' } });
  await wait(60);
  assert.ok(h.srv.codes >= 2);
  h.srv.answer = () => ({ status: 200, body: { status: 'pending' } });
  await wait(40);
  const polls = h.calls.filter((c) => c.path === '/api/tv/token');
  assert.equal(polls[polls.length - 1].body.secret, 'secret' + h.srv.codes); // polls with the newest code's own secret
  s.stop();
});

test('an unreachable Server shows an error and recovers', async () => {
  const h = harness();
  h.srv.down = true;
  const s = h.start();
  await wait(40);
  assert.match(h.last().error, /unreachable.*refused/);
  assert.equal(h.last().code, '');
  h.srv.down = false;
  await wait(60);
  assert.equal(h.last().error, '');
  assert.equal(h.last().code, 'ABCDEFG' + h.srv.codes);
  s.stop();
});

test('stop() ends all requests', async () => {
  const h = harness();
  const s = h.start();
  await wait(30);
  s.stop();
  const n = h.calls.length;
  await wait(50);
  assert.equal(h.calls.length, n);
});

test('Server addresses are checked and tidied', () => {
  assert.equal(normalizeServer(' https://sofa.familie-farkas.de/ '), 'https://sofa.familie-farkas.de');
  assert.equal(normalizeServer('http://192.168.42.57:8090'), 'http://192.168.42.57:8090');
  for (const bad of ['', 'sofa.test', 'ftp://sofa.test', 'https://sofa.test/path', 'https://', 'https://so fa.test']) assert.equal(normalizeServer(bad), null, bad);
  assert.equal(dashed('ABCD2345'), 'ABCD-2345');
});
