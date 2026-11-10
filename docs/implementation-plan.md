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
| 21 | YouTube IFrame player experiment (dropped 2026-11-10) | 3 | 07 | 2 | Sonnet | medium | TV |
| 22 | Plex episode allowance spike (dropped 2026-11-10) | 3 | 08 | 4 | Opus | high | HA, TV |
| 23 | Widget design direction | 4 | 11 | 3 | Opus | high | — |
| 24 | Templates: chart, days, stack | 4 | 23 | 4 | Opus | high | TV |
| 25 | Weather forecast views | 4 | 24 | 3 | Sonnet | medium | HA |
| 26 | Calendar days view | 4 | 24 | 3 | Sonnet | medium | HA |
| 27 | Power history chart | 4 | 24 | 3 | Sonnet | medium | HA |
| 28 | Dashboard layout, focus and footer | 4 | 23 | 3 | Sonnet | high | TV |
| 29 | Time-of-day backgrounds | 4 | 23 | 3 | Sonnet | medium | TV |
| 30 | App icons | 4 | 23 | 3 | Sonnet | medium | TV |
| 31 | Design pass and TV walk | 4 | 25, 26, 27, 28, 29, 30 | 3 | Sonnet | high | TV |

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
- **Household policy (decided 2026-11-08, for Session 08).** Approved Kids Mode apps: Netflix, KiKA and Plex. Daily allowance: 40 minutes, shared by all children. Overnight reset at 04:00. The TV switches off at once at zero, with no grace period (the 5-minute warning comes before).

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
- **The rule Session 16 relies on:** whoever commits a revision while drafts are open must bring each draft forward, by applying the same change to the draft's layout and setting its `base` to the new revision in the same transaction. A draft left behind cannot be published and has to be reloaded. Companion learns of a moved draft from its next `PUT`, which returns the merged draft (Session 16).
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
- **Verified on the TV (2026-11-08):** the QR code showed, scanning it from a phone and approving signed the TV in. **Not verified on hardware:** the TV's on-screen keyboard for the Server address and Back leaving Settings without leaving the app. The flow, a stale token, a changed address and Sign in again were run in a desktop browser against a local Server.

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

**Built (2026-11-08).** Model and tests are in `tv/src/`: `focus.ts` (focus manager), `keys.ts` (remote keys and long press), `shell.ts` (tabs, tiles, focus order, clock), `launch.ts` (Tizen launch adapter). `view.ts` draws it into `tv/app/index.html`, `main.ts` is the glue, and the tokens are `shared/src/tokens.ts`.

- **Screens.** Dashboard (the layout's rows, then an All Apps tile that opens the Apps tab), Apps (every app, seven to a row) and Widgets (every widget instance as a placeholder tile with its size and whether it is on the Dashboard, six size units to a row). Settings is an overlay with the Session 06 rows. Greeting and clock sit on the Dashboard and in the bar. Widgets are filtered by the active profile in one place (`PROFILE` in `shell.ts`, `household` until Session 09); apps are not.
- **Focus order.** A bar on top (Dashboard, Apps, Widgets, Settings), then the tab's rows. Focus moves by an explicit grid of ids, never by the browser. Arrows stop at the edges; a vertical move aims for the column it came from, so a short row does not lose your place; Down from the bar lands on the first tile and Up returns to the bar item last used. Focusing a tab shows it. OK on a tab goes into it. Rows and the screen scroll to keep the focused tile in view, and the first row scrolls all the way up so the top of the screen stays visible. The sign-in screen has one focus target, a Settings button, so OK opens Settings there as before.
- **Back.** Closes the Settings overlay first and focus returns to the tile that opened it. Otherwise a tile goes to its tab in the bar, Apps and Widgets go to Dashboard, and Back on Dashboard does nothing (Home leaves the app). While typing the Server address, Back ends typing.
- **Keys and long press.** Arrows 37 to 40 and Back (10009, Escape on a desktop) act on `keydown`. OK (13) acts on `keyup`: held for less than `LONG_PRESS_MS` (500 ms) is a short press, which selects; at or above it is a long press, reported as `{ key: 'ok', long: true }`. `createRemote` in `keys.ts` is the event Sessions 11 and 16 hook into. Session 16 uses it for the widget menus. Everywhere else, `shell.key` treats a long press as a select. The raw key log still goes to `tv/tools/recv.py` and `sofahome.events`; it is no longer drawn on screen.
- **Launch.** OK on an app tile calls `tizenLauncher(tizen).launch(id)` (`tizen.application.launch`). The Netflix store ID `RN1MCdNq8t.Netflix` is mapped to `org.tizen.netflix-app`. A refused launch, or no Tizen API (desktop browser), marks the tile Unavailable for the session and shows a message; the next OK tries again. There is no installed-apps check up front.
- **Resume.** Before a launch the tab and focus id are stored (`sofahome.resume`). On `visibilitychange` back to visible, and on a cold start once the first layout is there, focus is restored to that tile, a "Welcome back. You were in Netflix." message shows, and the record is dropped (also after 6 hours). The in-memory focus model itself survives a Home-key trip. **Way back:** Sofa Home cannot draw over a provider app, so when a provider sends Back to Samsung Home the only way in is Samsung Home's own: Home, then Sofa Home in Apps (or Start Last App). Settings says so. A tile in Smart Hub (a preview) would need a service app and is not built.
- **Tokens.** `COLORS`, `SIZES`, `FONT`, `tokensCss()` (a `:root` rule of `--sofa-*` custom properties) and `textOn(hex)` (ink or ivory text for a background colour) are exported from `@sofa/shared`. Tiles are ivory panels with ink text whatever is behind them; the focus is a 5 px ivory ring inside a 6 px deep sage outline, plus a 6% scale. Text outside tiles follows the layout's background colour. Photo backgrounds arrive in Session 14.
- **Sample layout.** `npm run publish-layout` now publishes real Tizen IDs (Netflix, YouTube, Plex, ARD, ZDF, KiKA; the YouTube and Plex IDs are Samsung's store IDs and not yet checked on this TV), five widgets of all sizes, a widget row and an app row. The row title carries the publish time.
- **Checked off the TV.** Unit tests for the focus manager, key timing, launch fallback and tab switching, and the built page in a desktop browser at 1920x1080 against a local Server: arrows through every tile, tab switching, Settings and Back, a faked `tizen` for launch success and failure, no `tizen` for the unavailable state, restore after a reload. The bundle and CSS use nothing newer than Chromium 56.
- **Not tested on the TV.** Arrow reach on the real remote, launching real apps and the real app IDs, focus restore after a real launch and return (including whether a launch sends `visibilitychange` or restarts the page), the 500 ms threshold against a real thumb, and legibility at sofa distance.

### 08 · Watch Allowance engine

**Difficulty 5 · Opus · xhigh · HA**

The Server-side clock from the spec's [Watch Allowance](Sofa.OS%20Architecture%20v0.2.md#watch-allowance). Needs the household policy answers first.

- A state machine for Kids Mode active, TV on, warning sent, at zero, Done Screen pending. The clock runs while Kids Mode is active and the TV is on, including browsing and pauses, and stops when the TV is off or an adult exits.
- One daily budget for all children, overnight reset, minutes carry across sittings.
- Five minutes before zero: notification with the actions from Session 03. Top-up from a notification action or Companion.
- At zero: turn the TV off through the write guard. Mark the Done Screen as pending for the next power-on.
- Survive a Server restart mid-session without losing or double-counting minutes.
- Decide how the Server knows the TV is on. Home Assistant's state lags standby by about 3 minutes. Test the TV's own port 8001 `PowerState` first, as described under the spec's [Decisions to resolve](Sofa.OS%20Architecture%20v0.2.md#decisions-to-resolve) (needs the TV on, then standby from the remote).

**Done when:** tests with a fake clock and fake Home Assistant cover the reset, carry-over, warning, Top-up, zero, restart and TV-off-while-counting cases, and one live run turns the real TV off.

**Why this rating:** time arithmetic, restarts and external state together. A bug either cuts a child's show short or never switches the TV off.

**Built (2026-11-08).** The engine and its rules are in `server/src/allowance.ts`, with fake-clock tests in `allowance.test.ts`. The Home Assistant event subscription and the dry run are in `ha.ts`, the API is in `server.ts`, and `npm run kids-mode` drives it from a terminal. The live run that turns the real TV off is still to do (below).

- **State.** One JSON document in the `allowance` table (migration 4), saved after every change. It holds the allowance day, the seconds used and topped up, whether Kids Mode is active, the TV as `off`, `pending` or `on` with its timestamps, and three flags: warning sent, at zero, Done Screen pending. Time is counted in whole seconds, and only while Kids Mode is active and the TV is `on`.

| Event | Rule |
| --- | --- |
| **HA reports `off`** | The TV is `off` and the clock stops. The time since the last `on` reading (at most one 5-second tick) is not counted. |
| **HA reports `on` after `off`** | `pending` when it comes within 4 minutes of the `off`; otherwise `on`, counting from now. |
| **`pending` for 4 minutes** | `on`, and those 4 minutes are counted after all. A false `on` (about 3 minutes, see Known results) ends in `off` first and is never counted. |
| **The TV says Sofa Home is in front** | While an on is `pending`, the Server asks the TV's REST API every tick (Session 10b). `visible: true` proves the TV is on, and the `pending` on becomes `on` from that moment. Sofa Home's own requests and visibility reports prove nothing: in standby the TV restarts it with `document.hidden` false. |
| **HA `unavailable`, `unknown` or unreachable** | Proves nothing; the clock waits. |
| **Enter, exit** | Entering starts counting from now if the TV is on. Exiting stops the clock and clears the Done Screen. |
| **5 minutes left** | While counting, the notification goes once to each phone with **+5 min**, **+10 min** and **Custom**. It goes again only after a Top-up lifts the time left above 5 minutes. |
| **Top-up** | Adds minutes to today's budget. Clears at zero and Done Screen pending once there is time left. |
| **Zero** | While counting, Sofa Home is brought to the front first (Session 10b, through the TV's REST API), then `media_player.turn_off` through the write guard, once per zero, retried every tick while it fails. Then at zero and Done Screen pending. Kids Mode stays active. The clock stops at zero, so a later Top-up gives its full minutes. |
| **Done Screen shown** | `POST /api/kids/done-shown` clears it. |
| **04:00 local** | A new day: used, Top-up and all flags reset; Kids Mode and the TV state stay. Time from 04:00:00 counts toward the new day. |

- **Downtime rule.** Time counts only between two readings that both say `on` and are at most 60 seconds apart; the Server reads every 5 seconds. A Server restart or a Home Assistant outage shorter than that loses nothing. A longer one loses the time in between, and the TV returns as `pending`, so it must prove itself again as above. Nothing is counted twice, because counted time moves the clock's start forward in the same saved write.
- **Days and DST.** The day is read off the wall clock in `SOFA_TIME_ZONE`, so the reset stays at 04:00 local and DST days last 23 or 25 hours. A day only moves forward, so the repeated autumn hour cannot reset twice. A reset time inside the skipped spring hour (02:00 to 02:59) would start that day up to an hour late; this is marked as a `shortcut:` in the code.
- **Config.** The daily allowance is the layout's existing `kidsMode.dailyMinutes` (0 to 1440). It is read on every use, so a publish applies at once, and the schema is unchanged. Environment variables: `SOFA_TIME_ZONE` (default `Europe/Berlin`), `SOFA_ALLOWANCE_RESET` (`HH:MM`, default `04:00`), `SOFA_ALLOWANCE_GRACE_SECONDS` (default `0`, no grace) and `SOFA_HA_DRY_RUN=1` (writes still pass the write guard, then are logged instead of sent). Fixed in code: the 5-second tick, the 5-minute warning, the 60-second gap, the 4-minute hold and Top-ups of 1 to 240 minutes. The sample layout carries Netflix, KiKA and Plex with 40 minutes. A new database's revision 1 still says 60 minutes, because migrations do not change.
- **Home Assistant.** Every 5 seconds the Server reads `media_player.samung_tv` over REST. `off` is off; `unavailable`, `unknown` and errors prove nothing; any other state is on. Only changes in reachability are logged. The Server subscribes to `mobile_app_notification_action` over the WebSocket API, sending only `auth` and `subscribe_events`, and reconnects after a drop; events during a drop are lost. `SOFA_TOPUP_5` adds 5 minutes, `SOFA_TOPUP_10` adds 10, and `SOFA_TOPUP_CUSTOM` adds the typed `reply_text` if it is 1 to 240; anything else is ignored. The notification reads "N minutes of Kids Mode left." with the title Sofa.OS. The write guard is unchanged. Its tests now also refuse `turn_off` on `all`, `media_player.media_pause`, `notify` with a `target` and `persistent_notification.create`. Without Home Assistant configured, the clock does not run.
- **API.** Everything under `/api/kids` needs a Companion session or Sofa Home's device token, and gets 401 otherwise.
  - `GET /api/kids` returns `{ active, tv, dailySeconds, topUpSeconds, usedSeconds, remainingSeconds, donePending, resetsAt }` (`KidsStatus` in `@sofa/shared`).
  - `POST /api/kids/enter`, `/exit` and `/done-shown` take a JSON body, `{}`.
  - `POST /api/kids/topup { minutes }` is for Companion only: the TV gets 403, and anything but 1 to 240 gets 400.
  - `/ws` sends `{ "type": "kids" }`, with no data, when Kids Mode, the Done Screen, the Top-up, the day or the zero changes.
  - Session 09 adds the PIN in front of exit from the TV. Sofa Home should `GET /api/kids` on start and on resume (it was the proof that the TV is on until Session 10b replaced it with the TV's REST API).
- **Live run** (for the orchestrator and the user; not done in this session). It needs the TV on, and the CLI on a machine on the LAN with `SOFA_URL=https://sofa.familie-farkas.de SOFA_PASSWORD=…`.
  1. Deploy as a dry run: `git pull && SOFA_HA_DRY_RUN=1 docker compose -f deploy/compose.yaml up -d --build`. Then watch `docker logs -f sofa-os`. The log shows the dry-run warning, `home assistant reachable` and `home assistant events subscribed`.
  2. With the TV on, wait until the log shows `tv` `on`. After a restart this can take up to 4 minutes, because a TV that was `on` before the restart must prove itself again.
  3. Run `npm run kids-mode -- minutes 6`, then `-- enter`. About a minute later the log shows a dry-run `notify` call for each phone, then `allowance warning sent`. At 6 minutes it shows a dry-run `media_player.turn_off` and `allowance at zero`. `-- status` shows the counters at any time.
  4. Optionally test a Top-up: fire the event `mobile_app_notification_action` with `{"action": "SOFA_TOPUP_5"}` from Home Assistant's Developer Tools. The log shows `top-up` with source `notification`. `-- topup 5` tests the Companion path.
  5. With the user's go-ahead, repeat without `SOFA_HA_DRY_RUN` and with a real notification. A tap on **+10 min** and on **Custom** checks the untested actions.
  6. Restore the household settings: `-- exit`, then `-- minutes 40`.
- **Verified live (2026-11-08):** a 6-minute allowance on the real TV: the warning reached both iPhones (dry run), and with real writes the Server switched the TV off at zero. **Not verified live:** the **+5 min** action (the test tapped the notification body, which opens Home Assistant instead), the WebSocket event subscription against the real Home Assistant, **+10 min**, **Custom** and its `reply_text` field, Ioanna's iPhone, a false `on` after remote standby being held back as `pending`, and the clock across a real 04:00 or DST change. Port 8001 `PowerState` is not tested. It would plug in through `observe` (as the TV reading) or `tvSeen` (as proof of on).

### 09 · Kids Mode on TV and Companion

**Difficulty 3 · Sonnet · high · TV**

- Sofa Home: a prominent Kids Mode tile on the Dashboard, a child profile with large tiles and only approved apps, PIN to exit, the Done Screen, and an unavailable Kids Mode tile when the Server is unreachable.
- Server: profile filtering, so the Kids Mode profile retrieves only what is approved. Reload Kids Mode policy on resume.
- Companion: Kids Mode page for approved apps, allowance minutes, Top-up and setting the PIN.
- Warning notification (found in the Session 08 live test): on iPhone, tapping the notification body opens Home Assistant and removes the notification, which leaves nothing to act on. Add a `url` (and a `tag`) to the notification data so a tap opens the Companion Top-up page, which shows the running allowance with +5, +10 and custom buttons, or "expired" once the timer has run out. The action buttons stay as they are.

**Done when:** entering Kids Mode starts the clock from Session 08, the PIN leaves it and the Done Screen, and Companion edits apply on the TV.

**Why this rating:** mostly wiring of parts built earlier, with some TV UI.

**Built (2026-11-09).** Server: `pin.ts` (PIN), `layout.ts` (`kidsView`), `allowance.ts` (Done Screen timing, re-off), `server.ts` (routes), `config.ts` (`SOFA_PUBLIC_URL`). Sofa Home: `kids.ts` (screens, PIN pad, calls), `shell.ts`, `view.ts`, `main.ts` and `tv/app/index.html`; images in `tv/app/img/`. Companion: `/kids` and `/kids/topup` in `companion/src/main.ts` and `kids-view.ts`.

- **API added.**
  - `GET /api/snapshot?profile=kids` (Companion session or TV token) returns the layout with only the approved apps (in the approved order), the kids widgets and the rows that remain. `?profile=household` or none returns everything; any other value is 400.
  - `PUT /api/kids/pin { pin }` is for Companion only: exactly four digits, else 400.
  - `POST /api/kids/exit { pin }` from the TV needs the right PIN: 409 when no PIN is set, 403 with `triesLeft` when wrong, 429 with `retryAfterSeconds` (and `Retry-After`) when locked. A Companion session needs no PIN. `/api/kids` answers also carry `pinSet`.
- **PIN rules.** Four digits, stored as a salted scrypt hash in `kids_pin` (migration 5). Five wrong tries lock the PIN for 5 minutes; a try counts before the hash is checked, so parallel guesses cannot beat the limit. A right PIN and setting a new PIN reset the count. The count is in memory, so a Server restart clears a lock.
- **Notification tap target.** The warning's `data` has `url` (`SOFA_PUBLIC_URL` + `/kids/topup`, default `https://sofa.familie-farkas.de`) and `tag: sofa-kids-warning`; the action buttons are as before. `/kids/topup` asks for the Companion login first, then shows the running allowance with +5, +10 and custom, or "Expired" (allowance used up) or "No allowance running" (Kids Mode off).
- **Sofa Home.** The Dashboard leads with the Kids Mode tile (lavender panel composed in code, welcome unicorn, forest crop). OK enters. The tile reads "Not available right now", with the sleeping unicorn, until the Server has answered and while the layout sync is failing. Kids Mode shows five large tiles per row for the approved apps over the forest for the hour (morning until 11:00, midday until 16:00, late afternoon after). Back does nothing there. **Adults** opens the PIN pad: arrows and OK, or the number keys. The Done Screen shows when Kids Mode is on with nothing left, and calls `done-shown` once. `GET /api/kids` runs on start, on resume, when the socket opens while the page is visible and on every `kids` signal; the Server counts it as proof that the TV is on. The last screen is kept in `localStorage` so a restart in Kids Mode does not flash the household Dashboard. The kids view of the layout is cached apart from the household one.
- **Companion.** `/kids` shows the status, Top-up (+5, +10, custom), the approved apps, daily minutes (saved through draft and publish), the PIN, and an adult Exit that needs no PIN.
- **Policy decisions.** (a) At zero the TV is switched off again if someone turns it back on: a TV that is on at zero is switched off once more after a minute (60 s), and the Done Screen shows again. The minute starts when the Server learns the TV is on (Home Assistant's reading, or a request from Sofa Home), or when Sofa Home shows the Done Screen on a TV that is on, whichever comes first (changed after the TV proof: it used to start only from `done-shown`, and a `done-shown` posted while the TV was still going into standby left a stale start that cut the next power-on short). (b) 04:00 leaves Kids Mode as it is: the new day gives a new allowance and Kids Mode stays on.
- **Not done.** The warning overlay with the `unicorn-warning` art (optional in the brief). No Top-up from the TV.
- **Checked in this session:** unit tests (PIN, lockout, token against session, kids snapshot, notification data, Sofa Home logic with fakes) and a local smoke test at 1920x1080 with a local Server and a fake Home Assistant in dry run: sign-in, Kids Mode, wrong and right PIN with number keys and with arrows, the Done Screen at zero, Top-up from the phone page returning the TV to Kids Mode, the unavailable tile with the Server stopped.
- **Proven on the real TV (2026-11-09, Photo Booth camera, keys from Home Assistant, the live Server with real writes).**
  - Number keys reach the page through `registerKey` (all 31 registered, none failed) and work on the PIN pad. Arrows and OK work on the pad. A wrong PIN shows "Wrong PIN. 4 tries left."; the right PIN (mixed arrows, OK and a number key) leaves Kids Mode and returns the household Dashboard.
  - Back does nothing in Kids Mode (the app stays).
  - Images: the three forest backgrounds (cycled every 10 s in a throwaway build), the welcome unicorn on the tile, the sleeping unicorn on the unavailable tile and the resting unicorn on the Done Screen all render, with no blank and no restart.
  - Done Screen after a real zero: with a 0-minute allowance, entering Kids Mode switched the real TV off at zero; a power-on later showed the Done Screen.
  - Re-off: a TV switched on again at zero was switched off again by the Server one minute after the Server saw it on (twice; the second run, after the fix above, was exactly 60 s).
  - Unavailable tile: a throwaway build that fails the Kids requests turned the tile to "Not available right now" with the sleeping unicorn and the toast. The live Server was not stopped.
  - Focus restore: after Plex (household) and after KiKA (Kids Mode) the focus returned to the tile that was launched. A launch fires `visibilitychange` (HIDDEN), and Back out of the app (Plex asks "exit?" first) fires VISIBLE.
  - Settings: the TV's on-screen keyboard opens on the Server address row; Back leaves it. The keyboard's own Back arrives as code 65385 and left the field focused, so Back needed two presses to close Settings. Fixed: it now counts as Back and ends typing.
  - Also learned: the first OK on a freshly started Dashboard only moves focus from the tab bar down to the Kids tile (a second OK enters). That is the designed behaviour of OK on a tab, not a defect.
- **Still untested, needs a human:** the real notification tap on the iPhone and the +5, +10 and Custom buttons (Companion's `/kids/topup` page on the phone); the recovery of the Kids tile after the Server comes back (unit-tested only); the forest changing at 11:00 and 16:00 on its own; the Done button of the TV keyboard (code not seen); a Kids Mode with Netflix and Plex (the live layout approves only KiKA, so the five-per-row grid was not seen on the TV); the PIN lockout after five wrong tries on the TV (unit-tested only). Powering the TV on again from the Mac is slow and unreliable: Home Assistant has no turn-on for it, and a Wake-on-LAN packet plus KEY_POWER took about a minute and a half to bring it up (and a second KEY_POWER could toggle it off again). The live PIN is a throwaway one from the test; set a new one on Companion's Kids Mode page. Today's counters on the live Server kept a 5-minute test Top-up and about 3 minutes used until the 04:00 reset.

### 10 · Phase 1 acceptance: one Kids Mode evening

**Difficulty 2 · Sonnet · medium · TV, HA, phones**

Run the Phase 1 exit condition end to end with a short allowance: power-on, TV Sign-in, Kids Mode, a provider app, the warning, a Top-up, switch-off at zero, the Done Screen on return. Fix small defects in place and list larger ones as new sessions.

**Done when:** the full evening works once without intervention and the spec's roadmap marks Phase 1 done.

**Run 1, 2026-11-09 (live TV, live Server, real writes) — not accepted; defect 10b found.**

- **Passed.** Kids Mode from the household Dashboard (TV already signed in; sign-out and QR sign-in not repeated, proven in Session 06), KiKA launched from the Kids tile, the real warning at 5 minutes left (Server log; both phones were sent it, who saw it is unconfirmed: the user missed it), a Companion Top-up (`kids-mode topup`) lifting the time above 5 minutes and a second warning firing 5 minutes before the new zero (09:49:44Z), and the real TV switched off at zero twice (09:54:42Z and 10:05:09Z). One `top-up` of 5 minutes arrived with source `notification` at 09:44:27Z (the +5 min action button was tapped by someone; the Server event path is proven, the phone and tap were not observed). The 10:02:51Z Top-up came from Companion.
- **Not proven.** Tap on the notification body opening Companion Top-up, +10 min, Custom with its text field, Ioanna's iPhone (no PushNotification tool in this run, so no tap requests could be sent), and the Done Screen on return (below).
- **Defect found (new session 10b).** The TV powered back on in KiKA, not in Sofa Home: power-on uses Smart Hub's Start Last App, and the last app at zero was KiKA. Sofa Home never ran, so no Done Screen, and the Server only learned the TV was on from Home Assistant after the 4-minute hold, which then counted as used time. A child can therefore keep watching the provider app after zero until the re-off. The Done Screen itself was proven in Session 09 with Sofa Home in front at zero.
- **Power-on from the Mac is unreliable.** A KEY_POWER right after the zero switch-off worked once (about 4 minutes to on). Later Wake-on-LAN plus KEY_POWER attempts, minutes after standby, did not wake the TV (the Server saw `pending` and `off` flap). The TV was left off; a person must press the remote.
- **State left.** Kids Mode exited, 40 minutes, TV off, no log receiver running.

**Run 2, 2026-11-09 evening (after 10b, rei3 on 2432cfd) — accepted.** Kids Mode entered with a 15-minute day (about 6 minutes left), Netflix opened from the Kids tile, then, with the user at the phone:
- Warning 21:40:15Z; the user tapped the notification body, which opened Companion's Top-up page (by the user's word), and added 5 minutes there (21:40:43Z, source `companion`).
- Second warning 21:45:17Z; **+10 min** tapped: `top-up` 10, source `notification`, 21:45:25Z.
- Third warning 21:46:18Z; **Custom** with the text field, typed 3: `top-up` 3, source `notification`, 21:47:43Z.
- A fourth warning fired at 21:49:14Z after the allowance was lowered; each warning came again after a Top-up lifted the time above 5 minutes.
- Zero, switch-off and the Done Screen on return were proven in run 1 (two switch-offs at zero) and in Session 10b (both power-ons showed the Done Screen and the re-off), so this run did not repeat them. Sign-in and power-on to Sofa Home: Session 06 and 10b.
- Ioanna's iPhone: waived by the user (one phone is enough for testing); not tested.
- Restored: Kids Mode off, 40 minutes, TV on the household Dashboard.
Phase 1 is marked done in the spec roadmap.

### 10b · Return to Sofa Home after zero

**Difficulty 3 · Opus · high · TV, Server**

At zero the TV may be inside a provider app, and the next power-on resumes it. Make the next power-on land on Sofa Home (for example bring Sofa Home to the front before `turn_off` at zero through the write guard, or switch Start Last App off if Sofa Home still launches at power-on), keep the 60-second re-off as a backstop, then repeat Session 10's evening with the power-on from a person's remote.

**Done when:** a zero inside a provider app is followed by a power-on that shows the Done Screen, and Phase 1 can be marked done.

**Done (2026-11-09, rei3 at 2432cfd): proven live in the 21:22 run. A zero inside KiKA, then a person's power-on, shows the Done Screen and is switched off again a minute later. The false on is held as `pending`, with no re-off loop. Still open: D on a real power-on into a provider app (see Not proven yet).**

- **Evidence that shaped it.**
  - Home Assistant's `media_player.samung_tv` (core `samsungtv`, `supported_features` 24381) supports `PLAY_MEDIA` and `SELECT_SOURCE` but not `TURN_ON`. Its `source_list` has the store apps but not Sofa Home. While the TV is on, its attributes carry only volume and mute, with no `source` or `app_id` (24 hours of history checked), so the Server cannot see which app is in front through Home Assistant.
  - Live: `media_player.play_media` with `app` and `sofahome01.SofaHome` was accepted by Home Assistant and ignored by the TV (KiKA stayed in front, no error logged). The TV's own REST API, `POST http://192.168.42.54:8001/api/v2/applications/sofahome01.SofaHome` (no pairing), brought Sofa Home to the front from KiKA at once; Sofa Home's request reached the Server under a second later. `GET` on the same URL reports `running`/`visible`, but said `false`/`false` for KiKA while KiKA was on screen, so it cannot tell which app is in front either.
  - Sofa Home has `background-support="disable"`, so it gets no event at zero (option B ruled out). Start Last App is a TV setting only a person can change; it stays the fallback (option C).
- **A: Sofa Home before every switch-off.** At zero, and at the 60-second re-off, the Server first launches Sofa Home through the TV's REST API (`ha.ts` `launchSofaHome`, host `SOFA_TV_HOST`, default `192.168.42.54`; dry run logs it). It then switches off once Sofa Home has answered (its resume request) or 10 seconds after the launch (`LAUNCH_WAIT_MS`). A failed launch switches off in the same tick. A failed switch-off is retried every tick, without a second launch. This is the one call the Server makes to the TV itself rather than to Home Assistant: a fixed URL with no data that can only launch Sofa Home. The user accepted it on 2026-11-09 (fixed URL, no data, LAN only). The spec now says so, and the Home Assistant write guard is unchanged (its tests now also refuse `play_media` and `select_source`).
- **D: Sofa Home at a power-on at zero.** When the TV is `on` at zero and Sofa Home has not been proven in front since the last off (a provider app is in front), the Server launches Sofa Home once for that power-on. The re-off minute starts at the on reading as before, so a failed launch still ends in a switch-off a minute later. Nothing is launched while the on is `pending`.
- **Proof fix (found live, 2432cfd).** A pending on becomes `on` only when the TV's REST API says Sofa Home is in front: `GET http://192.168.42.54:8001/api/v2/applications/sofahome01.SofaHome` answers `visible: true` (`ha.ts` `sofaHomeVisible`, 2 s timeout, no answer counts as no). The engine asks it every tick while the on is `pending`, and during the launch wait before a switch-off (it switches off as soon as Sofa Home is in front, at most `LAUNCH_WAIT_MS` after the launch). Otherwise the 4-minute hold applies, which is what catches a power-on into a provider app (then D launches Sofa Home, and the re-off follows a minute later). Nothing is launched while the on is `pending`. Sofa Home's own requests and `visible` reports prove nothing any more, and the 20 s freshness gate is gone. The user's decision covers this read-only `GET` (architecture doc, Home Assistant section).
  - Why: with the current Sofa Home build installed (the TV had a build from before visibility reports; reinstalled 14:30Z, `sofa home` `visible` now logged), a zero at 14:34:28Z was followed by `START hidden=false` in the TV log at 14:35:09Z: in standby the TV restarts Sofa Home when its network wakes, and the page thinks it is visible. Its `visible: true` (14:35:11.7Z) made the false on at 14:35:23Z count as `on` (0a00608, the visible-report proof). Kids Mode was exited at 14:36:08Z before the re-off. The REST API said `visible: false` at every read from 14:35:19Z to 14:36:42Z, and `visible: true` when Sofa Home was really in front (14:30:47Z).
  - Earlier gates that failed: a request counted unless its socket said hidden (no build sent reports), then only within 20 s of the on (d8acfd5; the hidden Sofa Home's request came a few seconds before the false on).
  - Home Assistant history: every false on today lasted about 2.5 minutes (for example 11:06:01 to 11:08:34 and 12:54:13 to 12:56:46 local), inside the 4-minute hold.
- **State.** One new field, `launchAt`, cleared on an off reading, when time is added, at the day reset and on exit.
- **Proven live (2026-11-09, real writes).**
  - The REST launch brings Sofa Home to the front from KiKA (seen on camera).
  - A zero inside KiKA (Kids Mode entered with 2040 s left, KiKA from the Kids tile, then `minutes 6` so the time left jumped to zero without a warning): the log showed `sofa home brought to the front` (11:18:05.6Z) and `allowance at zero: tv switched off` on the next tick (11:18:11.6Z), so Sofa Home answered within 5 seconds. Home Assistant reported off at 11:18:16Z.
  - Second zero in KiKA (14:20 run, rei3 at e99d83f): launch 14:20:37.2Z, off 14:20:43.2Z.
  - **Correction:** a REST launch during Home Assistant's false on does wake the screen into Sofa Home. On camera: dark at 14:24:18Z, launch at 14:24:46Z, Done Screen at 14:24:51Z. A manual launch at 14:25:58Z (Kids Mode exited) woke it onto the household Dashboard. The earlier two samples that did not wake it are unexplained. A launch shortly after the off gets no connection (the TV's network is down until about 49 s after the off).
- **14:20 run, after the zero (Server log, Home Assistant history, camera).**
  - The user was cued at 14:21:10Z to press power. Home Assistant reported on at 14:21:35.9Z, 53 s after the off: the same delay as its false on, so whether this was the person's press is not known. The camera was not watched between 14:21 and 14:24.
  - The Server logged it as `tv` `on`, not `pending`. A minute later came a launch (14:22:38.7Z), then off after the 10 s wait (14:22:49.8Z): Sofa Home did not answer the launch.
  - Home Assistant on at 14:23:42.8Z, 53 s after that off. The Server logged `on`, but the camera showed a dark screen at 14:24:18Z: a false on taken as real.
  - Re-off at 14:24:46.5Z launched Sofa Home, which woke the TV onto the Done Screen (camera 14:24:51Z), then switched it off at 14:24:57.6Z after the 10 s wait. That is the loop: a dark TV is woken for about 10 s every 2 minutes.
  - Stopped with `exit` at 14:25:24Z, and `minutes 40` restored.
  - No `sofa home` `visible` line was logged.
- **21:22 run (2432cfd, real writes, camera, user at the remote).** Enter, KiKA from the Kids tile, `minutes 40` then `minutes 6`.
  - Zero: launch 21:21:59.8Z, off 21:22:05.9Z, Home Assistant off 21:22:10Z.
  - No loop: the TV restarted Sofa Home in standby again (`sofa home` `visible: true` at 21:22:36.6Z), but the REST API said `visible: false`. The false on was logged `pending` from 21:22:46Z until Home Assistant said off at 21:25:19Z. There was no launch and no re-off until the first press (21:28:44Z), and the screen stayed dark on camera.
  - Press 1 (late, about 6.5 minutes after the off): logged `pending` at 21:28:44.8Z, then `on` with `proof: sofa home in front` at 21:28:46.4Z. The Done Screen ("All done for now") was on camera. Re-off: launch 21:29:46.7Z, off 21:29:47.8Z (switched off as soon as the REST API said Sofa Home was in front). It was `pending` rather than `on` straight away because the hold counts from the last off reading, which here was the end of the false on.
  - Press 2 (inside the hold, as in the 14:20 run): Home Assistant's on at 21:30:42.9Z was logged `pending`. It may be the false on or the press, which cannot be told apart. The screen was still dark on camera at 21:30:52Z. The REST API said `visible: true` at 21:31:03Z, and the same second the Server logged `on` `proof: sofa home in front`. The Done Screen was on camera, and the re-off came at 21:32:03.4Z (launch) and 21:32:04.4Z (off).
  - Restored: `exit` at 21:32:12.6Z, `minutes 40`. A REST launch at 21:32:13Z, 9 s after that off, woke the TV onto the household Dashboard.
- **Not proven yet.**
  - D on a real power-on into a provider app (the 4-minute hold, then a launch over KiKA and the re-off). Both presses landed on Sofa Home, since A had made it the last app. This path is unit-tested only.
- **15:09 run (2432cfd, aborted: the household needed the TV).** Enter, KiKA from the Kids tile, `minutes 6`. Launch 15:09:30.1Z, Sofa Home in front by REST 15:09:30.2Z, off 15:09:36.2Z, Home Assistant off 15:09:41Z. In standby the TV restarted Sofa Home again (`sofa home` `visible: true` at 15:10:19.6Z, dark screen). Home Assistant's false on at 15:10:31Z was logged `pending` (the REST API said `visible: false`), and nothing was launched. Kids Mode was exited at 15:10:38Z, so only 7 s of the pending on were watched: no-loop over 5 minutes, and the person's presses, are still to run. `minutes 40` restored.
- **Dropped 2026-11-10 (user): the D run is not needed; D stays unit-tested only.**
- **Next run (only for D, dropped).** Needs a power-on into a provider app at zero, for example a zero reached while the TV is off with KiKA as the last app. Expect `pending` for 4 minutes, then `sofa home brought to the front` `on at zero`, the Done Screen, and the re-off a minute later. Restore with `exit` and `minutes 40`.

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

**Built (2026-11-09).** Types in `shared/src/widgets.ts`, the framework in `server/src/widgets.ts`, the catalogue in `server/src/catalogue.ts`, the sample adapter in `server/src/adapters/status.ts`. Sofa Home: `tv/src/widgets.ts` (fetch, store, staleness), `tv/src/cards.ts` (drawing) and `tv/app/cards.css`, wired into `view.ts`, `shell.ts`, `sync.ts` and `main.ts`. The decisions are in ADR 0003.

- **Adapter interface.** `WidgetAdapter` (`server/src/widgets.ts`) is a `WidgetType` (type, title, description, templates, sizes, default size and freshness, config `fields`) plus `read(config, { now, signal })`, which returns `{ card, detail?, title? }` or `{ empty: message }`, and an optional `forKids(result)`. Throw `Unavailable('message')` for a reason the household should read on the card; any other failure reads "Not available right now". A new type is one line in `createCatalogue`. `widgets.refreshType(type)` asks for a re-read now (for Session 12's Home Assistant events).
- **Config.** `ConfigField` kinds: text, number, choice, boolean, entity and entities. `readConfig(fields, raw)` applies defaults, drops undeclared keys and returns errors; an instance with errors shows "Check this widget in Companion".
- **API added.** `GET /api/widgets?profile=household|kids` (Companion session or TV token) returns `{ serverTime, widgets: WidgetData[] }` for the published layout's instances of that profile: `id, title, status (ok|empty|unavailable), card?, detail?, message?, updatedAt, failing, staleAfterSeconds`. An instance not read yet is left out, and the TV shows it as loading. `GET /api/widget-types` (Companion only) returns the catalogue for Session 15's forms. `/ws` sends `{ "type": "widgets" }` (no data, debounced 200 ms) when any widget changes, and a publish triggers a read at once.
- **Server rules.** Each instance is read on its own with a 10-second timeout that aborts its signal. Results are checked against the template and size caps. A failed read keeps the last result with `failing: true` and retries after the policy's interval, at most 60 seconds. A changed type, size, freshness or config starts the instance over, and an answer for the replaced config is dropped. Unknown types are unavailable, not refused at publish.
- **Sample adapter.** `status` (title Sofa.OS, list template, live): server uptime, layout revision and Kids Mode on the card; publish time, Home Assistant, TV, database size and Node version in the detail. It needs no external service.
- **Sofa Home.** Fetches `/api/widgets` for the household profile on start, on the signal, on a new revision, on resume and every 30 seconds, and keeps the last answer in `localStorage`. Kids Mode shows no widgets yet. A card is stale when the source is failing, the Server is unreachable or the data is older than `staleAfterSeconds`, with age measured against the Server's clock; stale cards dim and say when they were updated. OK on a widget opens the full view of its `detail` (or `card`); OK on Close or Back closes it. A long press on a widget opens the Session 16 menu.
- **Harness.** `npm run harness -w tv`, then serve `tv/` (`python3 -m http.server -d tv 8077`) and open `/harness/` at 1920 wide: every template at every size, the status widget in every state, and the full views, drawn with the real `cards.ts` and `cards.css`.
- **Checked in this session:** unit tests for the shared checks, the Server framework (throws, rejects, hangs, garbage, bad config and unknown types each isolated; the HTTP route still answers and the snapshot still loads with a failing adapter), staleness across a skewed TV clock and the stored answer. The harness at 1920 wide in headless Chromium. A local stack at 1920x1080: a test Server, a layout with three status widgets, an unknown type and an invalid config, TV sign-in, the cards, OK into the full view and Back out, and the cards going stale with the Server stopped.
- **Untested on the TV:** legibility at sofa distance; that `cards.css` ships in the signed package and loads; Chromium 56 with column-wrap flexbox (large list and agenda), `object-fit` on photos and the bar heights; the full view with the real remote's OK and Back; redraws every 30 seconds and on the signal; stale marking with the Server stopped; widget data kept across a restart; the en dash in the TV's font.
- **Checked on the TV (2026-11-09, Photo Booth camera, keys from Home Assistant, live Server; a test layout with the `status` widget at small, medium and large was published and the saved layout restored afterwards).**
  - Passed: `cards.css` ships in the signed package and loads; all three sizes draw and read at the camera's distance (small labels at 22 px are the faintest; judge them from the sofa). OK on a card opens the full view, Back closes it, OK on Close closes it. Cards redraw as time passes (uptime moved on without input) and at once on the `widgets` signal (restoring the layout replaced the cards within 4 s). A republish with unchanged widget config does not re-read them, so a card can show the previous revision until the next tick (at most 60 s for live); by design. Stale marking: with a throwaway build whose widget fetch fails, the cards dimmed and said "Updated 10:32" on the card and in the full view; the live container was not touched. Data survived an app restart (the throwaway build restarted and drew the stored answer, stale). The en dash renders (throwaway build showing the dash for "Off").
  - Chromium 56 (Tizen 4.0): column-wrap flexbox wraps as designed (throwaway row heights forced the large card and the full view into more than one column). Note that the list's `height` is overridden by the body's flex-grow in the full view (it measured 578 px, not 520), so eight 64 px rows fit one column and only longer lists wrap.
  - Not checked: `object-fit` on photos and the bar heights (no photo or columns adapter exists yet to publish; Session 12 or 14 should look when they do).
  - No defects found, nothing in the code changed.
- **Not built.** Publish-time checks of widget config (bad config shows on the card instead), a preview of a draft's widget for Companion, and widgets in Kids Mode.

### 12 · Home Assistant cards, weather and energy

**Difficulty 3 · Sonnet · medium · HA**

- Home Assistant REST for snapshots and WebSocket for subscribed updates. The token stays on the Server.
- The generic read-only entity card, within the limits Session 11 set.
- Weather from Home Assistant entities, and energy cards that name their unit and reporting period.

**Done when:** each card shows live data on the TV, and goes stale, not to 0, when Home Assistant is down.

**Built (2026-11-09).** Three widget types in `server/src/adapters/homeassistant.ts`, registered by one line in `server/src/catalogue.ts` (`homeAssistantAdapters`); tests in `homeassistant.test.ts` with a fake Home Assistant (REST and WebSocket, switchable off the network) and real recorded states in `server/src/fixtures/ha-states.json`.

- **Types.** `ha-entities` (title Home; list template; up to `MAX_CARD_ENTITIES` entities of `ENTITY_DOMAINS`, in order; label is the friendly name, value the state with its unit; unavailable, unknown or a missing entity is a dash). `weather` (value template; one `weather.*` entity; temperature, conditions and humidity on the card; wind, pressure and visibility in the full view; default freshness hourly). `energy` (value template; one `sensor.*`; the unit comes from Home Assistant and the household picks the period it reports: right now, today, yesterday, this week, this month, this year or total, shown as the card's note; a sensor with no unit shows a dash and says so rather than a bare number).
- **Entities on this house** (read 2026-11-09, for the first layout): weather `weather.home` (conditions and temperature only; no humidity), `weather.tomorrow_io_home_daily` (has humidity); energy `sensor.powerfox_aktuell` (grid, W, right now), `sensor.energy_production_today` (solar forecast, kWh, today), `sensor.bezug_powerfox` (grid import, kWh, total); generic card `sensor.average_outdoor_temperature` and `sensor.average_indoor_temperature`. No daily or monthly consumption sensor exists yet, so there is no real "used today" card until a utility meter is added in Home Assistant.
- **Outage behaviour.** Reads use the existing REST client (`HaHttpError` added to carry the status). A 404 is a missing entity (dash row, or unavailable for the single-entity types); 401 or 403 and any network error throw `Unavailable('Home Assistant is not reachable')`, so the framework keeps the last card with `failing: true` and Sofa Home marks it stale; a first read that fails is unavailable with that reason. Checked with a fake Home Assistant that goes away and returns, and against the real Server process with its fake: cards `ok failing=false`, then `failing=true` with the same readings after Home Assistant is killed.
- **Live updates.** `watchHomeAssistant` (started from `startServer` when Home Assistant is configured) reuses `subscribeEvents` for `state_changed`, and when an event names an entity configured on a widget it calls `widgets.refreshType` for that type, throttled to once per 5 seconds per type. Polling on the freshness policy covers events lost in a drop. Read-only: the subscription sends only auth and subscribe.
- **Decisions.** No forecast: Home Assistant removed the `forecast` attribute, and `weather.get_forecasts` is a service call that the write guard does not allow, so the weather card shows current conditions only (a forecast needs a spec decision and a guard rule). Numbers are shortened for reading (two decimals under 10, one under 100, none above) and units are shown as Home Assistant reports them (no Wh to kWh conversion). The `energy` type does not check that the period suits the sensor (a power sensor set to "today" is the household's mistake).
- **Untested on the TV:** the cards drawn from real Server data on the TV (the templates are Session 11's and were not changed), stale marking with the real Home Assistant unreachable, and the `state_changed` subscription against the real Home Assistant (only a fake WebSocket was used). Companion has no form yet (Session 15); layouts need hand-written config, like the sample in the Built note above.

### 13 · Family calendar adapter

**Difficulty 3 · Sonnet · medium · HA**

Follow the spec's [Family calendar](Sofa.OS%20Architecture%20v0.2.md#family-calendar) section exactly.

- Read with `calendar.get_events` from an allowlist of calendar entities (`calendar.family` first).
- Sort by start before limiting. Identify occurrences by `uid` plus `recurrence_id`. Handle date-only all-day events with an exclusive end, including multi-day ones.
- Strip event details for Kids Mode before data reaches the TV.
- Measure the real refresh delay and record it with the Server's own `calendar.get_events` result.

**Done when:** tests cover ordering, recurrence identity and all-day ranges using recorded responses, and the spec's two untested items are recorded.

**Built (2026-11-09).** `server/src/adapters/calendar.ts` (adapter and reader), registered in `catalogue.ts` and given the reader in `server.ts`; tests and anonymised recordings in `server/src/adapters/calendar.test.ts` and `fixtures/`.

- Type `calendar` (agenda template, medium and large, `hourly`). Config: `calendar` (a choice from `CALENDAR_ALLOWLIST`, `calendar.family` first) and `days` (1 to 14, default 7). The reader refuses any entity outside the allowlist and is a read, not one of the three writes.
- Events are de-duplicated, sorted by start (all day first), then limited to 40, then grouped by local day. A date-only event covers each day up to its exclusive end; a timed event past midnight continues as "Until HH:MM".
- Household cards show title and time; the full view adds the location. Descriptions never leave the Server (they hold phone numbers and booking text).
- Kids Mode (`forKids`): only time and "Something planned". A test with sentinel summaries, locations and descriptions checks that none appear anywhere in the kids response.
- **Measured: the Server's own `calendar.get_events` returns no `uid` or `recurrence_id`** (see the spec). The adapter uses them when present and otherwise start, end and title. Decision for the user: whether to read `/api/calendars/<entity>` instead for exact identity.
- **Not measured: the 15-minute delay** (needs an event added in the calendar). **The duplicate `icloud` calendars** are untouched: the allowlist keeps them out. Not checked on the TV or in a browser with live data.

### 14 · Immich photos and ambient view

**Difficulty 3 · Sonnet · high · TV**

- First confirm the installed Immich version, API key permissions and image formats, as the spec asks.
- Server: album selection, child-visible album approval, profile filtering, resizing or converting to bounded TV-friendly thumbnails in the media cache.
- Sofa Home: photo widget, full-screen album slideshow, ambient view, and the background options (static or slideshow).
- Measure thumbnail size and load time on the TV and record the budget.

**Done when:** the slideshow runs smoothly on the TV, Kids Mode shows only approved albums, and the thumbnail budget is in the spec.

**Built and proven on the TV (2026-11-09, rei3 at 2432cfd, Sofa Home reinstalled from main).**
- Server: Immich client (`server/src/immich.ts`), album and thumbnail cache with profile filtering (`photos.ts`, `photos-http.ts`), the `photo` widget type, `SOFA_IMMICH_API_KEY[_FILE]` and `SOFA_IMMICH_URL`, and the compose wiring. Decisions are in ADR 0003 (Photos); the budget and Immich facts are in the spec.
- Sofa Home: ambient view from a photo tile, Kids Mode album tiles with a slideshow, and the photo or slideshow Dashboard background (`tv/src/slideshow.ts`, `photos.ts`, `photoview.ts`, `app/photos.css`).
- **Photostream.** Immich has no albums yet, so a photo widget, the slideshow, the ambient view and the background can use the photostream instead: the newest 300 images of the library, a random pick (spec, Immich section; ADR 0003). Household only, never Kids Mode. Companion's widget form has a source choice and Appearance a button for the photostream background.
- **Not built.** An album picker in Companion (a typed album id remains), household album tiles, an idle-triggered ambient view, and a kids photo widget (it shows "Nothing to show" unless the layout allows the album for kids).
- **TV pass (camera and HA remote keys).** The live layout got a `Photostream` photo widget (large, household only, in its own Dashboard row) and showed a real photo from the library. OK on it opens the ambient view (clock, picture contained, portrait pictures with side bars). Right and Left step, OK pauses ("Paused", no advance for over 20 s) and resumes, the picture advances itself every 15 s, Back closes it. A temporary photostream slideshow background (60 s per picture, scrim, tiles legible) paused while the ambient view was open and resumed after Back; the household colour background was restored. Load time 74 to 270 ms per picture, JS heap flat at 10 MB over about 8 minutes (Sofa Home now logs `photo loaded in ... ms, ..., js heap ...` per picture). The cache holds 20 pictures, 8.3 MB, largest 800 KB (spec, budget). Kids Mode was not touched; the kids guarantee is tested on the Server.
- **Update 2026-11-10 (user).** The Immich API key is in place on rei3 and the photostream works. The household has no albums and will not for now, so album tiles, the album slideshow and the album picker stay unbuilt and unverified on purpose.
- **Found.** A Dashboard row holds six size units (small 1, medium 2, large 3); a widget past that is clipped without a hint (a large photo widget added to the full Today row did not show). Companion should warn about it (Session 15's editor).
- **Unproven.** The live Companion preview of the photo widget (Companion needs the password; checked on a local stack and through `/api/widgets`), Kids Mode album tiles with a real album (no albums exist), the album slideshow (8 s) on the TV, a hidden app stopping the timers, and runs of hours.
### 15 · Companion editor

**Difficulty 4 · Sonnet · high**

- Home Screen editor with a responsive 16:9 preview using the shared schema and tokens.
- Apps (visibility, order), Widgets (instance forms built from the Server's catalogue), Settings (TV, integrations, appearance).
- Draft, validate and publish through Session 05.

**Done when:** an adult rearranges the Dashboard on a phone, the preview matches the TV, and publishing updates the TV.

**Why this rating:** large UI surface on a settled data model. Sonnet at high effort fits.

**Built (2026-11-09).** Page `/edit` (a link from Companion's home). Code: `companion/src/editor.ts` (UI, draft lifecycle), `companion/src/edit.ts` (pure editing operations, tested in `edit.test.ts`), `companion/src/preview.ts` and `companion/build-preview.ts` (the preview), styles at the end of `companion/style.css`.

- **Preview is the TV's own code.** `/preview.html` is derived at build time from `tv/app/index.html` (its `<style>` goes to `preview-tv.css`, the script is swapped for `preview.js`; `cards.css` and `img/` are copied), and `preview.ts` imports `createShell`, `initView`/`render`, `cardOptions`, `forestFor` and the widget parser from `tv/src/` (read-only; nothing in `tv/` changed). Companion draws it in an iframe at 1920x1080 scaled to the column width, with the shared tokens. The build throws if the TV page's shape changes. Dependency direction: `companion` imports `tv/src`, so a change to the TV's shell, view or background code shows up in the preview on the next build; a change that bypasses those modules (for example a new paint step in `tv/src/main.ts`) needs the same line in `preview.ts`.
- **Parity check.** At 1920x1080, a dump of every visible element's tag, class, rounded rectangle and text in `#stage` was identical between the real Sofa Home page and the preview for the Dashboard, Apps and Widgets tabs and the Kids Mode screen. The only differences: the TV's status line (left empty in the preview), the clock minute, and the first tile's focus ring (the preview shows none unless an item is selected).
- **What the editor does.** Dashboard: rows (add, rename, reorder, remove) and items (move left/right, move to another row, remove from the Dashboard, add an app or widget to a row). Apps: rename, order, "On the Dashboard", add (known apps or a custom ID), remove (also from rows and the Kids Mode list). Widgets: add from the catalogue, a form per instance for all six `ConfigField` kinds (text, number, choice, boolean, entity, entities with the generic card's domain and count limits), size, refresh, Dashboard, "Allow in Kids Mode", remove, inline errors. Settings: background colour, TV state and revision, a pointer to the Kids Mode page, and a note that integrations are set up on the Server. Preview Kids Mode checkbox.
- **Draft lifecycle.** A draft is created on the first change and saved 900 ms after the last one (`PUT` with `base`). The draft id is kept in `localStorage` and restored on load when its base is still the current revision. A 409 (someone published meanwhile) blocks Publish and offers Reload, which drops the draft. Publish is disabled until the layout passes `validateLayout` and `checkWidgets`. Discard deletes the draft.
- **Preview data.** Widgets unchanged since the published layout show live data from `/api/widgets`; new or changed ones show a placeholder ("Shows data once published"), because the Server only reads published layouts.
- **Server changes (small, for merge).** `checkWidgets` and `widgetProblems` in `shared/src/widgets.ts` (size not offered by the type, or `readConfig` errors; unknown types are not refused, as ADR 0003 says); `publishDraft` in `server/src/layout.ts` takes an optional `check` and returns 422 with the errors; `server/src/server.ts` passes it the catalogue and changes the static CSP to `frame-ancestors 'self'` so Companion can frame its own preview. Test: `server/src/publish-check.test.ts`. This closes the "Publish-time checks of widget config" gap in Session 11's Not built.
- **Checked in this session.** A throwaway local Server and a local Sofa Home page in the Browser pane at 375x812 and 1280x800: moving a widget with the arrow updated the preview, the draft saved, Publish made revision 3 and the signed-in local TV page redrew with the new order; a 41-character title blocks Publish with the Server's wording; Discard clears the draft. Never run against the live Server.
- **Not built.** Drag and drop, an entity picker or discovery (entities are typed IDs), TV sign-in status and re-sign-in from Companion, backgrounds beyond a colour (photos come with Session 14), live data in the preview for new or changed widgets, merging with a TV-side change (built in Session 16), and a rename for known apps on the TV itself.
- **Untested on the TV.** Nothing: no TV code changed. Companion is for phones and desktop browsers only. A real iPhone's Safari was not used (Chromium emulation at 375 wide).

### 16 · Widget arranging on the TV

**Difficulty 4 · Opus · high · TV**

- Long press context menus: Move and Remove on the Dashboard, Add to Dashboard in the Widgets tab. Move lifts the widget, left and right reorder, OK places, Back cancels.
- The Server commits each TV change as a new revision and applies it to any open Companion draft, so publishing that draft does not undo it.

**Done when:** a TV move followed by publishing an older draft keeps the TV move, with a test for that case.

**Why this rating:** the draft merge is the subtle part and needs a clear rule.

**Merge rule** (in full in [ADR 0004](adr/0004-tv-changes-are-operations-replayed-onto-drafts.md)). A TV change is an operation on a widget id (`move` to an index in its row, `remove` from the Dashboard, `add` to the Dashboard), not a whole layout. The Server applies it to the current layout, stores the new revision with the operation in `revisions.op`, and in the same transaction replays it onto every draft whose `base` is the current revision and moves their `base` forward. A `PUT` with an older `base` is still accepted when only TV operations follow it: the Server replays them onto the layout sent and returns the merged draft. An operation that no longer applies to the draft leaves the draft's version standing. In practice: if the draft took the widget off the Dashboard or deleted it, it stays off. If the draft placed it already, the draft's place stands. If the draft moved it to another row, it stays in that row at the TV's index. If the TV moved it within the same row, the TV's position wins. A TV removal always wins. Drafts left behind by a Companion publish are not carried; they stay stale (409), as before.

**Built (2026-11-09).** API: `POST /api/layout/ops` with `{ base, op }`, where `op` is `{ op: 'move', widget, index }`, `{ op: 'remove', widget }` or `{ op: 'add', widget }`. It returns 200 with the new snapshot and broadcasts the revision. Errors: 400 (bad body), 401 (no TV token and no Companion session), 403 (Kids Mode active), 409 (stale `base`, or the widget is not where the TV showed it), 422 (the result is invalid). Adults are allowed simply because the TV is in household mode; there is no PIN.

- **Code.** `shared/src/ops.ts` (`applyOp`, `isLayoutOp`; tested in `ops.test.ts`). `server/src/layout.ts` (`commitOp`, the replay in `saveDraft`). Migration 6 adds `revisions.op`. The route is in `server/src/server.ts`. `tv/src/shell.ts` adds the menu, the lift and the `op` activation; the overlay and the request are in `tv/src/main.ts`, and the markup and CSS in `tv/app/index.html`. In `companion/src/editor.ts`, when a save comes back with a newer `base`, Companion adopts the merged draft with "Changes made on the TV were added to your draft." It does this only if nothing was edited while the save was in flight.
- **On the TV.** A long press (500 ms) on a Dashboard widget offers Move and "Remove from Dashboard". In the Widgets tab, it offers "Add to Dashboard" for a widget not yet placed; a placed widget opens its full view. A long press on an app is still a select. Move tints the card and shows a hint bar. Left and Right reorder within the row, skipping items hidden for this profile. OK sends the move only if the order changed; Back cancels. The change shows at once; a 409 puts the old layout back and says "The layout changed meanwhile". Kids Mode has no menu.
- **Tests.** `server/src/layout-ops.test.ts` covers the Done-when case, a Companion `PUT` on the old base being merged, an undo after the merge, a table of eight conflict combinations, drafts left behind by a Companion publish, refused operations, an invalid draft, and the HTTP rules. `tv/src/shell.test.ts` covers the menus, the lift and Kids Mode.
- **Checked in this session.** A throwaway local Server and the local Sofa Home page in the Browser pane at 1920x1080, with keys only. A Companion draft was open in another tab. The TV move made revision 3, the draft moved to base 3, and the next Companion save showed the merge notice. Publishing that draft kept the TV move. Remove and Add worked, and Back cancelled both the menu and the lift. A Companion publish during a lift gave the 409 toast and put the old layout back. In Kids Mode a long press launches. After a TV removal and a Companion reload, the draft came back at the new base with both changes. Never run against the live Server or the real TV.
- **Not built.** Moving a widget to another row from the TV. Reordering apps from the TV. Resizing from the TV (there is no `resize` operation). Session 18 built the Phone Remote's Menu, which opens the same menu.
- **TV pass (2026-11-09, live Server, camera and HA remote keys).** HA's `remote.send_command` cannot hold a key, so each menu was opened with the Phone Remote's Menu (`POST /api/remote {key:'menu'}`), the same menu a long press opens. The order of steps:
  1. A Companion draft (43) was opened at revision 40 with the Photos row renamed.
  2. On Weather, the menu showed "Weather" with Move and "Remove from Dashboard". OK on Move lifted the card: tinted, with the hint bar "Left and right move it · OK places it · Back cancels". Right moved it after Calendar, and OK made revision 41 (`layout op move` in the Server log).
  3. Draft 43 moved to base 41 and kept both changes. A Companion `PUT` from the stale base 40 was merged and answered with base 41.
  4. Weather was lifted again. Publishing draft 43 meanwhile made revision 42 and kept the TV move. OK on the TV was then refused: the Server logged "revision 42 is current, not 41", the TV showed "The layout changed meanwhile. Nothing was changed; please try again." and the order snapped back.
  5. Back during a lift put the card back with no revision. Remove on Energy made revision 43.
  6. In the Widgets tab, Energy's menu offered only "Add to Dashboard". Choosing it made revision 44, and the tile read "On Dashboard".
  7. The original layout was published back as revision 45, identical to revision 40.

  The menu, the tinted card and the hint bar read clearly on Chromium 56. Kids Mode was not entered; its 403 is covered by `layout-ops.test.ts`.
- **Found and fixed on the TV pass.** Add put the widget at the end of the first widget row whatever its width. A row shows six size units and clips the rest silently, so on the full Today row an added medium or large widget would have been invisible. `applyOp` now picks the first widget row with room, or a new row. `UNITS` and `ROW_UNITS` moved to `shared/src/layout.ts`. Test: `ops.test.ts`. The fix needs a Server deploy and a Sofa Home reinstall; until both are done, the TV and the Server disagree on where an added widget goes, and the TV follows the Server on the next sync.
- **Untested on the TV.** The physical 500 ms long press on the real remote (HA cannot hold OK). Companion's merge notice on a real phone (the merge itself was checked through the API). The fixed Add on the TV.

### 17 · Backups and outage behavior

**Difficulty 2 · Sonnet · medium · TV**

- Scheduled SQLite and configuration backups, and a tested restore.
- Walk the spec's outage table on the TV: Server down, Server down during Kids Mode, internet down, Home Assistant down, reconnect. Companion shows a Home Assistant outage.

**Done when:** a restore from backup works, and each outage row behaves as written.

**Built (2026-11-09, code half; the TV walk is still to do).**

- **Backups.** `server/src/backup.ts`. Node 26's `backup()` from `node:sqlite` writes a consistent snapshot while the Server writes, to `sofa-YYYYMMDDTHHMMSSZ.db` in `SOFA_BACKUP_DIR` (off when unset, with a warning in the log; `/backups` in the image, the `sofa-backups` volume in `deploy/compose.yaml`). A backup is written at startup when the newest is over a day old, and the hourly check writes one when it becomes a day old. It goes to a `.tmp` file and is renamed, so a half-written file never looks like a backup. Retention: the newest backup of each of the last 7 days that have one, plus the newest of each of the last 4 weeks (Monday start, UTC) that have one. The media cache and secrets are not in it. What else matters, and how to copy backups off rei3, is in [restore.md](restore.md).
- **Restore.** `npm run restore -- <file> [--force]` (`server/src/restore.ts`; target is `SOFA_DB_PATH`). It runs `integrity_check`, refuses schema version 0 (not ours) or newer than the Server's, refuses a database another process holds (it tries `BEGIN EXCLUSIVE`, so a running Server blocks it), and refuses an existing database without `--force`, which keeps the old one as `.before-restore`. Stale `-wal` and `-shm` files are removed. Tests in `backup.test.ts` back up while a writer inserts, restore into a fresh directory and compare revisions, drafts, the allowance state, the device token hash and the PIN hash.
- **Companion.** `GET /api/system` (Companion session) returns `{ homeAssistant, haReachable, haSince, backup: { lastAt, lastError } }` from `server/src/system.ts`. Reachability is the Watch Allowance tick's own read of the TV entity (`startAllowance` got an `onReach` callback). Companion's home page polls it every 15 s (`companion/src/system-banner.ts`): a red notice when Home Assistant was reached and now is not, and a line with the last backup time. "No token configured" is not an outage and shows nothing.
- **Checked locally.** The real Server (`server/src/main.ts`) with Home Assistant pointed at a closed port and backups on: `/api/system` gave `haReachable: false`, a backup appeared at startup, the restore CLI refused without `--force` and restored with it. Unit tests: 267 pass.
- **Deploy change.** New volume `sofa-backups` mounted at `/backups`; `docker compose -f deploy/compose.yaml up -d --build` creates it. No new secret.

**What each outage row does today** (read from the code; "Local" is what a test or a local run covers, "TV" is what only the TV can show).

| Row | What the code does | Local | TV |
| --- | --- | --- | --- |
| **Server or LAN outage** | Sofa Home keeps the last valid snapshot in localStorage (`sync.ts`), so a cold start without the Server draws it. Widget cards keep their stored answer and turn stale (`widgets.ts`: `reachable === false` marks stale; no stored answer shows "Not available right now"). The Kids Mode tile is unavailable while the layout sync reports an error or the last Kids request failed (`updateKidsTile`, `tileAvailable`). Apps launch without the Server. | Covered by `sync.test.ts`, `widgets.test.ts`, `kids.test.ts`, `shell.test.ts`. | The look on the TV: stale marks, the Kids tile wording, a cold start with the Server stopped, standby plus outage. |
| **Server outage during Kids Mode** | Nothing on the TV switches it off: the clock and the switch-off live in the Server (`allowance.ts`), and the TV only reads. The Kids screen stays up on the last status (`screenFor` keeps the last answer) and the stored kids layout. Leaving Kids Mode needs the Server for the PIN check, so the pad says "The Server is not reachable." When the Server returns, `allowance.observe` sees a gap over `GAP_MS` (60 s) and the TV's `on` must prove itself again for 4 minutes, so the outage time is not counted against the children. | PIN pad message and the gap rule are in `kids.test.ts` and `allowance.test.ts`; the Server stop and start with its database is the `main.ts` run above. | The whole row on the TV: the Kids screen during a Server stop, the remaining time shown, the Exit message, and the first minutes after the Server is back. |
| **Internet or upstream outage** | The Server reaches only the LAN (Home Assistant, Immich, Caddy). An internet outage shows up as Home Assistant entities turning `unavailable` or an integration failing: the card shows a dash, never 0 (`formatState`), and a read failure keeps the last card stale (`homeassistant.test.ts`). Album listings and pictures already in the Server's cache survive an Immich that is away (`photos.ts`). Apps need the internet themselves. | The Home Assistant adapters with a fake offline Home Assistant (existing tests). The real internet cut was not made. | Cutting the router's WAN: the cards, Netflix and YouTube behaviour, and whether the clock and the photos stay up. |
| **Home Assistant outage** | `/api/system` says `haReachable: false` and Companion shows the notice. In Kids Mode the allowance tick reads null, so `observe(null)` changes nothing and the clock does not run: the TV is not switched off, no warning is sent, no Top-up notification is acted on (the events subscription retries every 5 s). While Home Assistant is down the children have no limit; when it returns the `GAP_MS` rule makes the TV prove itself again for 4 minutes. A switch-off that fails is retried on every tick. Phone Remote is Session 18. | Real Server against a closed port (above); `allowance.test.ts` (fake socket and failing writes); `system.test.ts` (the callback). The Companion text is `system-banner.test.ts`; its look in a browser was not checked. | Whether Sofa Home looks right: the Dashboard cards stale, Kids Mode on the TV with Home Assistant stopped (the real Home Assistant must be stopped or blocked to test, and the real TV must not be switched off by accident). |
| **Reconnect** | `sync.ts` opens the socket and only then calls `refresh()`; `live` becomes true only when that snapshot arrived on the new socket. Sofa Home also refreshes Kids and widgets on socket open and on resume (`main.ts`). | `sync.test.ts`. | A real Server restart with the TV on: that the revision is current before the cards look fresh, and that Standby wake-up reconnects. |

No defect was found that needed a fix. Two behaviours you may not expect, both by design: with Home Assistant down the Watch Allowance clock stops, and the Companion banner can lag the real outage by one tick (5 seconds) because it reports the tick's last read.

- **TV pass (2026-11-09, main c23d803 merged, current Sofa Home reinstalled with `tv/build.sh install`).** The outage was made for the TV only, without touching production: a pass-through proxy on the Mac (`http://192.168.42.58:8095` to the live Server) became the TV's Server address (localStorage key `sofahome.server`, set over `sdb` debug and DevTools), and stopping the proxy was the Server outage. Watched through the Mac camera and the page's own text. The address was removed again afterwards and the TV is on the household Dashboard, revision 45, Live, on the real Server address.
  - **Server outage, on the Dashboard: as written.** Within 8 s of the proxy stopping the footer said Offline, then "Server unreachable", the Kids Mode tile read "Not available right now", and about 30 s later all 4 widget cards were marked stale (faded in the camera view). The layout stayed (revision 45).
  - **Cold start without the Server: as written.** Reloading Sofa Home with the Server away drew revision 45 at once from the stored snapshot, the Kids tile unavailable and the cards stale from the stored answers.
  - **Reconnect: as written.** With the proxy back, the footer was Live and the tile and cards were fresh within 7 s, at revision 45.
  - **Companion Home Assistant notice.** Not seen against the real Home Assistant. Checked in the browser pane (phone width) against a local Server whose Home Assistant URL is a closed port: the red notice with the time and the "Last backup: ..." line.
  - **Not done, on purpose.** Server outage during Kids Mode (the coordinator said not to enter Kids Mode), and a real Home Assistant outage (it would stop the household's Home Assistant). A WAN cut was not made either. The Network emulation and request interception of this TV's old Chromium do not work over DevTools, which is why the proxy was used. A launch of an app during the outage was not tried.
- **Still needs the TV.** Server stopped with Sofa Home on the Dashboard, then restarted. Server stopped during Kids Mode, with the Exit attempt, then restarted. WAN cut. Home Assistant stopped, on the Dashboard and in Kids Mode. Reconnect after each. Companion on a phone during the Home Assistant stop, to see the notice.
- **Not built.** Nothing sends a notification when a backup fails (the log and Companion's line say so). No automatic copy off rei3.

---

## Phase 3: Convenience

### 18 · Phone Remote

**Difficulty 2 · Sonnet · medium · HA, TV**

- Companion page with directional keys, OK, Back, Home and media keys. The Server forwards them through the Home Assistant remote entity using the write guard.
- Menu button sent over the Sofa Home WebSocket to open the focused widget's context menu. It does nothing inside a provider app.

**Done when:** the Phone Remote navigates Sofa Home and a provider app, and Menu opens a widget's context menu.

**Update 2026-11-10 (user):** the user does the remaining TV check (media keys, Home, keys inside a provider app) themself.

**Built (2026-11-09).** API: `POST /api/remote` with `{ key }`, Companion session only (the TV token and no cookie are 401). Keys: `up down left right ok back home play pause stop rewind forward` (Samsung `KEY_UP ... KEY_ENTER, KEY_RETURN, KEY_HOME, KEY_PLAY, KEY_PAUSE, KEY_STOP, KEY_REWIND, KEY_FF`) and `menu`. Answers: 200, 400 (unknown key), 403 (Kids Mode, see below), 409 (Menu while Sofa Home is not in front), 429 (more than 10 presses in 1 s per session, `Retry-After: 1`), 502 (Home Assistant failed), 503 (no Home Assistant).

- **Code.** `shared/src/remote.ts` (the key table, shared by guard, Server and Companion). `server/src/remote.ts` (rate limit, ordering, Kids Mode rule, Menu). `ha.ts`: the write guard no longer accepts any `KEY_*` but only those twelve codes. `companion/src/remote.ts` and the `/remote` section in `index.html`, a link on the home page. TV: `sync.ts` `onMenu`, `shell.menuKey()`, and `main.ts` (`reportVisible`, `phoneMenu`).
- **Menu and "is Sofa Home in front".** Sofa Home sends `{ type: 'visible', visible }` over its WebSocket on open and on every `visibilitychange`. The Server keeps the last value per TV socket (unknown counts as not in front) and sends `{ type: 'menu' }` only to visible ones; no socket or none visible is 409. The TV opens the focused widget's menu through `shell.menuKey()`, which, unlike a long OK, never selects or launches. It does nothing while an overlay is open or a widget is lifted.
- **Volume** is not offered: not required, and keeping it out keeps the allowlist small. Power is excluded because the Watch Allowance owns it. Play and Pause are two buttons, as Samsung has no toggle code.
- **Kids Mode decision.** The remote keeps working (arrows, OK, Back, media), but `home` and `menu` are 403 while Kids Mode is on: Home would leave the approved app for Samsung's own launcher, and Menu edits the layout, which Kids Mode forbids anyway. An adult who needs Home exits Kids Mode first. Power, volume and source are not keys at all, and the auth is the Companion session, so a child cannot reach it without the phone being unlocked. The physical remote's Home key cannot be intercepted by Sofa Home either way.
- **Tests.** `server/src/remote.test.ts` (key mapping, bad bodies, rate limit, ordering, 502/503, Kids Mode, Menu with fake sockets, then over HTTP and a real WebSocket with HA in dry run), new refused keys in `ha.test.ts`, `shell.test.ts` and `sync.test.ts` for Menu. `npm run check`, `npm test` (273) and `npm run build` pass.
- **Checked in this session.** A local Server with a fake HA in dry run and the Companion page in the Browser pane at 375 wide: layout and tap sizes fine, Up logged `remote.send_command KEY_UP` as a dry run, Menu said "Sofa Home is not on screen". The Sofa Home glue in `main.ts` was not run in a browser.
- **Not built.** Hold to repeat on arrows, volume, an on-screen text entry, a live "Sofa Home is in front" indicator on the page.
- **Untested on the TV and HA.** Real `remote.send_command` for each of the twelve codes (especially `KEY_FF`, `KEY_REWIND`, `KEY_HOME`); keys inside Sofa Home and a provider app; whether Sofa Home's socket survives while a provider app is in front (if not, Menu answers 409, which is the intended behaviour, but the `visible: false` report may then never arrive and a stale `true` lingers until the Server's ping drops the socket); Menu opening a widget's menu on the TV; the page as an installed PWA on the phone.
- **TV pass (2026-11-09, live Server and real TV, by the coordinator after the Session 18 agent was blocked by the permission check).** Through `POST /api/remote` with a Companion session: unknown key 400, no session 401; down, up, left, right and back 200 with no Server warnings; a burst of 14 presses in one second gave 10 x 200 and 4 x 429; Menu with focus on Weather opened the "Weather" menu (Move, Remove from Dashboard) on the camera, Back closed it. Not yet checked: play, pause, stop, rewind, forward and home on the TV (home would leave Sofa Home), the Remote page on a real phone, Menu inside a provider app, Kids Mode refusals live.

### 19 · Installable PWA

**Difficulty 1 · Haiku · low**

Manifest, icons and a minimal service worker for Companion so it installs on iPhone and desktop. No offline editing.

**Done when:** Companion installs to an iPhone home screen and opens full-screen.

**Why this rating:** standard, mechanical work.

**Built (2026-11-09).** `companion/manifest.webmanifest` (standalone, background `#f6f1e7` and theme `#2f5d46` from `COLORS`), icons in `companion/icons/` (180 apple-touch, 192, 512, maskable 512; copied from `assets/brand/v1`), `companion/sw.js` (a fetch listener that never answers, so nothing is cached and no offline mode), registered in `companion/src/main.ts`, iOS meta tags in `companion/index.html`. The build copies them into `dist/`. Server: `sw.js` is served `no-cache`; the CSP is unchanged. Test: `server/src/pwa.test.ts`.

- **Checked.** `npm run check`, `npm test` and `npm run build` pass. On a throwaway local Server (not the live one), `/kids/topup` and `/` return the Companion page, sign-in sets the cookie and the session is accepted on `/kids/topup`, and the manifest, worker and icons are served with the right types.
- **Not checked.** A real iPhone home screen install and a desktop Chrome install prompt. The Server must be deployed at `https://sofa.familie-farkas.de` first; then try "Add to Home Screen" on an iPhone.

### 20 · Title handoff and favorites library (dropped 2026-11-09: the household does not want it)

**Difficulty 4 · Sonnet · high · TV**

Only start if the household still wants it, since only ARD reached title opened.

- Favorite model: provider identifier kept apart from its launch recipe.
- Launch recipes: ARD through the `eden_resume` app control request with the `PAYLOAD` form that passed; app opened for KiKA, ZDF, Plex, YouTube and Netflix; a neutral unavailable state otherwise.
- Companion page to curate favorites (parent-curated, no imports). Favorites in Kids Mode.

**Done when:** an ARD favorite opens its series page from Kids Mode, and a broken recipe shows unavailable without deleting the favorite.

### 21 · YouTube IFrame player experiment (dropped 2026-11-10: no go; the result below stays as a record)

**Difficulty 2 · Sonnet · medium · TV**

The one provider experiment the spec lists that has not run: the IFrame player inside Sofa Home. Check embed restrictions, playback after a remote gesture and remote focus. Record the result with the spec's outcome classes.

**Done when:** Known results records the outcome. No product code unless the result is positive and the user asks for it.

**Result (2026-11-09, real TV, firmware T-KTM2DEUC 1400.2, throwaway signed probe app `ytprobe001.YtProbe`, uninstalled afterwards; no product code). Outcome class: playback started, but only through a Server-hosted relay page; the direct form fails.**

- **Direct IFrame player inside the packaged page (`file:///index.html`): unavailable.** The API script loads and `onReady` fires, then `onError` 153 (embedder identification missing) comes every time, with and without the `origin` parameter.
- **Relay page on an `http://` origin, embedded as an `<iframe>` of the packaged page: playback started.** The relay loaded the IFrame API with `origin=location.origin` (a LAN HTTP page, empty `document.referrer`) and the video (muted, `autoplay=1`, `playVideo()` in `onReady`) played at once with no remote gesture: state 1, `currentTime` advancing in real time (a 22 minute public video, camera showed the picture). Sofa Home would need the Server to serve that page (the real HTTPS Server origin was not tried; only a Mac LAN HTTP server).
- **Remote gesture and control:** while the parent page keeps focus (`activeElement` BODY) every remote key reaches the parent. Parent `postMessage` to the relay drove the player: OK paused (state 2) and played, Up seeked +30 s, Right unmuted (`isMuted()` false). Unmute was set after a remote key; `setVolume(0)` came back as volume 5, so the unmuted state was briefly audible at low volume, then the app was closed.
- **Remote focus:** once the iframe is focused (`iframe.focus()`), arrows, OK and Back (10009) go only to the iframe's document; the parent gets nothing and Back does not leave the app. The relay page must forward keys with `postMessage` (or the parent must never focus the iframe).
- **Not proven:** unmuted autoplay without a gesture (kept silent); an embed-restricted video (error 101/150 path; the invalid-ID error 100 and the restricted case were not exercised); the HTTPS Server origin and a signed-out versus signed-in difference; Kids Mode filtering of what may be played; sustained playback beyond about 2 minutes. A fresh install while the probe was running once killed the app back to Smart Hub (probe tooling, not the player).
- **Decision:** no product code. If the user wants YouTube in Sofa Home, build a Server-served relay page with `postMessage` key forwarding and a curated video list, and first re-test over HTTPS from the Server.

### 22 · Plex episode allowance spike (dropped 2026-11-10: no go; the result below stays as a record)

**Difficulty 4 · Opus · high · HA, TV**

Follow the event table in the spec's Watch Allowance section.

- Track the Plex client entity: predict the end from `media_position_updated_at` plus the remaining duration, ignore pauses, count an episode at `idle`, keep the last content ID.
- Test the untested cases: stopping mid-episode, seeking, episodes without autoplay, and whether `KEY_PAUSE` works in Plex.
- Do not use `sensor.plex_rei3`.

**Done when:** the spec records whether "two episodes, then the TV turns off" works, and if it does, a design for adding it to Session 08's engine.

**Why this rating:** inference from a lossy external entity, and the result decides a product feature.

**Result (2026-11-09 ~23:45 CET, real TV, Plex for Samsung 5.59.3, TV volume 0, Kids Mode off; no product code). Verdict: "two episodes, then the TV turns off" can work for Plex, with the design below. Not proven end to end.**

Entity `media_player.plex_plex_for_samsung_tv_2018` (the TV's Plex client; its name says 2018 but it is this TV), read every second from rei3 with the Server's token (throwaway poll script, log kept at `rei3:/tmp/plexpoll-session22.log`). Adventure Time S3E7 "Still" (707 s) and S3E8 "Wizard Battle" (705 s). Times UTC.

| Case | What happened |
| --- | --- |
| **Start / resume** | ENTER on the episode: `playing` 1 s after the press, position 0, fresh timestamp. A resume at 213 s was reported at 22:45:53 with 213, but 11 s later the position was 234: the first update after a resume can be about 10 s stale. |
| **Updates while playing** | About every 10.6 s, plus at once on every change. The position does not tick between updates. |
| **`KEY_PAUSE`** | Works: `paused` within 1 s (22:46:09.96, position 239, frozen). `KEY_PLAY`: `playing` again at 239 with a fresh timestamp (22:46:23). |
| **Seek** | `KEY_RIGHT` seeks +30 s. Every jump came through within 1 to 2 s with a fresh timestamp (13 presses: 239 → 276 → 339 → … → 688, consistent with the playback time in between). Backward seek not tried. |
| **Natural end, autoplay on** | Last update 22:47:02.6 at 688 → predicted end 22:47:21.6; `idle` at 22:47:22.3 (+0.7 s), details cleared. Next episode `playing` at 22:47:39.7 with a new content ID (57684) and position 0: gap 17.4 s (17 s on 2026-11-07 too). The credits played to the file end; no early Up Next. |
| **Stop mid-episode** | `KEY_STOP` at about 20 s of 705: `idle` at 22:47:59.9 within 1 s, details cleared, Plex back on the episode page. The state is the same as an end; only the prediction (about 685 s early) tells them apart. |
| **End without autoplay** | Episode 8 seeked to the end: last update 22:48:48.7 at 700 → predicted 22:48:53.7; `idle` at 22:48:58.7 (+5 s). `KEY_RETURN` on Plex's Up Next screen cancelled the countdown: still `idle` 40 s later, nothing played, Plex on the season page. |
| **TV REST API** | Reports Plex (`kIciSQlYEM.plex`) `running:false, visible:false` while it is in front, so the REST API cannot see Plex. Launching it through REST works. |

**Design for Session 08's engine (if the household wants it):**

- Config: `kidsMode.plexEpisodes` in the layout (optional whole number 1 to 10; absent means minutes only) and `SOFA_HA_PLEX_ENTITY` (this entity). The minutes allowance stays as the backstop; whichever runs out first wins.
- A small pure tracker next to `allowance.ts`, fed the Plex entity on every tick (a second `getState`; unavailable or unknown counts nothing). It keeps the content ID, duration, position and timestamp of the last `playing` or `paused`. On `idle` it counts one episode only if the predicted position (position, plus the time since the timestamp if it was playing) is at least the duration minus 30 s; otherwise it is a stop and counts nothing. A `playing` with a new content ID while the old one was predicted within 30 s of its end also counts the old one (covers an Up Next that skips credits, untested). It keeps the last counted content ID and time so one end is never counted twice. Counts reset with the day at 04:00 like the minutes, and are saved with the rest of the state.
- At the counting `idle` that reaches the limit: send `KEY_RETURN` at once (cancels Plex autoplay; already allowed by the Phone Remote write guard), then the existing zero path (bring Sofa Home to the front, switch off, Done Screen, re-off). With the 5 s tick plus up to 10 s launch wait, the off can land 15 s after `idle`, too close to the 17 s autoplay, which is why Back comes first. If the next episode starts anyway, send `KEY_PAUSE` (works, also allowed) and go on with the zero path.
- Warning: when the last allowed episode starts, notify the adults instead of the five-minute warning, with a "+1 episode" action next to the minute Top-ups.
- Status for Companion and the Done Screen: episodes watched and allowed today.

**Not proven:** turning the TV off inside the 17 s gap (not tried at midnight: the TV could not be switched back on from the Mac); the whole flow through the Server (no code); a series finale with no next episode; shows whose credits marker starts Up Next early; seeking backward; long pauses (whether the entity goes `unavailable` while paused); other Plex users or profiles on the TV.

## Phase 4: Widget design and detail views

Added 2026-11-10 at the user's request. The cards are plain, the calendar card is badly laid out, and OK on a widget opens a full-screen view that today carries little more than the card (weather and energy show a list of readings). Wanted: weather with the next hours and the week, the calendar with the next days laid out as days, power with a graph of the last few hours, and a more considered look overall (the Dashboard on one screen, real app icons, the time-of-day wallpapers). Kids Mode looks right to the user and only gets the app icons.

**What is already there.** Every widget may send a `detail` display that Sofa Home draws full screen (`WidgetData.detail`, `tv/src/cards.ts`, `#full-card` in `tv/app/cards.css`, 1560 x 760 px). The `columns` template already draws a row of columns with bars (`level`), up to 12 at full size. Neither the forecast nor history is read yet: weather gives only the current state (`homeassistant.ts`), power gives only the current reading.

**What is new, and why it costs a Sofa Home release.** A line graph and a day-by-day grid are not expressible in the five templates (ADR 0003), so Phase 4 adds templates. That means one new signed package and one reinstall; 24 therefore builds all of them together and everything after it is Server-only.

### 23 · Design direction

**Difficulty 3 · Opus · high**

Settle the look before building, from what the Dashboard does today and what the user asked for on 2026-11-10. Render the Dashboard and the three full-screen views (weather, calendar, power) at 1920 x 1080 as HTML mockups from the real tokens (`shared/src/tokens.ts`) and the real wallpapers, a few variants of each open choice, and let the user pick. Start from screenshots of today's Dashboard (camera on the TV) so the critique is of what is really drawn.

**Decided (the user, 2026-11-10; mockups follow these, they do not reopen them).**

- **One screen.** The whole Dashboard fits at once and the apps row at the bottom is always visible, never clipped. Budget: bar, Kids Mode tile, one widget row, apps row (about 770 of the 830 px between the bar and the footer today; a second widget row does not fit, which is why the photo widget's own row clipped).
- **One widget row, one slot each.** Widgets are small (264 x 220) by default; photos and calendar do not need to be wide. Medium and large stay in the code but are not the default, and the editor warns when a row passes six units (the Session 14 finding).
- **Real app icons** like the official apps, in place of the letter badges, on the Dashboard, All Apps and the Kids Mode grid. This is the only change to Kids Mode.
- **The time-of-day wallpapers** (`assets/brand/v1/wallpaper/day-cycle-4k`: morning, midday, evening, night) are the Dashboard background; Kids Mode keeps its own forest.
- **The footer line** (Server address, revision, Live) is small and quiet, since it is read from the TV's own screen at arm's length, not from the sofa.
- **Left margin versus focus ring.** The focus ring clips on the left. Probable cause, to confirm on the TV: a focused tile scales by 1.06 and the ring adds 11 px, which for a medium or large widget grows 17 to 25 px per side, more than the row's 24 px padding; the row has `overflow: hidden`. The mockups show the fix (ring without scale on wide tiles, or more room).

**Open choices for the mockups.**

- Where the Kids Mode tile sits: its own row as now, or next to the greeting over the wallpaper as in the first draft, which frees a row.
- App tiles: icon only with the name shown on focus, or icon with a label.
- Calendar and weather cards at one slot: what a 264 x 220 card shows (calendar: the next event with its time and how many more; weather: temperature, condition, high and low).
- The calendar view (week of day columns, as proposed, or a month grid) and whether the weather detail stacks hours over days.
- Text and chart colours over a dark night wallpaper (the clock and the greeting sit on the wallpaper, not on a panel), type scale at 55 inches, spacing.

**Done when:** the user has picked a direction and the plan records the token changes, each template's layout, the Dashboard's vertical budget and the icon tile in a few lines.

### 24 · Templates: chart, days, stack

**Difficulty 4 · Opus · high · TV**

- `chart`: one series over time, drawn as an inline SVG line with a soft fill, a min and max label, time-axis labels and an optional "now" mark. The Server sends already bucketed points (at most 96) and every label as a string, so the TV does no date or number formatting (ADR 0003).
- `days`: day columns with timed events (the calendar view): `{ days: [{ title, subtitle?, today?, events: [{ time, title }] }] }`. Sofa Home fits as many columns as the size allows.
- `stack`: two displays one above the other in the full-screen view, so a widget can show hours over days.
- Validation, `ITEM_LIMITS`, Companion's preview and tests for each; Kids Mode strips still go through `forKids`. Chromium 56 limits apply (no grid, no flex gap; SVG is fine).

**Done when:** each template draws from a fixture on the TV at card and full size, an unknown or malformed display shows the widget as unavailable instead of breaking the Dashboard, and Sofa Home is reinstalled.

### 25 · Weather forecast views

**Difficulty 3 · Sonnet · medium · HA**

`weather.home` reports `supported_features` 3 (daily and hourly forecasts). Read them with `weather.get_forecasts` and `return_response`, the same kind of read as the calendar's `calendar.get_events` (not one of the three writes, so the write guard is unchanged; the "Server never makes a service call" line in `homeassistant.ts` and ADR 0003 gets corrected). Detail: a `stack` of the next 12 hours (temperature bars, rain chance in the note) over the next 7 days (high, low, condition). The card keeps today's reading and gains the high and low. A forecast failure keeps the current reading and drops only the forecast.

**Done when:** the detail view on the TV shows hours and days from the live entity, and a Home Assistant outage marks it stale rather than blank.

### 26 · Calendar days view

**Difficulty 3 · Sonnet · medium · HA**

Move the calendar to the `days` template. Card: **one slot (small, 264 x 220) is the default**, so the calendar gains the `small` size: the next event (time, title) and "and 3 more today"; medium shows today and tomorrow, large three days. Detail: the next seven days as columns, today marked, all-day events on top, long titles cut with an ellipsis. Kids Mode keeps "Something planned" and never a title or place. Fold in the open Session 13 follow-up (read `uid` and `recurrence_id` from `/api/calendars/<entity>`) only if it is a few lines.

**Done when:** the live calendar draws as day columns at both sizes and Kids Mode still shows no titles.

### 27 · Power history chart

**Difficulty 3 · Sonnet · medium · HA**

`sensor.powerfox_aktuell` samples about every 10 seconds (1839 states in 6 hours). Read `/api/history/period/<start>?filter_entity_id=...&minimal_response&no_attributes` and average into 5 minute buckets (about 72 points for 6 hours). Detail: a `chart` of the last 6 hours with min, max and average, and the current reading as the headline. Config: hours to show (2 to 24, default 6). Cache the history for the freshness interval, so a 30 second live read does not pull the history each time. Missing stretches draw as a gap, never as zero.

**Done when:** the detail view on the TV shows the last 6 hours from the live sensor, and an energy sensor with no history shows the reading alone.

### 28 · Dashboard layout, focus and footer

**Difficulty 3 · Sonnet · high · TV**

Build the chosen layout in `tv/app/index.html`, `tv/src/shell.ts` and `view.ts`. The Dashboard fits one screen with the apps row always visible (the content column pins the last row at the bottom and gives way above it, rather than clipping the bottom); one widget row of small widgets; the sample layout and the editor's defaults use `small` (`photos`, `calendar`). Fix the focus ring on the left (confirm the cause with a camera shot first). The footer is small and dim (about 16 px, low contrast) and still shows the Server, revision and Live or Offline. The live layout changes only through Companion or the layout ops, with the user's say-so.

**Done when:** on the TV the whole Dashboard is on one screen, the first and last tile of every row show a complete ring, and the footer does not draw the eye.

### 29 · Time-of-day backgrounds

**Difficulty 3 · Sonnet · medium · TV**

The four masters are 3840 x 2160 and untracked (the user's files); the TV is 1080p, so ship 1920 x 1080 JPEGs in the package (a few hundred KB each, under the memory budget measured in Session 14) and **ask the user before committing any of `assets/brand`**. A new Layout background kind `daycycle` picks the picture from the TV's clock (morning 06 to 10, midday 10 to 17, evening 17 to 21, night 21 to 06) and cross-fades at a change; the schema, validator, Companion's Appearance control and the preview learn the kind. Over a dark night picture the text that sits on the wallpaper (clock, date, greeting) switches to the light ink (`textOn`). A solid colour, an image and the photostream slideshow stay available. **Decided 2026-11-10 (user): fixed hours**, not sunrise and sunset from `sun.sun`; revisit only if the hours feel wrong with the seasons.

**Done when:** the four pictures show at their hours on the TV (test by faking the hour), the cross-fade is smooth, and the clock stays readable on the night picture.

### 30 · App icons

**Difficulty 3 · Sonnet · medium · TV**

The tiles show a letter badge today. First a spike: the package already holds the `application.info` privilege, so try `tizen.application.getAppInfo(id).iconPath` on the TV for each app (Netflix, YouTube, Plex, ARD, ZDF, KiKA) and see whether an `<img>` may load it. If it can, the icons are the real ones with nothing to ship or license. If not: icon files bundled in the package (`tv/app/img/apps/<id>.png`, supplied or approved by the user, since they are trademarks and the repository may be public), or uploaded through Companion and served by the Server so they stay out of git; the letter badge remains the fallback for an app with no icon. Rounded-square icons at the tile size, also in All Apps and the Kids Mode grid.

**Done when:** every app on the Dashboard, in All Apps and in Kids Mode shows its own icon on the TV, and an app without one still shows its letter.

### 31 · Design pass and TV walk

**Difficulty 3 · Sonnet · high · TV**

Apply the chosen direction to what the earlier sessions left: the cards, the headers and the full-screen frame. Then walk the whole Dashboard on the TV with the camera: every widget, stale and unavailable states, the three detail views, the wallpapers at their hours, the icons, Kids Mode. Fix what the camera shows (clipping, contrast, text too small at 55 inches from a normal distance).

**Done when:** the user has seen it on the TV and accepts the look.
