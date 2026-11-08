import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDb } from './db.ts';
import { createPin, LOCK_MS, MAX_TRIES } from './pin.ts';

const setup = () => {
  const clock = { t: 1_800_000_000_000 };
  const db = openDb(':memory:');
  return { db, clock, pin: createPin(db, () => clock.t) };
};

test('the PIN is four digits, stored only as a salted hash', async () => {
  const { db, pin } = setup();
  assert.equal(pin.isSet(), false);
  for (const bad of ['123', '12345', 'abcd', '12 4', '', 1234, null, undefined]) assert.equal(await pin.set(bad), false, String(bad));
  assert.equal(pin.isSet(), false);
  assert.equal(await pin.set('4821'), true);
  const row = db.prepare('SELECT hash FROM kids_pin').get() as { hash: string };
  assert.match(row.hash, /^scrypt\$/);
  assert.ok(!row.hash.includes('4821'));
  await pin.set('4821');
  assert.notEqual((db.prepare('SELECT hash FROM kids_pin').get() as { hash: string }).hash, row.hash, 'a new salt each time');
});

test('check: unset, wrong, right, and a new PIN replaces the old one', async () => {
  const { pin } = setup();
  assert.deepEqual(await pin.check('1234'), { ok: false, reason: 'unset' });
  await pin.set('1234');
  assert.deepEqual(await pin.check('1234'), { ok: true });
  assert.deepEqual(await pin.check('1235'), { ok: false, reason: 'wrong', triesLeft: MAX_TRIES - 1 });
  assert.deepEqual(await pin.check('not a pin'), { ok: false, reason: 'wrong', triesLeft: MAX_TRIES - 2 });
  assert.deepEqual(await pin.check(undefined), { ok: false, reason: 'wrong', triesLeft: MAX_TRIES - 3 });
  await pin.set('9999');
  assert.deepEqual(await pin.check('1234'), { ok: false, reason: 'wrong', triesLeft: MAX_TRIES - 1 });
  assert.deepEqual(await pin.check('9999'), { ok: true });
});

test('five wrong tries lock the PIN for five minutes, even against the right PIN; a right one in time resets the count', async () => {
  const { pin, clock } = setup();
  await pin.set('1234');
  for (let i = 0; i < MAX_TRIES - 1; i++) await pin.check('0000');
  assert.deepEqual(await pin.check('1234'), { ok: true }, 'the fifth try would have locked it; a right PIN resets the count');
  for (let i = 0; i < MAX_TRIES - 1; i++) assert.equal((await pin.check('0000')).ok, false);
  assert.deepEqual(await pin.check('0000'), { ok: false, reason: 'locked', retryAfterSeconds: LOCK_MS / 1000 });
  assert.deepEqual(await pin.check('1234'), { ok: false, reason: 'locked', retryAfterSeconds: LOCK_MS / 1000 });
  clock.t += LOCK_MS - 1000;
  assert.deepEqual(await pin.check('1234'), { ok: false, reason: 'locked', retryAfterSeconds: 1 });
  clock.t += 1000;
  assert.deepEqual(await pin.check('1234'), { ok: true });
  assert.deepEqual(await pin.check('0000'), { ok: false, reason: 'wrong', triesLeft: MAX_TRIES - 1 }, 'a fresh count after the lockout');
});

test('setting a PIN in Companion ends a lockout', async () => {
  const { pin } = setup();
  await pin.set('1234');
  for (let i = 0; i < MAX_TRIES; i++) await pin.check('0000');
  assert.equal((await pin.check('1234')).ok, false);
  await pin.set('1234');
  assert.deepEqual(await pin.check('1234'), { ok: true });
});

test('a burst of parallel tries cannot get past the limit', async () => {
  const { pin } = setup();
  await pin.set('1234');
  const results = await Promise.all(Array.from({ length: 40 }, (_, i) => pin.check(String(1000 + i))));
  const verified = results.filter((r) => !r.ok && r.reason === 'wrong').length;
  assert.ok(verified <= MAX_TRIES, `${verified} tries were checked`);
  assert.equal(results.filter((r) => !r.ok && r.reason === 'locked').length, 40 - verified);
});
