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
    getCurrentApplication(): { appInfo: { id: string } };
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
