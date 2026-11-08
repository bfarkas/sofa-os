import type { KidsStatus } from '@sofa/shared';

// What Companion says about the Watch Allowance. Pure, so the wording is tested without a browser.

export const clock = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds));
  return Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
};

export type TopupView =
  | { kind: 'running'; left: string; text: string } // time is running: Top-up buttons make sense
  | { kind: 'expired'; left: string; text: string } // Kids Mode is on and the time is used up: the TV is off or showing the Done Screen
  | { kind: 'none'; left: string; text: string }; // Kids Mode is off, so no allowance is running

/** The Top-up page (the tap target of the warning notification). Buttons show only for `running`. */
export function topupView(s: KidsStatus): TopupView {
  if (!s.active) return { kind: 'none', left: '', text: 'No allowance running. Kids Mode is off.' };
  if (s.remainingSeconds <= 0) return { kind: 'expired', left: '0:00', text: 'Expired. Today’s allowance is used up. Open the Kids Mode page to add time.' };
  return { kind: 'running', left: clock(s.remainingSeconds), text: s.tv === 'on' ? 'left today. The clock is running.' : 'left today. The clock is waiting for the TV.' };
}

/** A few plain lines for the Kids Mode page. */
export function statusText(s: KidsStatus): string {
  const lines = [s.active ? 'Kids Mode is on.' : 'Kids Mode is off.', 'TV: ' + (s.tv === 'pending' ? 'on, not confirmed yet' : s.tv) + '.'];
  lines.push(clock(s.remainingSeconds) + ' of ' + Math.round((s.dailySeconds + s.topUpSeconds) / 60) + ' min left today' + (s.topUpSeconds ? ' (' + Math.round(s.topUpSeconds / 60) + ' min Top-up).' : '.'));
  if (s.active && s.remainingSeconds <= 0) lines.push('The allowance is used up.');
  return lines.join(' ');
}
