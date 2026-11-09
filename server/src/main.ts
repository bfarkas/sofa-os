import { mkdirSync } from 'node:fs';
import { createAllowance, fromDb, startAllowance } from './allowance.ts';
import { startBackups } from './backup.ts';
import { loadConfig } from './config.ts';
import { openDb } from './db.ts';
import { createHaClient } from './ha.ts';
import { log } from './log.ts';
import { startServer } from './server.ts';
import { createSystem } from './system.ts';

const config = loadConfig();
mkdirSync(config.mediaDir, { recursive: true });
const db = openDb(config.dbPath);
const ha = config.ha && createHaClient(config.ha);
const allowance = createAllowance({ ...fromDb(db), ha, ...config.allowance });
const system = createSystem(!config.ha ? 'off' : config.ha.dryRun ? 'dry run' : 'on');
const backups = config.backupDir ? startBackups(db, config.backupDir) : null;
if (backups) system.setBackups(backups.status);
else log.warn('no backup directory (SOFA_BACKUP_DIR): the database is not backed up');
const server = startServer(config, db, allowance, undefined, undefined, system);

// The Watch Allowance clock reads the TV's state every few seconds, so a wrong URL or token shows up in the logs at once.
let stopAllowance = () => {};
if (config.ha && ha) {
  if (config.ha.dryRun) log.warn('home assistant dry run: writes are logged, not sent');
  stopAllowance = startAllowance(allowance, config.ha, ha, undefined, system.setHaReachable);
} else log.warn('no home assistant: the watch allowance clock does not run');

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    log.info('shutting down', { signal });
    stopAllowance();
    backups?.stop();
    server.close(() => {
      db.close();
      process.exit(0);
    });
    server.closeAllConnections();
  });
}
