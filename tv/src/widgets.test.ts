import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WidgetData } from '@sofa/shared';
import { cardView, parseWidgets, startWidgets, updatedText, WIDGETS_KEY } from './widgets.ts';

const T = Date.parse('2026-11-09T12:00:00Z');
const ok = (over: Partial<WidgetData> = {}): WidgetData => ({
  id: 'w',
  title: 'Weather',
  status: 'ok',
  card: { template: 'value', value: '12', unit: '°C' },
  updatedAt: new Date(T - 60_000).toISOString(),
  failing: false,
  staleAfterSeconds: 180,
  ...over,
});
const answer = (widgets: unknown[], serverTime = T) => ({ serverTime: new Date(serverTime).toISOString(), widgets });

test('a card is ok, then stale once its data is older than the policy, measured across clock skew', () => {
  const tvClock = T + 3 * 3600_000; // the TV's clock is three hours off
  const s = parseWidgets(answer([ok()]), tvClock)!;
  const v = cardView(s, 'w', 'Fallback', tvClock);
  assert.equal(v.state, 'ok');
  assert.equal(v.state === 'ok' && v.stale, false);
  assert.deepEqual(v.state === 'ok' && v.detail, { template: 'value', value: '12', unit: '°C' }, 'no detail: the full view shows the card');
  // 60 s old at the answer; stale after 180 s, so 121 s later on the TV's own clock
  assert.equal((cardView(s, 'w', '', tvClock + 119_000) as { stale: boolean }).stale, false);
  assert.equal((cardView(s, 'w', '', tvClock + 121_000) as { stale: boolean }).stale, true);
});

test('a card is stale at once when the source failed or the Server is unreachable', () => {
  assert.equal((cardView(parseWidgets(answer([ok({ failing: true })]), T)!, 'w', '', T) as { stale: boolean }).stale, true);
  const s = parseWidgets(answer([ok()]), T)!;
  s.reachable = false;
  assert.equal((cardView(s, 'w', '', T) as { stale: boolean }).stale, true);
});

test('loading, empty, unavailable and malformed widgets', () => {
  const s = parseWidgets(answer([ok({ id: 'e', status: 'empty', card: undefined, message: 'No events today' }), ok({ id: 'u', status: 'unavailable', card: undefined, message: 'Home Assistant is not reachable' }), { id: 'bad', status: 'ok' }]), T)!;
  assert.deepEqual(cardView(s, 'nothing', 'Energy', T), { state: 'loading', title: 'Energy' });
  assert.equal(cardView(s, 'e', '', T).state, 'empty');
  assert.deepEqual(cardView(s, 'u', 'X', T), { state: 'unavailable', title: 'Weather', message: 'Home Assistant is not reachable' });
  assert.deepEqual(cardView(s, 'bad', 'Bad', T), { state: 'unavailable', title: 'Bad', message: 'Not available right now' });
  s.reachable = false;
  assert.equal(cardView(s, 'nothing', 'Energy', T).state, 'unavailable', 'no data and no Server');
  assert.equal(parseWidgets({ widgets: [] }, T), null);
});

test('updated text says the day only when it is not today', () => {
  const now = new Date(2026, 10, 9, 14, 30);
  assert.equal(updatedText(new Date(2026, 10, 9, 14, 5), now), 'Updated 14:05');
  assert.equal(updatedText(new Date(2026, 10, 8, 9, 0), now), 'Updated Sun 8 Nov 09:00');
});

test('the last answer is stored, shown on start, and kept (stale) while the Server is gone', async () => {
  const store: Record<string, string> = {};
  const storage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v) };
  let next: () => Promise<unknown> = () => Promise.resolve(answer([ok()]));
  const states: { reachable: boolean | null; ids: string[] }[] = [];
  const run = () =>
    startWidgets({ fetchWidgets: () => next(), storage, now: () => T, intervalMs: 1e9, onChange: (s) => states.push({ reachable: s.reachable, ids: Object.keys(s.byId) }) });
  const a = run();
  await new Promise((r) => setTimeout(r, 0));
  a.stop();
  assert.deepEqual(states, [{ reachable: null, ids: [] }, { reachable: true, ids: ['w'] }]);
  assert.ok(store[WIDGETS_KEY]);

  next = () => Promise.reject(new Error('down'));
  states.length = 0;
  const b = run();
  await new Promise((r) => setTimeout(r, 0));
  b.stop();
  assert.deepEqual(states, [{ reachable: null, ids: ['w'] }, { reachable: false, ids: ['w'] }]);

  next = () => Promise.resolve({ nonsense: true });
  states.length = 0;
  const c = run();
  await new Promise((r) => setTimeout(r, 0));
  c.stop();
  assert.deepEqual(states[1], { reachable: false, ids: ['w'] }, 'a malformed answer counts as no answer');
});
