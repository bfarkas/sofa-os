import type { DatabaseSync } from 'node:sqlite';
import { PIN_PATTERN } from '@sofa/shared';
import { hashSecret, verifySecret } from './auth.ts';

// The Kids Mode PIN: four digits, kept as a salted scrypt hash (the Companion password's helper). It is a light deterrent
// (ADR 0001), so the lockout is held in memory: a restart clears it. Companion sessions never need the PIN.
export const MAX_TRIES = 5; // wrong tries in a row before the lockout
export const LOCK_MS = 5 * 60_000;

export type PinCheck = { ok: true } | { ok: false; reason: 'unset' } | { ok: false; reason: 'wrong'; triesLeft: number } | { ok: false; reason: 'locked'; retryAfterSeconds: number };

export function createPin(db: DatabaseSync, now: () => number = Date.now) {
  let failures = 0;
  let lockedUntil = 0;
  const stored = () => (db.prepare('SELECT hash FROM kids_pin WHERE id = 1').get() as { hash: string } | undefined)?.hash;
  const locked = (t: number): PinCheck => ({ ok: false, reason: 'locked', retryAfterSeconds: Math.ceil((lockedUntil - t) / 1000) });
  const lock = (t: number) => {
    lockedUntil = t + LOCK_MS;
    failures = 0;
    return locked(t);
  };
  return {
    isSet: () => stored() !== undefined,

    /** Sets a new PIN (an adult in Companion), which also ends a lockout. False if it is not four digits. */
    async set(pin: unknown): Promise<boolean> {
      if (typeof pin !== 'string' || !PIN_PATTERN.test(pin)) return false;
      const hash = await hashSecret(pin);
      db.prepare('INSERT INTO kids_pin (id, hash) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET hash = excluded.hash').run(hash);
      failures = lockedUntil = 0;
      return true;
    },

    /** Counts the try before the slow hash runs, so a burst of parallel requests cannot get more than MAX_TRIES. */
    async check(pin: unknown): Promise<PinCheck> {
      const hash = stored();
      if (!hash) return { ok: false, reason: 'unset' };
      const t = now();
      if (t < lockedUntil) return locked(t);
      if (++failures > MAX_TRIES) return lock(t);
      if (typeof pin === 'string' && PIN_PATTERN.test(pin) && (await verifySecret(pin, hash))) {
        failures = 0;
        return { ok: true };
      }
      return failures >= MAX_TRIES ? lock(t) : { ok: false, reason: 'wrong', triesLeft: MAX_TRIES - failures };
    },
  };
}
