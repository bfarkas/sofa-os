# Sofa.OS Next Version Plan

The [implementation plan](implementation-plan.md) ends at Session 37 and is now a record: Phases 0 to 4 are built. New work is collected here instead. This file starts as an inbox of ideas and changes. When the user picks one, it becomes a session with the same format as the old plan (difficulty, model, effort, needs; what and why; tests; done when), numbered from 38 so that commit messages and references stay unambiguous. The ratings mean what they mean in the [old plan](implementation-plan.md#how-to-read-the-ratings); **TV** needs the user at the TV, **HA** touches the household's live Home Assistant.

How an idea moves: **Inbox** (one line, no design) → **Picked** (the user decided, mockups first for anything visual) → **Session** (written out below, built) → **Done** (one line with the commit, then deleted from here when it no longer helps).

## Inbox

Ideas and changes the user wants, one line each, newest at the top. Nothing is designed yet.

- Find a better way to add and design new widgets. Today a new type is one adapter module plus one line in `server/src/catalogue.ts`; a new template also needs `shared/src/widgets.ts`, `tv/src/cards.ts`, `tv/app/cards.css` and a new signed TV package. Worth borrowing from https://github.com/natureglass/haven-tizen-ha: entity picking grouped by area with a Suggested section first, labels shortened by room ("Living Room Temperature" → "Living Room"), subscribing only to the entities on screen, camera grid presets.

## Sessions

Picked by the user on 2026-11-15 after a grilling round. Order: check the base on the TV, then the small features, the camera, the consoles, the unicorn, and the Companion redesign last (so it restyles everything at once; the features before it add their Companion bits in today's style).

Open, not for this version: the user will switch the Bosch camera to local data mode some day; the Denon input of each console is mapped in Session 43.

### 38 · TV check of Sessions 34 to 37

**Difficulty 2 · Sonnet · medium · TV**

Sessions 34 to 37 were built and tested in the desktop harness only. New features stack on them, so check them on the real TV first and fix only what the check finds.

- Waste widget: bin colours (my guess for the Hannover bins), and "Today" until the integration's day switch (10:00); check on a collection day. If the household wants "Today" to end earlier, read the calendar entity too.
- Weather card and 24 hour view, calendar agenda card and week board.
- The five colour schemes on all four wallpapers (the user picks each in Companion → Appearance). Lamplight's warn colour is only 3:1 over the morning sky.
- Session 32 items 4 to 6: app icons for ARD, ZDF and KiKA, the Kids Mode tile's prominence from the sofa, midday and night on the panel.

**Done when:** each item above is confirmed or fixed on the TV, and the "Built, NOT yet seen on the TV" notes in the old plan get a line saying so.

### 39 · All installed apps in the Apps screen

**Difficulty 2 · Sonnet · medium · TV**

Today both the Apps tab and the Dashboard row come from the curated `layout.apps` (`tv/src/shell.ts:87`); the TV never asks what is installed, and Companion's picker offers a hard-coded `KNOWN_APPS` list (`companion/src/edit.ts:69`). The `application.info` privilege is already in `tv/app/config.xml`.

1. Sofa Home reads `tizen.application.getAppsInfo`, drops apps with `show === false` and itself. The Apps screen shows the curated apps first in their order, then the rest A–Z. The Dashboard row stays curated.
2. The TV reports the installed list to the Server (id and name); Companion's app picker offers that list instead of `KNOWN_APPS` (keep `KNOWN_APPS` only as the fallback before the TV has reported).
3. Kids Mode is unchanged: it still shows only `layout.kidsMode.apps`.

No denylist unless something odd shows up on the TV.

**Tests.** The merge (curated first, rest sorted, duplicates removed, hidden and self dropped) as a pure function; the Server endpoint validates and stores the list.

**Done when:** every launchable app on the TV appears in the Apps screen and launches, the Dashboard row is unchanged, and Companion's picker lists the TV's real apps.

**Built (date 2026-11-15), NOT yet seen on the TV:** `mergeApps` and `parseInstalledApps` in `shared/src/apps.ts`; Sofa Home calls `tizen.application.getAppsInfo` (`tv/src/launch.ts`) at start and whenever it comes back to the front, shows curated apps first and the rest A to Z in the Apps tab (`shell.setInstalled`), and PUTs the list to the Server. Server: `PUT /api/tv/apps` (TV token only, validated, max 500) and `GET /api/tv/apps` (Companion or TV), stored in a new `tv_apps` table (migration 7). Companion's picker uses the reported list (`pickableApps`), falling back to `KNOWN_APPS`. Deviations: the Server needs deploying before the TV's report is accepted (an old Server answers 404, which only logs); a curated app stays even if the TV marks it hidden (the user agreed). Follow-up after the user's answers (2026-11-15): the "All Apps" tile counts every app the Apps tab lists; the TV still reads its list locally on every return to the front, but PUTs it only when it changed since the last report (and once per start, retrying after a failure), so no refresh button is needed. Not checked: that `getAppsInfo` objects expose `name`/`show` as plain properties on the TV, and whether any odd system apps need a denylist.

### 40 · Photo screensaver

**Difficulty 2 · Sonnet · medium · TV**

There is no idle detection today. The slideshow pieces exist (`tv/src/slideshow.ts`, `tv/src/photos.ts`, the ambient view in `tv/src/photoview.ts`).

- An idle timer runs only while Sofa Home is in front and Kids Mode is off. Any key resets it.
- After the timeout the ambient photo view starts with the same Immich album as the photo widget.
- The first key press only wakes Sofa Home back to where it was; it does not act.
- The timeout is a household setting in Companion → Settings: Off, 5, 10, 15 or 30 minutes, default 10.

**Tests.** The idle timer as a pure state machine (start, reset on key, paused in Kids Mode and when Sofa Home is in the background, Off never fires); the setting's validation on the Server.

**Built (2026-11-15), NOT yet seen on the TV:** `tv/src/idle.ts` is the idle timer as a state machine fed the clock (no timers inside); `main.ts` ticks it every 10 s, resets it on every keydown, pauses it in Kids Mode and while hidden, and the first key after it starts only closes the ambient view and is swallowed (the previous overlay, if any, comes back). The setting is `layout.screensaverMinutes` (0 Off, 5, 10, 15, 30; absent means 10), validated by `validateLayout` on every Server publish and edited in Companion → Settings → Photo screensaver. Deviations: it lives in the layout, not a separate settings endpoint, so changing it publishes a revision; the album is the first photo widget on the layout whose card has loaded (changed after the user's answer, 2026-11-15: the screensaver always shows the Immich photostream until the user says otherwise; the Server allows the stream whenever the screensaver is not Off); a slideshow the user opened suppresses it; the count restarts when Sofa Home returns to the front. Not checked on the TV: that the ambient view's clock and the swallowed wake key behave with the real remote (OK acts on keyup, which keys.ts ignores without a keydown).

**Done when:** the TV starts the slideshow after the chosen time on the Dashboard, never in Kids Mode or over another app, and a key brings back the same screen without acting.

### 41 · Front door camera: snapshot widget

**Difficulty 2 · Sonnet · medium · HA**

The camera is a Bosch Eyes Outdoor (F770), not a doorbell, wired to mains. Home Assistant has `image.bosch_frontdoor_last_snapshot`, `sensor.bosch_frontdoor_bosch_frontdoor_last_event_type` (movement, person), `sensor.bosch_frontdoor_last_event` and `button.bosch_frontdoor_refresh_snapshot`.

- A new Server adapter for the small widget on the existing `photo` template: the last snapshot, with a caption like "Person · 2 h ago" from the last event.
- When the TV reads the widget and the snapshot is older than 2 minutes, the Server presses `refresh_snapshot` (so it only refreshes while someone is looking, and no timer of its own).
- Server only: no new template, no new TV package.

**Tests.** The caption and the refresh decision against recorded states (fresh, stale, camera offline, unknown event type).

**Done when:** the widget is on the Dashboard, shows a picture at most a few minutes old while the TV is on, and the caption matches the last event.

**Built (2026-11-15), NOT yet deployed or seen on the TV:** `server/src/adapters/camera.ts` is the `camera` widget type (photo template, small to large, `live` freshness, only a Title field). The Server proxies the picture from Home Assistant's image proxy at `/api/camera/<secret>.jpg?v=<snapshot time>`; the secret is random per Server start and is the capability, because an `<img>` cannot send credentials, so the TV holds no Home Assistant token. `caption` ("Person · 2 h ago"; unknown type is "Activity"; no event is no caption) and `shouldRefresh` (older than 2 min, not again within 60 s) are pure and tested against states recorded from the live entities (`adapters/fixtures/frontdoor-states.json`), plus offline, TV-not-looking, failed press and concurrent reads. Camera offline throws Unavailable("The camera is offline"), so the card keeps its last picture and shows the reason. Deviations: (1) the write guard got a fourth allowed write, `button.press` on exactly `button.bosch_frontdoor_refresh_snapshot` (guard tests added); (2) the widget framework reads on a timer, not on a TV request, so the press is gated on the TV reporting Sofa Home in front (`sofaHomeVisible`), which keeps the camera quiet with the TV off; (3) after pressing, the read waits up to 5 s for the new snapshot; (4) the entities are fixed constants, not config; (5) Kids Mode sees nothing; (6) OK on the card does nothing yet (Session 42). **Household adds it:** Companion → Dashboard layout → Add widget → "Front door", then publish. Check after deploy: set `SOFA_HA_DRY_RUN` is NOT on, the picture shows, the button press appears in Home Assistant's logbook only while the TV is on, and the caption matches the last event.

### 42 · Front door camera: full-screen live view

**Difficulty 3 · Sonnet · high · TV · HA**

The camera supports `STREAM`; the Bosch integration only opens a stream while `switch.bosch_frontdoor_live_stream` is on.

1. First, a quick check: turn the stream on and play Home Assistant's HLS URL in a plain `<video>` on the TV. If it does not play, fall back to the Server proxying the stream (and rate the session again).
2. OK on the camera widget opens a full-screen live view; Back closes it; it closes itself after 2 minutes.
3. The Server turns `live_stream` on when the view opens and off when it closes or times out, and hands the TV Home Assistant's short-lived HLS URL (its token lasts about 5 minutes). The TV never holds a Home Assistant token.

**Tests.** The Server's open and close handling (switch on, URL returned, switch off on close and on timeout, a second open while one is running); the TV view's timeout.

**Done when:** OK on the widget shows the live picture within a few seconds, Back and the 2 minute timeout both close it, and `live_stream` is off afterwards.

**Built (2026-11-15), NOT yet deployed or seen on the TV; step 1 (HLS on the TV) still open:** primary design, the TV plays Home Assistant's HLS URL directly in a `<video>`. Server: `POST /api/camera/live/open` and `/close` (TV token only, 403 in Kids Mode, 503 without Home Assistant). `createLiveView` in `adapters/camera.ts` switches `switch.bosch_frontdoor_live_stream` on once (a second open while one runs only restarts the 2 minute timeout and returns a fresh URL), asks Home Assistant's WebSocket `camera/stream` (`format: hls`, a read; `haCommand` in `ha.ts`) for the playlist, and returns it as an absolute URL (`ha.url` + the path with the short-lived token); close or the Server timeout switches it off (a failed switch-off is retried at the next timeout; no URL turns the switch back off). TV: `tv/src/live.ts` (pure controller, tested with fake timers) and the `live` overlay in `main.ts`: OK on the camera card opens it, Back closes it, 2 minutes closes it, the TV tells the Server on every close, and it closes when another app takes the screen. Deviations: (1) the write guard got a fifth allowed write, `switch.turn_on` / `switch.turn_off` on exactly `switch.bosch_frontdoor_live_stream` (guard tests added; the old "refused: live stream switch" case became "toggle"); (2) the URL points at `SOFA_HA_URL`, so the TV must reach Home Assistant at that address and HLS must play in Tizen's `<video>` (CORS is not needed for a plain `<video>`); (3) the Server switches `live_stream` off at startup (`LiveView.reset`, added 2026-11-15 on the user's OK), so a restart while the stream is on does not leave it on. **If step 1 fails**, swap to the Server proxy: only `LiveView.open()` changes (return a Server path that relays the playlist and segments) and the TV is untouched. Check on the TV: OK on the card shows a picture within a few seconds, Back and the 2 minute timeout both close it, `live_stream` is off afterwards in Home Assistant, and the Server log has no token in it.

### 43 · Start the consoles from Sofa Home

**Difficulty 3 · Opus · high · TV · HA**

The PC, PS5 and Switch hang off the Denon AVR-X1700H (`media_player.denon_avr_x1700h`, sources include PC, PS5, AUX1, AUX2). `script.wake_pc` and the automation "Wake PC when Denon selects PC" exist; the ESP32 HDMI-CEC device exposes only a last-message sensor, so CEC is sent through ESPHome services.

1. A new app entry kind, `input`: a tile in the curated app list (Dashboard row and Apps screen, arranged in Companion) carrying a Home Assistant script id and the TV input the Denon is on.
2. One Home Assistant script per console (for example `script.sofa_start_ps5`): set the Denon source and wake the console. Each script is shown to the user and approved before it is written to the live Home Assistant. Map which Denon input the Switch is on here.
3. OK on the tile: Sofa Home calls the script, switches the TV to the Denon's input and leaves Sofa Home.
4. Not allowed in Kids Mode (the timer cannot stop a console). Sofa Home never turns a console off.

Split into Home Assistant scripts and Sofa Home if the Denon mapping turns messy; decide inside the session.

**Tests.** The layout schema accepts and validates `input` entries and keeps them out of Kids Mode; the TV's launch path calls the script then switches input (with fakes).

**Done when:** each of the three tiles brings its console up on the TV with the right sound from the sofa, and Kids Mode does not show them.

**Built (2026-11-15), NOT yet seen on the TV; HA scripts written to Home Assistant on 2026-11-15 after the user approved them (Switch on AUX1, PS5 HDMI Device Link is on, all three on HDMI4):** Layout: an app entry may be `kind: 'input'` with `script` (must match `INPUT_SCRIPT`, `/^script\.sofa_start_[a-z0-9_]+$/`) and `source` (`HDMI1` to `HDMI9`); its id is the script id. It sits in rows and All Apps like any app; `validateLayout` refuses it in `kidsMode.apps`, and `kidsSections` drops it anyway. Server: `POST /api/inputs/start { app }` (TV token only, 403 in Kids Mode, 404 unless the id is an input of the published layout, 503 without Home Assistant, 502 when the call fails) runs that tile's script through `script.turn_on`; the write guard's new rule 6 allows `script.turn_on` with only an `entity_id` matching `INPUT_SCRIPT`. TV: OK on an input tile runs `startInput` in `tv/src/launch.ts`: Server first, then the input switch, then `tizen.application.getCurrentApplication().hide()`; a failing step stops the rest and shows a toast. Input switching uses `tizen.systeminfo.getPropertyValue('VIDEOSOURCE')` to find the connected `HDMI n`, then `tizen.tvwindow.setSource(src, …, 'MAIN')` (Samsung TVWindow API, Tizen 2.3 and later, present in this TV's firmware as `libtizen_tvwindow.so`); `http://tizen.org/privilege/tv.window` is added to `tv/app/config.xml`, so this needs a signed reinstall, not just a file push. Companion: Apps tab → "Add a console" (name, script id, TV input, default HDMI4); consoles are left out of the Kids Mode approval list. The three scripts are drafted in `docs/ha-scripts/session-43.yaml`. Deviations and open points: the Denon is on the TV's HDMI 4 (its CEC physical address is 4.0.0.0), so all three tiles use HDMI4. Not known until the TV: whether `setSource` on the MAIN window really changes the TV's input once Sofa Home hides, or only the picture inside Sofa Home (fallback: Home Assistant's `media_player.select_source` on the TV, which would need its own guard rule). The Switch's Denon input (AUX1 is a guess) and its wake path (none found) are for the user; the PS5 CEC power-on is untested.

### 44 · Animated unicorn: frames

**Difficulty 2 · Sonnet · medium · TV (short)**

The Kids Mode art is stills today, and nothing in `tv/` is animated (only transitions). Generate the frames with Codex image generation from the briefs in `assets/brand/v2`, in the style of the current unicorn:

- a wave goodbye, 8 to 12 frames, played once (about 2 s);
- a sleeping loop, 4 to 6 frames, slow breathing with an occasional "z".

Before the art is final, a quick test on the panel that a sprite sheet stepped by CSS (`steps()`) runs smoothly at the planned size. The user picks the frames.

**Picked (2026-11-15):** wave A (10 frames, two gentle waves), sleep A (6 frames, 4.8 s), lie-down A (8 frames, yawn). Style is fine. **Redo before final:** wave and lie-down show an extra arm; the unicorn must wave with one of its front legs. The `steps()` smoothness test on the panel is still open.

**Dreamina attempt (2026-11-16), waiting on a VIP plan:** `dreamina-canvas` (~/.local/bin, signed in) can do first+last frame video from `assets/brand/v1/kids/unicorn-welcome-v2.png` to `assets/brand/v2/candidates/unicorn-sleeping-b.png`, but every two-frame model (Seedance 2.0/2.5, Veo 3.1, Wan 3.0, HappyHorse) is VIP-only on this account; the free Seedance 1.0 Fast takes a start frame only. Canvas `a013adb2-6097-446d-83d3-af226b4ffb63` already holds both frames on flat green #00B140 (resources `df238cfa-…` first, `02c5a970-…` last) for keying out afterwards. Next: upgrade, create a `first_last_frame` video node (seedance_2.0, 1:1, 720p, 6 s), quote, run, then key out the green and cut sprite frames.

**Done when:** the user has picked both clips, and the sprite sheets are in `assets/brand/v2` and `tv/app`.

### 45 · Animated unicorn: the Done Screen

**Difficulty 2 · Sonnet · medium · TV**

The Done Screen (`tv/app/index.html:194`, shown when Kids Mode's time is up) plays the wave once, then the sleeping loop, as CSS sprite animations (Chromium 56 safe). Optional: slow CSS breathing on the other stills (welcome, resting, warning).

**Done when:** the Done Screen waves and goes to sleep on the TV, smoothly, and the rest of Kids Mode is unchanged.

**Note (2026-11-15):** today the Server switches the TV off as soon as Sofa Home is in front at zero (one 5 s tick, grace 0), so the wave and lie-down would be cut off. This session must hold the switch-off until the goodbye has played (for example a grace of about 15 s, or the TV reporting `done-shown` after the lie-down). The same applies to ending early from Companion (Session 48).

### 46 · Companion redesign: mockups

**Difficulty 3 · Opus · high**

Companion is framework-free TypeScript with one 97-line stylesheet and about seven pages toggled by `hidden`. Redesign it to feel like a native iOS app that follows Apple's Human Interface Guidelines (system font, grouped lists, system colours, light and dark), with only the Sofa.OS accent colour and wordmark taken from the TV. It does not copy the TV's 10-foot look.

- A bottom tab bar: **Home** (TV status and what's on, status first), **Remote**, **Kids**, **Layout** (today's editor), **Settings**. Sign-in and top-up stay pages reached by link.
- Layout on a phone is a list editor (rows and widgets as reorderable lists) with a Preview button that opens the 1920×1080 preview full screen, sideways; tablets and desktops keep the side-by-side preview.
- Fold in the unbuilt Companion items from the design critiques of Sessions 32 and 33: Home as status first (item 2), the editor on a phone (item 3), Kids page wording (item 4), small fixes (item 5).

Static HTML mockups at iPhone width of all five tabs, light and dark, plus a design critique pass with the UX/UI skills. The user picks before any code.

**Done when:** the user has picked a design for each tab.

**Picked (2026-11-15, mockups at https://claude.ai/artifact/HFvCr5NPr94GHyxycyajT4):** Home A (hero card with the ring), Preview only in Layout, Home shows the published-layout state. Remote: round arrow pad, keep Stop. Kids: "Save" in the top bar, switches. Layout: A (iOS drag list), a Widgets segment like Apps, the publish bar only when there are changes. Settings: a QR code for the Server address (carried-over item 7). Top-up from the notification: a sheet over Home. Buttons in sentence case ("Add row").

### 47 · Companion redesign: build

**Difficulty 4 · Opus · high**

Build the picked design, framework-free as today: the tab bar, Home as status first, the phone list editor with the sideways preview, the Kids wording and the small fixes. May split into more sessions once the mockups are picked.

**Done when:** every Companion page matches the picked mockups on an iPhone in light and dark, and all existing flows (sign-in, Remote, Kids top-up, Layout, Settings) still work.

### 48 · End Kids Mode early from Companion

**Difficulty 1 · Sonnet · low · Server · Companion** (the user's request, 2026-11-15)

**Built (2026-11-15), NOT yet seen on the TV:** Companion → Kids Mode → "End Kids Mode time now" (asks to confirm, disabled when Kids Mode is off or already at zero) calls `POST /api/kids/end` (Companion session only; the TV gets 403). `allowance.end()` sets the used time to today's allowance, so the usual zero path runs: the TV is signalled at once (the change signal now also fires when the time reaches zero), shows the Done Screen, the Server brings Sofa Home to the front and switches the TV off, and the next power-on shows the Done Screen again. No "minutes left" warning is sent. A Top-up brings the time back, as at a natural zero. The goodbye animation itself is Session 45, which has to delay the switch-off (see its note).

### 49 · Apps menu filter: only real apps, no duplicates

**Difficulty 2 · Sonnet · medium · TV · Companion** (the user's request, 2026-11-15)

**Why:** Session 39 lists every app whose `show` is not `false`. On the TV that is about 270 entries: `org.tizen.*` services, `*-dummy` stubs (`com.samsung.tv.aria-dummy` shows as a second "Apple TV"), "preview service" and "worker" apps. The same unfiltered list is reported to the Server, so Companion's app picker (`pickableApps`, `companion/src/edit.ts:94`) is just as noisy. The TV's own launcher shows 44 apps. [CleanFrame](https://github.com/nthnclrk/CleanFrame) (`app/device.js`, `apps()`) solves this with an allowlist instead of a denylist.

**What the TV reported, checked over sdb on 2026-11-15** (`node tv/tools/apps.mjs list`): the launcher apps are exactly the ones with a Tizen store id (`^[A-Za-z0-9]{10}\.\w+$`, for example `RN1MCdNq8t.Netflix`, also the sideloaded `sofahome01.SofaHome`) plus six Samsung ids: `org.tizen.browser`, `com.samsung.tv.gallery`, `com.samsung.tv.aria-video` (Apple TV), `com.samsung.tv.iot-dashboard` (SmartThings), `com.samsung.tv.UniversalBrowse` and `org.tizen.apple.apple-music`. Everything else in `getAppsInfo` is system.

**One filter, two places.** Today the TV filters twice, differently: `mergeApps` for its Apps tab (`tv/src/shell.ts:169`) and a bare `show !== false` for the report to the Server (`tv/src/main.ts:384`). Replace both with one pure function in `shared/src/apps.ts`, so the Apps tab and Companion's picker always agree:

1. `isLaunchable(app, selfId)`: true when `show !== false`, the id is not `selfId`, and either the id matches the store pattern or is on a short `SAMSUNG_APPS` list (the six above). False for ids ending `-dummy`, and when the name is empty or matches `service|worker|preview|plugin|daemon|factory|sdk` (as CleanFrame does; checked against names only, not ids, so `org.tizen.browser` is not caught by "launcher"-style words).
2. `dedupe(apps, curatedIds)`: group by name with case, spaces and punctuation ignored. In a group keep the curated app if there is one, otherwise the newest `installDate` (`getAppsInfo` has no use count; add `installDate` to `AppInfo` and to `installedApps` in `tv/src/launch.ts`). The removed copies are not shown anywhere.
3. `mergeApps(curated, installed, selfId)` calls both, so its existing contract stays: curated apps first in their order (always kept, even if the filter would drop them), then the rest A to Z. `reportInstalled` sends `mergeApps([], installed, self)` instead of the raw list. The Server and Companion need no change: `PUT /api/tv/apps` and `parseInstalledApps` already take any `{ id, name }` list.
4. Companion keeps a way to add a hidden app: the app form already takes any Tizen ID by hand (`companion/src/editor.ts:392`); its footnote says so. Reword it: "Not in the list? Enter its exact Tizen ID."

**Tests** (`shared/src/apps.test.ts`): store-id and Samsung-id apps pass; `org.tizen.hdmicec`, `com.samsung.tv.aria-dummy`, `kIciSQlYEM.service` ("plex preview service") and an empty name do not; Sofa Home itself is dropped; two apps named "ARTE" keep the curated one, else the newer; a curated app that would be filtered stays; sort order unchanged. Update the three existing tests where `show: false` was the only filter.

**Done when:** on the TV the Apps tab lists about the 22 apps the launcher shows (no services, no stubs), Companion's "Pick a known app" offers the same list after the TV restarts, a curated app that is not installed or would be filtered is still shown, and `npm test` and `npm run check` pass. **TV:** needs a new signed package and one look at the Apps tab.

**Built (2026-11-15):** `isLaunchable`, `nameKey` and the new `mergeApps` in `shared/src/apps.ts`; the TV reports `mergeApps([], …)` with names cut to 80; Companion's picker also skips same-named apps. The report had never arrived before (probably one of the ~270 raw entries broke the Server's 80-character name rule, which refuses the whole list); after installing, the Server holds 22 apps, no services or stubs. **Not yet seen:** the TV's Apps tab itself.

**Decided (2026-11-15, grilling):**
- **Step one: the app report.** The TV has never reported its apps: `tv_apps` on the Server is empty, so Companion's picker still shows `KNOWN_APPS`. Find out why from the TV's log over sdb and fix it. If that gets complicated, fall back to filling the Server's list once from `node tv/tools/apps.mjs list` over sdb.
- **Companion skips apps it already has by name too.** The layout curates Netflix as `org.tizen.netflix-app` and YouTube as `com.samsung.tv.cobalt-yt`, while the launcher reports `RN1MCdNq8t.Netflix` and `9Ur5IzDKqV.TizenYouTube`. `pickableApps` also leaves out an app whose name matches a Curated app, using the same name key as `dedupe`. The layout's ids stay as they are (Kids Mode approves Netflix by its alias id).
- **No extra hide list.** e-Manual, Privacy Choices, CleanFrame, TizenBrew and Steam Link all have store ids and stay listed.
- **ARTE point closed.** The curated copy wins, otherwise the newest; no case today, and `node tv/tools/apps.mjs list` marks duplicates if one comes back.

## Carried over from the old plan

Open items that were not finished when the old plan was closed. Each stays here until it is done or dropped. The TV checks moved into Session 38, the Companion items into Sessions 46 and 47.

**Not built** from the design critiques of Sessions 32 and 33: Sofa Home's Kids grid focus on load and tile sizing (item 2), Widgets tab badge and hint line (item 3), a code or QR for the Server address in Settings (item 7).

**Deployment state:** Server on rei3 at 419c1cc and Sofa Home reinstalled on the TV on 2026-11-12.
