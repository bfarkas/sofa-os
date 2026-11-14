import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeApps, parseInstalledApps } from './apps.ts';

test('curated apps come first in their order, the rest A to Z, without duplicates', () => {
  const curated = [{ id: 'z.Last', name: 'Zeta' }, { id: 'a.First', name: 'Alpha' }, { id: 'z.Last', name: 'Dup' }];
  const installed = [{ id: 'b.Bee', name: 'bee' }, { id: 'a.First', name: 'Alpha' }, { id: 'c.Cee', name: 'Cee' }, { id: 'b.Bee', name: 'Bee again' }, { id: 'a0.Ay', name: 'Ay' }];
  assert.deepEqual(mergeApps(curated, installed, 'self.App').map((a) => a.id), ['z.Last', 'a.First', 'a0.Ay', 'b.Bee', 'c.Cee']);
});

test('hidden apps and Sofa Home itself are dropped, a curated app stays even if hidden', () => {
  const installed = [{ id: 'sys.Hidden', name: 'Hidden', show: false }, { id: 'self.App', name: 'Sofa Home' }, { id: 'cur.App', name: 'Cur', show: false }, { id: 'ok.App', name: 'Ok', show: true }];
  assert.deepEqual(mergeApps([{ id: 'cur.App', name: 'Mine' }], installed, 'self.App'), [{ id: 'cur.App', name: 'Mine' }, { id: 'ok.App', name: 'Ok' }]);
});

test('an installed app without a name is shown by its id', () => {
  assert.deepEqual(mergeApps([], [{ id: 'x.App', name: '' }], 's'), [{ id: 'x.App', name: 'x.App' }]);
});

test('parseInstalledApps accepts a list of id and name and refuses anything else', () => {
  assert.deepEqual(parseInstalledApps([{ id: ' a.B ', name: 'A', extra: 1 }, { id: 'c.D', name: '' }]), [{ id: 'a.B', name: 'A' }, { id: 'c.D', name: 'c.D' }]);
  for (const bad of [null, {}, 'x', [null], [{ id: 1, name: 'x' }], [{ id: '', name: 'x' }], [{ id: 'a'.repeat(129), name: 'x' }], [{ id: 'a', name: 'n'.repeat(81) }], new Array(501).fill({ id: 'a', name: 'b' })]) assert.equal(parseInstalledApps(bad), null);
});
