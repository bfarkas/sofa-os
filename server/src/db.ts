import { DatabaseSync } from 'node:sqlite';

// Append-only: never edit a shipped migration, add a new one. PRAGMA user_version counts applied ones.
const migrations: string[] = [
  `CREATE TABLE sessions (
     token_hash TEXT PRIMARY KEY,
     created_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL
   ) STRICT;`,
  // Layout revisions (see layout.ts). Revision 1 is an empty layout, so there is always a current one.
  `CREATE TABLE revisions (
     number INTEGER PRIMARY KEY,
     base INTEGER REFERENCES revisions(number),
     layout TEXT NOT NULL,
     created_at INTEGER NOT NULL
   ) STRICT;
   CREATE TABLE drafts (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     base INTEGER NOT NULL REFERENCES revisions(number),
     layout TEXT NOT NULL,
     updated_at INTEGER NOT NULL
   ) STRICT;
   INSERT INTO revisions (number, base, layout, created_at) VALUES (1, NULL,
     '{"schema":1,"apps":[],"widgets":[],"rows":[],"background":{"kind":"color","color":"#f6f1e7"},"kidsMode":{"apps":[],"dailyMinutes":60}}',
     unixepoch() * 1000);`,
  // TV Sign-in (see tv.ts): pending codes, and the one device token. Only hashes are stored.
  `CREATE TABLE tv_codes (
     code TEXT PRIMARY KEY,
     secret_hash TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL,
     approved INTEGER NOT NULL DEFAULT 0
   ) STRICT;
   CREATE TABLE tv_device (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     token_hash TEXT NOT NULL,
     created_at INTEGER NOT NULL
   ) STRICT;`,
  // The Watch Allowance clock (see allowance.ts): its whole state as one JSON document.
  `CREATE TABLE allowance (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     state TEXT NOT NULL
   ) STRICT;`,
  // The Kids Mode PIN (see pin.ts): a salted hash, never the PIN.
  `CREATE TABLE kids_pin (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     hash TEXT NOT NULL
   ) STRICT;`,
  // A revision Sofa Home made records its operation (shared/src/ops.ts, ADR 0004); a Companion publish leaves it NULL.
  `ALTER TABLE revisions ADD COLUMN op TEXT;`,
];

export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const { user_version: applied } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let i = applied; i < migrations.length; i++) {
    db.exec('BEGIN');
    try {
      db.exec(migrations[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return db;
}
