// Kids Mode from the command line, for the Watch Allowance live run (plan, Session 08). Signs in like Companion.
//   SOFA_PASSWORD=... npm run kids-mode -- status
//   SOFA_PASSWORD=... npm run kids-mode -- enter | exit
//   SOFA_PASSWORD=... npm run kids-mode -- topup <minutes>
//   SOFA_PASSWORD=... npm run kids-mode -- minutes <daily minutes>   publishes the current layout with a new allowance
// SOFA_URL picks the Server (default http://127.0.0.1:8090). Prints the Watch Allowance afterwards.
import type { Draft, KidsStatus, Layout } from '@sofa/shared';

const base = (process.env.SOFA_URL ?? 'http://127.0.0.1:8090').replace(/\/$/, '');
const password = process.env.SOFA_PASSWORD;
const [command, arg] = process.argv.slice(2);
if (!password || !['status', 'enter', 'exit', 'topup', 'minutes'].includes(command)) {
  console.error('usage: SOFA_PASSWORD=... npm run kids-mode -- status | enter | exit | topup <minutes> | minutes <daily minutes>');
  process.exit(2);
}

async function call(method: string, path: string, cookie: string, body?: unknown): Promise<unknown> {
  const res = await fetch(base + path, {
    method,
    headers: { cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
if (!login.ok) throw new Error(`login failed: ${login.status}`);
const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
try {
  if (command === 'enter' || command === 'exit') await call('POST', `/api/kids/${command}`, cookie, {});
  if (command === 'topup') await call('POST', '/api/kids/topup', cookie, { minutes: Number(arg) });
  if (command === 'minutes') {
    const draft = (await call('POST', '/api/drafts', cookie)) as Draft;
    const layout = draft.layout as Layout;
    try {
      await call('PUT', `/api/drafts/${draft.id}`, cookie, { base: draft.base, layout: { ...layout, kidsMode: { ...layout.kidsMode, dailyMinutes: Number(arg) } } });
      await call('POST', `/api/drafts/${draft.id}/publish`, cookie);
    } catch (err) {
      await call('DELETE', `/api/drafts/${draft.id}`, cookie);
      throw err;
    }
  }
  console.log(JSON.stringify((await call('GET', '/api/kids', cookie)) as KidsStatus, null, 2));
} finally {
  await fetch(base + '/api/logout', { method: 'POST', headers: { cookie } });
}
