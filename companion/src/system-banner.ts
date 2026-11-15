import type { SystemStatus } from '@sofa/shared';

/** The Home Assistant outage notice for the Companion home page; null when there is nothing to say. */
export function outageText(s: SystemStatus): string | null {
  if (s.haReachable !== false) return null;
  const since = s.haSince ? ' since ' + new Date(s.haSince).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  return `Home Assistant is offline${since}. Until it’s back, the Remote, time warnings and the switch-off at zero don’t work.`;
}

/** The last backup, in words; a failed or missing backup says so. */
export function backupText(s: SystemStatus): string {
  if (s.backup.lastError) return 'The last backup failed. Check the Server log.';
  return s.backup.lastAt ? 'Last backup: ' + new Date(s.backup.lastAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'No backup yet.';
}
