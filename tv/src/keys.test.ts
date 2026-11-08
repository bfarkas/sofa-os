import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRemote, LONG_PRESS_MS, type RemoteEvent } from './keys.ts';

function setup() {
  const events: RemoteEvent[] = [];
  let t = 1000;
  const remote = createRemote((e) => events.push(e), () => t);
  return { remote, events, advance: (ms: number) => void (t += ms) };
}

test('arrows and Back act on keydown, once', () => {
  const { remote, events } = setup();
  for (const code of [37, 38, 39, 40, 10009, 27]) assert.equal(remote.down(code), true);
  remote.down(37); // a repeat while still held
  remote.up(37);
  assert.deepEqual(events.map((e) => e.key), ['left', 'up', 'right', 'down', 'back', 'back']);
  assert.ok(events.every((e) => !e.long));
});

test('OK is a short press below the threshold and a long press at or above it', () => {
  const { remote, events, advance } = setup();
  remote.down(13);
  assert.deepEqual(events, []); // nothing until release
  advance(LONG_PRESS_MS - 1);
  remote.up(13);
  remote.down(13);
  advance(LONG_PRESS_MS);
  remote.up(13);
  remote.down(13);
  advance(2500); // the 2.5 s hold measured on the TV: one keydown, one keyup
  remote.up(13);
  assert.deepEqual(events, [{ key: 'ok', long: false }, { key: 'ok', long: true }, { key: 'ok', long: true }]);
});

test('a keyup whose keydown we never saw is ignored, and reset forgets held keys', () => {
  const { remote, events, advance } = setup();
  remote.up(13);
  remote.down(13);
  remote.reset(); // the app lost focus
  advance(50);
  remote.up(13);
  assert.deepEqual(events, []);
});

test('keys that are not ours are left to the browser', () => {
  const { remote, events } = setup();
  assert.equal(remote.down(65), false);
  assert.equal(remote.down(10252), false);
  assert.deepEqual(events, []);
});

test('number keys and the keypad act on keydown and carry the digit', () => {
  const { remote, events } = setup();
  for (const code of [48, 53, 57, 96, 105]) assert.equal(remote.down(code), true);
  remote.down(53); // a repeat while held
  remote.up(53);
  remote.down(53);
  assert.deepEqual(events.map((e) => e.digit), ['0', '5', '9', '0', '9', '5']);
  assert.ok(events.every((e) => e.key === 'digit' && !e.long));
  assert.equal(remote.down(47), false);
  assert.equal(remote.down(58), false);
});
