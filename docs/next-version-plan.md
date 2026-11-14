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

**Built (date 2026-11-15), NOT yet seen on the TV:** `mergeApps` and `parseInstalledApps` in `shared/src/apps.ts`; Sofa Home calls `tizen.application.getAppsInfo` (`tv/src/launch.ts`) at start and whenever it comes back to the front, shows curated apps first and the rest A to Z in the Apps tab (`shell.setInstalled`), and PUTs the list to the Server. Server: `PUT /api/tv/apps` (TV token only, validated, max 500) and `GET /api/tv/apps` (Companion or TV), stored in a new `tv_apps` table (migration 7). Companion's picker uses the reported list (`pickableApps`), falling back to `KNOWN_APPS`. Deviations: the Server needs deploying before the TV's report is accepted (an old Server answers 404, which only logs); the "All Apps" tile still counts curated apps only; a curated app stays even if the TV marks it hidden. Not checked: that `getAppsInfo` objects expose `name`/`show` as plain properties on the TV, and whether any odd system apps need a denylist.

### 40 · Photo screensaver

**Difficulty 2 · Sonnet · medium · TV**

There is no idle detection today. The slideshow pieces exist (`tv/src/slideshow.ts`, `tv/src/photos.ts`, the ambient view in `tv/src/photoview.ts`).

- An idle timer runs only while Sofa Home is in front and Kids Mode is off. Any key resets it.
- After the timeout the ambient photo view starts with the same Immich album as the photo widget.
- The first key press only wakes Sofa Home back to where it was; it does not act.
- The timeout is a household setting in Companion → Settings: Off, 5, 10, 15 or 30 minutes, default 10.

**Tests.** The idle timer as a pure state machine (start, reset on key, paused in Kids Mode and when Sofa Home is in the background, Off never fires); the setting's validation on the Server.

**Built (2026-11-15), NOT yet seen on the TV:** `tv/src/idle.ts` is the idle timer as a state machine fed the clock (no timers inside); `main.ts` ticks it every 10 s, resets it on every keydown, pauses it in Kids Mode and while hidden, and the first key after it starts only closes the ambient view and is swallowed (the previous overlay, if any, comes back). The setting is `layout.screensaverMinutes` (0 Off, 5, 10, 15, 30; absent means 10), validated by `validateLayout` on every Server publish and edited in Companion → Settings → Photo screensaver. Deviations: it lives in the layout, not a separate settings endpoint, so changing it publishes a revision; the album is the first photo widget on the layout whose card has loaded (no photo widget or none loaded yet means no screensaver, not the photostream); a slideshow the user opened suppresses it; the count restarts when Sofa Home returns to the front. Not checked on the TV: that the ambient view's clock and the swallowed wake key behave with the real remote (OK acts on keyup, which keys.ts ignores without a keydown).

**Done when:** the TV starts the slideshow after the chosen time on the Dashboard, never in Kids Mode or over another app, and a key brings back the same screen without acting.

### 41 · Front door camera: snapshot widget

**Difficulty 2 · Sonnet · medium · HA**

The camera is a Bosch Eyes Outdoor (F770), not a doorbell, wired to mains. Home Assistant has `image.bosch_frontdoor_last_snapshot`, `sensor.bosch_frontdoor_bosch_frontdoor_last_event_type` (movement, person), `sensor.bosch_frontdoor_last_event` and `button.bosch_frontdoor_refresh_snapshot`.

- A new Server adapter for the small widget on the existing `photo` template: the last snapshot, with a caption like "Person · 2 h ago" from the last event.
- When the TV reads the widget and the snapshot is older than 2 minutes, the Server presses `refresh_snapshot` (so it only refreshes while someone is looking, and no timer of its own).
- Server only: no new template, no new TV package.

**Tests.** The caption and the refresh decision against recorded states (fresh, stale, camera offline, unknown event type).

**Done when:** the widget is on the Dashboard, shows a picture at most a few minutes old while the TV is on, and the caption matches the last event.

### 42 · Front door camera: full-screen live view

**Difficulty 3 · Sonnet · high · TV · HA**

The camera supports `STREAM`; the Bosch integration only opens a stream while `switch.bosch_frontdoor_live_stream` is on.

1. First, a quick check: turn the stream on and play Home Assistant's HLS URL in a plain `<video>` on the TV. If it does not play, fall back to the Server proxying the stream (and rate the session again).
2. OK on the camera widget opens a full-screen live view; Back closes it; it closes itself after 2 minutes.
3. The Server turns `live_stream` on when the view opens and off when it closes or times out, and hands the TV Home Assistant's short-lived HLS URL (its token lasts about 5 minutes). The TV never holds a Home Assistant token.

**Tests.** The Server's open and close handling (switch on, URL returned, switch off on close and on timeout, a second open while one is running); the TV view's timeout.

**Done when:** OK on the widget shows the live picture within a few seconds, Back and the 2 minute timeout both close it, and `live_stream` is off afterwards.

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

### 44 · Animated unicorn: frames

**Difficulty 2 · Sonnet · medium · TV (short)**

The Kids Mode art is stills today, and nothing in `tv/` is animated (only transitions). Generate the frames with Codex image generation from the briefs in `assets/brand/v2`, in the style of the current unicorn:

- a wave goodbye, 8 to 12 frames, played once (about 2 s);
- a sleeping loop, 4 to 6 frames, slow breathing with an occasional "z".

Before the art is final, a quick test on the panel that a sprite sheet stepped by CSS (`steps()`) runs smoothly at the planned size. The user picks the frames.

**Done when:** the user has picked both clips, and the sprite sheets are in `assets/brand/v2` and `tv/app`.

### 45 · Animated unicorn: the Done Screen

**Difficulty 2 · Sonnet · medium · TV**

The Done Screen (`tv/app/index.html:194`, shown when Kids Mode's time is up) plays the wave once, then the sleeping loop, as CSS sprite animations (Chromium 56 safe). Optional: slow CSS breathing on the other stills (welcome, resting, warning).

**Done when:** the Done Screen waves and goes to sleep on the TV, smoothly, and the rest of Kids Mode is unchanged.

### 46 · Companion redesign: mockups

**Difficulty 3 · Opus · high**

Companion is framework-free TypeScript with one 97-line stylesheet and about seven pages toggled by `hidden`. Redesign it to feel like a native iOS app that follows Apple's Human Interface Guidelines (system font, grouped lists, system colours, light and dark), with only the Sofa.OS accent colour and wordmark taken from the TV. It does not copy the TV's 10-foot look.

- A bottom tab bar: **Home** (TV status and what's on, status first), **Remote**, **Kids**, **Layout** (today's editor), **Settings**. Sign-in and top-up stay pages reached by link.
- Layout on a phone is a list editor (rows and widgets as reorderable lists) with a Preview button that opens the 1920×1080 preview full screen, sideways; tablets and desktops keep the side-by-side preview.
- Fold in the unbuilt Companion items from the design critiques of Sessions 32 and 33: Home as status first (item 2), the editor on a phone (item 3), Kids page wording (item 4), small fixes (item 5).

Static HTML mockups at iPhone width of all five tabs, light and dark, plus a design critique pass with the UX/UI skills. The user picks before any code.

**Done when:** the user has picked a design for each tab.

### 47 · Companion redesign: build

**Difficulty 4 · Opus · high**

Build the picked design, framework-free as today: the tab bar, Home as status first, the phone list editor with the sideways preview, the Kids wording and the small fixes. May split into more sessions once the mockups are picked.

**Done when:** every Companion page matches the picked mockups on an iPhone in light and dark, and all existing flows (sign-in, Remote, Kids top-up, Layout, Settings) still work.

## Carried over from the old plan

Open items that were not finished when the old plan was closed. Each stays here until it is done or dropped. The TV checks moved into Session 38, the Companion items into Sessions 46 and 47.

**Not built** from the design critiques of Sessions 32 and 33: Sofa Home's Kids grid focus on load and tile sizing (item 2), Widgets tab badge and hint line (item 3), a code or QR for the Server address in Settings (item 7).

**Deployment state:** Server on rei3 at 419c1cc and Sofa Home reinstalled on the TV on 2026-11-12.
