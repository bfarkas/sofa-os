// The idle timer of the photo screensaver (Session 40) as a state machine with no timers of its own: Sofa Home feeds it the
// clock. It counts only while Sofa Home is in front and Kids Mode is off; Off (0 minutes) never fires; any key restarts the count.
// Once fired, the first key only wakes (key() returns true: the caller swallows it). Runs on the TV (Chromium 56): ES2017 only.
export function createIdle(now: () => number = Date.now) {
  let minutes = 0;
  let last = now(); // the last key, or the moment counting began
  let kids = false, hidden = false;
  let active = false; // the screensaver is showing

  const paused = () => kids || hidden;
  const restart = () => { last = now(); };

  return {
    /** The household setting in minutes; 0 is Off. */
    setMinutes(m: number): void {
      if (m !== minutes) restart();
      minutes = m;
    },
    /** Kids Mode on or off. Returns true when it ended a running screensaver. */
    setKids(on: boolean): boolean {
      kids = on;
      restart();
      const was = active;
      if (on) active = false;
      return was && on;
    },
    /** Sofa Home went to the background or came back: the count starts again from zero either way. */
    setHidden(on: boolean): void {
      hidden = on;
      restart();
    },
    /** Every key. True when it only woke the screensaver and must not act. */
    key(): boolean {
      restart();
      const wake = active;
      active = false;
      return wake;
    },
    /** Call every few seconds. True once, when the screensaver should start. */
    tick(): boolean {
      if (active || paused() || minutes <= 0 || now() - last < minutes * 60_000) return false;
      active = true;
      return true;
    },
    active: () => active,
  };
}
