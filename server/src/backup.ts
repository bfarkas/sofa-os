import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { backup, type DatabaseSync } from 'node:sqlite';
import { log } from './log.ts';

// Consistent SQLite snapshots (node:sqlite's backup API, safe while the Server writes) in a backups directory.
// Files are sofa-YYYYMMDDTHHMMSSZ.db in UTC. One a day, plus one at startup if the newest is older than a day.
// Retention: the newest backup of each of the last 7 days that have one, plus the newest of each of the last 4 weeks
// that have one (weeks start Monday, UTC). The media cache is rebuildable and not included; secrets live outside the
// database and are not included either (docs/restore.md).
export const DAILY_KEPT = 7;
export const WEEKLY_KEPT = 4;
const DAY = 86_400_000;
const NAME = /^sofa-(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z\.db$/;

export const backupName = (t: number) => `sofa-${new Date(t).toISOString().replace(/[-:]|\.\d+/g, '')}.db`;
export function backupTime(name: string): number | null {
  const m = NAME.exec(name);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
}

/** Backup file names in the directory, oldest first. */
export function listBackups(dir: string): string[] {
  try {
    return readdirSync(dir).filter((n) => backupTime(n) !== null).sort();
  } catch {
    return [];
  }
}

/** Which of these names retention keeps. */
export function keepers(names: string[]): Set<string> {
  const keep = new Set<string>();
  const newestFirst = [...names].sort().reverse();
  const week = (t: number) => Math.floor((Math.floor(t / DAY) + 3) / 7); // epoch day 0 was a Thursday
  for (const [bucket, count] of [[(t: number) => Math.floor(t / DAY), DAILY_KEPT], [week, WEEKLY_KEPT]] as const) {
    const seen = new Set<number>();
    for (const n of newestFirst) {
      const b = bucket(backupTime(n)!);
      if (seen.has(b)) continue;
      if (seen.size >= count) break;
      seen.add(b);
      keep.add(n);
    }
  }
  return keep;
}

export async function backupNow(db: DatabaseSync, dir: string, now = Date.now()): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const name = backupName(now);
  const tmp = join(dir, name + '.tmp'); // a half-written file never looks like a backup
  try {
    await backup(db, tmp);
    renameSync(tmp, join(dir, name));
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
  const names = listBackups(dir);
  const keep = keepers(names);
  for (const n of names) if (!keep.has(n)) rmSync(join(dir, n), { force: true });
  return name;
}

export interface BackupStatus {
  lastAt: string | null; // ISO time of the newest backup
  lastError: string | null; // the last attempt's failure, until one succeeds
}

/** Backs up now if the newest is older than a day (so at startup too), and re-checks every hour. */
export function startBackups(db: DatabaseSync, dir: string, now: () => number = Date.now, checkMs = 3_600_000) {
  let lastError: string | null = null;
  const newest = () => listBackups(dir).at(-1);
  const status = (): BackupStatus => {
    const n = newest();
    return { lastAt: n ? new Date(backupTime(n)!).toISOString() : null, lastError };
  };
  let busy = false;
  const check = async () => {
    const n = newest();
    if (busy || (n && now() - backupTime(n)! < DAY)) return;
    busy = true;
    try {
      const name = await backupNow(db, dir, now());
      lastError = null;
      log.info('backup written', { name });
    } catch (err) {
      lastError = String(err);
      log.error('backup failed', { err: lastError });
    }
    busy = false;
  };
  const first = check();
  const timer = setInterval(check, checkMs);
  timer.unref();
  return { status, stop: () => clearInterval(timer), first };
}
