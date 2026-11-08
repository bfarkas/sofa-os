# Sofa.OS Implementation Plan

Derived from the [Architecture spec v0.2](Sofa.OS%20Architecture%20v0.2.md), [CONTEXT.md](../CONTEXT.md) and the [ADRs](adr/). The plan follows the spec's roadmap phases: 0 Hardware feasibility, 1 Kids Mode evening, 2 Household features, 3 Convenience.

Each session is one self-contained chunk of work that ends in something testable. Start each one fresh with this file, the spec and CONTEXT.md as context.

## How to read the ratings

**Difficulty** (1–5): 1 is mechanical, 3 is a normal feature with a few edge cases, 5 needs design judgment where mistakes are expensive to undo.

**Model**:

- **Haiku**: well-specified, low-risk, mostly mechanical work.
- **Sonnet**: normal feature work, and anything that needs back-and-forth with the user or the TV.
- **Opus**: foundational design, state machines, and data that must stay consistent.

**Effort**: `low`, `medium`, `high` or `xhigh`. Higher effort is for sessions where a wrong first design costs a rework later.

**TV** means the session needs the user at the TV (installing, pressing keys, watching the screen). **HA** means it touches the household's live Home Assistant.

## Overview

| # | Session | Phase | Depends on | Difficulty | Model | Effort | Needs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 01 | Sofa Home package skeleton | 0 | — | 3 | Sonnet | medium | TV |
| 02 | TV network feasibility | 0 | 01 | 2 | Sonnet | medium | TV |
| 03 | Home Assistant feasibility | 0 | — | 2 | Sonnet | medium | HA, TV, phones |
| 04 | Repository and Server foundation | 1 | 02 | 4 | Opus | high | — |
| 05 | Layout snapshot and sync | 1 | 04 | 4 | Opus | high | — |
| 06 | TV Sign-in | 1 | 04, 05 | 3 | Sonnet | high | TV |
| 07 | Sofa Home shell and focus | 1 | 01, 05 | 4 | Sonnet | high | TV |
| 08 | Watch Allowance engine | 1 | 03, 04 | 5 | Opus | xhigh | HA |
| 09 | Kids Mode on TV and Companion | 1 | 06, 07, 08 | 3 | Sonnet | high | TV |
| 10 | Phase 1 acceptance: one Kids Mode evening | 1 | 09 | 2 | Sonnet | medium | TV, HA, phones |
| 11 | Widget framework and display templates | 2 | 07 | 5 | Opus | high | TV |
| 12 | Home Assistant cards, weather and energy | 2 | 11 | 3 | Sonnet | medium | HA |
| 13 | Family calendar adapter | 2 | 11 | 3 | Sonnet | medium | HA |
| 14 | Immich photos and ambient view | 2 | 11 | 3 | Sonnet | high | TV |
| 15 | Companion editor | 2 | 05, 11 | 4 | Sonnet | high | — |
| 16 | Widget arranging on the TV | 2 | 15 | 4 | Opus | high | TV |
| 17 | Backups and outage behavior | 2 | 10 | 2 | Sonnet | medium | TV |
| 18 | Phone Remote | 3 | 08, 16 | 2 | Sonnet | medium | HA, TV |
| 19 | Installable PWA | 3 | 15 | 1 | Haiku | low | — |
| 20 | Title handoff and favorites library | 3 | 09 | 4 | Sonnet | high | TV |
| 21 | YouTube IFrame player experiment | 3 | 07 | 2 | Sonnet | medium | TV |
| 22 | Plex episode allowance spike | 3 | 08 | 4 | Opus | high | HA, TV |

### Order and parallel lanes

- **Phase 0:** 01 then 02. Session 03 runs alongside them.
- **Phase 1:** 04, then 05. After 05, sessions 06 and 07 can run in parallel, and 08 can start once 03 and 04 are done. 09 joins them, and 10 closes the phase.
- **Phase 2:** 11 first. Then 12, 13, 14 and 15 are independent of each other. 16 follows 15. 17 can run any time after 10.
- **Phase 3:** 19, 20, 21 and 22 are independent. 18 needs the WebSocket path from 16.

Two sessions should never edit the same files at once. In Phase 2 the adapters (12, 13, 14) each own their own Server module and template use, so they can run in parallel worktrees.

## Decisions to make before Session 04

Stack and layout were confirmed with the user on 2026-11-08, at the start of Session 04.

- **Stack (decided).** TypeScript across all parts. The Server runs on Node 26, which executes its `.ts` files directly (type stripping, so only erasable syntax), with the built-in `node:sqlite`, `node:test` and `ws` for WebSockets. esbuild bundles Companion and Sofa Home, Sofa Home for Chromium M56 (`chrome56,es2017`). Companion is a small SPA without a framework so far. One `tsc` run type-checks everything.
- **Repository layout (decided).** One repo with npm workspaces `shared/`, `server/`, `companion/` and `tv/`. `deploy/` holds the Dockerfile, compose file, Caddy route and password script.
- **Household policy** (needed by Session 08, not 04): approved Kids Mode apps, daily allowance minutes, overnight reset time, and whether a hard switch-off needs a grace period.

---

## Phase 0: Hardware feasibility

### 01 · Sofa Home package skeleton

**Difficulty 3 · Sonnet · medium · TV**

Build the first Sofa Home package from the CleanFrame Tizen 4 build in `tizen-research/app-development/cleanframe-tizen4`, used as a skeleton only.

- Strip CleanFrame down to a blank full-screen page with a key logger. Keep its manifest settings that already work on this TV (see `fullscreen-app-development.md`).
- Give it its own package ID (exactly 10 characters, or install fails with 118019) and the name Sofa Home.
- Add a scripted build: package, sign with the `hideki` profile, move the `.wgt` out of `~/tizen-studio/tools/ide/bin/out/`, install.
- Test on the TV: power-on auto-launch, Home key escape and return, suspend and resume (`visibilitychange`), key codes for the arrows, OK, Back and colour keys.

**Done when:** the package lives in this repo under `tv/`, rebuilds with one command, opens at power-on, and the results are in the spec's Known results.

**Why this rating:** the toolchain is already proven, but auto-launch and resume need live testing and the user's hands on the remote.

### 02 · TV network feasibility

**Difficulty 2 · Sonnet · medium · TV**

Answer the spec's open transport questions with a throwaway endpoint behind the existing Caddy proxy.

- Serve a test page and a WebSocket echo over HTTPS with the Let's Encrypt certificate.
- From the Session 01 package on the TV: Fetch over HTTPS, WebSocket over WSS, reconnect after a TV suspend.
- If M56 rejects the certificate, fall back to plain HTTP on the LAN and record it, as ADR 0002 allows.

**Done when:** Known results states which scheme Sofa Home uses, and the test endpoint is removed.

**Why this rating:** small, but only the TV can answer it.

### 03 · Home Assistant feasibility

**Difficulty 2 · Sonnet · medium · HA, TV, phones**

Exercise the three Home Assistant writes the spec allows, before any code depends on them.

- Turn the TV off through its media player. Check how reliably the TV's on/off state is reported, including after the Home key and inside a provider app.
- Send a mobile notification to both adults' iPhones with **+5 min**, **+10 min** and **Custom** actions, and confirm the action event reaches Home Assistant.
- Forward keys through the remote entity (already known to work; confirm Back and OK).

**Done when:** Known results records turn-off, state reliability and the notification actions, including the exact event shape the Server will listen for.

**Why this rating:** no code, but it touches the live household and needs both phones.

---

## Phase 1: Kids Mode evening

### 04 · Repository and Server foundation

**Difficulty 4 · Opus · high**

Set the conventions every later session builds on.

- Confirm the stack and layout from [Decisions to make](#decisions-to-make-before-session-04), then scaffold `server/`, `companion/`, `tv/` and `shared/`. Move the Session 01 package into the shared build.
- Server: HTTP and WebSocket server, SQLite with migrations, configuration from environment, a test runner, structured logs.
- Companion password login with secure session cookies (one password, ADR 0002). Store the PIN later as a salted hash with the same helper.
- A Home Assistant client with a write guard that allows exactly the three writes in the spec and refuses everything else.
- Docker image, persistent SQLite volume, separate media cache volume, Caddy route limited to LAN and VPN clients.

**Done when:** the Server runs in Docker behind Caddy, Companion shows a logged-in empty page, tests pass, and the write guard has a test for each allowed and one refused write.

**Why this rating:** every later session inherits these choices. Getting the shared schema package and the write guard wrong is costly to undo.

### 05 · Layout snapshot and sync

**Difficulty 4 · Opus · high**

The core data path from the spec's [Edit and sync](Sofa.OS%20Architecture%20v0.2.md#edit-and-sync).

- Define the layout schema in `shared/`: rows, app tiles, widget instances (type, size, config, profile visibility, freshness policy), background, Kids Mode settings.
- Server: drafts, validation, atomic publish into numbered revisions, `GET` current snapshot, WebSocket revision signal.
- Sofa Home: fetch on signal, REST polling when the socket drops, store the last valid snapshot locally, keep it if a new revision fails validation, fetch the current revision on reconnect before showing fresh data.

**Done when:** publishing from a test script updates a TV client within a second, a broken revision is rejected without affecting the TV, and the TV renders the last snapshot with the Server stopped.

**Why this rating:** consistency bugs here show up everywhere. Session 16's merge of TV edits into drafts depends on this revision model.

**Built (2026-11-08).** The schema and `validateLayout` are in `shared/src/layout.ts`, the revision model in `server/src/layout.ts`, and Sofa Home's sync in `tv/src/sync.ts`.

- **Revisions** are numbered 1, 2, 3 without gaps, and the highest is current. Each records its `base`, the revision it was built on. Revision 1 is an empty layout created by the migration, so there is always a current snapshot.
- **Drafts** belong to Companion. Each records `base`, the revision it was started from. `PUT` must send the draft's `base` and gets 409 otherwise. Publishing validates, then inserts the next revision and deletes the draft in one transaction, and is refused with 409 unless the draft's `base` is still current. A refused or failed publish changes nothing.
- **The rule Session 16 relies on:** whoever commits a revision while drafts are open must bring each draft forward, by applying the same change to the draft's layout and setting its `base` to the new revision in the same transaction. A draft left behind cannot be published and has to be reloaded. Companion learns of a moved draft from the 409 on its next `PUT`.
- **API:** `GET /api/snapshot` returns `{ revision, publishedAt, layout }`. `POST /api/drafts` starts a draft from the current revision; `GET`, `PUT { base, layout }` and `DELETE /api/drafts/:id` handle one; `POST /api/drafts/:id/publish` returns the new snapshot, or 422 with `errors` or 409. Drafts need a Companion session. The WebSocket `/ws` sends `{ "type": "revision", "revision": n }` after each publish and carries no data.
- **TV access:** the snapshot and `/ws` accept Sofa Home with the device token from Session 06 (see its note below).
- **Sofa Home** shows its stored snapshot at once, fetches on every socket open and on each signal, polls every 10 seconds while the socket is down, treats a clock jump as a dead socket, and keeps the last valid snapshot when a new one fails validation. The TV's validator is bundled in the signed package, so a schema change needs a Sofa Home release first. The Server address defaults from `SOFA_SERVER_URL` in `tv/build.sh` and is a setting since Session 06.
- **Publishing from a script:** `SOFA_URL=… SOFA_PASSWORD=… npm run publish-layout` publishes a sample layout stamped with the time, `-- layout.json` a file, and `-- --broken` an invalid one that must be refused.

### 06 · TV Sign-in

**Difficulty 3 · Sonnet · high · TV**

The flow in the spec's [TV Sign-in](Sofa.OS%20Architecture%20v0.2.md#tv-sign-in).

- Server: short-lived sign-in codes, one device token (ADR 0002: no multi-TV, no revocation flow).
- Sofa Home: Server address setting, QR code screen, token storage, connection status and a way to sign in again, all reachable from the TV.
- Companion: sign-in page opened by the QR code, protected by the Companion password.

**Done when:** a factory-fresh Sofa Home install signs in by phone and fetches its snapshot, and requests without the token are refused.

**Why this rating:** the flow is clear, but it is the only authentication the TV has, so it gets high effort.

**Built (2026-11-08).** Server in `server/src/tv.ts` and `server.ts`, Sofa Home in `tv/src/signin.ts`, `qr.ts` and `main.ts`, Companion's page in `companion/src/main.ts`.

- **Protocol.** (1) The TV calls `POST /api/tv/codes` (no credentials) and gets `{ code, secret, expiresAt }`: an 8-character code from an alphabet without look-alike characters, and a 256-bit secret. The Server keeps only a hash of the secret. Codes live 5 minutes, at most 10 are pending (the oldest is dropped), and each is single-use. (2) The TV shows `code` as a QR code for `<server>/tv-signin?code=<code>` and polls `POST /api/tv/token { code, secret }` every 2 seconds. The secret never leaves the TV, so someone who photographs the QR code can approve it at most, never collect the token: a wrong secret, an unknown code and an expired code all answer 404. (3) The phone opens the Companion page, which shows the login form first when there is no session and the code afterwards, on the same URL. **Approve** calls `POST /api/tv/approve { code }`, which needs a Companion session. (4) The next poll returns `{ status: "approved", token }` once. The code is spent, the token replaces the previous device token in one transaction (one token, ADR 0002) and any socket open with the old token is closed. The Server stores only the token's SHA-256.
- **Using the token.** REST sends `Authorization: Bearer <token>`. A browser cannot set WebSocket headers and a URL would end up in logs, so `/ws` takes the token as the subprotocol `sofa-token.<token>` and the Server echoes it back. `GET /api/snapshot` and `/ws` accept a Companion session or the token. Drafts and everything else still need a Companion session, so the TV is refused there. `SOFA_TV_OPEN_ACCESS` is gone.
- **Sofa Home** keeps the Server address (default from `SOFA_SERVER_URL` in `env.js`) and the token in `localStorage`. Without a token it shows the QR screen, the code to compare with the phone and the connection error if any. A 401 on the snapshot fetch drops the token and returns to the QR screen with a note, and the stored snapshot stays for after sign-in. With a token it shows the layout and the connection status. **OK** opens Settings from either screen (Up and Down choose, OK selects, Back closes): the Server address, which opens the TV's on-screen keyboard and starts over with a new token when changed, **Sign in again**, which forgets the token and shows a new QR code, and Close. Colour keys are not used. The QR code is drawn on a canvas with `uqr` (MIT, bundled, no network) at error correction M with 14 px modules and a quiet zone; a screenshot of it scaled to 40% still decodes.
- **Not verified on hardware:** the TV's on-screen keyboard for the Server address, Back leaving Settings without leaving the app, and scanning the QR code from a phone. The flow, a stale token, a changed address and Sign in again were run in a desktop browser against a local Server.

### 07 · Sofa Home shell and focus

**Difficulty 4 · Sonnet · high · TV**

The remote-driven interface from the spec's [TV experience](Sofa.OS%20Architecture%20v0.2.md#tv-experience), without widgets yet.

- Dashboard, Apps and Widgets tabs, Settings, clock and greeting. All English.
- An explicit focus order, Back closing overlays first, focus restored to the originating tile on resume, and a visible path back after a provider sends Back to Samsung Home.
- Long press detection by timing `keydown` to `keyup` on OK.
- App row and All Apps from the snapshot. Tizen launch adapter using `tizen.application.launch`, with app IDs from the spec (Netflix through `org.tizen.netflix-app`) and a clear unavailable state.
- Visual tokens from `shared/`: warm ivory, muted sage, clear focus outline, legible over photos.

**Done when:** on the TV, every tile is reachable by arrows, apps launch, and focus survives a launch and return.

**Why this rating:** large and interactive, with many hardware checks. Sonnet suits the back-and-forth at the TV.

### 08 · Watch Allowance engine

**Difficulty 5 · Opus · xhigh · HA**

The Server-side clock from the spec's [Watch Allowance](Sofa.OS%20Architecture%20v0.2.md#watch-allowance). Needs the household policy answers first.

- A state machine for Kids Mode active, TV on, warning sent, at zero, Done Screen pending. The clock runs while Kids Mode is active and the TV is on, including browsing and pauses, and stops when the TV is off or an adult exits.
- One daily budget for all children, overnight reset, minutes carry across sittings.
- Five minutes before zero: notification with the actions from Session 03. Top-up from a notification action or Companion.
- At zero: turn the TV off through the write guard. Mark the Done Screen as pending for the next power-on.
- Survive a Server restart mid-session without losing or double-counting minutes.

**Done when:** tests with a fake clock and fake Home Assistant cover the reset, carry-over, warning, Top-up, zero, restart and TV-off-while-counting cases, and one live run turns the real TV off.

**Why this rating:** time arithmetic, restarts and external state together. A bug either cuts a child's show short or never switches the TV off.

### 09 · Kids Mode on TV and Companion

**Difficulty 3 · Sonnet · high · TV**

- Sofa Home: a prominent Kids Mode tile on the Dashboard, a child profile with large tiles and only approved apps, PIN to exit, the Done Screen, and an unavailable Kids Mode tile when the Server is unreachable.
- Server: profile filtering, so the Kids Mode profile retrieves only what is approved. Reload Kids Mode policy on resume.
- Companion: Kids Mode page for approved apps, allowance minutes, Top-up and setting the PIN.

**Done when:** entering Kids Mode starts the clock from Session 08, the PIN leaves it and the Done Screen, and Companion edits apply on the TV.

**Why this rating:** mostly wiring of parts built earlier, with some TV UI.

### 10 · Phase 1 acceptance: one Kids Mode evening

**Difficulty 2 · Sonnet · medium · TV, HA, phones**

Run the Phase 1 exit condition end to end with a short allowance: power-on, TV Sign-in, Kids Mode, a provider app, the warning, a Top-up, switch-off at zero, the Done Screen on return. Fix small defects in place and list larger ones as new sessions.

**Done when:** the full evening works once without intervention and the spec's roadmap marks Phase 1 done.

---

## Phase 2: Household features

### 11 · Widget framework and display templates

**Difficulty 5 · Opus · high · TV**

Settle what ADR 0003 leaves open.

- Server: the adapter interface (config schema, display model with timestamp and availability), the type catalogue endpoint Companion builds forms from, per-widget failure isolation, freshness policy.
- Choose the first fixed set of display templates and the limits on which entities the generic card can pick. Record both in ADR 0003.
- Sofa Home: render each template with size presets, empty, stale and unavailable states, the read-only full-screen view, and a dash for any missing reading.
- One sample adapter to prove the path.

**Done when:** a sample widget renders on the TV in every state, and a failing adapter leaves the rest of the Dashboard working.

**Why this rating:** templates live in a signed TV package, so a weak first set means reinstalling. This is the expensive path ADR 0003 warns about.

### 12 · Home Assistant cards, weather and energy

**Difficulty 3 · Sonnet · medium · HA**

- Home Assistant REST for snapshots and WebSocket for subscribed updates. The token stays on the Server.
- The generic read-only entity card, within the limits Session 11 set.
- Weather from Home Assistant entities, and energy cards that name their unit and reporting period.

**Done when:** each card shows live data on the TV, and goes stale, not to 0, when Home Assistant is down.

### 13 · Family calendar adapter

**Difficulty 3 · Sonnet · medium · HA**

Follow the spec's [Family calendar](Sofa.OS%20Architecture%20v0.2.md#family-calendar) section exactly.

- Read with `calendar.get_events` from an allowlist of calendar entities (`calendar.family` first).
- Sort by start before limiting. Identify occurrences by `uid` plus `recurrence_id`. Handle date-only all-day events with an exclusive end, including multi-day ones.
- Strip event details for Kids Mode before data reaches the TV.
- Measure the real refresh delay and record it with the Server's own `calendar.get_events` result.

**Done when:** tests cover ordering, recurrence identity and all-day ranges using recorded responses, and the spec's two untested items are recorded.

### 14 · Immich photos and ambient view

**Difficulty 3 · Sonnet · high · TV**

- First confirm the installed Immich version, API key permissions and image formats, as the spec asks.
- Server: album selection, child-visible album approval, profile filtering, resizing or converting to bounded TV-friendly thumbnails in the media cache.
- Sofa Home: photo widget, full-screen album slideshow, ambient view, and the background options (static or slideshow).
- Measure thumbnail size and load time on the TV and record the budget.

**Done when:** the slideshow runs smoothly on the TV, Kids Mode shows only approved albums, and the thumbnail budget is in the spec.

### 15 · Companion editor

**Difficulty 4 · Sonnet · high**

- Home Screen editor with a responsive 16:9 preview using the shared schema and tokens.
- Apps (visibility, order), Widgets (instance forms built from the Server's catalogue), Settings (TV, integrations, appearance).
- Draft, validate and publish through Session 05.

**Done when:** an adult rearranges the Dashboard on a phone, the preview matches the TV, and publishing updates the TV.

**Why this rating:** large UI surface on a settled data model. Sonnet at high effort fits.

### 16 · Widget arranging on the TV

**Difficulty 4 · Opus · high · TV**

- Long press context menus: Move and Remove on the Dashboard, Add to Dashboard in the Widgets tab. Move lifts the widget, left and right reorder, OK places, Back cancels.
- The Server commits each TV change as a new revision and applies it to any open Companion draft, so publishing that draft does not undo it.

**Done when:** a TV move followed by publishing an older draft keeps the TV move, with a test for that case.

**Why this rating:** the draft merge is the subtle part and needs a clear rule.

### 17 · Backups and outage behavior

**Difficulty 2 · Sonnet · medium · TV**

- Scheduled SQLite and configuration backups, and a tested restore.
- Walk the spec's outage table on the TV: Server down, Server down during Kids Mode, internet down, Home Assistant down, reconnect. Companion shows a Home Assistant outage.

**Done when:** a restore from backup works, and each outage row behaves as written.

---

## Phase 3: Convenience

### 18 · Phone Remote

**Difficulty 2 · Sonnet · medium · HA, TV**

- Companion page with directional keys, OK, Back, Home and media keys. The Server forwards them through the Home Assistant remote entity using the write guard.
- Menu button sent over the Sofa Home WebSocket to open the focused widget's context menu. It does nothing inside a provider app.

**Done when:** the Phone Remote navigates Sofa Home and a provider app, and Menu opens a widget's context menu.

### 19 · Installable PWA

**Difficulty 1 · Haiku · low**

Manifest, icons and a minimal service worker for Companion so it installs on iPhone and desktop. No offline editing.

**Done when:** Companion installs to an iPhone home screen and opens full-screen.

**Why this rating:** standard, mechanical work.

### 20 · Title handoff and favorites library

**Difficulty 4 · Sonnet · high · TV**

Only start if the household still wants it, since only ARD reached title opened.

- Favorite model: provider identifier kept apart from its launch recipe.
- Launch recipes: ARD through the `eden_resume` app control request with the `PAYLOAD` form that passed; app opened for KiKA, ZDF, Plex, YouTube and Netflix; a neutral unavailable state otherwise.
- Companion page to curate favorites (parent-curated, no imports). Favorites in Kids Mode.

**Done when:** an ARD favorite opens its series page from Kids Mode, and a broken recipe shows unavailable without deleting the favorite.

### 21 · YouTube IFrame player experiment

**Difficulty 2 · Sonnet · medium · TV**

The one provider experiment the spec lists that has not run: the IFrame player inside Sofa Home. Check embed restrictions, playback after a remote gesture and remote focus. Record the result with the spec's outcome classes.

**Done when:** Known results records the outcome. No product code unless the result is positive and the user asks for it.

### 22 · Plex episode allowance spike

**Difficulty 4 · Opus · high · HA, TV**

Follow the event table in the spec's Watch Allowance section.

- Track the Plex client entity: predict the end from `media_position_updated_at` plus the remaining duration, ignore pauses, count an episode at `idle`, keep the last content ID.
- Test the untested cases: stopping mid-episode, seeking, episodes without autoplay, and whether `KEY_PAUSE` works in Plex.
- Do not use `sensor.plex_rei3`.

**Done when:** the spec records whether "two episodes, then the TV turns off" works, and if it does, a design for adding it to Session 08's engine.

**Why this rating:** inference from a lossy external entity, and the result decides a product feature.
