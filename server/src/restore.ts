import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_VERSION } from './db.ts';

/** Checks a backup file; returns the problems (none: it can be restored). */
export function verifyBackup(file: string): string[] {
  if (!existsSync(file)) return [`no such file: ${file}`];
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const integrity = (db.prepare('PRAGMA integrity_check').all() as { integrity_check: string }[]).map((r) => r.integrity_check);
    const { user_version: v } = db.prepare('PRAGMA user_version').get() as { user_version: number };
    const problems = integrity[0] === 'ok' ? [] : integrity.map((m) => 'integrity_check: ' + m);
    if (v < 1) problems.push('schema version 0: not a Sofa.OS database');
    if (v > SCHEMA_VERSION) problems.push(`schema version ${v} is newer than this Server (${SCHEMA_VERSION}); deploy the newer Server first`);
    return problems;
  } catch (err) {
    return [String(err)];
  } finally {
    db?.close();
  }
}

/** True if another process has the database open (a running Server): it cannot be locked exclusively. */
function inUse(dbPath: string): boolean {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE; ROLLBACK');
    return false;
  } catch {
    return true;
  } finally {
    db.close();
  }
}

/** Restores a backup over dbPath. Refuses a bad backup, a running Server, and an existing database without force (which keeps it as <db>.before-restore). */
export function restore(file: string, dbPath: string, force = false): void {
  const problems = verifyBackup(file);
  if (problems.length) throw new Error('backup refused: ' + problems.join('; '));
  if (existsSync(dbPath)) {
    if (!force) throw new Error(`${dbPath} exists; stop the Server and pass --force to replace it (the old one is kept as ${dbPath}.before-restore)`);
    if (inUse(dbPath)) throw new Error(`${dbPath} is in use: stop the Server first`);
  }
  mkdirSync(dirname(dbPath), { recursive: true });
  const tmp = dbPath + '.restoring';
  copyFileSync(file, tmp);
  if (existsSync(dbPath)) {
    rmSync(dbPath + '.before-restore', { force: true });
    renameSync(dbPath, dbPath + '.before-restore');
  }
  for (const ext of ['-wal', '-shm']) rmSync(dbPath + ext, { force: true }); // a stale WAL would replay over the restored file
  renameSync(tmp, dbPath);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const [file] = args.filter((a) => !a.startsWith('--'));
  const dbPath = process.env.SOFA_DB_PATH ?? 'sofa.db';
  if (!file) {
    console.error(`usage: npm run restore -- <backup file> [--force]   (target: SOFA_DB_PATH, now ${dbPath}; stop the Server first)`);
    process.exit(2);
  }
  try {
    restore(file, dbPath, force);
    console.log(`restored ${file} to ${dbPath}`);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
