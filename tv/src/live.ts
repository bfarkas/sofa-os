// The front door's full-screen live view (Session 42), without the DOM. OK on the camera widget opens it, Back closes it, and it
// closes itself after LIVE_MS. It tells the Server on open (which switches the stream on and answers with Home Assistant's HLS
// URL) and on close; the Server has its own timeout too. The TV holds no Home Assistant token: the URL carries a short-lived one.
// To play the stream through the Server instead (if the TV cannot play Home Assistant's HLS itself), change only what `open` returns.
import type { RemoteEvent } from './keys.ts';
import type { CardView } from './widgets.ts';

export const LIVE_MS = 2 * 60_000;

/** A camera card: a photo the Server proxies from the front door (server/src/adapters/camera.ts). */
export const isCameraCard = (v: CardView): boolean => v.state === 'ok' && v.card.template === 'photo' && v.card.image.indexOf('/api/camera/') === 0;

export interface LiveDeps {
  open(): Promise<string>; // POST /api/camera/live/open: the HLS URL
  close(): void; // POST /api/camera/live/close, fire and forget
  show(view: { url: string | null; message: string }): void; // draw the view (message while there is no url)
  hide(): void;
  onClosed(): void; // the view closed itself (timeout); the caller gives the screen back
  setTimer?: (f: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

export function createLive(d: LiveDeps) {
  const setT = d.setTimer || ((f, ms) => setTimeout(f, ms));
  const clearT = d.clearTimer || ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  let active = false;
  let ticket = 0; // an answer for a view that has been closed is ignored
  let timer: unknown;

  function end(): void {
    active = false;
    ticket++;
    clearT(timer);
    d.hide();
    d.close();
  }

  return {
    isOpen: () => active,
    open(): void {
      if (active) return;
      active = true;
      const mine = ++ticket;
      d.show({ url: null, message: 'Starting the camera…' });
      timer = setT(() => {
        end();
        d.onClosed();
      }, LIVE_MS);
      d.open().then(
        (url) => mine === ticket && d.show({ url, message: '' }),
        () => mine === ticket && d.show({ url: null, message: 'The camera is not available right now.' }),
      );
    },
    close(): void {
      if (active) end();
    },
    /** A key while the view is open: Back closes it (true), the rest does nothing. */
    key(e: RemoteEvent): boolean {
      if (e.key !== 'back' || !active) return false;
      end();
      return true;
    },
  };
}
export type Live = ReturnType<typeof createLive>;
