// Which day-cycle picture is on: the period of the TV's clock, or of a fake hour for testing (SOFA_FAKE_HOUR, see the plan, Session 29).
import { periodAt, type DayPeriod } from '@sofa/shared';

/** The first usable fake hour (a whole number 0 to 23, as a number or a string); anything else is ignored. null means use the clock. */
export function fakeHour(...candidates: unknown[]): number | null {
  for (const c of candidates) {
    if ((typeof c === 'number' || (typeof c === 'string' && c.trim() !== '')) && Number.isInteger(Number(c)) && Number(c) >= 0 && Number(c) <= 23) return Number(c);
  }
  return null;
}

export const currentPeriod = (now: Date, fake: number | null): DayPeriod => periodAt(fake === null ? now.getHours() : fake);
