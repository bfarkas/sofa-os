import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mediaPath } from '@sofa/shared';
import { albumOfCard, authedGet, backgroundImage, fetchImages, parseAlbums, startAlbums } from './photos.ts';
import type { CardView } from './widgets.ts';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const asset = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const ok = (image: string): CardView => ({ state: 'ok', title: 'Photos', card: { template: 'photo', image }, detail: { template: 'photo', image }, stale: false, updated: '' });

test('a photo card knows its album; other cards and other paths do not', () => {
  assert.equal(albumOfCard(ok(mediaPath('household', A, asset(1)))), A);
  assert.equal(albumOfCard(ok(mediaPath('kids', A, asset(1)))), null);
  assert.equal(albumOfCard(ok('/img/kids-tile-forest.jpg')), null);
  assert.equal(albumOfCard({ state: 'loading', title: 'x' }), null);
  assert.equal(albumOfCard({ state: 'ok', title: 'x', card: { template: 'value', value: '1' }, detail: { template: 'value', value: '1' }, stale: false, updated: '' }), null);
});

test('a background image is "<album>/<asset>" and becomes a household media path', () => {
  assert.equal(backgroundImage(A + '/' + asset(1)), mediaPath('household', A, asset(1)));
  for (const bad of ['', A, A + '/' + asset(1) + '/x', 'x/y', '../' + asset(1), A + '/' + asset(1) + '.jpg']) assert.equal(backgroundImage(bad), null);
});

test('only the asked profile and album are loaded, whatever the Server sends', async () => {
  const get = async () => ({ name: 'Kids', images: [mediaPath('kids', A, asset(1)), mediaPath('household', A, asset(2)), mediaPath('kids', B, asset(3)), 'https://evil.test/x.jpg', 7, mediaPath('kids', A, asset(4))] });
  assert.deepEqual(await fetchImages(get, A, 'kids'), { name: 'Kids', images: [mediaPath('kids', A, asset(1)), mediaPath('kids', A, asset(4))] });
  await assert.rejects(fetchImages(async () => ({}), A, 'kids'), /not an album/);
});

test('album answers are checked and the list survives a failed fetch', async () => {
  assert.equal(parseAlbums(null), null);
  assert.deepEqual(parseAlbums({ albums: [{ id: A, name: 'Kids', count: 3 }, { id: 'x', name: 'bad', count: 1 }, { id: B, name: 5, count: 1 }] }), [{ id: A, name: 'Kids', count: 3 }]);

  let n = 0;
  const seen: string[][] = [];
  const s = startAlbums({
    fetchAlbums: async () => {
      if (n++) throw new Error('offline');
      return { albums: [{ id: A, name: 'Kids', count: 3 }] };
    },
    onChange: (l) => seen.push(l.map((a) => a.name)),
    intervalMs: 3600_000,
  });
  await new Promise((r) => setTimeout(r, 10));
  s.refresh();
  await new Promise((r) => setTimeout(r, 10));
  s.stop();
  assert.deepEqual(seen, [['Kids']]); // the failed second fetch changed nothing
});

test('requests carry the device token and fail on any other status', async () => {
  const calls: { url: string; auth: string }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, auth: (init.headers as Record<string, string>).Authorization });
    return url.endsWith('/bad') ? new Response('{}', { status: 403 }) : new Response('{"a":1}');
  }) as unknown as typeof fetch;
  const get = authedGet(f, 'https://sofa.test', 'tok');
  assert.deepEqual(await get('/api/x'), { a: 1 });
  await assert.rejects(get('/bad'), /403/);
  assert.deepEqual(calls[0], { url: 'https://sofa.test/api/x', auth: 'Bearer tok' });
});
