import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

// Salted scrypt hashes for the Companion password, and later the Kids Mode PIN.
// Format: scrypt$N$r$p$salt$hash, salt and hash in base64.
const N = 1 << 15, R = 8, P = 1, KEYLEN = 32;
const MAXMEM = 64 * 1024 * 1024; // N=2^15 needs 32 MiB, Node's default limit is exactly that

function derive(secret: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(secret.normalize('NFC'), salt, KEYLEN, { N: n, r, p, maxmem: MAXMEM }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(secret, salt, N, R, P);
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifySecret(secret: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await derive(secret, Buffer.from(salt, 'base64'), Number(n), Number(r), Number(p));
  return key.length === expected.length && timingSafeEqual(key, expected);
}

// Sessions: the cookie holds a random token, the database only its SHA-256.
export const SESSION_COOKIE = 'sofa_session';
export const SESSION_DAYS = 90;

const sha256 = (token: string) => createHash('sha256').update(token).digest('hex');

export function createSession(db: DatabaseSync, now = Date.now()): { token: string; expiresAt: number } {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = now + SESSION_DAYS * 86_400_000;
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
  db.prepare('INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)').run(sha256(token), now, expiresAt);
  return { token, expiresAt };
}

/** Returns the session's expiry time, or null if the token is unknown or expired. */
export function checkSession(db: DatabaseSync, token: string | undefined, now = Date.now()): number | null {
  if (!token) return null;
  const row = db.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?').get(sha256(token)) as { expires_at: number } | undefined;
  return row && row.expires_at > now ? row.expires_at : null;
}

export function deleteSession(db: DatabaseSync, token: string | undefined): void {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

export function sessionCookie(token: string, maxAgeSeconds: number, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}
