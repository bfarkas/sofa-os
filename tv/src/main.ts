// Sofa Home: TV Sign-in, then the shell (tabs, tiles, Settings) over the synced layout, plus the Session 01 key and lifecycle log.
// This file is the glue: shell.ts holds the screens and focus, view.ts draws them, keys.ts times the remote, launch.ts starts apps.
// esbuild bundles it for Chromium M56 (ES2017).
import { textOn, tokensCss, TV_PROTOCOL_PREFIX } from '@sofa/shared';
import { tizenLauncher, type TizenApplicationApi } from './launch.ts';
import { createRemote, type RemoteEvent } from './keys.ts';
import { drawQr } from './qr.ts';
import { createShell, type Tab } from './shell.ts';
import { dashed, normalizeServer, SERVER_KEY, startSignIn, TOKEN_KEY, type SignInState } from './signin.ts';
import { snapshotFetcher, startSync, STORAGE_KEY, type SyncState } from './sync.ts';
import { initView, render, setFocus, updateClock } from './view.ts';

declare global {
  interface Window {
    SOFA_LOG_URL?: string;
    SOFA_SERVER_URL?: string;
  }
  // Tizen web API, only the parts used here. Absent in a desktop browser.
  const tizen: TizenApplicationApi & {
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
  'MediaStop', 'MediaRewind', 'MediaFastForward', 'MediaTrackPrevious', 'MediaTrackNext', 'Info', 'Menu', 'Guide', 'Exit', 'ChannelUp', 'ChannelDown', 'VolumeUp', 'VolumeDown', 'VolumeMute'];

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
    if (e.keyCode === 13 || e.keyCode === 10009 || e.keyCode === 27) {
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
  if (!document.hidden) {
    focusStage();
    refocusSoon();
    updateClock(new Date());
    shell.focus.refresh(); // the focus model survived; draw it again
    resumeFromLaunch();
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
let sync: { stop(): void } | null = null;
let signIn: { stop(): void } | null = null;
let lastRevision = 0;
let lastNote = '';
let lastSync: SyncState | null = null;
let appNames: Record<string, string> = {};
let resumed = false;

const settingsEl = $('settings'), codeEl = $('code'), signinNote = $('signin-note'), toastEl = $('toast');
const serverInput = $('server-input') as HTMLInputElement;
const settingsNote = $('settings-note');

const style = document.createElement('style');
style.textContent = tokensCss();
document.head.appendChild(style);
initView();
const shell = createShell({ onView: render, onFocus: setFocus });
const launcher = tizenLauncher(typeof tizen === 'undefined' ? undefined : tizen);

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
  const snap = s.snapshot;
  const note = (snap ? 'revision ' + snap.revision : 'no layout yet') + (s.live ? ', live' : ', offline') + (s.error ? '. ' + s.error : '');
  if (note !== lastNote) add('sync ' + (lastNote = note));
  if (snap && snap.revision !== lastRevision) {
    lastRevision = snap.revision;
    const l = snap.layout;
    appNames = {};
    for (const a of l.apps) appNames[a.id] = a.name;
    // Only a colour background until Session 14; text colour follows it so labels outside tiles stay legible.
    const bg = l.background.kind === 'color' ? l.background.color : '';
    document.body.style.background = bg;
    stage.style.setProperty('--on-bg', textOn(bg));
    shell.setLayout(l);
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
  sync = signIn = null;
  lastSync = null;
  updateFoot();
  shell.setMode(token && server ? 'home' : 'signin');
  if (!token) {
    document.body.style.background = '';
    stage.style.removeProperty('--on-bg');
  }
  if (!server) return openSettings('Enter the Server address first.');
  if (token) {
    const t = token;
    sync = startSync({
      fetchSnapshot: snapshotFetcher(window.fetch.bind(window), server, t),
      openSocket: (h) => {
        // Browsers cannot set WebSocket headers, so the token travels as a subprotocol, never in the URL.
        const ws = new WebSocket(server.replace(/^http/, 'ws') + '/ws', [TV_PROTOCOL_PREFIX + t]);
        ws.onopen = h.open;
        ws.onmessage = (e) => h.message(String(e.data));
        ws.onclose = h.close;
        return ws;
      },
      storage: localStorage,
      onChange: renderHome,
      onUnauthorized: () => {
        // The Server replaced or forgot this token. The stored layout stays; it shows again after signing in.
        add('token refused, signing in again');
        token = '';
        store.remove(TOKEN_KEY);
        start('This TV was signed out. ' + (lastRevision ? 'The last layout (revision ' + lastRevision + ') is kept.' : ''));
      },
    });
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
const settingsOpen = () => shell.focus.depth() > 1;

function openSettings(note = ''): void {
  settingsNote.textContent = note;
  serverInput.value = server;
  if (!settingsOpen()) shell.focus.push([['set:server'], ['set:again'], ['set:close']], { wrap: true });
  settingsEl.hidden = false;
}

function closeSettings(): void {
  if (!server) return; // nothing to go back to without an address
  serverInput.blur();
  shell.focus.pop();
  settingsEl.hidden = true;
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

function onRemote(e: RemoteEvent): void {
  if (e.key === 'back' && settingsOpen() && !server) return;
  const act = shell.key(e);
  settingsEl.hidden = !settingsOpen();
  if (!act) return;
  if (act.type === 'launch') launchApp(act.appId);
  else if (act.type === 'settings') openSettings();
  else if (act.id === 'set:server') serverInput.focus(); // the TV's on-screen keyboard opens for a focused text field
  else if (act.id === 'set:again') {
    token = '';
    store.remove(TOKEN_KEY);
    add('signing in again');
    closeSettings();
    start();
  } else closeSettings();
}

setInterval(() => updateClock(new Date()), 10_000);
start();

export {};
