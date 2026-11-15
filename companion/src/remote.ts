import type { KidsStatus, PhoneKey, RemoteRequest } from '@sofa/shared';

// Phone Remote page (/remote, Session 46 pick: a round arrow pad, Stop kept). Each button posts one key to the Server; a tap is
// one key press, there is no repeat on hold.
type Call = <T>(method: string, url: string, body?: unknown) => Promise<T>;

const KIDS_OFF: PhoneKey[] = ['home', 'menu']; // the Server refuses these in Kids Mode (server/src/remote.ts)
const icon = (id: string) => `<svg class="ic" aria-hidden="true"><use href="#${id}"/></svg>`;
const round = (key: PhoneKey, id: string, name: string, label = '') => `<button type="button" class="rk" data-key="${key}" aria-label="${name}"><span class="c">${icon(id)}</span>${label}</button>`;

// Static markup with fixed strings only (no data), so innerHTML is safe here.
const PAD = `
  <div class="rtop">${round('back', 'i-uturn', 'Back', 'Back')}${round('home', 'i-house-s', 'Home', 'Home')}${round('menu', 'i-menu', 'Menu', 'Menu')}</div>
  <div class="dpad" role="group" aria-label="Arrows and OK">
    <button type="button" class="ar-up" data-key="up" aria-label="Up">${icon('up')}</button>
    <button type="button" class="ar-left" data-key="left" aria-label="Left">${icon('left')}</button>
    <button type="button" class="ar-right" data-key="right" aria-label="Right">${icon('right')}</button>
    <button type="button" class="ar-down" data-key="down" aria-label="Down">${icon('down')}</button>
    <button type="button" class="ok" data-key="ok">OK</button>
  </div>
  <div class="rvol">
    <div class="capsule" role="group" aria-label="Volume"><button type="button" data-key="voldown" aria-label="Volume down">${icon('i-minus')}</button><em>Volume</em><button type="button" data-key="volup" aria-label="Volume up">${icon('i-plus')}</button></div>
    ${round('mute', 'i-mute', 'Mute')}
  </div>
  <div class="rmedia">${round('rewind', 'i-rew', 'Rewind')}${round('play', 'i-play', 'Play')}${round('pause', 'i-pause', 'Pause')}${round('stop', 'i-stop', 'Stop')}${round('forward', 'i-ff', 'Forward')}</div>`;

export function startRemote(call: Call): void {
  const host = document.getElementById('remote-pad')!;
  const note = document.getElementById('remote-note')!;
  if (!host.childElementCount) {
    host.innerHTML = PAD;
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
    const s = await call<KidsStatus>('GET', '/api/kids').catch(() => null);
    const active = !!s && s.active;
    for (const key of KIDS_OFF) host.querySelector<HTMLButtonElement>(`[data-key=${key}]`)!.disabled = active;
    document.getElementById('remote-kids')!.hidden = !active;
    document.getElementById('remote-tv')!.textContent = !s ? '' : s.tv === 'off' ? 'TV off' : 'TV on';
  }
  void kids();
}
