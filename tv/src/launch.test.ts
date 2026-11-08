import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tizenLauncher, type TizenApplicationApi } from './launch.ts';

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
