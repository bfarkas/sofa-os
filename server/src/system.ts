import type { SystemStatus } from '@sofa/shared';
import type { BackupStatus } from './backup.ts';

/** What Companion's status banner shows: whether Home Assistant answers (as the Watch Allowance tick last saw it) and the last backup. */
export function createSystem(mode: SystemStatus['homeAssistant'] = 'off', now: () => number = Date.now) {
  let reachable: boolean | null = null; // unknown until the first tick
  let since: number | null = null;
  let backups: () => BackupStatus = () => ({ lastAt: null, lastError: null });
  return {
    setHaReachable(ok: boolean): void {
      if (ok !== reachable) since = now();
      reachable = ok;
    },
    setBackups(status: () => BackupStatus): void {
      backups = status;
    },
    status: (): SystemStatus => ({
      homeAssistant: mode,
      haReachable: mode === 'off' ? null : reachable,
      haSince: since === null ? null : new Date(since).toISOString(),
      backup: backups(),
    }),
  };
}
export type System = ReturnType<typeof createSystem>;
