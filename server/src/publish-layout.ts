// Publishes a layout the way Companion does: sign in, start a draft, save it, publish it.
//   SOFA_PASSWORD=... npm run publish-layout                  sample layout stamped with the time
//   SOFA_PASSWORD=... npm run publish-layout -- layout.json   a layout from a file
//   SOFA_PASSWORD=... npm run publish-layout -- --broken      an invalid layout, which the Server must refuse
// SOFA_URL picks the Server (default http://127.0.0.1:8090). Exits 1 if the publish is refused.
import { readFileSync } from 'node:fs';
import type { Draft, Layout, Snapshot } from '@sofa/shared';

const base = (process.env.SOFA_URL ?? 'http://127.0.0.1:8090').replace(/\/$/, '');
const password = process.env.SOFA_PASSWORD;
if (!password) {
  console.error('set SOFA_PASSWORD to the Companion password');
  process.exit(2);
}
const arg = process.argv[2];

function sample(): Layout {
  return {
    schema: 1,
    apps: [
      { id: 'mvOizTfhQn.KiKAplayer', name: 'KiKA' },
      { id: 'SrAoJxGQUf.ARD', name: 'ARD' },
      { id: 'yPSlpvfeTf.ZDFmediathek', name: 'ZDF' },
      { id: 'org.tizen.netflix-app', name: 'Netflix' },
    ],
    widgets: [{ id: 'weather', type: 'weather', size: 'medium', config: {}, profiles: ['household', 'kids'], freshness: 'hourly' }],
    rows: [
      { id: 'apps', title: 'Published ' + new Date().toLocaleTimeString('en-GB'), items: ['mvOizTfhQn.KiKAplayer', 'SrAoJxGQUf.ARD', 'yPSlpvfeTf.ZDFmediathek', 'org.tizen.netflix-app'].map((id) => ({ kind: 'app' as const, id })) },
      { id: 'widgets', title: 'Today', items: [{ kind: 'widget', id: 'weather' }] },
    ],
    background: { kind: 'color', color: '#f6f1e7' },
    kidsMode: { apps: ['mvOizTfhQn.KiKAplayer'], dailyMinutes: 60 },
  };
}

function layoutToPublish(): unknown {
  if (arg === '--broken') {
    const l = sample() as any;
    l.rows[0].items.push({ kind: 'app', id: 'missing.App' });
    l.widgets[0].size = 'huge';
    return l;
  }
  return arg ? JSON.parse(readFileSync(arg, 'utf8')) : sample();
}

async function call(method: string, path: string, cookie: string, body?: unknown): Promise<Response> {
  return fetch(base + path, {
    method,
    headers: { cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const login = await call('POST', '/api/login', '', { password });
if (!login.ok) throw new Error(`login failed: ${login.status} ${await login.text()}`);
const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];

const draft = (await (await call('POST', '/api/drafts', cookie)).json()) as Draft;
const saved = await call('PUT', `/api/drafts/${draft.id}`, cookie, { base: draft.base, layout: layoutToPublish() });
if (!saved.ok) throw new Error(`saving the draft failed: ${saved.status} ${await saved.text()}`);

const published = await call('POST', `/api/drafts/${draft.id}/publish`, cookie);
if (published.ok) {
  console.log(`published revision ${((await published.json()) as Snapshot).revision}`);
} else {
  console.error(`refused (${published.status}):`, JSON.stringify(await published.json(), null, 2));
  await call('DELETE', `/api/drafts/${draft.id}`, cookie);
  process.exitCode = 1;
}
await call('POST', '/api/logout', cookie);
