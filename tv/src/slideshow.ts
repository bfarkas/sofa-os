// The slideshow without the DOM: which picture is next, when, and what to do when one fails to load. photoview.ts holds
// the two <img> layers and does the loading, so at most two pictures are decoded at once: the one on screen and the next one
// while it fades in. The next picture is loaded only after the current one has been shown for its interval, and the one that
// faded out is released (photoview.ts). A picture that fails is skipped; if several fail in a row the show gives up.
export interface SlideshowOptions {
  count: number; // how many pictures there are
  intervalMs: number;
  /** Loads picture `index` into the hidden layer. Resolves when it can be shown, rejects when it cannot be loaded. */
  load(index: number): Promise<void>;
  /** Fades the loaded picture in and releases the one it replaces. */
  show(index: number): void;
  onGiveUp(): void; // every picture failed
  onChange?(): void; // the index or the paused state changed
}

const MAX_FAILURES = 5;

export function createSlideshow(o: SlideshowOptions) {
  let index = -1; // the picture on screen
  let cursor = -1; // where the next step starts from: the picture on screen, or one that failed and was stepped over
  let ticket = 0; // a load that finishes after another was asked for is dropped
  let timer: ReturnType<typeof setTimeout> | undefined;
  let paused = false;
  let stopped = true;

  function schedule(): void {
    clearTimeout(timer);
    if (!paused && !stopped && o.count > 1) timer = setTimeout(() => go(1), o.intervalMs);
  }

  function go(step: number, failures = 0): void {
    if (stopped || !o.count) return;
    const mine = ++ticket;
    const target = (((cursor < 0 ? (step > 0 ? -1 : 0) : cursor) + step) % o.count + o.count) % o.count;
    clearTimeout(timer);
    o.load(target).then(
      () => {
        if (mine !== ticket || stopped) return;
        index = cursor = target;
        o.show(target);
        if (o.onChange) o.onChange();
        schedule();
      },
      () => {
        if (mine !== ticket || stopped) return;
        if (failures + 1 >= Math.min(o.count, MAX_FAILURES)) {
          stopped = true;
          o.onGiveUp();
        } else {
          cursor = target; // step over it
          go(step, failures + 1);
        }
      },
    );
  }

  return {
    start(): void {
      stopped = false;
      paused = false;
      index = cursor = -1;
      go(1);
    },
    stop(): void {
      stopped = true;
      ticket++;
      clearTimeout(timer);
    },
    next: () => go(1),
    prev: () => go(-1),
    /** Pauses or resumes the timer (not a load already under way). Returns whether it is paused now. */
    toggle(): boolean {
      paused = !paused;
      if (paused) clearTimeout(timer);
      else schedule();
      if (o.onChange) o.onChange();
      return paused;
    },
    /** Stops the timer without ending the show, e.g. while the app is in the background. */
    suspend(): void {
      clearTimeout(timer);
    },
    resume(): void {
      if (index >= 0) schedule();
    },
    index: () => index,
    paused: () => paused,
  };
}
