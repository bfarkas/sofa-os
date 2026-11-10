import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createIcons, iconCandidates, type IconReport, type TizenAppInfoApi } from './icons.ts';

const fake = (info: (id: string) => { iconPath?: string } | null | undefined) => {
  const asked: string[] = [];
  const api: TizenAppInfoApi = { application: { getAppInfo: (id) => (asked.push(id), info(id)) } };
  const reports: IconReport[] = [];
  return { icons: createIcons(api, (r) => reports.push(r)), asked, reports };
};

test('a bare absolute path is tried as returned, then with file://', () => {
  assert.deepEqual(iconCandidates('/opt/usr/apps/x/icon.png'), ['/opt/usr/apps/x/icon.png', 'file:///opt/usr/apps/x/icon.png']);
  assert.deepEqual(iconCandidates(' file:///a/b.png '), ['file:///a/b.png']);
  assert.deepEqual(iconCandidates('http://localhost/a.png'), ['http://localhost/a.png']);
  assert.deepEqual(iconCandidates('//host/a.png'), ['//host/a.png']);
  assert.deepEqual(iconCandidates('res/icon.png'), ['res/icon.png']);
  for (const none of ['', '   ', undefined, null, 5]) assert.deepEqual(iconCandidates(none), []);
});

test('the first source that loads is kept, reported once, and asked for only once', () => {
  const { icons, asked, reports } = fake(() => ({ iconPath: '/a/icon.png' }));
  assert.equal(icons.src('SrAoJxGQUf.ARD'), '/a/icon.png');
  assert.equal(icons.failed('SrAoJxGQUf.ARD', '/a/icon.png'), 'file:///a/icon.png');
  assert.equal(icons.src('SrAoJxGQUf.ARD'), 'file:///a/icon.png');
  icons.loaded('SrAoJxGQUf.ARD', 'file:///a/icon.png');
  icons.loaded('SrAoJxGQUf.ARD', 'file:///a/icon.png');
  assert.equal(icons.src('SrAoJxGQUf.ARD'), 'file:///a/icon.png', 'a redraw gets the working source at once');
  assert.deepEqual(asked, ['SrAoJxGQUf.ARD']);
  assert.deepEqual(reports, [{ app: 'SrAoJxGQUf.ARD', outcome: 'loaded', detail: 'file:///a/icon.png' }]);
});

test('every source failing keeps the letter and reports the path once', () => {
  const { icons, reports } = fake(() => ({ iconPath: '/a/icon.png' }));
  icons.src('x.App');
  assert.equal(icons.failed('x.App', '/a/icon.png'), 'file:///a/icon.png');
  assert.equal(icons.failed('x.App', 'file:///a/icon.png'), undefined);
  assert.equal(icons.failed('x.App', 'file:///a/icon.png'), undefined, 'a second tile of the same app failing too');
  assert.equal(icons.src('x.App'), undefined);
  assert.deepEqual(reports, [{ app: 'x.App', outcome: 'failed', detail: '/a/icon.png' }]);
});

test('a second tile for the same app that fails on an old source is sent to the current one', () => {
  const { icons } = fake(() => ({ iconPath: '/a/icon.png' }));
  icons.src('x.App');
  icons.failed('x.App', '/a/icon.png');
  assert.equal(icons.failed('x.App', '/a/icon.png'), 'file:///a/icon.png');
});

test('no API, a throwing API, no iconPath: the letter stays and the reason is reported', () => {
  const reports: IconReport[] = [];
  assert.equal(createIcons(undefined, (r) => reports.push(r)).src('x.App'), undefined);
  const boom = fake(() => {
    throw Object.assign(new Error('nope'), { name: 'NotFoundError' });
  });
  assert.equal(boom.icons.src('x.App'), undefined);
  assert.equal(fake(() => ({})).icons.src('x.App'), undefined);
  assert.equal(fake(() => null).icons.src('x.App'), undefined);
  assert.deepEqual(reports, [{ app: 'x.App', outcome: 'none', detail: 'no Tizen API' }]);
  assert.deepEqual(boom.reports, [{ app: 'x.App', outcome: 'none', detail: 'NotFoundError' }]);
  assert.equal(boom.icons.src('x.App'), undefined);
  assert.equal(boom.reports.length, 1, 'cached: no second lookup and no second report');
  assert.equal(boom.icons.failed('x.App', 'whatever'), undefined);
});

test('the Netflix store id is looked up by the id that launches, then by its own', () => {
  const { icons, asked } = fake((id) => (id === 'org.tizen.netflix-app' ? { iconPath: '/n.png' } : undefined));
  assert.equal(icons.src('RN1MCdNq8t.Netflix'), '/n.png');
  assert.deepEqual(asked, ['org.tizen.netflix-app']);
  const second = fake((id) => (id === 'RN1MCdNq8t.Netflix' ? { iconPath: '/s.png' } : undefined));
  assert.equal(second.icons.src('RN1MCdNq8t.Netflix'), '/s.png');
  assert.deepEqual(second.asked, ['org.tizen.netflix-app', 'RN1MCdNq8t.Netflix']);
});
