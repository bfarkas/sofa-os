import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isLaunchable, mergeApps, parseInstalledApps } from './apps.ts';

test('curated apps come first in their order, the rest A to Z, without duplicate ids', () => {
  const curated = [{ id: 'zzzzzzzzzz.Last', name: 'Zeta' }, { id: 'aaaaaaaaaa.First', name: 'Alpha' }, { id: 'zzzzzzzzzz.Last', name: 'Dup' }];
  const installed = [{ id: 'bbbbbbbbbb.Bee', name: 'bee' }, { id: 'aaaaaaaaaa.First', name: 'Alpha' }, { id: 'cccccccccc.Cee', name: 'Cee' }, { id: 'bbbbbbbbbb.Bee', name: 'Bee again' }, { id: 'aaaaaaaaa0.Ay', name: 'Ay' }];
  assert.deepEqual(mergeApps(curated, installed, 'self.App').map((a) => a.id), ['zzzzzzzzzz.Last', 'aaaaaaaaaa.First', 'aaaaaaaaa0.Ay', 'bbbbbbbbbb.Bee', 'cccccccccc.Cee']);
});

test('hidden apps and Sofa Home itself are dropped, a curated app stays even if hidden or not launchable', () => {
  const installed = [{ id: 'syshidden0.Hidden', name: 'Hidden', show: false }, { id: 'sofahome01.SofaHome', name: 'Sofa Home' }, { id: 'org.tizen.cur', name: 'Cur', show: false }, { id: 'okokokokok.App', name: 'Ok', show: true }];
  assert.deepEqual(mergeApps([{ id: 'org.tizen.cur', name: 'Mine' }], installed, 'sofahome01.SofaHome'), [{ id: 'org.tizen.cur', name: 'Mine' }, { id: 'okokokokok.App', name: 'Ok' }]);
});

test('only store apps and the known Samsung apps are launchable; stubs, services and nameless apps are not', () => {
  const ok = (id: string, name: string) => isLaunchable({ id, name }, 'sofahome01.SofaHome');
  assert.ok(ok('RN1MCdNq8t.Netflix', 'Netflix'));
  assert.ok(ok('org.tizen.browser', 'Internet'));
  assert.ok(ok('com.samsung.tv.aria-video', 'Apple TV'));
  assert.ok(!ok('org.tizen.hdmicec', 'HDMI-CEC'));
  assert.ok(!ok('com.samsung.tv.aria-dummy', 'Apple TV'));
  assert.ok(!ok('kIciSQlYEM.service', 'plex preview service'));
  assert.ok(!ok('kIciSQlYEM.worker', 'Plex Worker'));
  assert.ok(!ok('DJ8grEH6Hu.arte', ''));
  assert.ok(!ok('sofahome01.SofaHome', 'Sofa Home'));
});

test('same-named apps show once: the curated one, else the newest install', () => {
  const installed = [
    { id: 'RN1MCdNq8t.Netflix', name: 'Netflix' },
    { id: 'DJ8grEH6Hu.arte', name: 'ARTE', installDate: 1 },
    { id: 'XXXXXXXXXX.arte', name: 'arte ', installDate: 2 },
    { id: 'MCmYXNxgcu.DisneyPlus', name: 'Disney+' },
  ];
  assert.deepEqual(mergeApps([{ id: 'org.tizen.netflix-app', name: 'Netflix' }], installed, 's').map((a) => a.id), ['org.tizen.netflix-app', 'XXXXXXXXXX.arte', 'MCmYXNxgcu.DisneyPlus']);
});

test('parseInstalledApps accepts a list of id and name and refuses anything else', () => {
  assert.deepEqual(parseInstalledApps([{ id: ' a.B ', name: 'A', extra: 1 }, { id: 'c.D', name: '' }]), [{ id: 'a.B', name: 'A' }, { id: 'c.D', name: 'c.D' }]);
  for (const bad of [null, {}, 'x', [null], [{ id: 1, name: 'x' }], [{ id: '', name: 'x' }], [{ id: 'a'.repeat(129), name: 'x' }], [{ id: 'a', name: 'n'.repeat(81) }], new Array(501).fill({ id: 'a', name: 'b' })]) assert.equal(parseInstalledApps(bad), null);
});
