import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { TvCode, TvTokenResponse } from '@sofa/shared';
import { sha256 } from './auth.ts';

// TV Sign-in. The TV asks for a code and gets {code, secret}. The code goes into the QR code, so anyone who sees the
// screen knows it; the secret stays on the TV. A Companion session approves the code. Only the TV that holds the secret
// can then collect the device token, once. There is one device token: signing in again replaces it (ADR 0002).
export const CODE_TTL_MS = 5 * 60_000;
export const MAX_PENDING = 10; // a bounded table: past this, the oldest code is dropped
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L, easy to read off a TV

export function createCode(db: DatabaseSync, now = Date.now()): TvCode {
  db.prepare('DELETE FROM tv_codes WHERE expires_at <= ?').run(now);
  const { n } = db.prepare('SELECT count(*) AS n FROM tv_codes').get() as { n: number };
  if (n >= MAX_PENDING) {
    db.prepare('DELETE FROM tv_codes WHERE code IN (SELECT code FROM tv_codes ORDER BY created_at, rowid LIMIT ?)').run(n - MAX_PENDING + 1);
  }
  const code = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  const secret = randomBytes(32).toString('base64url');
  const expiresAt = now + CODE_TTL_MS;
  db.prepare('INSERT INTO tv_codes (code, secret_hash, created_at, expires_at) VALUES (?, ?, ?, ?)').run(code, sha256(secret), now, expiresAt);
  return { code, secret, expiresAt: new Date(expiresAt).toISOString() };
}

/** Marks a live code approved. False when it is unknown or expired. */
export function approveCode(db: DatabaseSync, code: string, now = Date.now()): boolean {
  return Number(db.prepare('UPDATE tv_codes SET approved = 1 WHERE code = ? AND expires_at > ?').run(code, now).changes) > 0;
}

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * The TV's poll. null when the code is unknown, expired or the secret is wrong (indistinguishable on purpose).
 * Once approved, the code is spent and replaces the device token in one transaction, and the new token is returned.
 */
export function claimToken(db: DatabaseSync, code: string, secret: string, now = Date.now()): TvTokenResponse | null {
  const row = db.prepare('SELECT secret_hash, approved FROM tv_codes WHERE code = ? AND expires_at > ?').get(code, now) as
    | { secret_hash: string; approved: number }
    | undefined;
  if (!row || !same(row.secret_hash, sha256(secret))) return null;
  if (!row.approved) return { status: 'pending' };
  const token = randomBytes(32).toString('base64url');
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM tv_codes WHERE code = ?').run(code);
    db.prepare(
      'INSERT INTO tv_device (id, token_hash, created_at) VALUES (1, ?, ?) ON CONFLICT (id) DO UPDATE SET token_hash = excluded.token_hash, created_at = excluded.created_at',
    ).run(sha256(token), now);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { status: 'approved', token };
}

export function checkDeviceToken(db: DatabaseSync, token: string | undefined): boolean {
  if (!token) return false;
  const row = db.prepare('SELECT token_hash FROM tv_device WHERE id = 1').get() as { token_hash: string } | undefined;
  return !!row && same(row.token_hash, sha256(token));
}
