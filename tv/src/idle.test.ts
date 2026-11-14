import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createIdle } from './idle.ts';

const MIN = 60_000;
function rig(minutes = 10) {
  let t = 0;
  const idle = createIdle(() => t);
  idle.setMinutes(minutes);
  return { idle, at: (m: number) => (t = m * MIN) };
}

test('fires once after the minutes without a key, not before', () => {
  const { idle, at } = rig(10);
  assert.equal(idle.tick(), false);
  at(9.9);
  assert.equal(idle.tick(), false);
  at(10);
  assert.equal(idle.tick(), true);
  assert.equal(idle.active(), true);
  at(20);
  assert.equal(idle.tick(), false); // already showing
});

test('a key restarts the count', () => {
  const { idle, at } = rig(5);
  at(4);
  assert.equal(idle.key(), false); // nothing to wake: the key acts as normal
  at(8);
  assert.equal(idle.tick(), false);
  at(9);
  assert.equal(idle.tick(), true);
});

test('the first key after it started only wakes, the next acts', () => {
  const { idle, at } = rig(5);
  at(5);
  idle.tick();
  at(6);
  assert.equal(idle.key(), true);
  assert.equal(idle.active(), false);
  assert.equal(idle.key(), false);
  at(10.9);
  assert.equal(idle.tick(), false); // counts from the waking key
  at(11);
  assert.equal(idle.tick(), true);
});

test('Off never fires', () => {
  const { idle, at } = rig(0);
  at(100000);
  assert.equal(idle.tick(), false);
});

test('paused in Kids Mode, and a running screensaver ends when Kids Mode starts', () => {
  const { idle, at } = rig(5);
  assert.equal(idle.setKids(true), false);
  at(60);
  assert.equal(idle.tick(), false);
  assert.equal(idle.setKids(false), false);
  at(64.9);
  assert.equal(idle.tick(), false); // the count restarted when Kids Mode ended
  at(65);
  assert.equal(idle.tick(), true);
  assert.equal(idle.setKids(true), true); // ended it
  assert.equal(idle.active(), false);
  assert.equal(idle.key(), false);
});

test('paused while Sofa Home is in the background, and the count restarts when it comes back', () => {
  const { idle, at } = rig(5);
  at(4);
  idle.setHidden(true);
  at(30);
  assert.equal(idle.tick(), false);
  idle.setHidden(false);
  at(34.9);
  assert.equal(idle.tick(), false);
  at(35);
  assert.equal(idle.tick(), true);
});

test('changing the minutes restarts the count', () => {
  const { idle, at } = rig(30);
  at(20);
  idle.setMinutes(5);
  assert.equal(idle.tick(), false);
  at(25);
  assert.equal(idle.tick(), true);
});
