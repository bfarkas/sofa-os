import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { backupNow, backupName, keepers, listBackups, startBackups } from './backup.ts';
import { openDb } from './db.ts';
import { createPin } from './pin.ts';
import { restore, verifyBackup } from './restore.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'sofa-backup-'));
const dump = (db: DatabaseSync) =>
  Object.fromEntries(['revisions', 'drafts', 'allowance', 'kids_pin', 'tv_device'].map((t) => [t, db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all()]));

test('backup while writing, restore into a fresh dir: layout revisions, drafts, kids state and the PIN hash come back equal', async () => {
  const dir = tmp();
  const db = openDb(join(dir, 'live.db'));
  db.prepare("INSERT INTO revisions (number, base, layout, created_at, op) VALUES (2, 1, '{\"schema\":1,\"n\":2}', 5, '{\"op\":\"x\"}')").run();
  db.prepare("INSERT INTO drafts (base, layout, updated_at) VALUES (2, '{\"draft\":true}', 6)").run();
  db.prepare("INSERT INTO allowance (id, state) VALUES (1, '{\"remainingSeconds\":1234}')").run();
  db.prepare("INSERT INTO tv_device (id, token_hash, created_at) VALUES (1, 'th', 7)").run();
  assert.ok(await createPin(db).set('4821'));
  const before = dump(db);
  let n = 0;
  const writer = setInterval(() => db.prepare('INSERT INTO sessions VALUES (?, 1, 2)').run('t' + n++), 1); // writes during the backup
  const name = await backupNow(db, join(dir, 'backups'), Date.UTC(2026, 0, 5, 3));
  clearInterval(writer);
  assert.deepEqual(listBackups(join(dir, 'backups')), [name]);
  assert.deepEqual(verifyBackup(join(dir, 'backups', name)), []);

  const target = join(dir, 'fresh', 'sofa.db');
  restore(join(dir, 'backups', name), target);
  const back = openDb(target);
  assert.deepEqual(dump(back), before);
  assert.match((back.prepare('SELECT hash FROM kids_pin').get() as { hash: string }).hash, /^scrypt\$/);
  assert.equal((back.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check, 'ok');
  assert.ok((back.prepare('SELECT count(*) AS c FROM sessions').get() as { c: number }).c <= n);
  back.close();
  db.close();
});

test('restore refuses: a bad file, a newer schema, an existing database without --force, and a running Server', () => {
  const dir = tmp();
  const good = join(dir, 'good.db');
  openDb(good).close();
  writeFileSync(join(dir, 'junk.db'), 'not a database at all, not at all, not at all');
  assert.ok(verifyBackup(join(dir, 'junk.db')).length > 0);
  assert.deepEqual(verifyBackup(join(dir, 'missing.db')), [`no such file: ${join(dir, 'missing.db')}`]);
  const newer = join(dir, 'newer.db');
  const n = new DatabaseSync(newer);
  n.exec('PRAGMA user_version = 999');
  n.close();
  assert.match(verifyBackup(newer)[0], /newer than this Server/);
  const empty = join(dir, 'empty.db');
  new DatabaseSync(empty).close();
  assert.match(verifyBackup(empty)[0], /not a Sofa\.OS database/);

  const target = join(dir, 'sofa.db');
  const live = openDb(target);
  assert.throws(() => restore(good, target), /--force/);
  live.exec('BEGIN EXCLUSIVE'); // what a running Server's write looks like to a second process
  assert.throws(() => restore(good, target, true), /in use/);
  live.exec('ROLLBACK');
  live.close();
  assert.throws(() => restore(join(dir, 'junk.db'), target, true), /refused/);
  restore(good, target, true);
  assert.ok(existsSync(target + '.before-restore'), 'the replaced database is kept');
  assert.ok(!existsSync(target + '-wal'));
});

test('retention: 7 newest days plus 4 newest weeks, everything else goes', () => {
  const at = (day: number, hour = 3) => backupName(Date.UTC(2026, 0, 1) + day * 86_400_000 + hour * 3_600_000);
  const names = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30, 60, 100].map((d) => at(d)).concat(at(31, 3), at(31, 15));
  const kept = keepers(names);
  assert.ok(kept.has(at(31, 15)) && !kept.has(at(31, 3)), 'the newest of a day');
  // newest 7 days: 100, 60, 31, 30, 20, 10, 9; the weeks (100, 60, 31/30, 20) are all inside that
  for (const d of [100, 60, 30, 20, 10, 9]) assert.ok(kept.has(at(d)), 'day ' + d);
  assert.ok(!kept.has(at(8)));
  assert.equal(kept.size, 7);
  // a week older than the daily window survives as its newest backup
  const weekly = keepers([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((d) => at(d)).concat(at(14), at(21)));
  assert.ok(weekly.has(at(14)) && weekly.has(at(21)));
});

test('startBackups: backs up at startup when the newest is a day old, not when it is fresh', async () => {
  const dir = tmp();
  const db = openDb(':memory:');
  let t = Date.UTC(2026, 0, 5, 3);
  const run = async () => {
    const b = startBackups(db, dir, () => t);
    await b.first;
    b.stop();
    return b;
  };
  await run();
  assert.equal(listBackups(dir).length, 1);
  t += 3_600_000;
  await run();
  assert.equal(listBackups(dir).length, 1, 'fresh enough');
  t += 86_400_000;
  const c = await run();
  assert.equal(listBackups(dir).length, 2);
  assert.equal(c.status().lastAt, new Date(t).toISOString().replace(/\.\d+Z/, '.000Z'));
  assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith('.tmp')), []);
});
