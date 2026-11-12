# Sofa.OS Next Version Plan

The [implementation plan](implementation-plan.md) ends at Session 37 and is now a record: Phases 0 to 4 are built. New work is collected here instead. This file starts as an inbox of ideas and changes. When the user picks one, it becomes a session with the same format as the old plan (difficulty, model, effort, needs; what and why; tests; done when), numbered from 38 so that commit messages and references stay unambiguous.

How an idea moves: **Inbox** (one line, no design) → **Picked** (the user decided, mockups first for anything visual) → **Session** (written out below, built) → **Done** (one line with the commit, then deleted from here when it no longer helps).

## Inbox

Ideas and changes the user wants, one line each, newest at the top. Nothing is designed yet.

- (empty)

## Carried over from the old plan

Open items that were not finished when the old plan was closed. Each stays here until it is done or dropped.

**Needs a look on the real TV** (Sessions 34 to 37 were built and tested in the desktop harness only):

- Waste widget (added to the Dashboard 2026-11-12): bin colours are my guess for the Hannover bins, confirm them. "Today" shows until the integration's day switch (10:00 by default); check on 17 Nov, and if the household wants "Today" to end earlier, read the calendar entity too.
- Weather card and 24 hour view, calendar agenda card and week board, and the five colour schemes: the user chooses a scheme in Companion (Appearance) and checks all four wallpapers. Lamplight's warn colour is only 3:1 over the morning sky.
- Session 32 items 4 to 6: app icons for ARD, ZDF and KiKA, the Kids Mode tile's prominence from the sofa, and midday and night on the panel.

**Not built** from the design critiques (Sessions 32 and 33):

- Sofa Home: Kids grid focus on load and tile sizing (item 2), Widgets tab badge and hint line (item 3), a code or QR for the Server address in Settings (item 7).
- Companion: Home as status first (item 2), the editor on a phone (item 3), Kids page wording (item 4), small fixes (item 5).

**Deployment state:** Server on rei3 at 419c1cc and Sofa Home reinstalled on the TV on 2026-11-12.
