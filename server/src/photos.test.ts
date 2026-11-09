import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { mediaPath, parseMediaPath, readConfig, validateDisplay, validateLayout, type Layout, type PhotoAlbumsResponse, type PhotoImagesResponse, type WidgetsResponse } from '@sofa/shared';
import { photoAdapter } from './adapters/photo.ts';
import { createAllowance, fromDb } from './allowance.ts';
import { hashSecret } from './auth.ts';
import { loadConfig, type Config } from './config.ts';
import { openDb } from './db.ts';
import { createImmich, type ImmichApi } from './immich.ts';
import { createPhotos, MAX_FILE_BYTES, PhotoError } from './photos.ts';
import { startServer } from './server.ts';
import { Unavailable } from './widgets.ts';

const A = '11111111-1111-4111-8111-111111111111'; // approved for kids
const B = '22222222-2222-4222-8222-222222222222'; // household only
const C = '33333333-3333-4333-8333-333333333333'; // not used anywhere
const asset = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const jpeg = (size = 2000) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size, 7)]);

const layoutWith = (more: Partial<Layout> = {}): Layout => ({
  schema: 1,
  apps: [],
  widgets: [{ id: 'w1', type: 'photo', size: 'medium', config: { album: B }, profiles: ['household', 'kids'], freshness: 'hourly' }],
  rows: [],
  background: { kind: 'color', color: '#f6f1e7' },
  kidsMode: { apps: [], dailyMinutes: 40, albums: [A] },
  ...more,
});

function fakeImmich(over: Partial<ImmichApi> = {}) {
  const calls = { album: 0, preview: 0 };
  const albums: Record<string, { name: string; assetIds: string[] }> = {
    [A]: { name: 'Kids', assetIds: [asset(1), asset(2)] },
    [B]: { name: 'Family', assetIds: [asset(3), asset(4), asset(5)] },
    [C]: { name: 'Private', assetIds: [asset(6)] },
  };
  const api: ImmichApi = {
    albums: async () => Object.entries(albums).map(([id, a]) => ({ id, name: a.name, count: a.assetIds.length })),
    album: async (id) => {
      calls.album++;
      if (!albums[id]) throw new Error('Immich answered 404');
      return albums[id];
    },
    preview: async () => {
      calls.preview++;
      return jpeg();
    },
    ...over,
  };
  return { api, calls };
}

const make = (over: Partial<ImmichApi> = {}, layout: Layout = layoutWith(), extra: { cacheBytes?: number; dir?: string; now?: () => number } = {}) => {
  const dir = extra.dir ?? mkdtempSync(join(tmpdir(), 'sofa-photos-'));
  const f = fakeImmich(over);
  const photos = createPhotos({ immich: f.api, mediaDir: dir, layout: () => layout, random: () => 0.5, ...extra });
  return { photos, dir, ...f };
};

test('media paths round trip and refuse anything else', () => {
  const p = mediaPath('kids', A.toUpperCase(), asset(1));
  assert.equal(p, `/api/media/kids/${A}/${asset(1)}.jpg`);
  assert.deepEqual(parseMediaPath(p), { profile: 'kids', album: A, asset: asset(1) });
  for (const bad of ['/api/media/guest/' + A + '/' + asset(1) + '.jpg', '/api/media/kids/../x.jpg', 'https://evil.test/a.jpg', p + '?x=1', `/api/media/kids/${A}/${asset(1)}.png`]) assert.equal(parseMediaPath(bad), null);
  assert.deepEqual(validateDisplay({ template: 'photo', image: p }), []);
});

test('kids see only the approved albums, the household the albums the layout uses', async () => {
  const { photos } = make();
  assert.deepEqual((await photos.albumsFor('kids')).map((a) => a.name), ['Kids']);
  assert.deepEqual((await photos.albumsFor('household')).map((a) => a.name).sort(), ['Family', 'Kids']);
  assert.equal(photos.allowed('kids', B), false);
  assert.equal(photos.allowed('household', C), false);
  assert.equal(photos.allowed('kids', 'not-an-id'), false);
  assert.deepEqual((await photos.allAlbums()).map((a) => [a.name, a.kids]), [['Kids', true], ['Family', false], ['Private', false]]);

  const kids = await photos.images('kids', A);
  assert.equal(kids.images.length, 2);
  assert.ok(kids.images.every((p) => parseMediaPath(p)?.profile === 'kids'));
  await assert.rejects(photos.images('kids', B), (e) => e instanceof PhotoError && e.status === 403);
  await assert.rejects(photos.images('household', C), (e) => e instanceof PhotoError && e.status === 403);
  await assert.rejects(photos.file('kids', B, asset(3)), (e) => e instanceof PhotoError && e.status === 403);
  await assert.rejects(photos.file('kids', A, asset(3)), (e) => e instanceof PhotoError && e.status === 404); // an asset of another album
  await assert.rejects(photos.file('kids', A, 'x'), (e) => e instanceof PhotoError && e.status === 404);
});

test('the background and the kids list count as used albums', async () => {
  const { photos } = make({}, layoutWith({ widgets: [], background: { kind: 'image', image: `${C}/${asset(6)}` } }));
  assert.equal(photos.allowed('household', C), true);
  assert.equal(photos.allowed('household', B), false);
  const slide = make({}, layoutWith({ widgets: [], background: { kind: 'slideshow', album: B } }));
  assert.equal(slide.photos.allowed('household', B), true);
});

test('a photo is fetched from Immich once, whoever asks and however many ask at once', async () => {
  const { photos, calls, dir } = make();
  const files = await Promise.all([photos.file('kids', A, asset(1)), photos.file('kids', A, asset(1)), photos.file('household', A, asset(1))]);
  assert.equal(new Set(files).size, 1);
  assert.equal(calls.preview, 1);
  await photos.file('kids', A, asset(1));
  assert.equal(calls.preview, 1);
  assert.equal(calls.album, 1); // the listing is kept for a while too
  assert.deepEqual(readdirSync(join(dir, 'photos')), [asset(1) + '.jpg']);
});

test('a preview that is not a JPEG, or is over the budget, is refused and not cached', async () => {
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(100), Buffer.from('WEBP')]);
  const a = make({ preview: async () => webp });
  await assert.rejects(a.photos.file('kids', A, asset(1)), (e) => e instanceof PhotoError && e.status === 502 && /JPEG/.test(e.message));
  const b = make({ preview: async () => jpeg(MAX_FILE_BYTES) });
  await assert.rejects(b.photos.file('kids', A, asset(1)), (e) => e instanceof PhotoError && /budget/.test(e.message));
  assert.equal(await b.photos.cacheSize(), 0);
});

test('the cache stays under its size by dropping the least recently used photos', async () => {
  const { photos, dir } = make({}, layoutWith(), { cacheBytes: 5000 });
  await photos.file('household', B, asset(3)); // each file is about 2 KB
  await new Promise((r) => setTimeout(r, 15));
  await photos.file('household', B, asset(4));
  await new Promise((r) => setTimeout(r, 15));
  await photos.file('household', B, asset(3)); // touched again: asset 4 is now the oldest
  await new Promise((r) => setTimeout(r, 15));
  await photos.file('household', B, asset(5));
  await new Promise((r) => setTimeout(r, 100)); // the trim runs after the write
  assert.deepEqual(readdirSync(join(dir, 'photos')).sort(), [asset(3) + '.jpg', asset(5) + '.jpg']);
  assert.ok((await photos.cacheSize()) <= 5000);
});

test('while Immich is away the last listing and the cached photos still serve, even after a restart', async () => {
  const first = make();
  await first.photos.file('kids', A, asset(1));
  const down = async () => {
    throw new Error('connect ECONNREFUSED');
  };
  const after = make({ album: down, albums: down, preview: down }, layoutWith(), { dir: first.dir });
  assert.ok((await after.photos.file('kids', A, asset(1))).endsWith(asset(1) + '.jpg'));
  assert.equal((await after.photos.images('kids', A)).name, 'Kids');
  await assert.rejects(after.photos.file('kids', A, asset(2)), (e) => e instanceof PhotoError && e.status === 502); // not cached, cannot fetch
  await assert.rejects(after.photos.albumsFor('kids'), (e) => e instanceof PhotoError && e.status === 502);
});

test('the photo widget picks a cached photo, hides itself from kids unless approved, and fails as unavailable', async () => {
  const { photos } = make({}, layoutWith({ widgets: [{ id: 'w1', type: 'photo', size: 'medium', config: { album: B }, profiles: ['household', 'kids'], freshness: 'hourly' }, { id: 'w2', type: 'photo', size: 'small', config: { album: A }, profiles: ['kids'], freshness: 'hourly' }] }));
  const a = photoAdapter({ photos });
  const ctx = { now: 0, signal: new AbortController().signal };
  assert.deepEqual(readConfig(a.fields, { album: B, junk: 1 }), { config: { album: B }, errors: [] });
  assert.deepEqual(readConfig(a.fields, { album: 'x' }).errors, ['album: must be an Immich album id']);

  const family = await a.read({ album: B }, ctx);
  assert.ok('card' in family && family.card.template === 'photo');
  assert.equal(family.title, 'Family');
  assert.equal(parseMediaPath((family.card as { image: string }).image)?.profile, 'household');
  assert.deepEqual(a.forKids!(family), { empty: 'Nothing to show' }); // B is not approved for kids, whatever the widget's profiles say

  const kidsAlbum = await a.read({ album: A, title: 'Ponies' }, ctx);
  assert.equal(kidsAlbum.title, 'Ponies');
  const forKids = a.forKids!(kidsAlbum);
  assert.ok('card' in forKids && parseMediaPath((forKids.card as { image: string }).image)?.profile === 'kids');

  await assert.rejects(async () => a.read({ album: C }, ctx), (e) => e instanceof Unavailable); // not in the layout
  await assert.rejects(async () => photoAdapter({ photos: createPhotos({ immich: null, mediaDir: tmpdir(), layout: () => layoutWith() }) }).read({ album: B }, ctx), /Immich is not set up/);
  const empty = make({ album: async () => ({ name: 'Empty', assetIds: [] }) });
  assert.deepEqual(await photoAdapter({ photos: empty.photos }).read({ album: B }, ctx), { empty: 'This album has no photos' });
});

test('the Immich client sends its key only as a header, validates ids and reads the v3 shapes', async () => {
  const seen: { url: string; key: string | null; method: string; body: string }[] = [];
  const reply = (body: unknown, type = 'application/json') => new Response(body as BodyInit, { headers: { 'content-type': type } });
  const client = createImmich({ url: 'http://immich.test', apiKey: 'sekrit' }, (async (url: string, init: RequestInit) => {
    const h = new Headers(init.headers);
    seen.push({ url, key: h.get('x-api-key'), method: init.method ?? 'GET', body: String(init.body ?? '') });
    if (url.endsWith('/api/albums')) return reply(JSON.stringify([{ id: A, albumName: 'Kids', assetCount: 2 }, { id: 'bad', albumName: 'x' }]));
    if (url.endsWith('/api/albums/' + A)) return reply(JSON.stringify({ id: A, albumName: 'Kids' }));
    if (url.endsWith('/api/search/metadata')) return reply(JSON.stringify({ assets: { items: [{ id: asset(1) }, { id: 'nope' }], total: 2 } }));
    if (url.includes('/thumbnail')) return reply(jpeg(10), 'image/jpeg');
    return new Response('no', { status: 404 });
  }) as typeof fetch);
  assert.deepEqual(await client.albums(), [{ id: A, name: 'Kids', count: 2 }]);
  assert.deepEqual(await client.album(A), { name: 'Kids', assetIds: [asset(1)] });
  assert.equal((await client.preview(asset(1))).length, 14);
  assert.ok(seen.every((s) => s.key === 'sekrit' && !s.url.includes('sekrit')));
  assert.deepEqual(JSON.parse(seen[2].body), { albumIds: [A], type: 'IMAGE', size: 1000 });
  assert.ok(seen[3].url.endsWith(`/api/assets/${asset(1)}/thumbnail?size=preview`));
  await assert.rejects(client.preview('../etc/passwd'), /not an Immich id/);
  await assert.rejects(client.album('x'), /not an Immich id/);
  const gone = createImmich({ url: 'http://immich.test', apiKey: 'sekrit' }, (async () => new Response('', { status: 401 })) as typeof fetch);
  await assert.rejects(gone.albums(), (e: Error) => /401/.test(e.message) && !/sekrit/.test(e.message));
});

test('Immich is configured by an API key, from a secret file like the Home Assistant token', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'sofa-key-')), 'immich_api_key');
  const env = { SOFA_PASSWORD_HASH: 'x', SOFA_IMMICH_API_KEY_FILE: file };
  writeFileSync(file, '\n');
  assert.equal(loadConfig(env).immich, null); // an empty file switches Immich off
  writeFileSync(file, 'abc123\n');
  assert.deepEqual(loadConfig({ ...env, SOFA_IMMICH_URL: 'http://immich.lan:2283/' }).immich, { url: 'http://immich.lan:2283', apiKey: 'abc123' });
  assert.equal(loadConfig(env).immich?.url, 'http://immich_server:2283');
});

test('layouts accept kidsMode.albums and refuse bad ones', () => {
  assert.deepEqual(validateLayout(layoutWith()), []);
  assert.deepEqual(validateLayout({ ...layoutWith(), kidsMode: { apps: [], dailyMinutes: 40 } }), []); // older layouts have none
  assert.ok(validateLayout({ ...layoutWith(), kidsMode: { apps: [], dailyMinutes: 40, albums: [A, A] } }).length);
  assert.ok(validateLayout({ ...layoutWith(), kidsMode: { apps: [], dailyMinutes: 40, albums: 'x' } }).length);
});

test('HTTP: kids get only approved albums and their pictures; the media path checks profile, album and asset', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sofa-photos-http-'));
  writeFileSync(join(dir, 'index.html'), '<title>Companion</title>');
  const config: Config = {
    port: 0,
    dbPath: join(dir, 'test.db'),
    mediaDir: join(dir, 'media'),
    companionDir: dir,
    passwordHash: await hashSecret('correct horse'),
    secureCookies: false,
    ha: null,
    allowance: { timeZone: 'Europe/Berlin', resetMinutes: 240, graceSeconds: 0, topUpUrl: 'https://sofa.test/kids/topup' },
  };
  const db = openDb(config.dbPath);
  const layout = layoutWith();
  db.prepare('INSERT INTO revisions (number, base, layout, created_at) VALUES (2, 1, ?, ?)').run(JSON.stringify(layout), Date.now());
  const allowance = createAllowance({ ...fromDb(db), ha: null, ...config.allowance });
  const f = fakeImmich();
  const photos = createPhotos({ immich: f.api, mediaDir: config.mediaDir, layout: () => layout });
  const server = startServer(config, db, allowance, undefined, photos);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'correct horse' }) });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    const get = (path: string) => fetch(base + path, { headers: { cookie } });

    assert.equal((await fetch(base + '/api/photos/albums?profile=kids')).status, 401);
    const mine = (await (await get('/api/photos/albums')).json()) as PhotoAlbumsResponse;
    assert.deepEqual(mine.albums.map((a) => [a.name, a.kids]), [['Kids', true], ['Family', false], ['Private', false]]);
    const kids = (await (await get('/api/photos/albums?profile=kids')).json()) as PhotoAlbumsResponse;
    assert.deepEqual(kids.albums.map((a) => a.name), ['Kids']);
    assert.equal((await get('/api/photos/albums?profile=guest')).status, 400);
    assert.equal((await get(`/api/photos/albums/${B}/images?profile=kids`)).status, 403);
    assert.equal((await get(`/api/photos/albums/${A}/images`)).status, 400);
    const imgs = (await (await get(`/api/photos/albums/${A}/images?profile=kids`)).json()) as PhotoImagesResponse;
    assert.equal(imgs.images.length, 2);

    // The picture itself: no credentials, a JPEG with a cache lifetime; a kids path outside the approved albums is refused.
    const pic = await fetch(base + imgs.images[0]);
    assert.equal(pic.status, 200);
    assert.equal(pic.headers.get('content-type'), 'image/jpeg');
    assert.match(pic.headers.get('cache-control') ?? '', /max-age=\d+/);
    assert.deepEqual(Buffer.from(await pic.arrayBuffer()).subarray(0, 3), Buffer.from([0xff, 0xd8, 0xff]));
    assert.equal((await fetch(base + mediaPath('kids', B, asset(3)))).status, 403);
    assert.equal((await fetch(base + mediaPath('household', C, asset(6)))).status, 403);
    assert.equal((await fetch(base + mediaPath('household', B, asset(3)))).status, 200);
    assert.equal((await fetch(base + mediaPath('household', B, asset(1)))).status, 404);
    assert.equal((await fetch(base + `/api/media/kids/${A}/${asset(1)}.jpg`, { method: 'POST' })).status, 405);

    // The widget: the photo widget is on the household layout and the kids profile only gets an approved album.
    await new Promise((r) => setTimeout(r, 100));
    const widgets = (await (await get('/api/widgets')).json()) as WidgetsResponse;
    assert.deepEqual(widgets.widgets.map((w) => [w.id, w.status]), [['w1', 'ok']]);
    const kidsWidgets = (await (await get('/api/widgets?profile=kids')).json()) as WidgetsResponse;
    assert.deepEqual(kidsWidgets.widgets.map((w) => [w.id, w.status]), [['w1', 'empty']]); // album B is not approved
  } finally {
    server.close();
  }
});
