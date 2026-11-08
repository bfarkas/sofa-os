import { mkdirSync } from 'node:fs';
import { loadConfig } from './config.ts';
import { openDb } from './db.ts';
import { createHaClient } from './ha.ts';
import { log } from './log.ts';
import { startServer } from './server.ts';

const config = loadConfig();
mkdirSync(config.mediaDir, { recursive: true });
const db = openDb(config.dbPath);
const server = startServer(config, db);

// Read-only check so a wrong Home Assistant URL or token shows up in the logs at once.
if (config.ha) {
  const { tvEntity } = config.ha;
  createHaClient(config.ha)
    .getState(tvEntity)
    .then((s) => log.info('home assistant reachable', { entity: tvEntity, state: (s as { state?: string }).state }))
    .catch((err) => log.warn('home assistant check failed', { entity: tvEntity, err: String(err) }));
}

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
