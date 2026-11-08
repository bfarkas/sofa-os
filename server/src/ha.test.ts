import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HaConfig } from './config.ts';
import { checkWrite, createHaClient, WriteRefused, type ServiceCall } from './ha.ts';

const ha: HaConfig = {
  url: 'http://ha.test:8123',
  token: 'test-token',
  tvEntity: 'media_player.samung_tv',
  remoteEntity: 'remote.samung_tv',
  notifyServices: ['mobile_app_hidekis_iphone', 'mobile_app_ioannas_iphone'],
};

function fakeHa() {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response('[]', { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, client: createHaClient(ha, fetchFn) };
}

test('allowed: turn this TV off', async () => {
  const { calls, client } = fakeHa();
  await client.turnOffTv();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://ha.test:8123/api/services/media_player/turn_off');
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { entity_id: 'media_player.samung_tv' });
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer test-token');
});

test("allowed: notify the adults' phones", async () => {
  const { calls, client } = fakeHa();
  await client.notifyAdults('5 minutes left', { title: 'Kids Mode', data: { actions: [{ action: 'SOFA_TOPUP_5', title: '+5 min' }] } });
  assert.deepEqual(calls.map((c) => c.url), [
    'http://ha.test:8123/api/services/notify/mobile_app_hidekis_iphone',
    'http://ha.test:8123/api/services/notify/mobile_app_ioannas_iphone',
  ]);
});

test('allowed: forward a Phone Remote key to this TV', async () => {
  const { calls, client } = fakeHa();
  await client.sendKey('KEY_ENTER');
  assert.equal(calls[0].url, 'http://ha.test:8123/api/services/remote/send_command');
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { entity_id: 'remote.samung_tv', command: 'KEY_ENTER' });
});

const refused: [string, ServiceCall][] = [
  ['another domain', { domain: 'light', service: 'turn_on', data: { entity_id: 'light.living_room' } }],
  ['a Home Assistant restart', { domain: 'homeassistant', service: 'restart', data: {} }],
  ['turning on the TV', { domain: 'media_player', service: 'turn_on', data: { entity_id: 'media_player.samung_tv' } }],
  ['turning off another player', { domain: 'media_player', service: 'turn_off', data: { entity_id: 'media_player.kitchen' } }],
  ['turn-off with an entity list', { domain: 'media_player', service: 'turn_off', data: { entity_id: ['media_player.samung_tv', 'media_player.kitchen'] } }],
  ['turn-off widened by area', { domain: 'media_player', service: 'turn_off', data: { entity_id: 'media_player.samung_tv', area_id: 'living_room' } }],
  ['turn-off with no target', { domain: 'media_player', service: 'turn_off', data: {} }],
  ['notify to an unknown phone', { domain: 'notify', service: 'mobile_app_guest', data: { message: 'hi' } }],
  ['notify to every device', { domain: 'notify', service: 'notify', data: { message: 'hi' } }],
  ['notify without a message', { domain: 'notify', service: 'mobile_app_hidekis_iphone', data: { title: 'x' } }],
  ['a key to another remote', { domain: 'remote', service: 'send_command', data: { entity_id: 'remote.bedroom', command: 'KEY_ENTER' } }],
  ['a non-key command', { domain: 'remote', service: 'send_command', data: { entity_id: 'remote.samung_tv', command: 'power_on' } }],
  ['a key held down', { domain: 'remote', service: 'send_command', data: { entity_id: 'remote.samung_tv', command: 'KEY_POWER', hold_secs: 5 } }],
  ['remote.turn_off', { domain: 'remote', service: 'turn_off', data: { entity_id: 'remote.samung_tv' } }],
];

for (const [label, call] of refused) {
  test(`refused: ${label}`, async () => {
    assert.throws(() => checkWrite(call, ha), WriteRefused);
    const { calls, client } = fakeHa();
    await assert.rejects(client.callService(call), WriteRefused);
    assert.equal(calls.length, 0, 'nothing reaches Home Assistant');
  });
}

test('getState rejects anything but an entity id', () => {
  const { client } = fakeHa();
  assert.throws(() => client.getState('../config'), /not an entity id/);
});
