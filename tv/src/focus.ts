// The focus manager: arrows move between tiles by an explicit model of rows of ids, never by what the browser would guess.
// A layer is one screen's grid. Overlays are pushed on top and popped by Back; the layer below keeps its focus, so
// popping lands on the tile that opened the overlay. Nothing here touches the DOM: `onChange` says which id to highlight.
export type Dir = 'left' | 'right' | 'up' | 'down';

export interface GridOptions {
  wrap?: boolean; // arrows wrap around the edges (menus); the default stops at the edge
  bar?: boolean; // rows[0] is a bar (tabs): Down leaves it for the first tile of rows[1], Up returns to the bar item last focused
}

interface Layer extends GridOptions {
  rows: string[][];
  cur: string | null;
  want: number; // the column vertical moves aim for, so a short row does not forget where you were
  barMem: string | null;
}

const layer = (rows: string[][], o: GridOptions): Layer => ({ rows: rows.filter((r) => r.length), wrap: o.wrap, bar: o.bar, cur: null, want: 0, barMem: null });

export function createFocus(onChange: (id: string | null) => void) {
  const layers: Layer[] = [layer([], {})];
  const top = () => layers[layers.length - 1];

  function find(l: Layer, id: string | null): [number, number] | null {
    if (id === null) return null;
    for (let r = 0; r < l.rows.length; r++) {
      const c = l.rows[r].indexOf(id);
      if (c >= 0) return [r, c];
    }
    return null;
  }

  function put(l: Layer, r: number, c: number): void {
    l.cur = l.rows[r][c];
    l.want = c;
    if (l.bar && r === 0) l.barMem = l.cur;
  }

  // Calls onChange if the focused id of the visible layer is not what it was before `change` ran.
  function changing(change: () => void): void {
    const before = top().cur;
    change();
    if (top().cur !== before) onChange(top().cur);
  }

  function settle(l: Layer, was: [number, number] | null): void {
    if (find(l, l.cur)) return;
    const n = l.rows.length;
    if (!n) {
      l.cur = null;
      return;
    }
    const r = was ? Math.min(was[0], n - 1) : 0;
    put(l, r, was ? Math.min(was[1], l.rows[r].length - 1) : 0);
  }

  return {
    /** Replaces the base screen's grid. Focus stays on the same id, or on the nearest position if that id is gone. */
    setBase(rows: string[][], o: GridOptions = {}): void {
      const base = layers[0];
      const was = find(base, base.cur);
      const next = layer(rows, o);
      next.cur = base.cur;
      next.want = base.want;
      next.barMem = base.barMem;
      layers[0] = next;
      const bar = find(next, next.barMem);
      if (!bar || bar[0] !== 0) next.barMem = null;
      if (layers.length === 1) changing(() => settle(next, was));
      else settle(next, was); // an overlay is showing: its focus is what counts
    },

    /** Opens an overlay with its own grid and focuses `start` (default: the first tile). */
    push(rows: string[][], o: GridOptions & { start?: string } = {}): void {
      const l = layer(rows, o);
      layers.push(l);
      const p = find(l, o.start || null);
      if (p) put(l, p[0], p[1]);
      else settle(l, null);
      onChange(l.cur);
    },

    /** Closes the top overlay and focuses the tile below that opened it. False when only the base screen is left. */
    pop(): boolean {
      if (layers.length < 2) return false;
      layers.pop();
      onChange(top().cur);
      return true;
    },

    focus(id: string): boolean {
      const l = top();
      const p = find(l, id);
      if (!p) return false;
      changing(() => put(l, p[0], p[1]));
      return true;
    },

    /** Moves one step. False if there was nowhere to go (an edge, or nothing to focus). */
    move(dir: Dir): boolean {
      const l = top();
      const p = find(l, l.cur);
      if (!p) {
        const had = l.cur;
        settle(l, null);
        if (l.cur !== had) onChange(l.cur);
        return l.cur !== null && l.cur !== had;
      }
      const [r, c] = p;
      const n = l.rows.length;
      let tr = r, tc = c;
      if (dir === 'left' || dir === 'right') {
        const len = l.rows[r].length;
        tc = c + (dir === 'left' ? -1 : 1);
        if (tc < 0 || tc >= len) {
          if (!l.wrap || len < 2) return false;
          tc = (tc + len) % len;
        }
      } else {
        tr = r + (dir === 'up' ? -1 : 1);
        if (tr < 0 || tr >= n) {
          if (!l.wrap || n < 2) return false;
          tr = (tr + n) % n;
        }
        if (l.bar && dir === 'down' && r === 0) tc = 0;
        else if (l.bar && dir === 'up' && tr === 0) {
          const m = find(l, l.barMem);
          tc = m && m[0] === 0 ? m[1] : 0;
        } else tc = Math.min(l.want, l.rows[tr].length - 1);
      }
      const keep = l.want;
      changing(() => {
        put(l, tr, tc);
        if (tr !== r && !(l.bar && (r === 0 || tr === 0))) l.want = keep; // a vertical move keeps its aim, except to and from the bar
      });
      return true;
    },

    /** Tells onChange the current focus again, e.g. after the app resumes. */
    refresh(): void {
      onChange(top().cur);
    },

    current: () => top().cur,
    depth: () => layers.length,
  };
}

export type Focus = ReturnType<typeof createFocus>;
