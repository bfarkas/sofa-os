// Sofa Home: the synced layout as plain text (Session 07 builds the real UI), plus the Session 01 key and lifecycle log.
// esbuild bundles it for Chromium M56 (ES2017).
import { startSync, type SyncState } from './sync.ts';

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
  e.preventDefault();
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

// Layout sync. SOFA_SERVER_URL comes from env.js until Session 06 adds the Server address setting.
const SERVER = (window.SOFA_SERVER_URL || '').replace(/\/$/, '');
const statusEl = document.getElementById('status')!;
const layoutEl = document.getElementById('layout')!;
let lastNote = '';

function render(s: SyncState): void {
  const snap = s.snapshot;
  const note = (snap ? 'revision ' + snap.revision : 'no layout yet') + (s.live ? ', live' : ', offline') + (s.error ? '. ' + s.error : '');
  statusEl.textContent = note.charAt(0).toUpperCase() + note.slice(1);
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

if (SERVER) {
  startSync({
    // Session 06 adds the device token to both requests.
    fetchSnapshot: () =>
      fetch(SERVER + '/api/snapshot').then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }),
    openSocket: (h) => {
      const ws = new WebSocket(SERVER.replace(/^http/, 'ws') + '/ws');
      ws.onopen = h.open;
      ws.onmessage = (e) => h.message(String(e.data));
      ws.onclose = h.close;
      return ws;
    },
    storage: localStorage,
    onChange: render,
  });
} else {
  statusEl.textContent = 'No Server address. Build with SOFA_SERVER_URL set.';
}

export {};
