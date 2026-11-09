import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Draft, Layout } from '@sofa/shared';
import { createAllowance, fromDb } from './allowance.ts';
import { hashSecret } from './auth.ts';
import type { Config } from './config.ts';
import { openDb } from './db.ts';
import { currentSnapshot } from './layout.ts';
import { startServer } from './server.ts';
import { statusAdapter } from './adapters/status.ts';

// Publish-time widget checks (Session 15): a bad widget config is refused with its errors instead of showing "Check this widget" on the TV.
test('publishing refuses a widget whose config or size its type rejects, and lets unknown types through', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sofa-publish-check-'));
  writeFileSync(join(dir, 'index.html'), '<title>Companion</title>');
  const config: Config = {
    port: 0, dbPath: join(dir, 'test.db'), mediaDir: join(dir, 'media'), companionDir: dir, passwordHash: await hashSecret('pw'), secureCookies: false, ha: null,
    allowance: { timeZone: 'Europe/Berlin', resetMinutes: 240, graceSeconds: 0, topUpUrl: 'https://sofa.test/kids/topup' },
  };
  const db = openDb(config.dbPath);
  const allowance = createAllowance({ ...fromDb(db), ha: null, ...config.allowance });
  const server = startServer(config, db, allowance, [statusAdapter({ db, allowance: () => allowance.status(), homeAssistant: 'off', timeZone: 'Europe/Berlin' })]);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'pw' }) });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    const api = (method: string, path: string, body?: unknown) =>
      fetch(base + path, { method, headers: { cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const attempt = async (widgets: Layout['widgets']) => {
      const draft = (await (await api('POST', '/api/drafts')).json()) as Draft;
      await api('PUT', `/api/drafts/${draft.id}`, { base: draft.base, layout: { ...(draft.layout as Layout), widgets } });
      return api('POST', `/api/drafts/${draft.id}/publish`);
    };
    const w = (id: string, type: string, config: Record<string, unknown>): Layout['widgets'][number] => ({ id, type, size: 'medium', config, profiles: ['household'], freshness: 'live' });

    const before = currentSnapshot(db).revision;
    const refused = await attempt([w('a', 'status', { title: 'x'.repeat(41) })]);
    assert.equal(refused.status, 422);
    const body = (await refused.json()) as { errors: string[] };
    assert.deepEqual(body.errors, ['widgets[0] (a): title: must be text of at most 40 characters']);
    assert.equal(currentSnapshot(db).revision, before, 'a refused publish changes nothing');

    assert.equal((await attempt([w('a', 'status', { title: 'Home' }), w('b', 'weather', { anything: 1 })])).status, 200); // unknown types are unavailable, not refused (ADR 0003)
    assert.equal(currentSnapshot(db).revision, before + 1);
  } finally {
    server.close();
  }
});
