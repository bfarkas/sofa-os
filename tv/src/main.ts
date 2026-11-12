// Sofa Home: TV Sign-in, then the shell (tabs, tiles, Settings) over the synced layout, plus the Session 01 key and lifecycle log.
// This file is the glue: shell.ts holds the screens and focus, view.ts draws them, keys.ts times the remote, launch.ts starts apps.
// esbuild bundles it for Chromium M56 (ES2017).
import { applyOp, dayFootInk, dayInk, dayShadow, isSource, schemeCss, textOn, tokensCss, TV_PROTOCOL_PREFIX, type LayoutOp } from '@sofa/shared';
import { tizenLauncher, type TizenApplicationApi } from './launch.ts';
import { createIcons, type IconReport, type TizenAppInfoApi } from './icons.ts';
import { createRemote, type RemoteEvent } from './keys.ts';
import { currentPeriod, fakeHour } from './daycycle.ts';
import { createKids, createPad, forestFor, leftText, PAD_ROWS, screenFor, tileAvailable, type KidsState, type Screen } from './kids.ts';
import { drawQr } from './qr.ts';
import { createShell, type Activation, type Tab } from './shell.ts';
import { dashed, normalizeServer, SERVER_KEY, startSignIn, TOKEN_KEY, type SignInState } from './signin.ts';
import { KIDS_STORAGE_KEY, snapshotFetcher, startSync, STORAGE_KEY, type SyncState } from './sync.ts';
import { initView, redrawCards, render, renderPad, setFocus, setKidsLeft, updateClock } from './view.ts';
import { cardOptions, drawCard, setWidgetsState, viewFor } from './cards.ts';
import { albumOfCard, authedGet, backgroundImage, fetchImages, startAlbums } from './photos.ts';
import { createPhotoView } from './photoview.ts';
import { startWidgets, widgetsFetcher } from './widgets.ts';

declare global {
  interface Window {
    SOFA_LOG_URL?: string;
    SOFA_SERVER_URL?: string;
    SOFA_FAKE_HOUR?: string | number; // optional, from env.js: pretend it is this hour (0 to 23) for the day-cycle background
  }
  // Tizen web API, only the parts used here. Absent in a desktop browser.
  const tizen: TizenApplicationApi & TizenAppInfoApi & {
    tvinputdevice: {
      registerKey(name: string): void;
      getSupportedKeys(): { name: string; code: number }[];
    };
  };
}

const KEY = 'sofahome.events';
const MAX = 8;
const stage = document.getElementById('stage')!;
const logEl = document.getElementById('log')!; // hidden on screen; the lines still go to tv/tools/recv.py
const $ = (id: string) => document.getElementById(id)!;
let events: string[] = [];
try {
  events = JSON.parse(localStorage.getItem(KEY) ?? '[]') || [];
} catch {
  events = [];
}

const pad = (n: number) => (n < 10 ? '0' : '') + n;

function add(text: string): void {
  const d = new Date();
  events.push(`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${text}`);
  events = events.slice(-MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(events));
  } catch {
    /* storage full or off */
  }
  logEl.textContent = events.join('\n');
  send(events[events.length - 1]);
}

// Fire-and-forget to tv/tools/recv.py on the Mac; SOFA_LOG_URL comes from env.js, written by build.sh (empty = off).
function send(line: string): void {
  if (!window.SOFA_LOG_URL) return;
  try {
    const x = new XMLHttpRequest();
    x.open('POST', window.SOFA_LOG_URL);
    x.send(line);
  } catch {
    /* receiver not running */
  }
}

// Colour and media keys only reach the page after registration; log whether each registers.
const EXTRA = ['ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue', 'MediaPlayPause', 'MediaPlay', 'MediaPause',
  'MediaStop', 'MediaRewind', 'MediaFastForward', 'MediaTrackPrevious', 'MediaTrackNext', 'Info', 'Menu', 'Guide', 'Exit', 'ChannelUp', 'ChannelDown', 'VolumeUp', 'VolumeDown', 'VolumeMute',
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9']; // the number keys are the PIN pad's

const focusStage = () => stage.focus();
// Tizen resumes the web view before input focus settles, so refocus a few times.
const refocusSoon = () => [250, 900, 1800].forEach((ms) => setTimeout(focusStage, ms));

// Keys: arrows and Back act on keydown, OK on keyup so that a long press can be told from a short one (keys.ts).
// While the Server address is being typed the keyboard needs its keys; only Enter and Back are ours.
const remote = createRemote((e) => onRemote(e));
document.addEventListener('keydown', (e) => {
  if (!held[e.keyCode]) {
    held[e.keyCode] = Date.now();
    add(`down ${e.keyCode} key=${e.key}`);
  }
  if (document.activeElement === serverInput) {
    // 65385 is the on-screen keyboard's own Back (tested on the TV): it closes the keyboard but leaves the field focused.
    if (e.keyCode === 13 || e.keyCode === 10009 || e.keyCode === 27 || e.keyCode === 65385) {
      e.preventDefault();
      endTyping();
    }
    return;
  }
  if (remote.down(e.keyCode)) e.preventDefault();
});
document.addEventListener('keyup', (e) => {
  add(`up   ${e.keyCode} held=${held[e.keyCode] ? Date.now() - held[e.keyCode] : 0}ms`);
  delete held[e.keyCode];
  remote.up(e.keyCode);
});
let held: Record<number, number> = {}; // for the log only

const forget = () => {
  remote.reset();
  held = {};
};
window.addEventListener('blur', forget);
window.addEventListener('focus', () => { focusStage(); refocusSoon(); });
document.addEventListener('visibilitychange', () => {
  forget();
  add(document.hidden ? 'HIDDEN' : 'VISIBLE');
  photoView.pause(document.hidden); // no slideshow timers while another app has the screen
  reportVisible();
  if (!document.hidden) {
    focusStage();
    refocusSoon();
    updateClock(new Date());
    paintBackground(); // the hour may have moved on while the TV was away
    shell.focus.refresh(); // the focus model survived; draw it again
    resumeFromLaunch();
    if (token && server) {
      kidsCtl.refresh();
      if (sync) sync.refresh();
      if (widgetsSync) widgetsSync.refresh();
      if (albumsSync) albumsSync.refresh();
    }
  }
});

add('START hidden=' + document.hidden);
const ok: string[] = [], bad: string[] = [];
for (const k of EXTRA) {
  try { tizen.tvinputdevice.registerKey(k); ok.push(k); } catch { bad.push(k); }
}
add(`registered ${ok.length} failed: ${bad.join(',') || 'none'}`);
try {
  add('supported: ' + tizen.tvinputdevice.getSupportedKeys().map((k) => `${k.name}=${k.code}`).join(' '));
} catch {
  add('getSupportedKeys failed');
}
focusStage();
refocusSoon();

// ---- TV Sign-in and layout sync ----
// The Server address and device token live in localStorage; env.js (SOFA_SERVER_URL) is only the default address.
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage full or off */
    }
  },
  remove: (k: string) => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* storage off */
    }
  },
};
const RESUME_KEY = 'sofahome.resume';
const RESUME_MAX_MS = 6 * 3600_000;
let server = normalizeServer(store.get(SERVER_KEY) || window.SOFA_SERVER_URL || '') || '';
let token = store.get(TOKEN_KEY) || '';
let sync: { stop(): void; refresh(): void } | null = null;
let widgetsSync: { stop(): void; refresh(): void } | null = null; // widget data, while the household screen shows
let albumsSync: { stop(): void; refresh(): void } | null = null; // the albums Kids Mode may open, while Kids Mode shows
let fullWidget = { id: '', title: '' }; // the widget in the full-screen view
let signIn: { stop(): void } | null = null;
let lastRevision = 0;
let lastNote = '';
let lastSync: SyncState | null = null;
let appNames: Record<string, string> = {};
let resumed = false;
const FAKE_HOUR_KEY = 'sofahome.fakehour'; // optional localStorage twin of SOFA_FAKE_HOUR
const SCREEN_KEY = 'sofahome.screen'; // the last screen, so a restart in Kids Mode does not flash the household Dashboard
let screen: Screen = store.get(SCREEN_KEY) === 'kids' ? 'kids' : store.get(SCREEN_KEY) === 'done' ? 'done' : 'household';
let syncKids = screen !== 'household'; // which view of the layout the sync fetches
let bgColor = ''; // the household layout's background
let bgPhoto: { path: string } | { album: string } | null = null; // or a photo / album slideshow from Immich
let bgDay = false; // or the day cycle: four pictures from the package, by the clock
let overlay: 'settings' | 'pin' | 'full' | 'photos' | 'menu' | null = null;
let menuWidget = ''; // the widget the context menu is for
let liftBase = 0; // the revision a lifted widget was lifted on
let kidsTileOk = false; // the Kids Mode request has been answered

const settingsEl = $('settings'), pinEl = $('pin'), codeEl = $('code'), signinNote = $('signin-note'), toastEl = $('toast');
const serverInput = $('server-input') as HTMLInputElement;
const settingsNote = $('settings-note');

const style = document.createElement('style');
style.textContent = tokensCss();
document.head.appendChild(style);
const schemeStyle = document.createElement('style'); // the colour scheme of the glass (Session 37), repainted with every snapshot
document.head.appendChild(schemeStyle);
// App icons (Session 30): each app's outcome goes to the Server's log once (over the socket when it is up), and to the local log.
let liveSocket: WebSocket | null = null; // the sync socket (runSync); Phone Remote's visible report and the icon reports go over it
let iconReports: string[] = []; // waiting for the socket
function flushIconReports(): void {
  if (!liveSocket || liveSocket.readyState !== 1) return;
  for (const m of iconReports) liveSocket.send(m);
  iconReports = [];
}
function reportIcon(r: IconReport): void {
  add('icon ' + r.app + ' ' + r.outcome + ' ' + r.detail);
  iconReports.push(JSON.stringify({ type: 'icon', ...r }));
  flushIconReports();
}
initView(createIcons(typeof tizen === 'undefined' ? undefined : tizen, reportIcon));
const shell = createShell({ onView: render, onFocus: setFocus });
shell.setScreen(screen);
const launcher = tizenLauncher(typeof tizen === 'undefined' ? undefined : tizen);
// Photos (Session 14): the slideshow and ambient view, and a photo background. Pictures come from the Server's media cache.
const photoView = createPhotoView({
  server: () => server,
  images: (album, profile) => fetchImages(authedGet(window.fetch.bind(window), server, token), album, profile),
  log: add,
});

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(text: string): void {
  toastEl.textContent = text;
  toastEl.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 7000);
}

function updateFoot(): void {
  const s = lastSync;
  const parts = [server ? 'Server ' + server : 'No Server address'];
  if (token && s) parts.push(s.snapshot ? 'Revision ' + s.snapshot.revision : 'No layout yet', s.live ? 'Live' : 'Offline');
  if (token && s && s.error) parts.push(s.error);
  $('foot').textContent = parts.join('   ·   ');
}

function renderHome(s: SyncState): void {
  lastSync = s;
  updateKidsTile();
  const snap = s.snapshot;
  const note = (snap ? 'revision ' + snap.revision : 'no layout yet') + (s.live ? ', live' : ', offline') + (s.error ? '. ' + s.error : '');
  if (note !== lastNote) add('sync ' + (lastNote = note));
  if (snap && snap.revision !== lastRevision) {
    lastRevision = snap.revision;
    const l = snap.layout;
    appNames = {};
    for (const a of l.apps) appNames[a.id] = a.name;
    // A colour or an Immich photo; text colour follows it so labels outside tiles stay legible.
    schemeStyle.textContent = schemeCss(l.scheme);
    const bg = l.background;
    bgColor = bg.kind === 'color' ? bg.color : '';
    const path = bg.kind === 'image' ? backgroundImage(bg.image) : null;
    bgPhoto = path ? { path } : bg.kind === 'slideshow' && isSource(bg.album) ? { album: bg.album } : null;
    bgDay = bg.kind === 'daycycle';
    paintBackground();
    shell.setLayout(l);
    if (widgetsSync) widgetsSync.refresh(); // new or changed widgets
    if (albumsSync) albumsSync.refresh(); // Kids Mode albums approved or removed
  }
  updateFoot();
  if (snap && !resumed) {
    resumed = true;
    resumeFromLaunch(); // a cold start after launching an app: the record is waiting
  }
}

function renderSignIn(s: SignInState, signedOutNote: string): void {
  codeEl.textContent = s.code ? dashed(s.code) : 'Asking the Server for a code...';
  if (s.url) drawQr($('qr') as HTMLCanvasElement, s.url);
  $('qr').style.visibility = s.url ? 'visible' : 'hidden';
  signinNote.textContent = ((s.error ? s.error + '. ' : '') + signedOutNote).trim();
}

// Starts whatever the stored state calls for: sign-in without a token, the synced layout with one.
function start(signedOutNote = ''): void {
  if (sync) sync.stop();
  if (signIn) signIn.stop();
  if (widgetsSync) widgetsSync.stop();
  if (albumsSync) albumsSync.stop();
  sync = signIn = widgetsSync = albumsSync = null;
  if (overlay === 'photos') {
    overlay = null;
    syncOverlays();
  }
  lastSync = null;
  updateFoot();
  shell.setMode(token && server ? 'home' : 'signin');
  paintBackground();
  if (!server) return openSettings('Enter the Server address first.');
  if (token) {
    runSync();
    kidsCtl.refresh();
  } else {
    renderSignIn({ code: '', url: '', error: '' }, signedOutNote);
    signIn = startSignIn({
      server,
      fetch: (url, init) => window.fetch(url, init),
      onChange: (s) => renderSignIn(s, signedOutNote),
      onToken: (t) => {
        token = t;
        store.set(TOKEN_KEY, t);
        add('signed in');
        start();
      },
    });
  }
}

// The household layout (or the kids view of it while Kids Mode shows) with a live socket. Restarted when the screen changes sides.
function runSync(): void {
  if (sync) sync.stop();
  const t = token, kids = syncKids;
  lastRevision = 0; // the other view has the same revision numbers: draw it anyway
  sync = startSync({
    fetchSnapshot: snapshotFetcher(window.fetch.bind(window), server, t, kids),
    openSocket: (h) => {
      // Browsers cannot set WebSocket headers, so the token travels as a subprotocol, never in the URL.
      const ws = new WebSocket(server.replace(/^http/, 'ws') + '/ws', [TV_PROTOCOL_PREFIX + t]);
      liveSocket = ws;
      ws.onopen = () => {
        h.open();
        reportVisible();
        flushIconReports();
        if (!document.hidden) kidsCtl.refresh(); // a dropped socket may have missed a Kids Mode signal
      };
      ws.onmessage = (e) => h.message(String(e.data));
      ws.onclose = h.close;
      return ws;
    },
    storage: localStorage,
    storageKey: kids ? KIDS_STORAGE_KEY : STORAGE_KEY,
    onKids: () => kidsCtl.refresh(),
    onWidgets: () => widgetsSync && widgetsSync.refresh(),
    onMenu: phoneMenu,
    onChange: renderHome,
    onUnauthorized: tokenRefused,
  });
  // Widget cards: only the household screen shows them. A failing widget fetch only marks the cards stale.
  if (widgetsSync) widgetsSync.stop();
  cardOptions.server = server;
  widgetsSync = kids ? null : startWidgets({
    fetchWidgets: widgetsFetcher(window.fetch.bind(window), server, t),
    storage: localStorage,
    onChange: (s) => {
      setWidgetsState(s);
      redrawCards();
      if (overlay === 'full') drawCard($('full-card'), fullWidget.id, fullWidget.title, 'full');
    },
  });
  // Kids Mode shows the approved albums as tiles; the Server lists only those (and checks again on every picture).
  if (albumsSync) albumsSync.stop();
  albumsSync = kids ? startAlbums({ fetchAlbums: () => authedGet(window.fetch.bind(window), server, t)('/api/photos/albums?profile=kids'), onChange: (list) => shell.setAlbums(list) }) : null;
  if (!kids) shell.setAlbums([]);
}

function tokenRefused(): void {
  // The Server replaced or forgot this token. The stored layout stays; it shows again after signing in.
  add('token refused, signing in again');
  token = '';
  store.remove(TOKEN_KEY);
  start('This TV was signed out. ' + (lastRevision ? 'The last layout (revision ' + lastRevision + ') is kept.' : ''));
}

// ---- Kids Mode: the Server says which screen shows; the forest paints the background ----
const kidsCtl = createKids({
  send: (method, path, body) => {
    const headers: Record<string, string> = { Authorization: 'Bearer ' + token };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    return window.fetch(server + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
      .then((r) => r.json().then((b) => b, () => null).then((b) => ({ status: r.status, body: b })))
      .catch((e) => {
        add('kids ' + method + ' ' + path + ' failed: ' + e);
        throw e;
      });
  },
  onChange: (k: KidsState) => {
    kidsLeft = k.status ? { seconds: k.status.remainingSeconds, at: Date.now() } : null;
    paintKidsLeft();
    kidsTileOk = tileAvailable(k);
    updateKidsTile();
    showScreen(screenFor(k.status));
  },
  onUnauthorized: tokenRefused,
});

// The pill counts down on this page's clock from the last answer; resume and Top-up signals fetch a fresh one.
let kidsLeft: { seconds: number; at: number } | null = null;
function paintKidsLeft(): void {
  setKidsLeft(kidsLeft ? leftText(kidsLeft.seconds - (Date.now() - kidsLeft.at) / 1000) : '');
}

// Unavailable while the Server has not answered, and while the layout sync is failing: the Server is gone.
function updateKidsTile(): void {
  shell.setKidsTile(kidsTileOk && !(lastSync && lastSync.error));
}

function showScreen(next: Screen): void {
  if (next === screen) return;
  add('screen ' + screen + ' -> ' + next);
  screen = next;
  store.set(SCREEN_KEY, next);
  while (shell.focus.depth() > 1) shell.focus.pop(); // the Settings or PIN overlay belongs to the screen that is gone
  overlay = null;
  syncOverlays();
  padCtl.reset();
  shell.setScreen(next);
  paintBackground();
  if ((next !== 'household') !== syncKids) {
    syncKids = next !== 'household';
    if (token && server) runSync();
  }
}

let painted = '';
function paintBackground(): void {
  const look = token ? screen : 'household';
  const day = bgDay ? currentPeriod(new Date(), fakeHour(window.SOFA_FAKE_HOUR, store.get(FAKE_HOUR_KEY))) : null;
  const photo = look === 'household' && token ? (day ? { day } : bgPhoto) : null; // Kids Mode keeps the forest, whatever the household chose
  photoView.setBackground(photo);
  const bg = look === 'household' ? (token ? (photo ? '#1f241e' : bgColor) : '') : '#26331f url(img/kids-forest-' + forestFor(new Date()) + '.jpg) center / cover no-repeat';
  const key = bg + (photo ? '|' + JSON.stringify(photo) : '');
  if (key === painted) return;
  painted = key;
  document.body.className = look === 'household' ? '' : 'kids';
  document.body.style.background = bg;
  if (photo) stage.style.setProperty('--on-bg', 'day' in photo ? dayInk(photo.day) : '#fffdf8'); // a photo's scrim is dark; a day picture has its own measured ink
  else if (look === 'household' && bgColor && token) stage.style.setProperty('--on-bg', textOn(bgColor)); // kids: the stylesheet's ivory
  else stage.style.removeProperty('--on-bg');
  if (photo && 'day' in photo) {
    stage.style.setProperty('--on-foot', dayFootInk(photo.day));
    stage.style.setProperty('--on-shadow', dayShadow(photo.day));
  } else {
    stage.style.removeProperty('--on-foot');
    stage.style.removeProperty('--on-shadow');
  }
}

// ---- The PIN pad: an overlay over Kids Mode or the Done Screen. Arrows and OK, or the number keys. ----
const padCtl = createPad((pin) => {
  kidsCtl.exit(pin).then((r) => {
    if (r.ok) return closePin(); // the Server's answer already moved the screen
    padCtl.reset();
    renderPad(0, r.message);
  });
});

function openPin(): void {
  padCtl.reset();
  renderPad(0, '');
  overlay = 'pin';
  shell.focus.push(PAD_ROWS);
  syncOverlays();
}

function closePin(): void {
  if (overlay !== 'pin') return;
  shell.focus.pop();
  overlay = null;
  syncOverlays();
  padCtl.reset();
  focusStage();
}

function padKey(id: string): void {
  if (id === 'pin:close') return closePin();
  if (id === 'pin:del') padCtl.del();
  else padCtl.push(id.slice(4));
  renderPad(padCtl.count(), '');
}

function syncOverlays(): void {
  settingsEl.hidden = overlay !== 'settings';
  pinEl.hidden = overlay !== 'pin';
  $('full').hidden = overlay !== 'full';
  $('menu').hidden = overlay !== 'menu';
  if (overlay !== 'photos') photoView.close(); // the view hides itself; the background gets its pictures' place back
}

// ---- Launching apps, and coming back ----
// Before launching, remember where focus was. The page normally survives (visibilitychange brings it back), but if the TV
// restarted it, the record restores the tab and tile on the first layout. Sofa Home cannot draw over a provider app, and
// Back there may land in Samsung Home, so the way back is Home, then Sofa Home in Apps (spelled out in Settings).
function launchApp(appId: string): void {
  const where = shell.where();
  if (where) store.set(RESUME_KEY, JSON.stringify({ tab: where.tab, id: where.id, appId, at: Date.now() }));
  add('launch ' + appId);
  launcher.launch(appId).then(
    () => shell.setUnavailable(appId, false),
    (err: Error) => {
      store.remove(RESUME_KEY);
      shell.setUnavailable(appId, true);
      add('launch failed ' + appId + ': ' + err.message);
      toast((appNames[appId] || appId) + ' is unavailable: ' + err.message);
    },
  );
}

function resumeFromLaunch(): void {
  const raw = store.get(RESUME_KEY);
  if (!raw) return;
  store.remove(RESUME_KEY);
  try {
    const r = JSON.parse(raw) as { tab: Tab; id: string; appId: string; at: number };
    if (Date.now() - r.at > RESUME_MAX_MS) return;
    shell.restore({ tab: r.tab, id: r.id });
    toast('Welcome back. You were in ' + (appNames[r.appId] || 'another app') + '.');
  } catch {
    /* an unreadable record is dropped */
  }
}

// ---- Settings: an overlay. Server address and signing in again. OK opens it, Back closes it. ----
function openSettings(note = ''): void {
  settingsNote.textContent = note;
  serverInput.value = server;
  if (overlay !== 'settings') shell.focus.push([['set:server'], ['set:again'], ['set:close']], { wrap: true });
  overlay = 'settings';
  syncOverlays();
}

function closeSettings(): void {
  if (!server || overlay !== 'settings') return; // nothing to go back to without an address
  serverInput.blur();
  shell.focus.pop();
  overlay = null;
  syncOverlays();
  focusStage();
}

// Runs when typing ends (Enter, Back or the keyboard closing). A new address starts over: the token belongs to the old Server.
function commitServer(): void {
  const next = normalizeServer(serverInput.value);
  if (!next) {
    settingsNote.textContent = 'Use an address like https://sofa.example.de';
    serverInput.value = server;
    return;
  }
  settingsNote.textContent = '';
  serverInput.value = next;
  if (next === server) return;
  server = next;
  token = '';
  store.set(SERVER_KEY, next);
  store.remove(TOKEN_KEY);
  store.remove(STORAGE_KEY);
  lastRevision = 0;
  shell.setLayout(null);
  add('server address changed');
  start();
}
serverInput.addEventListener('blur', commitServer);

function endTyping(): void {
  serverInput.blur();
  commitServer(); // blur commits too, but only when the page has focus; a second run changes nothing
  focusStage();
}

// ---- Arranging widgets (Session 16, ADR 0004): the context menu, and operations the Server commits as revisions ----
function openMenu(m: Extract<Activation, { type: 'menu' }>): void {
  menuWidget = m.widget;
  $('menu-title').textContent = viewFor(m.widget, m.title).title || m.title;
  for (const item of ['move', 'remove', 'add']) $('menu:' + item).hidden = m.items.indexOf(item as 'move') < 0;
  overlay = 'menu';
  shell.focus.push(m.items.map((i) => ['menu:' + i]), { wrap: true });
  syncOverlays();
}

function menuChoice(item: string): void {
  shell.focus.pop();
  overlay = null;
  syncOverlays();
  const snap = lastSync && lastSync.snapshot;
  if (!snap) return;
  if (item === 'move') {
    liftBase = snap.revision;
    shell.lift(menuWidget);
  } else sendOp({ op: item === 'add' ? 'add' : 'remove', widget: menuWidget }, snap.revision);
}

// Shown at once; the Server's revision follows over the socket. Without the Server nothing changes (the spec's rule).
function sendOp(op: LayoutOp, base: number): void {
  const snap = lastSync && lastSync.snapshot;
  if (!snap || !token) return;
  const next = applyOp(snap.layout, op);
  if (next) shell.setLayout(next);
  add('op ' + op.op + ' ' + op.widget + ' on ' + base);
  const fail = (text: string) => {
    toast(text);
    const s = lastSync && lastSync.snapshot;
    if (s) shell.setLayout(s.layout);
  };
  window.fetch(server + '/api/layout/ops', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ base, op }) })
    .then((r) => {
      add('op answered ' + r.status);
      if (r.status === 401) return tokenRefused();
      if (r.status === 409) fail('The layout changed meanwhile. Nothing was changed; please try again.');
      else if (!r.ok) fail('That did not work (' + r.status + '). Nothing was changed.');
    }, () => fail('The Server is not reachable. Nothing was changed.'))
    .then(() => sync && sync.refresh());
}

function openPhotos(album: string, profile: 'household' | 'kids', how: 'ambient' | 'slideshow', name = ''): void {
  overlay = 'photos';
  photoView.open(album, profile, how, name);
}

// Phone Remote. The Server only sends Menu to a Sofa Home that says it is in front (a provider app on top means hidden).
function reportVisible(): void {
  if (liveSocket && liveSocket.readyState === 1) liveSocket.send(JSON.stringify({ type: 'visible', visible: !document.hidden }));
}
// Menu opens the focused widget's context menu like a long press, and never selects when there is none.
function phoneMenu(): void {
  if (document.hidden || overlay !== null) return;
  const act = shell.menuKey();
  if (act && act.type === 'menu') openMenu(act);
}

function onRemote(e: RemoteEvent): void {
  if (overlay === 'photos') {
    // The slideshow owns the remote: arrows step, OK pauses, Back returns to the tile that opened it.
    if (photoView.key(e)) {
      overlay = null;
      syncOverlays();
    }
    return;
  }
  if (e.key === 'back' && overlay === 'settings' && !server) return;
  const act = shell.key(e);
  if (shell.focus.depth() <= 1) overlay = null; // Back closed it
  syncOverlays();
  if (!act) return;
  if (act.type === 'launch') launchApp(act.appId);
  else if (act.type === 'album') openPhotos(act.id, 'kids', 'slideshow', act.name);
  else if (act.type === 'widget' && albumOfCard(viewFor(act.id, act.title))) openPhotos(albumOfCard(viewFor(act.id, act.title))!, 'household', 'ambient'); // the photo widget opens the ambient view
  else if (act.type === 'widget') {
    // The read-only full-screen view: Back or OK closes it, and focus returns to the widget.
    fullWidget = { id: act.id, title: act.title };
    drawCard($('full-card'), act.id, act.title, 'full');
    overlay = 'full';
    shell.focus.push([['full:close']]);
    syncOverlays();
  }
  else if (act.type === 'menu') openMenu(act);
  else if (act.type === 'op') sendOp(act.op, liftBase);
  else if (act.type === 'settings') openSettings();
  else if (act.type === 'pin') openPin();
  else if (act.type === 'digit') {
    if (overlay === 'pin') padKey('pin:' + act.digit);
  } else if (act.type === 'kids-enter') {
    add('kids enter');
    kidsCtl.enter().then((ok) => { add('kids enter ' + (ok ? 'ok' : 'refused')); if (!ok) toast('Kids Mode is not available right now.'); });
  } else if (act.type === 'kids-unavailable') {
    toast('Kids Mode is not available right now.');
    kidsCtl.refresh();
  } else if (overlay === 'pin') padKey(act.id);
  else if (act.id === 'full:close') {
    shell.focus.pop();
    overlay = null;
    syncOverlays();
  }
  else if (act.id.indexOf('menu:') === 0) menuChoice(act.id.slice(5));
  else if (act.id === 'set:server') serverInput.focus(); // the TV's on-screen keyboard opens for a focused text field
  else if (act.id === 'set:again') {
    token = '';
    store.remove(TOKEN_KEY);
    add('signing in again');
    closeSettings();
    start();
  } else closeSettings();
}

setInterval(() => {
  updateClock(new Date());
  paintBackground(); // the forest and the day cycle change with the hour
  paintKidsLeft();
}, 10_000);
start();

export {};
