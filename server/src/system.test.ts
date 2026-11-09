import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAllowance, fromDb, startAllowance } from './allowance.ts';
import { openDb } from './db.ts';
import type { HaConfig } from './config.ts';
import { createSystem } from './system.ts';

test('system status: unknown, then reachable, then down with the time it changed', () => {
  let t = Date.UTC(2026, 0, 1);
  const sys = createSystem('on', () => t);
  assert.deepEqual(sys.status(), { homeAssistant: 'on', haReachable: null, haSince: null, backup: { lastAt: null, lastError: null } });
  sys.setHaReachable(true);
  t += 60_000;
  sys.setHaReachable(true);
  assert.equal(sys.status().haSince, '2026-01-01T00:00:00.000Z', 'only a change moves the time');
  sys.setHaReachable(false);
  assert.equal(sys.status().haReachable, false);
  assert.equal(sys.status().haSince, '2026-01-01T00:01:00.000Z');
  assert.equal(createSystem('off').status().haReachable, null);
});

test('the allowance tick reports Home Assistant reachability as it changes', async () => {
  const HA = { url: 'http://127.0.0.1:1', token: 't', tvEntity: 'media_player.tv', remoteEntity: 'remote.tv', notifyServices: [] } as HaConfig;
  const seen: boolean[] = [];
  let up = false;
  const engine = createAllowance({ ...fromDb(openDb(':memory:')), ha: null, timeZone: 'Europe/Berlin', resetMinutes: 240, graceSeconds: 0, topUpUrl: 'https://x/kids/topup' });
  const client = { getState: async () => (up ? { state: 'on' } : Promise.reject(new Error('down'))) };
  const stop = startAllowance(engine, HA, client, 10, (ok) => seen.push(ok));
  await new Promise((r) => setTimeout(r, 60));
  up = true;
  await new Promise((r) => setTimeout(r, 60));
  stop();
  assert.equal(seen[0], false);
  assert.equal(seen.at(-1), true);
});
