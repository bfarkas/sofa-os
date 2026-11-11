// App icons (Session 30). The TV already knows each installed app's icon: tizen.application.getAppInfo(id).iconPath. Whether an <img>
// may load that path is only known on the TV, so everything here is defensive: no API, an error, no path or an <img> that fails all
// leave the tile with its letter badge. The answer is cached per app id for the session, and each app reports its outcome once.

/** The subset of the Tizen Application API used here. */
export interface TizenAppInfoApi {
  application: { getAppInfo(id: string): { iconPath?: string } | null | undefined };
}

/** loaded: an <img> showed it; failed: every path we tried failed to load; none: no path, or the API said no. `detail` is the path or the error name. */
export interface IconReport {
  app: string;
  outcome: 'loaded' | 'failed' | 'none';
  detail: string;
}

/** The sources to try for an iconPath, in order: as returned, then `file://` when it is a bare absolute path. */
export function iconCandidates(path: unknown): string[] {
  const p = typeof path === 'string' ? path.trim() : '';
  if (!p) return [];
  return p.charAt(0) === '/' && p.charAt(1) !== '/' ? [p, 'file://' + p] : [p];
}

/** Pictures packaged with the app, tried instead of the TV's own: the TV's Netflix icon is an old logo and it has none for YouTube (Cobalt). The mockup's marks. */
const BUNDLED: Record<string, string> = {
  'org.tizen.netflix-app': 'img/icon-netflix.svg',
  'RN1MCdNq8t.Netflix': 'img/icon-netflix.svg',
  'com.samsung.tv.cobalt-yt': 'img/icon-youtube.svg',
};

export interface Icons {
  /** What to try as the tile's <img> source now, or undefined for the letter badge. Looks the app up once. */
  src(appId: string): string | undefined;
  /** The <img> showed `src`. */
  loaded(appId: string, src: string): void;
  /** The <img> failed on `src`; returns the next source to try, or undefined when the letter stays. */
  failed(appId: string, src: string): string | undefined;
}

interface Entry {
  path: string;
  tries: string[];
  at: number; // index of the source being tried
  state: 'trying' | 'loaded' | 'failed' | 'none';
}

/** `api` is `window.tizen` on the TV; without it (a desktop browser) every app keeps its letter. */
export function createIcons(api: TizenAppInfoApi | undefined, report: (r: IconReport) => void): Icons {
  const cache: Record<string, Entry> = {};

  function lookup(appId: string): Entry {
    if (BUNDLED[appId]) return { path: BUNDLED[appId], tries: [BUNDLED[appId]], at: 0, state: 'trying' };
    let error = api && api.application ? 'no iconPath' : 'no Tizen API';
    try {
      const info = api && api.application ? api.application.getAppInfo(appId) : null;
      const tries = iconCandidates(info && info.iconPath);
      if (tries.length) return { path: String(info!.iconPath), tries, at: 0, state: 'trying' };
    } catch (e) {
      error = String((e && ((e as { name?: string }).name || (e as { message?: string }).message)) || 'error');
    }
    report({ app: appId, outcome: 'none', detail: error.slice(0, 80) });
    return { path: '', tries: [], at: 0, state: 'none' };
  }

  const entry = (appId: string) => cache[appId] || (cache[appId] = lookup(appId));
  return {
    src(appId) {
      const e = entry(appId);
      return e.state === 'trying' || e.state === 'loaded' ? e.tries[e.at] : undefined;
    },
    loaded(appId, src) {
      const e = entry(appId);
      if (e.state === 'loaded' || e.state === 'none' || e.tries.indexOf(src) < 0) return;
      e.state = 'loaded';
      e.at = e.tries.indexOf(src);
      report({ app: appId, outcome: 'loaded', detail: src });
    },
    failed(appId, src) {
      const e = entry(appId);
      if (e.state === 'trying' && e.tries[e.at] === src) { // another tile of the same app may have moved on already
        if (e.at + 1 < e.tries.length) e.at++;
        else {
          e.state = 'failed';
          report({ app: appId, outcome: 'failed', detail: e.path });
        }
      }
      return e.state === 'trying' ? e.tries[e.at] : undefined;
    },
  };
}
