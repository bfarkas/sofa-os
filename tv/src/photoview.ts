// Draws photos: the full-screen album slideshow and ambient view, and the Dashboard background. The memory rule for the TV:
// every show owns exactly two <img> layers, so at most two pictures are decoded at once, and a layer is emptied (its src
// removed) as soon as it has faded out. While the slideshow or ambient view is open the background gives up its layers too,
// and while the app is in the background every timer stops. The order and timing are in slideshow.ts.
import { dayImage, type DayPeriod, type Profile } from '@sofa/shared';
import { AMBIENT_MS, BACKGROUND_MS, SLIDESHOW_MS, type AlbumImages } from './photos.ts';
import type { RemoteEvent } from './keys.ts';
import { clockText, dateText } from './shell.ts';
import { createSlideshow } from './slideshow.ts';

const FADE_MS = 1000; // matches the opacity transition in photos.css
const DAY_FADE_MS = 2000; // the day cycle fades slower: `#bg.day` in photos.css
const $ = (id: string) => document.getElementById(id)! as HTMLElement;

interface Layer {
  el: HTMLImageElement;
  release?: ReturnType<typeof setTimeout>;
}

/** Two stacked images: load the next one in the hidden layer, fade it in, then empty the one that faded out. */
function createLayers(a: HTMLImageElement, b: HTMLImageElement, note: (text: string) => void, fadeMs: () => number = () => FADE_MS) {
  let front: Layer = { el: a }, back: Layer = { el: b };
  const empty = (l: Layer) => {
    clearTimeout(l.release);
    l.el.onload = l.el.onerror = null;
    l.el.removeAttribute('src');
    l.el.classList.remove('on');
  };
  return {
    load(url: string): Promise<void> {
      clearTimeout(back.release);
      const t0 = Date.now();
      return new Promise((resolve, reject) => {
        back.el.onload = () => {
          const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory; // Chromium only; the TV log shows whether memory stays flat
          note('photo loaded in ' + (Date.now() - t0) + ' ms, ' + back.el.naturalWidth + 'x' + back.el.naturalHeight + (heap ? ', js heap ' + Math.round(heap.usedJSHeapSize / 1e5) / 10 + ' MB' : ''));
          resolve();
        };
        back.el.onerror = () => reject(new Error('picture failed to load'));
        back.el.src = url;
      });
    },
    show(): void {
      back.el.classList.add('on');
      front.el.classList.remove('on');
      const old = front;
      front = back;
      back = old;
      old.release = setTimeout(() => empty(old), fadeMs() + 300);
    },
    clear(): void {
      empty(front);
      empty(back);
    },
  };
}

export type Getter = (album: string, profile: Profile) => Promise<AlbumImages>;

export interface PhotoViewDeps {
  server(): string;
  images: Getter; // GET /api/photos/albums/<id>/images
  log?(text: string): void; // a line for the TV log: how long each picture took to load
}

export function createPhotoView(deps: PhotoViewDeps) {
  const overlay = $('photos');
  const note = (t: string) => deps.log?.(t);
  const layers = createLayers($('pl-a') as HTMLImageElement, $('pl-b') as HTMLImageElement, (t) => note('show ' + t));
  const bgLayers = createLayers($('bg-a') as HTMLImageElement, $('bg-b') as HTMLImageElement, (t) => note('bg ' + t), () => (bgSpec && bgSpec.day ? DAY_FADE_MS : FADE_MS));
  let show: ReturnType<typeof createSlideshow> | null = null;
  let clockTimer: ReturnType<typeof setInterval> | undefined;
  let opened = 0; // ticket: an answer for a view that has been closed is ignored
  let isOpen = false;
  let mode: 'ambient' | 'slideshow' = 'ambient';
  let name = '';
  let total = 0;

  // ---- the background ----
  let bgKey = '';
  let bgShow: ReturnType<typeof createSlideshow> | null = null;
  let bgSpec: { path?: string; album?: string; day?: DayPeriod } | null = null;
  let bgPlace = 0; // where the slideshow carries on after it was suspended
  let bgCount = 1;
  let bgRetry: ReturnType<typeof setTimeout> | undefined;
  let suspended = false;

  function stopBackground(): void {
    clearTimeout(bgRetry);
    if (bgShow) bgPlace = (bgPlace + bgShow.index() + 1) % bgCount;
    if (bgShow) bgShow.stop();
    bgShow = null;
    bgLayers.clear();
  }

  function startBackground(): void {
    const spec = bgSpec;
    if (!spec || suspended) return;
    $('bg').hidden = false;
    if (spec.day) return void bgLayers.load(dayImage(spec.day)).then(() => bgLayers.show(), () => {}); // from the package, not the Server
    if (spec.path) {
      const path = spec.path;
      bgLayers.load(deps.server() + path).then(() => bgLayers.show(), () => {});
      return;
    }
    deps.images(spec.album!, 'household').then(
      (a) => {
        if (spec !== bgSpec || suspended || !a.images.length) return;
        const n = (bgCount = a.images.length);
        bgShow = createSlideshow({
          count: n,
          intervalMs: BACKGROUND_MS,
          load: (i) => bgLayers.load(deps.server() + a.images[(i + bgPlace) % n]),
          show: () => bgLayers.show(),
          onGiveUp: () => stopBackground(),
        });
        bgShow.start();
      },
      () => {
        bgRetry = setTimeout(startBackground, 60_000); // the Server or Immich is away: try again in a minute
      },
    );
  }

  // ---- the full-screen view ----
  function caption(): void {
    const paused = !!show && show.paused();
    $('pl-cap').textContent = mode === 'slideshow' && show && total ? name + '   ' + (show.index() + 1) + ' / ' + total + (paused ? '   Paused' : '') : paused ? 'Paused' : '';
    $('pl-cap').hidden = !$('pl-cap').textContent;
  }

  function tickClock(): void {
    const d = new Date();
    $('pl-time').textContent = clockText(d);
    $('pl-date').textContent = dateText(d);
  }

  function message(text: string): void {
    $('pl-msg').textContent = text;
    $('pl-msg').hidden = !text;
  }

  function end(): void {
    opened++;
    if (show) show.stop();
    show = null;
    layers.clear();
    clearInterval(clockTimer);
    overlay.hidden = true;
    isOpen = false;
  }

  return {
    /** Opens the full-screen view of an album: a slideshow with its name, or the ambient view with the clock. */
    open(album: string, profile: Profile, how: 'ambient' | 'slideshow', title = ''): void {
      end();
      const mine = opened;
      mode = how;
      name = title;
      total = 0;
      isOpen = true;
      suspended = true;
      stopBackground(); // gives its decoded pictures back
      overlay.hidden = false;
      overlay.className = how;
      $('pl-clock').hidden = how !== 'ambient';
      $('pl-cap').hidden = true;
      message('Loading photos…');
      if (how === 'ambient') {
        tickClock();
        clockTimer = setInterval(tickClock, 10_000);
      }
      deps.images(album, profile).then(
        (a) => {
          if (mine !== opened) return;
          if (!a.images.length) return message('This album has no photos.');
          name = a.name;
          total = a.images.length;
          show = createSlideshow({
            count: total,
            intervalMs: how === 'ambient' ? AMBIENT_MS : SLIDESHOW_MS,
            load: (i) => layers.load(deps.server() + a.images[i]),
            show: () => {
              message('');
              layers.show();
            },
            onGiveUp: () => mine === opened && message('These photos cannot be loaded right now.'),
            onChange: caption,
          });
          show.start();
        },
        () => mine === opened && message('Photos are not available right now.'),
      );
    },

    /** Closes whatever is open and gives the background its place back. Safe to call any time. */
    close(): void {
      if (!isOpen && !suspended) return;
      end();
      suspended = false;
      startBackground();
    },

    isOpen: () => isOpen,

    /** A key while the view is open: arrows step, OK pauses or resumes, Back closes. Returns true when Back closed it. */
    key(e: RemoteEvent): boolean {
      if (e.key === 'back') return true;
      if (!show) return false;
      if (e.key === 'left') show.prev();
      else if (e.key === 'right') show.next();
      else if (e.key === 'ok') show.toggle();
      return false;
    },

    /** The Dashboard background: a Layout background that is a photo or a day-cycle picture, or null for a colour. Same input twice changes nothing. */
    setBackground(spec: { path: string } | { album: string } | { day: DayPeriod } | null): void {
      const key = JSON.stringify(spec);
      if (key === bgKey) return;
      bgKey = key;
      const swap = !!bgSpec && !!bgSpec.day && !!spec && 'day' in spec; // the next picture loads behind the one on screen, then fades over it: no empty frame
      if (!swap) {
        stopBackground();
        bgPlace = 0;
        $('bg').hidden = true;
      }
      bgSpec = spec;
      $('bg').className = spec && 'day' in spec ? 'day' : '';
      startBackground();
    },

    /** The app went to the background (or came back): stop every timer, keep the place. */
    pause(hidden: boolean): void {
      if (hidden) {
        if (show) show.suspend();
        if (bgShow) bgShow.suspend();
        clearInterval(clockTimer);
      } else {
        if (show) show.resume();
        if (bgShow) bgShow.resume();
        clearInterval(clockTimer);
        if (isOpen && mode === 'ambient') {
          tickClock();
          clockTimer = setInterval(tickClock, 10_000);
        }
      }
    },
  };
}

export type PhotoView = ReturnType<typeof createPhotoView>;
