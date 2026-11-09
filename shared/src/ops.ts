// The layout changes Sofa Home makes (Session 16, ADR 0004): small operations on a widget id. The Server applies one to the
// current revision and replays it onto open Companion drafts, so the same function runs on both. Runs on the TV (ES2017).
import { ROW_UNITS, UNITS, type Layout, type Row } from './layout.ts';

export type LayoutOp =
  | { op: 'move'; widget: string; index: number } // to this position among the items of its Dashboard row (clamped)
  | { op: 'remove'; widget: string } // off the Dashboard; the widget itself stays
  | { op: 'add'; widget: string }; // onto the Dashboard: the end of the first widget row with room for it, or a new row

/** Body of POST /api/layout/ops. `base` is the revision Sofa Home showed; any other is refused with 409. */
export interface LayoutOpRequest {
  base: number;
  op: LayoutOp;
}

const isWidget = (id: string) => (i: { kind: string; id: string }) => i.kind === 'widget' && i.id === id;

/** The layout with `op` applied, or null when it does not apply: the widget is not on the Dashboard (move, remove), or does not exist or already is (add). */
export function applyOp(l: Layout, op: LayoutOp): Layout | null {
  const at = isWidget(op.widget);
  const row = l.rows.filter((r) => r.items.some(at))[0];
  if (op.op === 'add') {
    if (row || !l.widgets.some((w) => w.id === op.widget)) return null;
    const item = { kind: 'widget' as const, id: op.widget };
    // The first widget row with room for it, since a row clips anything past ROW_UNITS without a hint.
    const units = (id: string) => {
      const w = l.widgets.filter((x) => x.id === id)[0];
      return w ? UNITS[w.size] || 0 : 0;
    };
    const target = l.rows.filter(
      (r) => r.items.some((i) => i.kind === 'widget') && r.items.reduce((n, i) => n + (i.kind === 'widget' ? units(i.id) : 0), units(op.widget)) <= ROW_UNITS,
    )[0];
    if (target) return { ...l, rows: l.rows.map((r) => (r === target ? { ...r, items: r.items.concat(item) } : r)) };
    let n = l.rows.length + 1;
    while (l.rows.some((r) => r.id === 'row-' + n)) n++;
    return { ...l, rows: l.rows.concat({ id: 'row-' + n, title: 'Widgets', items: [item] }) };
  }
  if (!row) return null;
  const rest = row.items.filter((i) => !at(i));
  let next: Row;
  if (op.op === 'remove') next = { ...row, items: rest };
  else {
    const i = Math.max(0, Math.min(rest.length, Math.floor(op.index)));
    next = { ...row, items: rest.slice(0, i).concat({ kind: 'widget', id: op.widget }, rest.slice(i)) };
  }
  return { ...l, rows: l.rows.map((r) => (r === row ? next : r)) };
}

/** Checks a request body at the trust boundary: an operation of a known kind on a widget id. */
export function isLayoutOp(v: unknown): v is LayoutOp {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== 'object' || typeof o.widget !== 'string' || !o.widget || o.widget.length > 64) return false;
  if (o.op === 'move') return typeof o.index === 'number' && Number.isInteger(o.index) && o.index >= 0 && o.index < 50;
  return o.op === 'remove' || o.op === 'add';
}
