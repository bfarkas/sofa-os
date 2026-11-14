import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLive, isCameraCard, LIVE_MS } from './live.ts';
import type { CardView } from './widgets.ts';

function rig(open: () => Promise<string> = async () => 'http://ha/x.m3u8') {
  const log: string[] = [];
  let timer: { f: () => void; ms: number } | null = null;
  const live = createLive({
    open: () => (log.push('open'), open()),
    close: () => log.push('close'),
    show: (v) => log.push('show ' + (v.url || v.message)),
    hide: () => log.push('hide'),
    onClosed: () => log.push('closed'),
    setTimer: (f, ms) => (timer = { f, ms }),
    clearTimer: () => (timer = null),
  });
  return { live, log, timer: () => timer };
}
const tick = () => new Promise((r) => setImmediate(r));

test('open shows the view, asks the Server, then plays the URL', async () => {
  const r = rig();
  r.live.open();
  await tick();
  assert.deepEqual(r.log, ['show Starting the camera…', 'open', 'show http://ha/x.m3u8']);
  assert.equal(r.live.isOpen(), true);
  r.live.open();
  assert.equal(r.log.length, 3, 'a second open does nothing');
});

test('Back closes, tells the Server and stops the timeout; other keys do nothing', async () => {
  const r = rig();
  r.live.open();
  await tick();
  assert.equal(r.live.key({ key: 'ok', long: false }), false);
  assert.equal(r.live.key({ key: 'left', long: false }), false);
  assert.equal(r.live.isOpen(), true);
  assert.equal(r.live.key({ key: 'back', long: false }), true);
  assert.deepEqual(r.log.slice(-2), ['hide', 'close']);
  assert.equal(r.timer(), null);
  assert.equal(r.live.isOpen(), false);
});

test('it closes itself after 2 minutes and tells the Server', async () => {
  const r = rig();
  r.live.open();
  assert.equal(r.timer()!.ms, LIVE_MS);
  assert.equal(LIVE_MS, 120_000);
  r.timer()!.f();
  assert.deepEqual(r.log.slice(-3), ['hide', 'close', 'closed']);
  assert.equal(r.live.isOpen(), false);
});

test('a failed open says so, and Back still closes (and tells the Server)', async () => {
  const r = rig(() => Promise.reject(new Error('502')));
  r.live.open();
  await tick();
  assert.equal(r.log[r.log.length - 1], 'show The camera is not available right now.');
  assert.equal(r.live.key({ key: 'back', long: false }), true);
  assert.equal(r.log[r.log.length - 1], 'close');
});

test('an answer that arrives after Back is ignored', async () => {
  let answer: (u: string) => void = () => {};
  const r = rig(() => new Promise((res) => (answer = res)));
  r.live.open();
  r.live.key({ key: 'back', long: false });
  answer('http://ha/late.m3u8');
  await tick();
  assert.ok(!r.log.some((l) => l.indexOf('late') >= 0));
});

test('the camera card is told by its proxied picture path', () => {
  const card = (image: string): CardView => ({ state: 'ok', title: 't', card: { template: 'photo', image }, detail: { template: 'photo', image }, stale: false, updated: '' });
  assert.equal(isCameraCard(card('/api/camera/abc.jpg?v=1')), true);
  assert.equal(isCameraCard(card('/api/media/household/x/y.jpg')), false);
  assert.equal(isCameraCard({ state: 'loading', title: 't' }), false);
});
