// Remote keys as Sofa Home sees them. Key codes are from the TV tests in the spec (Known results): arrows 37 to 40,
// OK 13, Back 10009. Escape stands in for Back on a desktop browser.
//
// Long press: a held key sends one `keydown` and one `keyup`, no repeats, so a long press can only be told at release:
// OK is a long press when `keyup` comes LONG_PRESS_MS or more after `keydown`. Arrows and Back act on `keydown`.
// OK acts on `keyup`, as a short press (select) or a long press. Session 16 uses the long press for widget menus.
export const LONG_PRESS_MS = 500;

export type RemoteKey = 'left' | 'up' | 'right' | 'down' | 'ok' | 'back';

export interface RemoteEvent {
  key: RemoteKey;
  long: boolean; // only ever true for 'ok'
}

const CODES: Record<number, RemoteKey> = { 37: 'left', 38: 'up', 39: 'right', 40: 'down', 13: 'ok', 10009: 'back', 27: 'back' };

export function createRemote(emit: (e: RemoteEvent) => void, now: () => number = Date.now) {
  let downAt: Record<number, number> = {};
  return {
    /** Feed every `keydown`. True when the key is one of ours, so the caller stops the browser's own handling. */
    down(code: number): boolean {
      const key = CODES[code];
      if (!key) return false;
      if (downAt[code] !== undefined) return true; // a repeat, if a TV ever sends one
      downAt[code] = now();
      if (key !== 'ok') emit({ key, long: false });
      return true;
    },
    /** Feed every `keyup`. A `keyup` without our `keydown` (the key went down while another app had the screen) is ignored. */
    up(code: number): void {
      const t = downAt[code];
      delete downAt[code];
      if (t !== undefined && CODES[code] === 'ok') emit({ key: 'ok', long: now() - t >= LONG_PRESS_MS });
    },
    /** Forget keys that are down: blur, resume. Their `keyup` may never arrive here. */
    reset(): void {
      downAt = {};
    },
  };
}
