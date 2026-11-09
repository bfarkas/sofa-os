import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import { COLORS } from '@sofa/shared';
import type { Config } from './config.ts';
import { openDb } from './db.ts';
import { startServer } from './server.ts';

// Serves Companion's real source folder, so the manifest, icons and worker are checked as they will be published.
const companion = new URL('../../companion/', import.meta.url);
const dir = mkdtempSync(join(tmpdir(), 'sofa-pwa-'));
let base = '';
let server: ReturnType<typeof startServer>;

before(async () => {
  const config = {
    port: 0,
    dbPath: join(dir, 'test.db'),
    mediaDir: join(dir, 'media'),
    companionDir: companion.pathname,
    passwordHash: 'unused',
    secureCookies: true,
    ha: null,
    allowance: { timeZone: 'Europe/Berlin', resetMinutes: 240, graceSeconds: 0, topUpUrl: 'https://sofa.test/kids/topup' },
  } as Config;
  server = startServer(config, openDb(config.dbPath));
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

test('manifest is served as a web app manifest, standalone, in the shared colours', async () => {
  const res = await fetch(base + '/manifest.webmanifest');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/manifest+json');
  const manifest = (await res.json()) as { display: string; start_url: string; scope: string; background_color: string; theme_color: string; icons: { src: string; sizes: string; purpose: string }[] };
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.background_color, COLORS.ivory);
  assert.equal(manifest.theme_color, COLORS.sageDeep);
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'));
  for (const icon of manifest.icons) {
    const img = await fetch(base + icon.src);
    assert.equal(img.status, 200, icon.src);
    assert.equal(img.headers.get('content-type'), 'image/png');
    const bytes = Buffer.from(await img.arrayBuffer());
    assert.equal(bytes.readUInt32BE(16), Number(icon.sizes.split('x')[0]), `${icon.src} width`);
  }
  const touch = await fetch(base + '/icons/icon-180.png');
  assert.equal(touch.status, 200);
});

test('service worker is served as script, revalidated, and keeps the strict CSP', async () => {
  const res = await fetch(base + '/sw.js');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /^text\/javascript/);
  assert.equal(res.headers.get('cache-control'), 'no-cache');
  assert.equal(res.headers.get('content-security-policy'), "default-src 'self'; frame-ancestors 'self'");
  // The worker must not cache: no Cache API, and no respondWith that could answer API, /ws or pages from storage.
  const source = await res.text();
  assert.doesNotMatch(source, /caches\.|respondWith/);
});

test('index links the manifest and the iOS home-screen tags', async () => {
  const html = await (await fetch(base + '/')).text();
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/);
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  assert.match(html, /<link rel="apple-touch-icon" href="\/icons\/icon-180\.png">/);
  assert.match(html, /<script src="\/main\.js">/);
});

test('the registration in main.ts points at the served worker', () => {
  assert.match(readFileSync(new URL('src/main.ts', companion), 'utf8'), /serviceWorker\.register\('\/sw\.js'\)/);
});
