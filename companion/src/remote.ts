import type { KidsStatus, PhoneKey, RemoteRequest } from '@sofa/shared';

// Phone Remote page (/remote): big buttons that post one key each to the Server. A tap is one key press; there is no repeat on hold.
type Call = <T>(method: string, url: string, body?: unknown) => Promise<T>;

// Buttons by row: [key, glyph, accessible name]. The d-pad is a 3x3 grid, the rest are rows of equal buttons.
const PAD: [PhoneKey | '', string, string][] = [
  ['', '', ''], ['up', '▲', 'Up'], ['', '', ''],
  ['left', '◀', 'Left'], ['ok', 'OK', 'OK'], ['right', '▶', 'Right'],
  ['', '', ''], ['down', '▼', 'Down'], ['', '', ''],
];
const TOP: [PhoneKey, string, string][] = [['back', '↩', 'Back'], ['home', '⌂', 'Home'], ['menu', '☰', 'Menu']];
const MEDIA: [PhoneKey, string, string][] = [['rewind', '⏪', 'Rewind'], ['play', '▶', 'Play'], ['pause', '⏸', 'Pause'], ['stop', '⏹', 'Stop'], ['forward', '⏩', 'Forward']];
const KIDS_OFF: PhoneKey[] = ['home', 'menu']; // the Server refuses these in Kids Mode (server/src/remote.ts)

export function startRemote(call: Call): void {
  const host = document.getElementById('remote-pad')!;
  const note = document.getElementById('remote-note')!;
  if (!host.childElementCount) {
    const make = (rows: [PhoneKey | '', string, string][], cls: string) => {
      const row = document.createElement('div');
      row.className = cls;
      for (const [key, glyph, name] of rows) {
        const b = document.createElement('button');
        if (key) Object.assign(b, { type: 'button', textContent: glyph }), b.setAttribute('aria-label', name), (b.dataset.key = key);
        else b.className = 'gap', (b.disabled = true), (b.tabIndex = -1), b.setAttribute('aria-hidden', 'true');
        row.appendChild(b);
      }
      host.appendChild(row);
    };
    make(TOP, 'rtop');
    make(PAD, 'rpad');
    make(MEDIA, 'rmedia');
    host.addEventListener('click', async (e) => {
      const key = (e.target as HTMLElement).closest('button')?.dataset.key as PhoneKey | undefined;
      if (!key) return;
      try {
        await call('POST', '/api/remote', { key } satisfies RemoteRequest);
        note.textContent = '';
      } catch (err) {
        note.textContent = err instanceof Error ? err.message : 'The Server is not reachable.';
        if ((err as { status?: number }).status === 403) void kids();
      }
    });
  }
  // Home and Menu are off while Kids Mode is on; say so rather than let a tap fail.
  async function kids(): Promise<void> {
    const active = await call<KidsStatus>('GET', '/api/kids').then((s) => s.active, () => false);
    for (const key of KIDS_OFF) host.querySelector<HTMLButtonElement>(`[data-key=${key}]`)!.disabled = active;
    if (active) note.textContent = 'Kids Mode is on: Home and Menu are off.';
  }
  void kids();
}
