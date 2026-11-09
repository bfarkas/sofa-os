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

function fakeHa(config = ha) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response('[]', { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, client: createHaClient(config, fetchFn) };
}

test('allowed: turn this TV off', async () => {
  const { calls, client } = fakeHa();
  await client.turnOffTv();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://ha.test:8123/api/services/media_player/turn_off');
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { entity_id: 'media_player.samung_tv' });
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer test-token');
});

test('allowed: bring Sofa Home to the front on this TV (before the switch-off at zero)', async () => {
  const { calls, client } = fakeHa();
  await client.launchSofaHome();
  assert.equal(calls[0].url, 'http://ha.test:8123/api/services/media_player/play_media');
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { entity_id: 'media_player.samung_tv', media_content_type: 'app', media_content_id: 'sofahome01.SofaHome' });
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
  ['power', { domain: 'remote', service: 'send_command', data: { entity_id: 'remote.samung_tv', command: 'KEY_POWER' } }],
  ['volume', { domain: 'remote', service: 'send_command', data: { entity_id: 'remote.samung_tv', command: 'KEY_VOLUP' } }],
  ['a list with one key outside the Phone Remote set', { domain: 'remote', service: 'send_command', data: { entity_id: 'remote.samung_tv', command: ['KEY_UP', 'KEY_MUTE'] } }],
  ['a key held down', { domain: 'remote', service: 'send_command', data: { entity_id: 'remote.samung_tv', command: 'KEY_POWER', hold_secs: 5 } }],
  ['remote.turn_off', { domain: 'remote', service: 'turn_off', data: { entity_id: 'remote.samung_tv' } }],
  ['turn-off of every player', { domain: 'media_player', service: 'turn_off', data: { entity_id: 'all' } }],
  ['pausing the TV', { domain: 'media_player', service: 'media_pause', data: { entity_id: 'media_player.samung_tv' } }],
  ['notify with an added target', { domain: 'notify', service: 'mobile_app_hidekis_iphone', data: { message: 'hi', target: ['mobile_app_guest'] } }],
  ['launching another app', { domain: 'media_player', service: 'play_media', data: { entity_id: 'media_player.samung_tv', media_content_type: 'app', media_content_id: '111299001912' } }],
  ['playing a URL on the TV', { domain: 'media_player', service: 'play_media', data: { entity_id: 'media_player.samung_tv', media_content_type: 'url', media_content_id: 'sofahome01.SofaHome' } }],
  ['launching Sofa Home on another player', { domain: 'media_player', service: 'play_media', data: { entity_id: 'media_player.kitchen', media_content_type: 'app', media_content_id: 'sofahome01.SofaHome' } }],
  ['a launch with extra data', { domain: 'media_player', service: 'play_media', data: { entity_id: 'media_player.samung_tv', media_content_type: 'app', media_content_id: 'sofahome01.SofaHome', enqueue: 'play' } }],
  ['selecting a source', { domain: 'media_player', service: 'select_source', data: { entity_id: 'media_player.samung_tv', source: 'KiKA' } }],
  ['a persistent notification', { domain: 'persistent_notification', service: 'create', data: { message: 'hi' } }],
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

test('dry run: allowed writes pass the guard and are logged, not sent; everything else is still refused', async () => {
  const { calls, client } = fakeHa({ ...ha, dryRun: true });
  await client.turnOffTv();
  await client.launchSofaHome();
  await client.notifyAdults('5 minutes left');
  await client.sendKey('KEY_ENTER');
  assert.equal(calls.length, 0);
  for (const [, call] of refused) await assert.rejects(client.callService(call), WriteRefused);
});
