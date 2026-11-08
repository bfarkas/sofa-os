import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KidsStatus } from '@sofa/shared';
import { createKids, createPad, forestFor, screenFor, tileAvailable, type KidsState, type Send } from './kids.ts';

const status = (over: Partial<KidsStatus> = {}): KidsStatus => ({
  active: true, tv: 'on', dailySeconds: 2400, topUpSeconds: 0, usedSeconds: 0, remainingSeconds: 600, donePending: false, resetsAt: '2026-11-10T03:00:00.000Z', pinSet: true,
  ...over,
});
const at = (h: number) => new Date(2026, 10, 9, h, 0);

test('the forest follows the hour: morning, midday, late afternoon', () => {
  assert.deepEqual([6, 10, 11, 15, 16, 21].map((h) => forestFor(at(h))), ['morning', 'morning', 'midday', 'midday', 'late-afternoon', 'late-afternoon']);
});

test('the Server decides the screen: Kids Mode while time is left, the Done Screen at zero, the Dashboard otherwise', () => {
  assert.equal(screenFor(null), 'household');
  assert.equal(screenFor(status({ active: false })), 'household');
  assert.equal(screenFor(status()), 'kids');
  assert.equal(screenFor(status({ remainingSeconds: 0 })), 'done');
});

test('the tile is unavailable until the Server has answered, and when it stops answering', async () => {
  let up = true;
  const states: KidsState[] = [];
  const kids = createKids({
    send: async () => { if (!up) throw new Error('refused'); return { status: 200, body: status({ active: false }) }; },
    onChange: (s) => states.push(s),
    onUnauthorized() {},
  });
  assert.equal(tileAvailable(kids.state), false);
  await kids.refresh();
  assert.equal(tileAvailable(kids.state), true);
  up = false;
  await kids.refresh();
  assert.equal(tileAvailable(states[states.length - 1]), false);
  assert.equal(states[states.length - 1].status?.active, false, 'the last answer is kept');
});

function fake(answers: Record<string, { status: number; body?: unknown }>) {
  const calls: string[] = [];
  const unauthorized: number[] = [];
  const send: Send = async (method, path, body) => {
    calls.push(method + ' ' + path + (body && (body as { pin?: string }).pin ? ' ' + (body as { pin: string }).pin : ''));
    return (answers[method + ' ' + path] as { status: number; body: any }) || { status: 200, body: status() };
  };
  const kids = createKids({ send, onChange() {}, onUnauthorized: () => void unauthorized.push(1) });
  return { kids, calls, unauthorized };
}

test('the Done Screen tells the Server once per episode', async () => {
  const calls: string[] = [];
  let pending = true; // the Server stops saying so once it was told
  const kids = createKids({
    send: async (method, path) => {
      calls.push(method + ' ' + path);
      if (method === 'POST') pending = false;
      return { status: 200, body: status({ remainingSeconds: 0, donePending: pending }) };
    },
    onChange() {},
    onUnauthorized() {},
  });
  await Promise.all([kids.refresh(), kids.refresh()]); // two answers that both say pending
  await kids.refresh();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.filter((c) => c === 'POST /api/kids/done-shown').length, 1);
});

test('leaving with the PIN: the Server answers become words for the pad', async () => {
  const run = async (answer: { status: number; body?: unknown }) => fake({ 'POST /api/kids/exit': answer }).kids.exit('1234');
  assert.deepEqual(await run({ status: 200, body: status({ active: false }) }), { ok: true });
  assert.deepEqual(await run({ status: 403, body: { error: 'wrong', triesLeft: 3 } }), { ok: false, message: 'Wrong PIN. 3 tries left.' });
  assert.deepEqual(await run({ status: 403, body: { triesLeft: 1 } }), { ok: false, message: 'Wrong PIN. 1 try left.' });
  assert.deepEqual(await run({ status: 429, body: { retryAfterSeconds: 241 } }), { ok: false, message: 'Too many tries. Try again in 5 minutes.' });
  assert.deepEqual(await run({ status: 409, body: {} }), { ok: false, message: 'No PIN is set yet. Set one in Companion.' });
  const down = createKids({ send: async () => { throw new Error('x'); }, onChange() {}, onUnauthorized() {} });
  assert.deepEqual(await down.exit('1234'), { ok: false, message: 'The Server is not reachable.' });
});

test('a refused device token is reported', async () => {
  const f = fake({ 'GET /api/kids': { status: 401, body: {} } });
  await f.kids.refresh();
  assert.equal(f.unauthorized.length, 1);
});

test('the pad sends on the fourth digit, then waits for reset; Delete takes one back; letters are ignored', () => {
  const sent: string[] = [];
  const pad = createPad((pin) => void sent.push(pin));
  'x1'.split('').forEach(pad.push);
  assert.equal(pad.count(), 1);
  pad.del();
  pad.del();
  assert.equal(pad.count(), 0);
  '1234'.split('').forEach(pad.push);
  assert.deepEqual(sent, ['1234']);
  pad.push('5');
  pad.del();
  assert.equal(pad.count(), 4, 'busy until the answer is in');
  pad.reset();
  assert.equal(pad.count(), 0);
});
