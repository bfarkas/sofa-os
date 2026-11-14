import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { validateDisplay } from '@sofa/shared';
import { HaHttpError } from '../ha.ts';
import { cameraAdapter, caption, createLiveView, shouldRefresh, type Camera } from './camera.ts';

// The four real entities, recorded 2026-11-15.
const base: Record<string, { state: string; attributes: Record<string, unknown> }> = JSON.parse(readFileSync(new URL('./fixtures/frontdoor-states.json', import.meta.url), 'utf8'));
const SNAP = 'image.bosch_frontdoor_last_snapshot';
const TYPE = 'sensor.bosch_frontdoor_bosch_frontdoor_last_event_type';
const SNAP_AT = Date.parse('2026-11-14T23:30:31.272Z');
const EVENT_AT = Date.parse('2026-11-14T19:56:50Z');
const signal = new AbortController().signal;

function fake(over: Record<string, string> = {}, opts: { looking?: boolean; onPress?: (states: Record<string, string>) => void } = {}) {
  const states: Record<string, string> = Object.fromEntries(Object.entries(base).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [k, v.state]));
  Object.assign(states, over);
  const presses: number[] = [];
  const camera: Camera = {
    secret: 'abc123',
    ha: { async getState(id) { if (!(id in states)) throw new HaHttpError('nf', 404); return { state: states[id], attributes: {} }; } },
    async press() { presses.push(1); opts.onPress?.(states); },
    looking: async () => opts.looking ?? true,
    image: async () => ({ body: Buffer.from('x'), type: 'image/jpeg' }),
    live: async () => {},
    streamUrl: async () => 'http://ha.test/api/hls/T/master_playlist.m3u8',
  };
  return { camera, presses, adapter: cameraAdapter({ camera }, async () => {}) };
}
const read = async (a: ReturnType<typeof fake>, now: number) => a.adapter.read({}, { now, signal });

test('caption: type word and how long ago', () => {
  const now = EVENT_AT + 3 * 3600_000 + 20 * 60_000;
  assert.equal(caption('movement', EVENT_AT, now), 'Movement · 3 h ago');
  assert.equal(caption('person', EVENT_AT, EVENT_AT + 2 * 3600_000), 'Person · 2 h ago');
  assert.equal(caption('person', EVENT_AT, EVENT_AT + 5 * 60_000), 'Person · 5 min ago');
  assert.equal(caption('person', EVENT_AT, EVENT_AT + 20_000), 'Person · just now');
  assert.equal(caption('person', EVENT_AT, EVENT_AT + 3 * 86_400_000), 'Person · 3 d ago');
});

test('caption: unknown type is neutral, missing data is no caption', () => {
  assert.equal(caption('doorbell_ring', EVENT_AT, EVENT_AT + 3600_000), 'Activity · 1 h ago');
  assert.equal(caption('none', EVENT_AT, EVENT_AT + 3600_000), 'Activity · 1 h ago');
  assert.equal(caption('person', null, 0), 'Person');
  assert.equal(caption('unavailable', null, 0), undefined);
});

test('refresh decision: fresh, stale, offline, debounced', () => {
  assert.equal(shouldRefresh(SNAP_AT, SNAP_AT + 60_000, null), false, 'fresh');
  assert.equal(shouldRefresh(SNAP_AT, SNAP_AT + 120_000, null), false, 'exactly 2 minutes is not older');
  assert.equal(shouldRefresh(SNAP_AT, SNAP_AT + 121_000, null), true, 'stale');
  assert.equal(shouldRefresh(null, SNAP_AT + 3600_000, null), false, 'camera offline: nothing to press');
  assert.equal(shouldRefresh(SNAP_AT, SNAP_AT + 300_000, SNAP_AT + 280_000), false, 'pressed 20 s ago');
  assert.equal(shouldRefresh(SNAP_AT, SNAP_AT + 300_000, SNAP_AT + 200_000), true, 'pressed 100 s ago');
});

test('fresh snapshot: a photo card with the proxied path and caption, no press', async () => {
  const a = fake();
  const r = await read(a, SNAP_AT + 30_000);
  assert.ok('card' in r && r.card.template === 'photo');
  assert.equal(r.card.image, '/api/camera/abc123.jpg?v=' + SNAP_AT);
  assert.equal(r.card.caption, 'Movement · 3 h ago');
  assert.equal(r.title, 'Front door');
  assert.deepEqual(validateDisplay(r.card, 'card'), []);
  assert.equal(a.presses.length, 0);
});

test('stale snapshot: presses once, takes the new picture, and concurrent reads do not press again', async () => {
  const fresh = '2026-11-15T00:00:09.000+00:00';
  const a = fake({ [TYPE]: 'person' }, { onPress: (s) => { s[SNAP] = fresh; } });
  const now = SNAP_AT + 10 * 60_000;
  const [x, y] = await Promise.all([read(a, now), read(a, now)]);
  assert.equal(a.presses.length, 1);
  for (const r of [x, y]) assert.ok('card' in r && r.card.template === 'photo' && r.card.caption?.startsWith('Person · '));
  assert.ok('card' in x && x.card.template === 'photo' && x.card.image.endsWith('?v=' + Date.parse(fresh)));
});

test('stale snapshot but the TV is not showing Sofa Home: no press', async () => {
  const a = fake({}, { looking: false });
  await read(a, SNAP_AT + 10 * 60_000);
  assert.equal(a.presses.length, 0);
});

test('camera offline: unavailable with a clear message, never a press', async () => {
  const a = fake({ [SNAP]: 'unavailable' });
  await assert.rejects(read(a, SNAP_AT + 3600_000), /camera is offline/);
  assert.equal(a.presses.length, 0);
});

test('a failed press keeps the old picture; kids see nothing; no Home Assistant is a clear message', async () => {
  const a = fake();
  a.camera.press = async () => { throw new Error('boom'); };
  const r = await read(a, SNAP_AT + 10 * 60_000);
  assert.ok('card' in r && r.card.template === 'photo' && r.card.image.endsWith('?v=' + SNAP_AT));
  assert.deepEqual(a.adapter.forKids!(r), { empty: 'Nothing to show' });
  await assert.rejects(async () => cameraAdapter({ camera: null }).read({}, { now: 0, signal }), /not set up/);
});

// ---- the live view (Session 42) ----
function liveRig(over: Partial<Camera> = {}) {
  const { camera } = fake();
  const calls: string[] = [];
  camera.live = async (on) => { calls.push(on ? 'on' : 'off'); };
  Object.assign(camera, over);
  const timers: { f: () => void; ms: number; id: number }[] = [];
  let n = 0;
  const set = ((f: () => void, ms: number) => (timers.push({ f, ms, id: ++n }), n)) as unknown as typeof setTimeout;
  const clear = ((id: number) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); }) as unknown as typeof clearTimeout;
  return { view: createLiveView(camera, 120_000, { set, clear }), calls, timers };
}

test('live: open switches on and returns the URL; close switches off', async () => {
  const r = liveRig();
  assert.equal(await r.view.open(), 'http://ha.test/api/hls/T/master_playlist.m3u8');
  assert.deepEqual(r.calls, ['on']);
  await r.view.close();
  assert.deepEqual(r.calls, ['on', 'off']);
  assert.equal(r.timers.length, 0);
  await r.view.close();
  assert.deepEqual(r.calls, ['on', 'off'], 'closing with nothing running does nothing');
});

test('live: the Server timeout switches off when the TV never closes', async () => {
  const r = liveRig();
  await r.view.open();
  assert.equal(r.timers.length, 1);
  assert.equal(r.timers[0].ms, 120_000);
  r.timers[0].f();
  await r.view.close(); // queued behind the timeout's switch-off
  assert.deepEqual(r.calls, ['on', 'off']);
});

test('live: a second open while one runs does not switch again and restarts the timeout', async () => {
  const r = liveRig();
  await Promise.all([r.view.open(), r.view.open()]);
  await r.view.open();
  assert.deepEqual(r.calls, ['on']);
  assert.equal(r.timers.length, 1, 'one timeout, restarted');
});

test('live: no stream URL turns the switch back off and fails the open', async () => {
  const r = liveRig({ streamUrl: async () => { throw new Error('no stream'); } });
  await assert.rejects(r.view.open(), /no stream/);
  assert.deepEqual(r.calls, ['on', 'off']);
});

test('live: a failed switch-off is tried again at the next timeout', async () => {
  let down = true;
  const calls: string[] = [];
  const r = liveRig({ live: async (on) => { if (!on && down) throw new Error('ha down'); calls.push(on ? 'on' : 'off'); } });
  await r.view.open();
  await assert.rejects(r.view.close(), /ha down/);
  assert.equal(r.timers.length, 1);
  down = false;
  r.timers[0].f();
  await r.view.close();
  assert.deepEqual(calls, ['on', 'off']);
});
