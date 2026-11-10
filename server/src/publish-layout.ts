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

// A layout with something to navigate: real Tizen app IDs and one widget of each size. The first four IDs are from the
// spec (Known results); YouTube and Plex are read from this TV's `0 applist` (9Ur5IzDKqV.TizenYouTube launched without the logged-in users, so YouTube uses the Cobalt app). Netflix launches through org.tizen.netflix-app, not its store ID.
function sample(): Layout {
  const apps = [
    { id: 'org.tizen.netflix-app', name: 'Netflix' },
    { id: 'com.samsung.tv.cobalt-yt', name: 'YouTube' },
    { id: 'kIciSQlYEM.plex', name: 'Plex' },
    { id: 'SrAoJxGQUf.ARD', name: 'ARD' },
    { id: 'yPSlpvfeTf.ZDFmediathek', name: 'ZDF' },
    { id: 'mvOizTfhQn.KiKAplayer', name: 'KiKA' },
  ];
  const both: Layout['widgets'][number]['profiles'] = ['household', 'kids'];
  const widget = (id: string, size: 'small' | 'medium' | 'large', profiles = both, config: Record<string, unknown> = {}): Layout['widgets'][number] => ({ id, type: id, size, config, profiles, freshness: 'hourly' });
  return {
    schema: 1,
    apps,
    widgets: [widget('weather', 'small', both, { entity: 'weather.home' }), widget('calendar', 'small', ['household']), widget('energy', 'small', ['household'], { entity: 'sensor.powerfox_aktuell', period: 'now' }), widget('photos', 'small'), widget('home', 'small', ['household'])], // the Dashboard's widget row holds five small ones
    rows: [
      { id: 'today', title: 'Today (published ' + new Date().toLocaleTimeString('en-GB') + ')', items: ['weather', 'calendar', 'energy'].map((id) => ({ kind: 'widget' as const, id })) },
      { id: 'apps', title: 'My Apps', items: apps.map((a) => ({ kind: 'app' as const, id: a.id })) },
    ],
    background: { kind: 'color', color: '#f6f1e7' },
    kidsMode: { apps: ['org.tizen.netflix-app', 'mvOizTfhQn.KiKAplayer', 'kIciSQlYEM.plex'], dailyMinutes: 40 }, // household policy, 2026-11-08
  };
}

function layoutToPublish(): unknown {
  if (arg === '--broken') {
    const l = sample() as any;
    l.rows[1].items.push({ kind: 'app', id: 'missing.App' });
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
