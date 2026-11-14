import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import type { Layout } from '@sofa/shared';
import { hashSecret } from './auth.ts';
import type { Config } from './config.ts';
import { openDb } from './db.ts';
import { createDraft, currentSnapshot, publishDraft, saveDraft } from './layout.ts';
import { startServer } from './server.ts';
import { approveCode, claimToken, createCode } from './tv.ts';

// POST /api/inputs/start (Session 43) against a dry-run Home Assistant: the write guard runs, nothing is sent.
const dir = mkdtempSync(join(tmpdir(), 'sofa-inputs-'));
let base = '';
let token = '';
let server: ReturnType<typeof startServer>;
before(async () => {
  const config: Config = {
    port: 0,
    dbPath: join(dir, 'inputs.db'),
    mediaDir: join(dir, 'media'),
    companionDir: dir,
    passwordHash: await hashSecret('pw'),
    secureCookies: false,
    ha: { url: 'http://127.0.0.1:9', token: 't', tvEntity: 'media_player.tv', remoteEntity: 'remote.tv', notifyServices: [], dryRun: true },
    allowance: { timeZone: 'Europe/Berlin', resetMinutes: 240, graceSeconds: 0, topUpUrl: 'https://sofa.test/kids/topup' },
  };
  const db = openDb(config.dbPath);
  const layout: Layout = {
    ...currentSnapshot(db).layout,
    apps: [
      { id: 'org.tizen.netflix-app', name: 'Netflix' },
      { id: 'script.sofa_start_ps5', name: 'PS5', kind: 'input', script: 'script.sofa_start_ps5', source: 'HDMI4' },
    ],
  };
  const draft = createDraft(db);
  saveDraft(db, draft.id, draft.base, layout);
  assert.equal(publishDraft(db, draft.id).ok, true);
  const c = createCode(db);
  approveCode(db, c.code);
  const claimed = claimToken(db, c.code, c.secret);
  token = claimed?.status === 'approved' ? claimed.token : assert.fail('no token');
  server = startServer(config, db);
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const post = (path: string, body: unknown, auth = true) =>
  fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });

test('the TV starts a console of the layout; anything else is refused; Kids Mode refuses it', async () => {
  assert.equal((await post('/api/inputs/start', { app: 'script.sofa_start_ps5' }, false)).status, 401);
  assert.equal((await post('/api/inputs/start', { app: 'script.sofa_start_ps5' })).status, 200);
  assert.equal((await post('/api/inputs/start', { app: 'org.tizen.netflix-app' })).status, 404, 'a Tizen app is not a console');
  assert.equal((await post('/api/inputs/start', { app: 'script.sofa_start_switch' })).status, 404, 'only tiles of the published layout');
  assert.equal((await post('/api/kids/enter', {})).status, 200);
  assert.equal((await post('/api/inputs/start', { app: 'script.sofa_start_ps5' })).status, 403);
});
