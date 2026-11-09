import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSlideshow } from './slideshow.ts';

// A slideshow over `count` pictures whose loads we settle by hand; every load and show is logged.
function rig(count: number, failing: number[] = []) {
  const log: string[] = [];
  let gaveUp = false;
  const show = createSlideshow({
    count,
    intervalMs: 1000,
    load: (i) => {
      log.push('load ' + i);
      return failing.indexOf(i) >= 0 ? Promise.reject(new Error('404')) : Promise.resolve();
    },
    show: (i) => log.push('show ' + i),
    onGiveUp: () => (gaveUp = true),
  });
  return { show, log, gaveUp: () => gaveUp };
}
const settle = () => new Promise((r) => setImmediate(r));

test('shows the first picture at once, then the next after each interval, and wraps', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { show, log } = rig(3);
  show.start();
  await settle();
  assert.deepEqual(log, ['load 0', 'show 0']);
  for (const n of [1, 2, 0]) {
    t.mock.timers.tick(1000);
    await settle();
    assert.equal(log[log.length - 1], 'show ' + n);
  }
  assert.equal(log.filter((l) => l.startsWith('load')).length, 4); // never more than one load ahead
  show.stop();
});

test('the next picture is not loaded before its time, so only the current one is held', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { show, log } = rig(5);
  show.start();
  await settle();
  t.mock.timers.tick(999);
  await settle();
  assert.deepEqual(log, ['load 0', 'show 0']);
  show.stop();
});

test('pause stops the clock, arrows step either way, and resume starts the clock again', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { show, log } = rig(4);
  show.start();
  await settle();
  assert.equal(show.toggle(), true);
  t.mock.timers.tick(5000);
  await settle();
  assert.equal(log.length, 2);
  show.next();
  await settle();
  show.prev();
  await settle();
  show.prev();
  await settle();
  assert.deepEqual(log.filter((l) => l.startsWith('show')), ['show 0', 'show 1', 'show 0', 'show 3']);
  t.mock.timers.tick(5000);
  await settle();
  assert.equal(log[log.length - 1], 'show 3'); // still paused after the steps
  assert.equal(show.toggle(), false);
  t.mock.timers.tick(1000);
  await settle();
  assert.equal(log[log.length - 1], 'show 0');
  show.stop();
});

test('a picture that fails is skipped, and a show where everything fails gives up', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const a = rig(4, [0, 1]);
  a.show.start();
  await settle();
  assert.deepEqual(a.log, ['load 0', 'load 1', 'load 2', 'show 2']);
  a.show.stop();

  const b = rig(3, [0, 1, 2]);
  b.show.start();
  await settle();
  assert.equal(b.gaveUp(), true);
  assert.equal(b.log.filter((l) => l.startsWith('show')).length, 0);
  t.mock.timers.tick(10_000);
  await settle();
  assert.equal(b.log.length, 3); // and it stays given up
});

test('a load that finishes after a newer request is dropped; stop ends everything', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const release: (() => void)[] = [];
  const shown: number[] = [];
  const s = createSlideshow({ count: 3, intervalMs: 1000, load: () => new Promise<void>((r) => release.push(r)), show: (i) => shown.push(i), onGiveUp() {} });
  s.start();
  s.next(); // asked again before the first load finished
  release[0]();
  await settle();
  assert.deepEqual(shown, []); // the first answer is stale
  release[1]();
  await settle();
  assert.deepEqual(shown, [0]);
  s.stop();
  t.mock.timers.tick(5000);
  await settle();
  assert.equal(release.length, 2);
});

test('suspend and resume keep the place', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { show, log } = rig(3);
  show.start();
  await settle();
  show.suspend();
  t.mock.timers.tick(5000);
  await settle();
  assert.equal(log.length, 2);
  show.resume();
  t.mock.timers.tick(1000);
  await settle();
  assert.equal(log[log.length - 1], 'show 1');
  assert.equal(show.index(), 1);
  show.stop();
});
