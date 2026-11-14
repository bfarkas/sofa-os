import type { AppInfo } from '@sofa/shared';

// Starting provider apps. Sofa Home talks to the TV through this small interface so tests and a desktop browser can fake it.
export interface Launcher {
  /** Resolves once the TV accepted the launch; rejects with a readable reason when the app cannot be opened. */
  launch(appId: string): Promise<void>;
}

/** The subset of the Tizen Application API used here. */
export interface TizenApplicationApi {
  application: { launch(id: string, onSuccess: () => void, onError: (e: { message?: string; name?: string }) => void): void };
}

/** Store IDs that leave a black screen, mapped to the ID that launches (spec: Title handoff, Netflix). */
export const APP_ID_ALIASES: Record<string, string> = { 'RN1MCdNq8t.Netflix': 'org.tizen.netflix-app' };

/** `api` is `window.tizen` on the TV; without it (a desktop browser) every launch reports unavailable. */
export function tizenLauncher(api: TizenApplicationApi | undefined): Launcher {
  return {
    launch(appId) {
      return new Promise<void>((resolve, reject) => {
        if (!api || !api.application) return reject(new Error('Not running on a TV'));
        try {
          api.application.launch(APP_ID_ALIASES[appId] || appId, resolve, (e) => reject(new Error((e && (e.message || e.name)) || 'The TV refused to open it')));
        } catch (e) {
          reject(new Error((e instanceof Error && e.message) || 'The TV refused to open it'));
        }
      });
    },
  };
}

/** The part of the Tizen Application API that lists what is installed (privilege application.info). */
export interface TizenInstalledApi {
  application: {
    getAppsInfo(onSuccess: (apps: { id: string; name?: string; show?: boolean }[]) => void, onError: (e: { message?: string }) => void): void;
    getCurrentApplication(): { appInfo: { id: string }; hide?(): void }; // hide: Session 43 leaves Sofa Home after switching input
  };
}

/** Every app the TV lists, and Sofa Home's own id. Rejects without the API (a desktop browser) or when the TV refuses. */
export function installedApps(api: TizenInstalledApi | undefined): Promise<{ apps: AppInfo[]; self: string }> {
  return new Promise((resolve, reject) => {
    if (!api || !api.application || !api.application.getAppsInfo) return reject(new Error('Not running on a TV'));
    try {
      api.application.getAppsInfo(
        (list) => resolve({ apps: list.map((a) => ({ id: a.id, name: a.name || '', show: a.show })), self: api.application.getCurrentApplication().appInfo.id }),
        (e) => reject(new Error((e && e.message) || 'The TV refused to list apps')),
      );
    } catch (e) {
      reject(new Error((e instanceof Error && e.message) || 'The TV refused to list apps'));
    }
  });
}

// Session 43: an input tile starts a console behind the Denon. The Server runs its Home Assistant script (Denon source,
// wake); the TV then switches its own input with tizen.tvwindow (privilege tv.window) and Sofa Home hides itself.

/** The Tizen APIs the input switch uses: the connected video sources and the main TV window's source. */
export interface TizenSourceApi {
  systeminfo: { getPropertyValue(p: 'VIDEOSOURCE', ok: (v: { connected: { type: string; number: number }[] }) => void, fail: (e: { message?: string }) => void): void };
  tvwindow: { setSource(src: { type: string; number: number }, ok: () => void, fail: (e: { message?: string }) => void, window?: 'MAIN'): void };
}

/** Switches the TV to `source` (HDMI4 and so on), which must be listed as connected. Rejects without the API or when the TV refuses. */
export function switchSource(api: TizenSourceApi | undefined, source: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const m = /^([A-Z]+)(\d+)$/.exec(source);
    if (!api || !api.tvwindow || !api.systeminfo) return reject(new Error('Not running on a TV'));
    if (!m) return reject(new Error('Not a TV input: ' + source));
    const fail = (e: { message?: string }) => reject(new Error((e && e.message) || 'The TV did not switch to ' + source));
    try {
      api.systeminfo.getPropertyValue('VIDEOSOURCE', (v) => {
        const src = (v.connected || []).filter((s) => s.type === m[1] && s.number === Number(m[2]))[0];
        if (!src) return reject(new Error(source + ' is not connected'));
        try {
          api.tvwindow.setSource(src, () => resolve(), fail, 'MAIN');
        } catch (e) {
          fail(e as { message?: string });
        }
      }, fail);
    } catch (e) {
      fail(e as { message?: string });
    }
  });
}

/** OK on an input tile: the script first, then the TV input, then leave Sofa Home. A failing step stops the rest. Never turns anything off. */
export function startInput(steps: { runScript(): Promise<void>; switchSource(): Promise<void>; leave(): void }): Promise<void> {
  return steps.runScript().then(() => steps.switchSource()).then(() => steps.leave());
}
