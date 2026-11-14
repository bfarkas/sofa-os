// The apps installed on the TV (Session 39): what Sofa Home reports to the Server, and how the Apps screen merges them
// with the household's curated list. Pure, so the TV, the Server and tests share one definition.
export interface InstalledApp {
  id: string;
  name: string;
}

/** What `tizen.application.getAppsInfo` returns per app (only the fields used). `show` is false for hidden system apps. */
export interface AppInfo extends InstalledApp {
  show?: boolean;
}

export const MAX_INSTALLED_APPS = 500;

/** Curated apps first in their order, then every other launchable app A to Z by name. Hidden apps, `selfId` and duplicate ids are dropped. */
export function mergeApps(curated: InstalledApp[], installed: AppInfo[], selfId: string): InstalledApp[] {
  const seen: Record<string, boolean> = {};
  const out: InstalledApp[] = [];
  for (const a of curated) {
    if (seen[a.id]) continue;
    seen[a.id] = true;
    out.push(a);
  }
  const rest: InstalledApp[] = [];
  for (const a of installed) {
    if (a.show === false || a.id === selfId || seen[a.id]) continue;
    seen[a.id] = true;
    rest.push({ id: a.id, name: a.name || a.id });
  }
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
