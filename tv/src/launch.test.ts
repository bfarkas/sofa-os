import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installedApps, startInput, switchSource, tizenLauncher, type TizenApplicationApi, type TizenSourceApi } from './launch.ts';

const fake = (behave: (id: string, ok: () => void, fail: (e: { message?: string }) => void) => void) => {
  const launched: string[] = [];
  const api: TizenApplicationApi = { application: { launch: (id, ok, fail) => (launched.push(id), behave(id, ok, fail)) } };
  return { api, launched };
};

test('launch resolves once the TV accepts it', async () => {
  const { api, launched } = fake((_, ok) => ok());
  await tizenLauncher(api).launch('SrAoJxGQUf.ARD');
  assert.deepEqual(launched, ['SrAoJxGQUf.ARD']);
});

test('the Netflix store ID is launched as org.tizen.netflix-app', async () => {
  const { api, launched } = fake((_, ok) => ok());
  await tizenLauncher(api).launch('RN1MCdNq8t.Netflix');
  await tizenLauncher(api).launch('org.tizen.netflix-app');
  assert.deepEqual(launched, ['org.tizen.netflix-app', 'org.tizen.netflix-app']);
});

test('a launch the TV refuses rejects with its message', async () => {
  const { api } = fake((_, __, fail) => fail({ message: 'Application not found' }));
  await assert.rejects(tizenLauncher(api).launch('nope.App'), /Application not found/);
});

test('a throwing API rejects instead of throwing', async () => {
  const { api } = fake(() => {
    throw new Error('SecurityError');
  });
  await assert.rejects(tizenLauncher(api).launch('x.App'), /SecurityError/);
});

test('without the Tizen API (a desktop browser) launching reports unavailable', async () => {
  await assert.rejects(tizenLauncher(undefined).launch('org.tizen.netflix-app'), /Not running on a TV/);
});

test('installedApps lists the TV\'s apps with Sofa Home\'s own id', async () => {
  const api = { application: { getAppsInfo: (ok: (a: { id: string; name?: string; show?: boolean; installDate?: Date }[]) => void) => ok([{ id: 'a.B', name: 'Bee', show: false, installDate: new Date(5) }, { id: 'c.D' }]), getCurrentApplication: () => ({ appInfo: { id: 'me.Home' } }) } };
  assert.deepEqual(await installedApps(api), { apps: [{ id: 'a.B', name: 'Bee', show: false, installDate: 5 }, { id: 'c.D', name: '', show: undefined, installDate: 0 }], self: 'me.Home' });
  await assert.rejects(installedApps(undefined), /Not running on a TV/);
});

test('an input tile runs the script, then switches the input, then leaves; a failing step stops the rest', async () => {
  const order: string[] = [];
  const steps = (failAt?: string) => ({
    runScript: () => (order.push('script'), failAt === 'script' ? Promise.reject(new Error('HTTP 502')) : Promise.resolve()),
    switchSource: () => (order.push('input'), failAt === 'input' ? Promise.reject(new Error('HDMI4 is not connected')) : Promise.resolve()),
    leave: () => void order.push('leave'),
  });
  await startInput(steps());
  assert.deepEqual(order.splice(0), ['script', 'input', 'leave']);
  await assert.rejects(startInput(steps('script')), /502/);
  assert.deepEqual(order.splice(0), ['script']);
  await assert.rejects(startInput(steps('input')), /not connected/);
  assert.deepEqual(order.splice(0), ['script', 'input']);
});

test('switchSource picks the connected source by type and number and sets the main window', async () => {
  const set: unknown[] = [];
  const api: TizenSourceApi = {
    systeminfo: { getPropertyValue: (_p, ok) => ok({ connected: [{ type: 'TV', number: 1 }, { type: 'HDMI', number: 4 }] }) },
    tvwindow: { setSource: (src, ok, _fail, w) => (set.push([src, w]), ok()) },
  };
  await switchSource(api, 'HDMI4');
  assert.deepEqual(set, [[{ type: 'HDMI', number: 4 }, 'MAIN']]);
  await assert.rejects(switchSource(api, 'HDMI2'), /HDMI2 is not connected/);
  await assert.rejects(switchSource(undefined, 'HDMI4'), /Not running on a TV/);
});
