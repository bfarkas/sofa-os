// Sofa Home: TV Sign-in, then the synced layout as plain text (Session 07 builds the real UI), plus the Session 01 key and lifecycle log.
// esbuild bundles it for Chromium M56 (ES2017).
import { TV_PROTOCOL_PREFIX } from '@sofa/shared';
import { drawQr } from './qr.ts';
import { dashed, normalizeServer, SERVER_KEY, startSignIn, TOKEN_KEY, type SignInState } from './signin.ts';
import { snapshotFetcher, startSync, STORAGE_KEY, type SyncState } from './sync.ts';

declare global {
  interface Window {
    SOFA_LOG_URL?: string;
    SOFA_SERVER_URL?: string;
  }
  // Tizen web API, only the parts used here.
  const tizen: {
    tvinputdevice: {
      registerKey(name: string): void;
      getSupportedKeys(): { name: string; code: number }[];
    };
  };
}

const KEY = 'sofahome.events';
const MAX = 8;
const stage = document.getElementById('stage')!;
const logEl = document.getElementById('log')!;
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

let down: Record<number, number> = {};
document.addEventListener('keydown', (e) => {
  if (down[e.keyCode]) return;
  down[e.keyCode] = Date.now();
  add(`down ${e.keyCode} key=${e.key}`);
  // While the Server address is being typed the keyboard needs its keys; only Enter and Back are ours.
  if (document.activeElement === serverInput && e.keyCode !== 13 && e.keyCode !== 10009 && e.keyCode !== 27) return;
  e.preventDefault();
  onKey(e.keyCode);
});
document.addEventListener('keyup', (e) => {
  const held = down[e.keyCode] ? Date.now() - down[e.keyCode] : 0;
  delete down[e.keyCode];
  add(`up   ${e.keyCode} held=${held}ms`);
});

window.addEventListener('blur', () => { down = {}; });
window.addEventListener('focus', () => { focusStage(); refocusSoon(); });
document.addEventListener('visibilitychange', () => {
  down = {};
  add(document.hidden ? 'HIDDEN' : 'VISIBLE');
  if (!document.hidden) { focusStage(); refocusSoon(); }
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
let server = normalizeServer(store.get(SERVER_KEY) || window.SOFA_SERVER_URL || '') || '';
let token = store.get(TOKEN_KEY) || '';
let sync: { stop(): void } | null = null;
let signIn: { stop(): void } | null = null;
let lastRevision = 0;
let lastNote = '';

const signinEl = $('signin'), homeEl = $('home'), settingsEl = $('settings');
const statusEl = $('status'), layoutEl = $('layout'), codeEl = $('code'), signinNote = $('signin-note');
const serverInput = $('server-input') as HTMLInputElement;
const settingsNote = $('settings-note');

function renderHome(s: SyncState): void {
  const snap = s.snapshot;
  if (snap) lastRevision = snap.revision;
  const note = (snap ? 'revision ' + snap.revision : 'no layout yet') + (s.live ? ', live' : ', offline') + (s.error ? '. ' + s.error : '');
  statusEl.textContent = 'Signed in. ' + note.charAt(0).toUpperCase() + note.slice(1);
  if (note !== lastNote) add('sync ' + (lastNote = note));
  if (!snap) return;
  const l = snap.layout;
  const app = (id: string) => (l.apps.find((a) => a.id === id) || { name: id }).name;
  const widget = (id: string) => {
    const w = l.widgets.find((x) => x.id === id);
    return w ? w.type + ' (' + w.size + ')' : id;
  };
  const lines = l.rows.map((r) => (r.title || 'Untitled row') + ':   ' + r.items.map((i) => (i.kind === 'app' ? app(i.id) : widget(i.id))).join('  ·  '));
  lines.push('Kids Mode:   ' + (l.kidsMode.apps.map(app).join('  ·  ') || 'no apps') + ',  ' + l.kidsMode.dailyMinutes + ' min a day');
  layoutEl.textContent = lines.join('\n');
  document.body.style.background = l.background.kind === 'color' ? l.background.color : '';
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
  $('foot').textContent = (server ? 'Server ' + server : 'No Server address') + '   ·   OK: Settings';
  signinEl.hidden = !!token || !server;
  homeEl.hidden = !token || !server;
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

// ---- Settings: Server address and signing in again. OK opens it, Back closes it. ----
const ROWS = ['row-server', 'row-again', 'row-close'];
let row = 0;

function focusRow(i: number): void {
  row = (i + ROWS.length) % ROWS.length;
  ROWS.forEach((id, n) => $(id).classList.toggle('focus', n === row));
}

function openSettings(note = ''): void {
  settingsEl.hidden = false;
  settingsNote.textContent = note;
  serverInput.value = server;
  focusRow(0);
}

function closeSettings(): void {
  if (!server) return; // nothing to go back to without an address
  serverInput.blur();
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
  add('server address changed');
  start();
}
serverInput.addEventListener('blur', commitServer);

function onKey(code: number): void {
  const back = code === 10009 || code === 27;
  if (settingsEl.hidden) {
    if (code === 13) openSettings();
    return;
  }
  if (document.activeElement === serverInput) {
    if (code === 13 || back) {
      serverInput.blur();
      commitServer(); // blur commits too, but only when the page has focus; a second run changes nothing
      focusStage();
    }
    return;
  }
  if (back) closeSettings();
  else if (code === 38) focusRow(row - 1);
  else if (code === 40) focusRow(row + 1);
  else if (code === 13) {
    if (row === 0) serverInput.focus(); // the TV's on-screen keyboard opens for a focused text field
    else if (row === 1) {
      token = '';
      store.remove(TOKEN_KEY);
      add('signing in again');
      settingsEl.hidden = true;
      start();
    } else closeSettings();
  }
}

start();

export {};
