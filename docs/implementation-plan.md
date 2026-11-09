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
- **Keys and long press.** Arrows 37 to 40 and Back (10009, Escape on a desktop) act on `keydown`. OK (13) acts on `keyup`: held for less than `LONG_PRESS_MS` (500 ms) is a short press, which selects; at or above it is a long press, reported as `{ key: 'ok', long: true }`. `createRemote` in `keys.ts` is the event Sessions 11 and 16 hook into. Until Session 16 claims it, `shell.key` treats a long press as a select. The raw key log still goes to `tv/tools/recv.py` and `sofahome.events`; it is no longer drawn on screen.
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
| **HA reports `on` after `off`** | `pending` when it comes within 4 minutes of the `off` and Sofa Home has made no request since; otherwise `on`, counting from now. |
| **`pending` for 4 minutes** | `on`, and those 4 minutes are counted after all. A false `on` (about 3 minutes, see Known results) ends in `off` first and is never counted. |
| **A request from Sofa Home** | Any `/api/kids` request with the device token proves the TV is on. A `pending` on becomes `on` from that moment, and the next `on` after an `off` is not held back. |
| **HA `unavailable`, `unknown` or unreachable** | Proves nothing; the clock waits. |
| **Enter, exit** | Entering starts counting from now if the TV is on. Exiting stops the clock and clears the Done Screen. |
| **5 minutes left** | While counting, the notification goes once to each phone with **+5 min**, **+10 min** and **Custom**. It goes again only after a Top-up lifts the time left above 5 minutes. |
| **Top-up** | Adds minutes to today's budget. Clears at zero and Done Screen pending once there is time left. |
| **Zero** | While counting, `media_player.turn_off` through the write guard, once per zero, retried every tick while it fails. Then at zero and Done Screen pending. Kids Mode stays active. The clock stops at zero, so a later Top-up gives its full minutes. |
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
  - Session 09 adds the PIN in front of exit from the TV. Sofa Home should `GET /api/kids` on start and on resume, because that request is the proof that the TV is on.
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
- **Sofa Home.** Fetches `/api/widgets` for the household profile on start, on the signal, on a new revision, on resume and every 30 seconds, and keeps the last answer in `localStorage`. Kids Mode shows no widgets yet. A card is stale when the source is failing, the Server is unreachable or the data is older than `staleAfterSeconds`, with age measured against the Server's clock; stale cards dim and say when they were updated. OK on a widget opens the full view of its `detail` (or `card`); OK on Close or Back closes it. Long press on a widget is still a select until Session 16.
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
- **Not built.** Drag and drop, an entity picker or discovery (entities are typed IDs), TV sign-in status and re-sign-in from Companion, backgrounds beyond a colour (photos come with Session 14), live data in the preview for new or changed widgets, merging with a TV-side change (Session 16), and a rename for known apps on the TV itself.
- **Untested on the TV.** Nothing: no TV code changed. Companion is for phones and desktop browsers only. A real iPhone's Safari was not used (Chromium emulation at 375 wide).

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
