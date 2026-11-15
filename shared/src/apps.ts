// The apps installed on the TV (Session 39): what Sofa Home reports to the Server, and how the Apps screen merges them
// with the household's curated list. Pure, so the TV, the Server and tests share one definition.
export interface InstalledApp {
  id: string;
  name: string;
}

/** What `tizen.application.getAppsInfo` returns per app (only the fields used). `show` is false for hidden system apps. */
export interface AppInfo extends InstalledApp {
  show?: boolean;
  /** Install time in ms (0 when the TV does not say); the newer of two same-named apps wins. */
  installDate?: number;
}

export const MAX_INSTALLED_APPS = 500;

// Session 49: the TV's own launcher shows store apps (a 10-character package id) plus a few Samsung apps; everything else
// getAppsInfo lists (about 270 entries) is system services, stubs and workers. An allowlist, as CleanFrame does.
const STORE_ID = /^[A-Za-z0-9]{10}\.\w+$/;
export const SAMSUNG_APPS = ['org.tizen.browser', 'com.samsung.tv.gallery', 'com.samsung.tv.aria-video', 'com.samsung.tv.iot-dashboard', 'com.samsung.tv.UniversalBrowse', 'org.tizen.apple.apple-music'];
const SYSTEM_NAME = /service|worker|preview|plugin|daemon|factory|sdk/i;

/** True for an app the TV's launcher would show: not hidden, not Sofa Home, a store or known Samsung app, no stub or service. */
export function isLaunchable(app: AppInfo, selfId: string): boolean {
  if (app.show === false || app.id === selfId || /-dummy$/.test(app.id)) return false;
  if (!app.name || SYSTEM_NAME.test(app.name)) return false;
  return STORE_ID.test(app.id) || SAMSUNG_APPS.indexOf(app.id) >= 0;
}

/** The name two apps are compared by: case, spaces and punctuation ignored ("Disney+" and "disney" match). */
export const nameKey = (name: string): string => name.toLowerCase().replace(/[^0-9a-z\u00c0-\u024f]/g, '');
// An app whose name has no Latin letters or digits is compared by its id, so such apps never all match each other.
const keyOf = (a: InstalledApp) => nameKey(a.name) || a.id;

/**
 * Curated apps first in their order (always, even when not installed or filtered), then every other launchable app A to Z.
 * Same-named apps show once: the curated one if there is one, else the newest install. Duplicate ids are dropped.
 */
export function mergeApps(curated: InstalledApp[], installed: AppInfo[], selfId: string): InstalledApp[] {
  const seen: Record<string, boolean> = {};
  const names: Record<string, boolean> = {};
  const out: InstalledApp[] = [];
  for (const a of curated) {
    if (seen[a.id]) continue;
    seen[a.id] = names[keyOf(a)] = true;
    out.push(a);
  }
  const best: Record<string, AppInfo> = {};
  for (const a of installed) {
    if (seen[a.id] || !isLaunchable(a, selfId)) continue;
    seen[a.id] = true;
    const key = keyOf(a);
    if (names[key]) continue;
    if (!best[key] || (a.installDate || 0) > (best[key].installDate || 0)) best[key] = a;
  }
  const rest = Object.keys(best).map((k) => ({ id: best[k].id, name: best[k].name }));
  rest.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || (a.id < b.id ? -1 : 1));
  return out.concat(rest);
}

/** The reported list of GET and PUT /api/tv/apps, or null when `v` is not a list of { id, name } with short non-empty strings. */
export function parseInstalledApps(v: unknown): InstalledApp[] | null {
  if (!Array.isArray(v) || v.length > MAX_INSTALLED_APPS) return null;
  const out: InstalledApp[] = [];
  for (const a of v) {
    if (!a || typeof a !== 'object' || typeof a.id !== 'string' || typeof a.name !== 'string') return null;
    const id = a.id.trim(), name = a.name.trim();
    if (!id || id.length > 128 || name.length > 80) return null;
    out.push({ id, name: name || id });
  }
  return out;
}

/** Body of PUT /api/tv/apps (the TV's token) and answer of GET /api/tv/apps (Companion or the TV). `reportedAt` is null until the TV has reported. */
export interface TvAppsReport {
  apps: InstalledApp[];
  reportedAt: string | null;
}
