import type { DatabaseSync } from 'node:sqlite';
import { applyOp, validateLayout, type Draft, type Layout, type LayoutOp, type Snapshot } from '@sofa/shared';

// Revision model (docs/implementation-plan.md, Session 05 note):
// - Revisions are numbered 1, 2, 3 without gaps; the highest is current. Each records `base`, the revision it was built on.
// - A draft records `base`, the revision it started from. Publishing commits the draft as current + 1 and deletes it,
//   in one transaction, and is refused unless draft.base is still current. So a publish never silently drops a
//   revision the draft has not seen.
// - Sofa Home's changes are operations (ADR 0004): commitOp applies one to the current revision, records it on the new
//   revision and replays it onto each draft based on the current revision, moving that draft forward. saveDraft accepts an
//   older base when only such operations follow it, and replays them onto the sent layout.

interface RevisionRow {
  number: number;
  layout: string;
  created_at: number;
}
interface DraftRow {
  id: number;
  base: number;
  layout: string;
}

const currentRow = (db: DatabaseSync) =>
  db.prepare('SELECT number, layout, created_at FROM revisions ORDER BY number DESC LIMIT 1').get() as unknown as RevisionRow;

export function currentSnapshot(db: DatabaseSync): Snapshot {
  const row = currentRow(db);
  return { revision: row.number, publishedAt: new Date(row.created_at).toISOString(), layout: JSON.parse(row.layout) as Layout };
}

/**
 * What the Kids Mode profile may retrieve: the approved apps in tile order, the widgets that are visible to kids, and only
 * the Dashboard rows' items that remain. Still a valid layout, so Sofa Home's validator and renderer work on it unchanged.
 * Curation, not containment (ADR 0001): the household snapshot stays readable with the TV's token.
 */
export function kidsView(snapshot: Snapshot): Snapshot {
  const { layout } = snapshot;
  const byId = new Map(layout.apps.map((a) => [a.id, a]));
  const apps = layout.kidsMode.apps.flatMap((id) => byId.get(id) ?? []);
  const widgets = layout.widgets.filter((w) => w.profiles.includes('kids'));
  const keep = new Set([...apps.map((a) => 'app:' + a.id), ...widgets.map((w) => 'widget:' + w.id)]);
  const rows = layout.rows
    .map((r) => ({ ...r, items: r.items.filter((i) => keep.has(i.kind + ':' + i.id)) }))
    .filter((r) => r.items.length);
  return { ...snapshot, layout: { ...layout, apps, widgets, rows, kidsMode: { ...layout.kidsMode, apps: apps.map((a) => a.id) } } };
}

function toDraft(row: DraftRow): Draft {
  const layout: unknown = JSON.parse(row.layout);
  return { id: row.id, base: row.base, layout, errors: validateLayout(layout) };
}

const draftRow = (db: DatabaseSync, id: number) =>
  db.prepare('SELECT id, base, layout FROM drafts WHERE id = ?').get(id) as unknown as DraftRow | undefined;

/** Starts a draft from the current revision. */
export function createDraft(db: DatabaseSync, now = Date.now()): Draft {
  const cur = currentRow(db);
  const { lastInsertRowid } = db.prepare('INSERT INTO drafts (base, layout, updated_at) VALUES (?, ?, ?)').run(cur.number, cur.layout, now);
  return toDraft({ id: Number(lastInsertRowid), base: cur.number, layout: cur.layout });
}

export function getDraft(db: DatabaseSync, id: number): Draft | undefined {
  const row = draftRow(db, id);
  return row && toDraft(row);
}

/** A draft layout may be anything Companion sent; an operation that cannot apply to it leaves it as it was. */
function replay(layout: unknown, op: LayoutOp): unknown {
  try {
    return applyOp(layout as Layout, op) ?? layout;
  } catch {
    return layout;
  }
}

/**
 * Saves a draft's layout as sent, valid or not. `base` is the draft's base, or an earlier revision followed only by Sofa Home's
 * operations: those are replayed onto the layout and the draft moves to the current revision. Anything else is 'stale'.
 */
export function saveDraft(db: DatabaseSync, id: number, base: number, layout: unknown, now = Date.now()): Draft | 'missing' | 'stale' {
  const row = draftRow(db, id);
  if (!row) return 'missing';
  if (base > row.base) return 'stale';
  const after = db.prepare('SELECT number, op FROM revisions WHERE number > ? ORDER BY number').all(base) as unknown as { number: number; op: string | null }[];
  let merged = layout;
  for (const r of after) {
    if (r.op === null) return 'stale'; // a Companion publish: whole layouts do not merge
    merged = replay(merged, JSON.parse(r.op) as LayoutOp);
  }
  const json = JSON.stringify(merged);
  const top = after.length ? after[after.length - 1].number : base;
  db.prepare('UPDATE drafts SET base = ?, layout = ?, updated_at = ? WHERE id = ?').run(top, json, now, id);
  return toDraft({ id, base: top, layout: json });
}

export function deleteDraft(db: DatabaseSync, id: number): boolean {
  return db.prepare('DELETE FROM drafts WHERE id = ?').run(id).changes > 0;
}

export type PublishResult = { ok: true; snapshot: Snapshot } | { ok: false; reason: 'missing' | 'stale' | 'invalid'; errors: string[] };

/** Commits a valid draft as the next revision and deletes the draft, atomically. `check` adds problems the schema cannot see (widget config against the catalogue). */
export function publishDraft(db: DatabaseSync, id: number, now = Date.now(), check?: (layout: Layout) => string[]): PublishResult {
  const row = draftRow(db, id);
  if (!row) return { ok: false, reason: 'missing', errors: [] };
  const draft = toDraft(row);
  const errors = draft.errors.length ? draft.errors : (check?.(draft.layout as Layout) ?? []);
  if (errors.length) return { ok: false, reason: 'invalid', errors };
  db.exec('BEGIN IMMEDIATE');
  try {
    const current = currentRow(db).number;
    if (row.base !== current) {
      db.exec('ROLLBACK');
      return { ok: false, reason: 'stale', errors: [`draft is based on revision ${row.base}, current is ${current}`] };
    }
    db.prepare('INSERT INTO revisions (number, base, layout, created_at) VALUES (?, ?, ?, ?)').run(current + 1, row.base, row.layout, now);
    db.prepare('DELETE FROM drafts WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { ok: true, snapshot: currentSnapshot(db) };
}

export type OpResult = { ok: true; snapshot: Snapshot } | { ok: false; status: 409 | 422; error: string; errors?: string[] };

/** Applies Sofa Home's operation to the current revision as the next one, and replays it onto the drafts based on it, atomically. */
export function commitOp(db: DatabaseSync, base: number, op: LayoutOp, now = Date.now()): OpResult {
  db.exec('BEGIN IMMEDIATE');
  try {
    const cur = currentRow(db);
    const next = cur.number === base ? applyOp(JSON.parse(cur.layout) as Layout, op) : null;
    const errors = next ? validateLayout(next) : [];
    if (!next || errors.length) {
      db.exec('ROLLBACK');
      if (cur.number !== base) return { ok: false, status: 409, error: `the layout changed: revision ${cur.number} is current, not ${base}` };
      return next ? { ok: false, status: 422, error: 'layout is invalid', errors } : { ok: false, status: 409, error: 'that widget is not where the TV showed it' };
    }
    db.prepare('INSERT INTO revisions (number, base, layout, created_at, op) VALUES (?, ?, ?, ?, ?)').run(cur.number + 1, cur.number, JSON.stringify(next), now, JSON.stringify(op));
    const drafts = db.prepare('SELECT id, base, layout FROM drafts WHERE base = ?').all(cur.number) as unknown as DraftRow[];
    const move = db.prepare('UPDATE drafts SET base = ?, layout = ? WHERE id = ?');
    for (const d of drafts) move.run(cur.number + 1, JSON.stringify(replay(JSON.parse(d.layout), op)), d.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { ok: true, snapshot: currentSnapshot(db) };
}
