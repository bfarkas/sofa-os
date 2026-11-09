import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { WebSocketServer } from 'ws';
import { actionMinutes, allowanceDays, createAllowance, fromDb, startAllowance, tvPower, type Store, type TvPower } from './allowance.ts';
import { loadConfig, type HaConfig } from './config.ts';
import { openDb } from './db.ts';
import { createHaClient } from './ha.ts';

const HA: HaConfig = { url: 'http://ha.test:8123', token: 't', tvEntity: 'media_player.samung_tv', remoteEntity: 'remote.samung_tv', notifyServices: ['mobile_app_a', 'mobile_app_b'], tvHost: 'tv.test' };
const memoryStore = (): Store => {
  let v: string | undefined;
  return { load: () => v, save: (json) => void (v = json) };
};

// A fake clock and a fake Home Assistant behind the real client, so every write goes through the write guard.
// By default a launch brings Sofa Home to the front at once (the TV's REST API then says so); `home` changes that.
// `front` is what that API says: whether Sofa Home is in front.
function setup(o: { minutes?: number; at?: string; grace?: number; resetMinutes?: number; failTurnOff?: number; home?: 'answers' | 'silent' | 'fails' } = {}) {
  const clock = { t: Date.parse(o.at ?? '2026-11-09T17:00:00+01:00') };
  const calls: { path: string; body: Record<string, any> }[] = [];
  let failTurnOff = o.failTurnOff ?? 0;
  const fetchFn = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/turn_off') && failTurnOff-- > 0) return new Response('', { status: 502 });
    const launch = path === '/api/v2/applications/sofahome01.SofaHome';
    if (launch && init.method !== 'POST') return Response.json({ id: 'sofahome01.SofaHome', running: true, visible: t.front });
    if (launch && o.home === 'fails') return new Response('', { status: 500 });
    calls.push({ path, body: launch ? {} : JSON.parse(String(init.body)) });
    if (launch && (o.home ?? 'answers') === 'answers') t.front = true;
    if (path.endsWith('/turn_off')) t.front = false;
    return new Response('[]');
  }) as unknown as typeof fetch;
  const store = memoryStore();
  const make = () =>
    createAllowance({
      store,
      budgetSeconds: () => (o.minutes ?? 40) * 60,
      ha: createHaClient(HA, fetchFn),
      timeZone: 'Europe/Berlin',
      resetMinutes: o.resetMinutes ?? 240,
      graceSeconds: o.grace ?? 0,
      topUpUrl: 'https://sofa.test/kids/topup',
      now: () => clock.t,
    });
  let engine = make();
  const t = {
    clock,
    calls,
    front: false,
    get engine() {
      return engine;
    },
    turnOffs: () => calls.filter((c) => c.path === '/api/services/media_player/turn_off'),
    /** The TV writes in order: 'launch' (Sofa Home to the front) or 'off'. */
    writes: () => calls.filter((c) => c.path.startsWith('/api/v2/applications/') || c.path === '/api/services/media_player/turn_off').map((c) => (c.path.endsWith('/turn_off') ? 'off' : 'launch')),
    notifies: () => calls.filter((c) => c.path.startsWith('/api/services/notify/')),
    used: () => engine.status().usedSeconds,
    /** A Server restart: a new engine on the same store, `seconds` later. */
    restart(seconds: number) {
      clock.t += seconds * 1000;
      engine = make();
    },
    /** Home Assistant reports `power` every 5 seconds for `seconds`, and the engine acts after each, like the loop. */
    async watch(seconds: number, power: TvPower | null = 'on') {
      for (let i = 0; i < seconds / 5; i++) {
        clock.t += 5000;
        engine.observe(power);
        await engine.act();
      }
    },
  };
  return t;
}

test('the clock runs only while Kids Mode is active and the TV is on, and minutes carry across sittings', async () => {
  const k = setup();
  k.engine.observe('on');
  await k.watch(60);
  assert.equal(k.used(), 0, 'Kids Mode is not active');
  k.engine.enter();
  await k.watch(600);
  assert.equal(k.used(), 600);
  await k.watch(600, 'off');
  assert.equal(k.used(), 600, 'nothing counts while the TV is off');
  await k.watch(300); // the next sitting: counted from the first reading that says on
  assert.equal(k.used(), 895);
  assert.equal(k.engine.status().remainingSeconds, 40 * 60 - 895);
  k.engine.exit();
  await k.watch(60);
  assert.equal(k.used(), 895, 'an adult exited');
  assert.equal(k.engine.status().active, false);
});

test('TV off while counting: the clock stops at the first off reading and keeps the minutes', async () => {
  const k = setup();
  k.engine.observe('on');
  k.engine.enter();
  await k.watch(120);
  await k.watch(5, 'off');
  assert.equal(k.used(), 120, 'the time since the last on reading is not proven, so it does not count');
  assert.equal(k.engine.status().tv, 'off');
  await k.watch(3600, 'off');
  assert.equal(k.used(), 120);
  assert.equal(k.turnOffs().length, 0);
});

test("Home Assistant's false on after a remote standby is never counted", async () => {
  // Known results: off for about 10 seconds, then on while the TV is dark, then a settled off after about 3 minutes.
  const k = setup();
  k.engine.observe('on');
  k.engine.enter();
  await k.watch(60);
  await k.watch(10, 'off');
  await k.watch(180, 'on');
  assert.equal(k.engine.status().tv, 'pending');
  await k.watch(240, 'off');
  assert.equal(k.used(), 60);
  await k.watch(60, 'on'); // a real power-on long after the off counts at once
  assert.equal(k.engine.status().tv, 'on');
  assert.equal(k.used(), 115);
});

test('a real on right after an off counts in full once it outlasts a false on', async () => {
  const k = setup();
  k.engine.observe('on');
  k.engine.enter();
  await k.watch(60);
  await k.watch(30, 'off');
  await k.watch(200, 'on');
  assert.equal(k.used(), 60, 'unconfirmed for now');
  await k.watch(100, 'on');
  assert.equal(k.used(), 355, 'confirmed after 4 minutes and counted from its start');
});

test('the TV itself (its REST API says Sofa Home is in front) confirms a pending on at its first reading, the second signal', async () => {
  const k = setup();
  k.engine.observe('on');
  k.engine.enter();
  await k.watch(60);
  await k.watch(10, 'off');
  await k.watch(15, 'on');
  assert.equal(k.engine.status().tv, 'pending', 'Sofa Home is not in front');
  k.front = true; // a person powers on into Sofa Home
  await k.watch(5);
  assert.equal(k.engine.status().tv, 'on');
  await k.watch(55);
  assert.equal(k.used(), 115, 'counted from the proof');
  await k.watch(10, 'off');
  await k.watch(30, 'on');
  assert.equal(k.engine.status().tv, 'on');
  assert.equal(k.used(), 140, 'proven at the first on reading');
});

test('Home Assistant unreachable: the clock waits, and after a long gap the on must prove itself again', async () => {
  const k = setup();
  k.engine.observe('on');
  k.engine.enter();
  await k.watch(60);
  await k.watch(30, null);
  assert.equal(k.used(), 60);
  await k.watch(5, 'on');
  assert.equal(k.used(), 95, 'a gap of at most a minute with on at both ends counts');
  await k.watch(120, null);
  await k.watch(5, 'on');
  assert.equal(k.used(), 95, 'a longer gap does not');
  assert.equal(k.engine.status().tv, 'pending');
  await k.watch(240);
  assert.equal(k.used(), 335);
});

test('the daily allowance resets at 04:00 local time, and Kids Mode stays active', async () => {
  const k = setup({ at: '2026-11-10T03:50:00+01:00' });
  k.engine.observe('on');
  k.engine.enter();
  k.engine.topUp(5, 'test');
  await k.watch(595);
  assert.equal(k.used(), 595);
  assert.equal(k.engine.status().topUpSeconds, 300);
  assert.equal(k.engine.status().resetsAt, '2026-11-10T03:00:00.000Z');
  await k.watch(125); // 04:02 local
  const s = k.engine.status();
  assert.equal(s.usedSeconds, 120, 'counted from 04:00:00 exactly');
  assert.equal(s.topUpSeconds, 0);
  assert.equal(s.active, true);
  assert.equal(s.resetsAt, '2026-11-11T03:00:00.000Z');
});

test('allowance days follow the wall clock across both DST changes', () => {
  const days = allowanceDays('Europe/Berlin', 240);
  const at = (iso: string) => Date.parse(iso);
  assert.equal(days.start('2026-03-29'), at('2026-03-29T02:00:00Z')); // 04:00 CEST
  assert.equal(days.start('2026-03-29') - days.start('2026-03-28'), 23 * 3600_000);
  assert.equal(days.of(at('2026-03-29T01:59:59Z')), '2026-03-28');
  assert.equal(days.of(at('2026-03-29T02:00:00Z')), '2026-03-29');
  assert.equal(days.start('2026-10-25'), at('2026-10-25T03:00:00Z')); // 04:00 CET
  assert.equal(days.start('2026-10-25') - days.start('2026-10-24'), 25 * 3600_000);
  assert.equal(days.of(at('2026-10-25T02:59:59Z')), '2026-10-24');
  assert.equal(days.of(at('2026-10-25T03:00:00Z')), '2026-10-25');
  assert.equal(days.of(at('2026-11-09T23:30:00Z')), '2026-11-09'); // 00:30 local belongs to the evening before
});

test('the reset on the spring-forward night happens at 04:00 CEST', async () => {
  const k = setup({ at: '2026-03-29T01:55:00Z' }); // 03:55 CEST, an hour after the clocks went forward
  k.engine.observe('on');
  k.engine.enter();
  k.engine.topUp(5, 'test');
  await k.watch(600);
  assert.equal(k.used(), 300);
  assert.equal(k.engine.status().topUpSeconds, 0);
});

test('a reset time inside the repeated autumn hour resets once', () => {
  const k = setup({ at: '2026-10-25T00:00:00Z', resetMinutes: 150 }); // reset at 02:30, which happens twice that night
  const at = (iso: string) => {
    k.clock.t = Date.parse(iso);
    return k.engine.status();
  };
  at('2026-10-25T00:15:00Z');
  k.engine.topUp(5, 'test');
  assert.equal(at('2026-10-25T00:30:00Z').topUpSeconds, 0, '02:30 CEST resets');
  k.engine.topUp(5, 'test');
  assert.equal(at('2026-10-25T01:00:00Z').topUpSeconds, 300, '02:00 CET is not the evening before again');
  assert.equal(at('2026-10-25T01:30:00Z').topUpSeconds, 300, '02:30 CET does not reset again');
});

test('the 5-minute warning is sent once to both phones, and again after a Top-up', async () => {
  const k = setup({ minutes: 10 });
  k.engine.observe('on');
  k.engine.enter();
  await k.watch(295);
  assert.equal(k.notifies().length, 0);
  await k.watch(5);
  assert.deepEqual(k.notifies().map((c) => c.path), ['/api/services/notify/mobile_app_a', '/api/services/notify/mobile_app_b']);
  const { body } = k.notifies()[0];
  assert.equal(body.message, '5 minutes of Kids Mode left.');
  assert.deepEqual(body.data.actions.map((a: { action: string }) => a.action), ['SOFA_TOPUP_5', 'SOFA_TOPUP_10', 'SOFA_TOPUP_CUSTOM']);
  assert.equal(body.data.actions[2].behavior, 'textInput');
  assert.equal(body.data.url, 'https://sofa.test/kids/topup', 'a tap opens the Companion Top-up page');
  assert.equal(body.data.tag, 'sofa-kids-warning');
  await k.watch(60);
  assert.equal(k.notifies().length, 2, 'sent once');
  k.engine.topUp(10, 'test'); // 4 + 10 minutes left
  await k.watch(535);
  assert.equal(k.notifies().length, 2);
  await k.watch(5);
  assert.equal(k.notifies().length, 4, 'zero moved, so warn again five minutes before it');
});

test('a Top-up adds to today and needs whole minutes from 1 to 240', () => {
  const k = setup();
  k.engine.topUp(10, 'companion');
  assert.equal(k.engine.status().topUpSeconds, 600);
  assert.equal(k.engine.status().remainingSeconds, 50 * 60);
  for (const bad of [0, -5, 2.5, 241, NaN]) assert.throws(() => k.engine.topUp(bad, 'companion'), RangeError);
});

test('notification actions map to Top-ups, and anything else is ignored', () => {
  assert.equal(actionMinutes({ action: 'SOFA_TOPUP_5' }), 5);
  assert.equal(actionMinutes({ action: 'SOFA_TOPUP_10' }), 10);
  assert.equal(actionMinutes({ action: 'SOFA_TOPUP_CUSTOM', reply_text: ' 15 ' }), 15);
  for (const reply_text of ['0', '241', '1e2', '-5', 'ten', '', undefined]) assert.equal(actionMinutes({ action: 'SOFA_TOPUP_CUSTOM', reply_text }), null, String(reply_text));
  assert.equal(actionMinutes({ action: 'SOMETHING_ELSE' }), null);
  assert.equal(actionMinutes({}), null);
});

test('zero switches the TV off once through the write guard and leaves the Done Screen pending', async () => {
  const k = setup({ minutes: 1 });
  k.engine.observe('on');
  k.engine.enter();
  await k.watch(55);
  assert.equal(k.turnOffs().length, 0);
  await k.watch(5);
  assert.deepEqual(k.turnOffs(), [{ path: '/api/services/media_player/turn_off', body: { entity_id: 'media_player.samung_tv' } }]);
  let s = k.engine.status();
  assert.equal(s.remainingSeconds, 0);
  assert.equal(s.donePending, true);
  assert.equal(s.active, true, 'Kids Mode stays on; an adult leaves the Done Screen with the PIN');
  await k.watch(30); // Home Assistant has not caught up yet
  await k.watch(300, 'off');
  await k.watch(30); // back on: Sofa Home shows the Done Screen, no second switch-off
  assert.equal(k.turnOffs().length, 1);
  assert.equal(k.used(), 60, 'the clock stops at zero');
  k.engine.doneShown();
  assert.equal(k.engine.status().donePending, false);
  s = k.engine.topUp(5, 'test');
  assert.equal(s.remainingSeconds, 300, 'a Top-up after zero gives its full minutes');
  await k.watch(300);
  assert.equal(k.turnOffs().length, 2);
  assert.equal(k.notifies().length, 2, 'one warning (the first act, with a minute left); none after the +5 at zero');
});

test('a Top-up at zero clears the pending Done Screen', async () => {
  const k = setup({ minutes: 1 });
  k.engine.observe('on');
  k.engine.enter();
  await k.watch(60);
  assert.equal(k.engine.status().donePending, true);
  assert.equal(k.engine.topUp(10, 'notification').donePending, false);
});

/** The TV is switched on again at zero and Sofa Home (which proves the TV is on) is showing the Done Screen. */
async function backOnAtZero(k: ReturnType<typeof setup>) {
  k.engine.observe('on');
  k.engine.enter();
  await k.watch(60); // zero: the TV goes off
  await k.watch(300, 'off');
  k.engine.tvSeen();
  await k.watch(5, 'on');
  assert.equal(k.engine.status().donePending, true);
  k.engine.doneShown();
  assert.equal(k.engine.status().donePending, false);
}

test('a TV switched on again at zero goes off again a minute after the Done Screen was shown', async () => {
  const k = setup({ minutes: 1 });
  await backOnAtZero(k);
  await k.watch(55);
  assert.equal(k.turnOffs().length, 1, 'the Done Screen has a minute');
  await k.watch(5);
  assert.equal(k.turnOffs().length, 2);
  assert.equal(k.engine.status().donePending, true, 'the next power-on shows the Done Screen again');
  await k.watch(60); // still on in Home Assistant's eyes until it catches up: one switch-off, not one per reading
  assert.equal(k.turnOffs().length, 2);
});

test('a Top-up within the Done Screen minute cancels the second switch-off', async () => {
  const k = setup({ minutes: 1 });
  await backOnAtZero(k);
  await k.watch(30);
  k.engine.topUp(5, 'companion');
  await k.watch(120);
  assert.equal(k.turnOffs().length, 1);
  assert.equal(k.used(), 60 + 120);
});

test('a TV switched off by hand during the Done Screen minute shows it again next time, with a fresh minute', async () => {
  const k = setup({ minutes: 1 });
  await backOnAtZero(k);
  await k.watch(20);
  await k.watch(5, 'off');
  assert.equal(k.engine.status().donePending, true);
  await k.watch(600, 'off');
  k.engine.tvSeen();
  await k.watch(5, 'on');
  k.engine.doneShown();
  await k.watch(50);
  assert.equal(k.turnOffs().length, 1, 'the minute counts from the second Done Screen');
  await k.watch(10);
  assert.equal(k.turnOffs().length, 2);
});

test('entering Kids Mode with nothing left shows the Done Screen; leaving clears it', async () => {
  const k = setup({ minutes: 1 });
  k.engine.observe('on');
  k.engine.enter();
  await k.watch(60);
  k.engine.exit();
  assert.equal(k.engine.status().donePending, false);
  assert.equal(k.engine.enter().donePending, true, 'still zero today');
  const none = setup({ minutes: 0 });
  assert.equal(none.engine.enter().donePending, true);
  assert.equal(none.engine.topUp(5, 'companion').donePending, false);
});

test('a failed switch-off is retried on the next reading', async () => {
  const k = setup({ minutes: 1, failTurnOff: 1 });
  k.engine.observe('on');
  k.engine.enter();
  await k.watch(60);
  assert.equal(k.turnOffs().length, 0);
  assert.equal(k.engine.status().donePending, false);
  await k.watch(5);
  assert.equal(k.turnOffs().length, 1);
  assert.equal(k.engine.status().donePending, true);
});

test('a grace period delays the switch-off past zero', async () => {
  const k = setup({ minutes: 1, grace: 30 });
  k.engine.observe('on');
  k.engine.enter();
  await k.watch(85);
  assert.equal(k.turnOffs().length, 0);
  assert.equal(k.engine.status().remainingSeconds, 0);
  await k.watch(5);
  assert.equal(k.turnOffs().length, 1);
});

test('a Server restart mid-session neither loses nor double-counts time', async () => {
  const k = setup();
  k.engine.observe('on');
  k.engine.enter();
  await k.watch(300);
  k.restart(20);
  k.engine.observe('on');
  assert.equal(k.used(), 320, 'a short restart with the TV on at both ends counts');
  await k.watch(60);
  assert.equal(k.used(), 380, 'no double count');
  k.restart(300);
  k.engine.observe('on');
  assert.equal(k.used(), 380, 'five minutes down: not proven');
  assert.equal(k.engine.status().tv, 'pending');
  await k.watch(240);
  assert.equal(k.used(), 620);
  k.restart(20);
  k.engine.observe('off');
  assert.equal(k.used(), 620, 'off after the restart: the gap does not count');
  assert.equal(k.engine.status().active, true);
});

test('the change signal fires on Kids Mode changes, not on every reading', async () => {
  const k = setup({ minutes: 1 });
  k.engine.observe('on');
  let n = 0;
  k.engine.onChange(() => n++);
  k.engine.enter();
  assert.equal(n, 1);
  await k.watch(30);
  assert.equal(n, 1);
  k.engine.topUp(1, 'test');
  assert.equal(n, 2);
  await k.watch(90); // zero
  assert.equal(n, 3);
  k.engine.exit();
  assert.equal(n, 4);
});

test('the state survives in SQLite across a restart, and the budget comes from the current layout', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'sofa-allowance-')), 'sofa.db');
  let t = Date.parse('2026-11-09T17:00:00+01:00');
  const open = () => {
    const db = openDb(path);
    return { db, engine: createAllowance({ ...fromDb(db), ha: null, timeZone: 'Europe/Berlin', resetMinutes: 240, graceSeconds: 0, now: () => t }) };
  };
  let { db, engine } = open();
  assert.equal(engine.status().dailySeconds, 60 * 60, "revision 1's kidsMode.dailyMinutes");
  engine.observe('on');
  engine.enter();
  for (let i = 0; i < 12; i++) {
    t += 5000;
    engine.observe('on');
  }
  db.close(); // the Server stops
  t += 15_000;
  ({ db, engine } = open());
  engine.observe('on');
  assert.equal(engine.status().usedSeconds, 75);
  assert.equal(engine.status().active, true);
  t += 5000;
  engine.observe('on');
  assert.equal(engine.status().usedSeconds, 80);
  db.close();
});

test("Home Assistant's media player state as TV power: only off is off", () => {
  assert.equal(tvPower({ state: 'on' }), 'on');
  assert.equal(tvPower({ state: 'playing' }), 'on');
  assert.equal(tvPower({ state: 'off' }), 'off');
  for (const v of [{ state: 'unavailable' }, { state: 'unknown' }, {}, null]) assert.equal(tvPower(v), null);
});

test('allowance settings default to the household policy and refuse malformed values', () => {
  const env = { SOFA_PASSWORD_HASH: 'x' };
  assert.deepEqual(loadConfig(env).allowance, { timeZone: 'Europe/Berlin', resetMinutes: 240, graceSeconds: 0, topUpUrl: 'https://sofa.familie-farkas.de/kids/topup' });
  assert.equal(loadConfig({ ...env, SOFA_PUBLIC_URL: 'https://sofa.example.de/' }).allowance.topUpUrl, 'https://sofa.example.de/kids/topup');
  for (const bad of ['sofa.example.de', 'https://', 'ftp://x', 'https://a b']) assert.throws(() => loadConfig({ ...env, SOFA_PUBLIC_URL: bad }), /SOFA_PUBLIC_URL/);
  assert.equal(loadConfig({ ...env, SOFA_ALLOWANCE_RESET: '05:30' }).allowance.resetMinutes, 330);
  assert.equal(loadConfig({ ...env, SOFA_ALLOWANCE_GRACE_SECONDS: '30' }).allowance.graceSeconds, 30);
  for (const bad of ['4:00', '24:00', '04:60', 'four']) assert.throws(() => loadConfig({ ...env, SOFA_ALLOWANCE_RESET: bad }), /SOFA_ALLOWANCE_RESET/);
  assert.throws(() => loadConfig({ ...env, SOFA_ALLOWANCE_GRACE_SECONDS: '-1' }), /GRACE/);
  assert.equal(loadConfig({ ...env, SOFA_HA_TOKEN: 't', SOFA_HA_URL: 'http://ha', SOFA_HA_DRY_RUN: '1' }).ha?.dryRun, true);
});

async function until(ok: () => boolean): Promise<void> {
  for (const end = Date.now() + 3000; !ok(); await new Promise((r) => setTimeout(r, 5))) if (Date.now() > end) throw new Error('timed out');
}

test('the loop reads the TV state, and Top-ups arrive as notification actions over a read-only WebSocket', async () => {
  // A fake Home Assistant WebSocket API: auth, then subscribe_events, then events.
  const wss = new WebSocketServer({ port: 0 });
  await once(wss, 'listening');
  const received: Record<string, unknown>[] = [];
  wss.on('connection', (ws, req) => {
    assert.equal(req.url, '/api/websocket');
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw));
      received.push(msg);
      if (msg.type === 'auth') ws.send(JSON.stringify({ type: msg.access_token === 't' ? 'auth_ok' : 'auth_invalid' }));
      if (msg.type === 'subscribe_events') ws.send(JSON.stringify({ id: msg.id, type: 'result', success: true, result: null }));
    });
    ws.send(JSON.stringify({ type: 'auth_required' }));
  });
  const action = (data: Record<string, unknown>) => {
    for (const ws of wss.clients) ws.send(JSON.stringify({ id: 1, type: 'event', event: { event_type: 'mobile_app_notification_action', data } }));
  };
  const subscribed = () => received.filter((m) => m.type === 'subscribe_events').length;

  const engine = createAllowance({ store: memoryStore(), budgetSeconds: () => 2400, ha: null, timeZone: 'Europe/Berlin', resetMinutes: 240, graceSeconds: 0 });
  const reads: string[] = [];
  const client = { getState: async (id: string) => (reads.push(id), { state: 'on' }) };
  const stop = startAllowance(engine, { ...HA, url: `http://127.0.0.1:${(wss.address() as AddressInfo).port}` }, client, 10);
  try {
    await until(() => subscribed() === 1);
    assert.deepEqual(received, [{ type: 'auth', access_token: 't' }, { id: 1, type: 'subscribe_events', event_type: 'mobile_app_notification_action' }]);
    action({ action: 'SOFA_TOPUP_5' });
    action({ action: 'SOMEONE_ELSES_ACTION' });
    action({ action: 'SOFA_TOPUP_CUSTOM', reply_text: 'lots' });
    action({ action: 'SOFA_TOPUP_CUSTOM', reply_text: '12' });
    await until(() => engine.status().topUpSeconds === 17 * 60);
    for (const ws of wss.clients) ws.terminate(); // a drop: the subscription comes back
    await until(() => subscribed() === 2);
    action({ action: 'SOFA_TOPUP_10' });
    await until(() => engine.status().topUpSeconds === 27 * 60);
    assert.ok(received.every((m) => m.type === 'auth' || m.type === 'subscribe_events'), 'nothing but auth and subscribe_events');
    await until(() => reads.length > 2);
    assert.ok(reads.every((id) => id === HA.tvEntity));
    assert.equal(engine.status().tv, 'on');
  } finally {
    stop();
    wss.close();
  }
});

test('a Done Screen shown while the TV is still going to standby does not start the minute of the next power-on', async () => {
  const k = setup({ minutes: 1 });
  k.engine.observe('on');
  k.engine.enter();
  await k.watch(60); // zero: switched off
  await k.watch(10, 'off');
  k.engine.doneShown(); // Sofa Home, still up in the seconds before standby, shows it again after the off
  await k.watch(300, 'off'); // off for a long time
  k.engine.tvSeen();
  await k.watch(5, 'on');
  await k.watch(50);
  assert.equal(k.turnOffs().length, 1, 'the minute counts from the power-on, not from the old Done Screen');
  await k.watch(10);
  assert.equal(k.turnOffs().length, 2);
});

test('zero brings Sofa Home to the front, then switches the TV off once it has answered', async () => {
  const k = setup({ minutes: 1 });
  k.engine.observe('on');
  k.engine.enter();
  await k.watch(55);
  assert.deepEqual(k.writes(), []);
  await k.watch(5);
  assert.deepEqual(k.writes(), ['launch', 'off'], 'Sofa Home first, so Start Last App powers on into it');
  assert.equal(k.engine.status().donePending, true);
  await k.watch(30); // Home Assistant has not caught up yet: no second launch, no second switch-off
  assert.deepEqual(k.writes(), ['launch', 'off']);
});

test('zero: if Sofa Home does not answer the launch, the TV still goes off after the launch wait', async () => {
  const k = setup({ minutes: 1, home: 'silent' });
  k.engine.observe('on');
  k.engine.enter();
  await k.watch(60);
  assert.deepEqual(k.writes(), ['launch']);
  assert.equal(k.engine.status().donePending, false);
  await k.watch(5);
  assert.deepEqual(k.writes(), ['launch']);
  await k.watch(5); // LAUNCH_WAIT_MS after the launch
  assert.deepEqual(k.writes(), ['launch', 'off']);
  assert.equal(k.engine.status().donePending, true);
});

test('zero: a failed launch switches the TV off at once, and is not retried', async () => {
  const k = setup({ minutes: 1, home: 'fails' });
  k.engine.observe('on');
  k.engine.enter();
  await k.watch(60);
  assert.deepEqual(k.writes(), ['off'], 'the refused launch never reached the calls; the switch-off did, in the same reading');
  assert.equal(k.engine.status().donePending, true);
  await k.watch(30);
  assert.deepEqual(k.writes(), ['off']);
});

test('a TV powered on at zero into a provider app gets Sofa Home in front, and the re-off still comes a minute later', async () => {
  const k = setup({ minutes: 1, home: 'silent' }); // Sofa Home is not in front: it only answers when launched, see below
  k.engine.observe('on');
  k.engine.enter();
  await k.watch(70); // zero: launch, no answer, off after the wait
  assert.deepEqual(k.writes(), ['launch', 'off']);
  await k.watch(10, 'off');
  await k.watch(60); // Home Assistant's false on after standby: pending, so nothing is launched (it could wake the TV)
  assert.equal(k.engine.status().tv, 'pending');
  assert.deepEqual(k.writes(), ['launch', 'off']);
  await k.watch(300, 'off');
  await k.watch(5); // a person powers on; Start Last App resumes the provider app, Sofa Home says nothing
  assert.deepEqual(k.writes(), ['launch', 'off', 'launch'], 'Sofa Home brought to the front at the first on reading');
  await k.watch(50);
  assert.deepEqual(k.writes(), ['launch', 'off', 'launch'], 'once per power-on');
  await k.watch(10);
  assert.deepEqual(k.writes(), ['launch', 'off', 'launch', 'off'], 'the re-off a minute after the on, without another launch wait');
  assert.equal(k.engine.status().donePending, true);
});

test('a TV powered on at zero into Sofa Home is not launched again; the re-off brings it to the front first', async () => {
  const k = setup({ minutes: 1 });
  await backOnAtZero(k); // Sofa Home spoke before the on reading
  assert.deepEqual(k.writes(), ['launch', 'off']);
  await k.watch(60);
  assert.deepEqual(k.writes(), ['launch', 'off', 'launch', 'off']);
});

test('a failed launch at power-on leaves the re-off a minute later as the backstop', async () => {
  const k = setup({ minutes: 1, home: 'fails' });
  k.engine.observe('on');
  k.engine.enter();
  await k.watch(60);
  await k.watch(300, 'off');
  await k.watch(60); // the on reading, then 55 seconds
  assert.deepEqual(k.writes(), ['off']);
  await k.watch(5);
  assert.deepEqual(k.writes(), ['off', 'off']);
});

test('after a zero, the false on stays pending with no launch and no re-off; a real power-on into Sofa Home is caught at once', async () => {
  const k = setup({ minutes: 1 });
  k.engine.observe('on');
  k.engine.enter();
  await k.watch(60); // zero: launch, off
  await k.watch(50, 'off');
  await k.watch(150); // Home Assistant's false on, 50 s after the off, for about 2.5 minutes; the TV says Sofa Home is not in front
  assert.equal(k.engine.status().tv, 'pending');
  await k.watch(100, 'off');
  assert.deepEqual(k.writes(), ['launch', 'off'], 'no launch and no re-off at a dark TV');
  await k.watch(30); // a person powers on inside the hold, into Sofa Home (the last app)
  assert.equal(k.engine.status().tv, 'pending');
  k.front = true; // Sofa Home comes to the front
  await k.watch(5);
  assert.equal(k.engine.status().tv, 'on');
  assert.deepEqual(k.writes(), ['launch', 'off'], 'Sofa Home is in front: not launched again');
  await k.watch(55);
  assert.deepEqual(k.writes(), ['launch', 'off']);
  await k.watch(5);
  assert.deepEqual(k.writes(), ['launch', 'off', 'launch', 'off'], 'the re-off a minute after the proof, at once since Sofa Home is in front');
});

test('a power-on at zero into a provider app inside the hold stays pending, then is launched over and switched off after the hold', async () => {
  const k = setup({ minutes: 1, home: 'silent' });
  k.engine.observe('on');
  k.engine.enter();
  await k.watch(70); // zero: launch, no answer, off after the wait
  await k.watch(60, 'off');
  await k.watch(240); // a person powers on into KiKA (Start Last App): Home Assistant's on looks like its false on
  assert.equal(k.engine.status().tv, 'pending');
  assert.deepEqual(k.writes(), ['launch', 'off']);
  await k.watch(5); // outlasted the hold, so it is real
  assert.equal(k.engine.status().tv, 'on');
  assert.deepEqual(k.writes(), ['launch', 'off', 'launch']);
  await k.watch(55);
  assert.deepEqual(k.writes(), ['launch', 'off', 'launch']);
  await k.watch(5);
  assert.deepEqual(k.writes(), ['launch', 'off', 'launch', 'off']);
});
