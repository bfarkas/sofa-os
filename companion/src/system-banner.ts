import type { SystemStatus } from '@sofa/shared';

/** The Home Assistant outage notice for the Companion home page; null when there is nothing to say. */
export function outageText(s: SystemStatus): string | null {
  if (s.haReachable !== false) return null;
  const since = s.haSince ? ' since ' + new Date(s.haSince).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  return `Home Assistant is not reachable${since}. Until it is back: no Watch Allowance warning, no Top-up by notification, no automatic switch-off and no Phone Remote.`;
}

/** The last backup, in words; a failed or missing backup says so. */
export function backupText(s: SystemStatus): string {
  if (s.backup.lastError) return 'The last backup failed. Check the Server log.';
  return s.backup.lastAt ? 'Last backup: ' + new Date(s.backup.lastAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'No backup yet.';
}

/** Polls /api/system into two elements. Stops quietly if the page is signed out (the caller clears the returned timer). */
export function startBanner(banner: HTMLElement, backup: HTMLElement, fetchStatus: () => Promise<SystemStatus>): ReturnType<typeof setInterval> {
  const tick = () =>
    fetchStatus().then(
      (s) => {
        const text = outageText(s);
        banner.hidden = !text;
        banner.textContent = text;
        backup.textContent = backupText(s);
      },
      () => {}, // the Server itself is down or the session ended; the page already says so
    );
  void tick();
  return setInterval(tick, 15_000);
}
