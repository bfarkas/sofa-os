import { mkdirSync } from 'node:fs';
import { loadConfig } from './config.ts';
import { openDb } from './db.ts';
import { log } from './log.ts';
import { startServer } from './server.ts';

const config = loadConfig();
mkdirSync(config.mediaDir, { recursive: true });
const db = openDb(config.dbPath);
const server = startServer(config, db);

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    log.info('shutting down', { signal });
    server.close(() => {
      db.close();
      process.exit(0);
    });
    server.closeAllConnections();
  });
}
