# TV changes are operations replayed onto drafts

Sofa Home changes the layout in three small ways (move a Dashboard widget along its row, remove it from the Dashboard, add it to the Dashboard), while Companion edits whole layouts in a draft. We send the TV's changes as **operations on widget ids**, not as layouts: the Server applies one to the current revision, commits the result as a new revision that records the operation, and replays the same operation onto every open draft. Whole layouts cannot be merged, but an operation can be replayed onto a layout that has changed since, so a TV change is never lost to a Companion publish and a Companion draft is never lost to a TV change. Two Companion publishes still conflict as before (409, reload), because nothing smaller than a whole layout records what Companion meant.

## The operations

`shared/src/ops.ts`, `applyOp(layout, op)`; the same function runs on the Server and in Sofa Home.

- **move** `{ op: 'move', widget, index }`: the widget goes to position `index` among the items of the row it is in (apps and hidden widgets count), clamped to the row's end.
- **remove** `{ op: 'remove', widget }`: the widget leaves the Dashboard. The widget itself stays (Widgets tab).
- **add** `{ op: 'add', widget }`: the widget goes to the end of the first row that holds a widget, or to a new row titled Widgets, as Companion's "On the Dashboard" does.

An operation that does not apply returns nothing: move or remove of a widget that is not on the Dashboard, add of a widget that does not exist or is already there.

## The rule

1. **On the TV's revision.** Sofa Home sends `{ base, op }`. The Server refuses it with 409 unless `base` is the current revision (the TV acted on a layout it no longer shows) or if the operation does not apply to it, and with 422 if the result fails validation. Otherwise, in one transaction, it commits the result as the next revision with the operation recorded, and replays the operation onto **every draft whose base is the current revision**, moving that draft's base forward. A draft that does not apply the operation keeps its layout and still moves forward. Drafts already left behind by a Companion publish are not touched: they are stale either way.
2. **Replaying onto a draft is "the TV's change, on top of the draft"**, with the draft winning where the TV's change no longer makes sense:
   - The draft took the widget off the Dashboard or deleted it, and the TV moved or removed it: the widget stays off. Nothing to move.
   - The draft deleted the widget, and the TV added it: it stays deleted.
   - The draft already put the widget on the Dashboard, and the TV added it: the draft's place stands.
   - The draft moved the widget to another row, and the TV moved it: it stays in the draft's row, at the TV's position (clamped).
   - The draft moved the widget along the same row, and the TV moved it: the TV's position wins.
   - The draft moved it, and the TV removed it: it is removed.
   - Anything else the draft changed (other widgets, rows, apps, settings) is kept as is.
3. **Saving a draft with an older base.** Companion's open page still holds the layout from before the TV's change. `PUT /api/drafts/:id { base, layout }` is accepted when `base` is the draft's base **or an earlier revision followed only by TV operations**: the Server replays those operations onto the sent layout and stores it with the current base. The response carries the merged `{ base, layout }`, and Companion adopts both together (only if nothing was edited while the request ran; otherwise it keeps its old base and the next save replays again). Operations are idempotent when replayed on a layout that already has them, so a repeated replay is harmless; adopting `base` with the layout is what lets an adult undo a TV change in Companion afterwards.
4. **Publishing** is unchanged: a draft publishes only if its base is current. Rules 1 and 3 keep a draft current across TV changes, so publishing an older draft keeps the TV's change. A draft behind a Companion publish is refused with 409, as before, and so is a save that would need to merge across one.

## Who may send operations

`POST /api/layout/ops` takes the TV's device token (or a Companion session). It is refused while Kids Mode or the Done Screen is active: editing is for the household screen, and Sofa Home offers no menus in Kids Mode. That is the only adult check, in line with ADR 0001 (curation, not containment) and ADR 0002 (one trusted TV).
