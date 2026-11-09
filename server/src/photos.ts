// Photos for the TV: which Immich albums each profile may open, and the bounded JPEGs in the media cache.
//
// Policy (ADR 0003, Photos). Kids get exactly the albums in the layout's kidsMode.albums. The household gets every album the
// published layout uses (a photo widget, the background, the kids list). Both are checked on every request, here, so a path
// handed to the wrong profile is refused whatever the TV asks for. An asset is served only if it is in that album.
//
// Pictures are not resized here: Immich already makes a web-friendly "preview" JPEG of every photo (HEIC and RAW included),
// 1440 px on the long edge by default, and the Server caches that file (docs, Session 14). Anything else is refused: a file
// that is not a JPEG (Chromium 56 on the TV, and the budget), or bigger than MAX_FILE_BYTES.
import { mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mediaPath, SLIDESHOW_IMAGES, UUID, type Layout, type PhotoAlbum, type Profile } from '@sofa/shared';
import type { ImmichApi } from './immich.ts';
import { log } from './log.ts';

export const MAX_FILE_BYTES = 1_500_000; // a 1440 px preview is 150 to 600 KB; more than this is not a TV-friendly thumbnail
export const CACHE_BYTES = 400_000_000; // roughly 1000 photos; the oldest-used files go first
const LIST_TTL_MS = 10 * 60_000; // an album's contents are looked at again after this

/** A refusal with the HTTP status it deserves: 403 not for this profile, 404 not in the album, 502 Immich or the file is wrong. */
export class PhotoError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface PhotosOptions {
  immich: ImmichApi | null; // null: no API key configured
  mediaDir: string;
  layout(): Layout;
  now?(): number;
  random?(): number;
  cacheBytes?: number;
}

interface Listing {
  name: string;
  ids: string[];
  at: number;
}

const isJpeg = (b: Uint8Array) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

export function createPhotos(o: PhotosOptions) {
  const now = o.now ?? Date.now;
  const random = o.random ?? Math.random;
  const cacheBytes = o.cacheBytes ?? CACHE_BYTES;
  const photoDir = join(o.mediaDir, 'photos');
  const listDir = join(o.mediaDir, 'albums');
  const lists = new Map<string, Listing>();
  const fetching = new Map<string, Promise<string>>();
  const reading = new Map<string, Promise<Listing>>(); // album reads in progress, so simultaneous requests share one
  let trimming = false;

  /** The albums the household's published layout uses. */
  function usedAlbums(l: Layout): Set<string> {
    const s = new Set<string>(l.kidsMode.albums ?? []);
    for (const w of l.widgets) if (w.type === 'photo' && typeof w.config.album === 'string') s.add(w.config.album);
    if (l.background.kind === 'slideshow') s.add(l.background.album);
    else if (l.background.kind === 'image') s.add(l.background.image.split('/')[0]);
    return s;
  }
  const allowed = (profile: Profile, album: string): boolean => {
    const l = o.layout();
    return UUID.test(album) && (profile === 'kids' ? (l.kidsMode.albums ?? []).indexOf(album) >= 0 : usedAlbums(l).has(album));
  };
  function must(profile: Profile, album: string): void {
    if (!o.immich) throw new PhotoError(502, 'Immich is not set up');
    if (!allowed(profile, album)) throw new PhotoError(403, 'this album is not available');
  }

  const immichAlbums = async (signal?: AbortSignal) => {
    if (!o.immich) throw new PhotoError(502, 'Immich is not set up');
    return o.immich.albums(signal).catch((err) => {
      throw new PhotoError(502, 'Immich is not reachable: ' + String(err instanceof Error ? err.message : err).slice(0, 100));
    });
  };

  const shuffled = <T>(a: T[]): T[] => {
    const b = a.slice();
    for (let i = b.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [b[i], b[j]] = [b[j], b[i]];
    }
    return b;
  };

  /** An album's contents: fresh from Immich, else the last good listing (memory, then the cache directory) while Immich is away. */
  async function listing(album: string, signal?: AbortSignal): Promise<Listing> {
    const known = lists.get(album);
    if (known && now() - known.at < LIST_TTL_MS) return known;
    const pending = reading.get(album);
    if (pending) return pending;
    const p = (async () => {
      try {
        const a = await o.immich!.album(album, signal);
        const fresh = { name: a.name, ids: a.assetIds, at: now() };
        lists.set(album, fresh);
        mkdir(listDir, { recursive: true }).then(() => writeFile(join(listDir, album + '.json'), JSON.stringify(fresh))).catch(() => {}); // a cache: losing it only matters in an outage
        return fresh;
      } catch (err) {
        if (known) return known;
        const saved = await readFile(join(listDir, album + '.json'), 'utf8').then((t) => JSON.parse(t) as Listing, () => null);
        if (saved && Array.isArray(saved.ids) && typeof saved.name === 'string') {
          lists.set(album, saved);
          return saved;
        }
        throw new PhotoError(502, 'Immich is not reachable: ' + String(err instanceof Error ? err.message : err).slice(0, 100));
      }
    })().finally(() => reading.delete(album));
    reading.set(album, p);
    return p;
  }

  /** Keeps the cache under its size: deletes the least recently used files (a hit touches the file's mtime). */
  async function trim(): Promise<void> {
    if (trimming) return;
    trimming = true;
    try {
      const files = await Promise.all((await readdir(photoDir)).filter((f) => f.endsWith('.jpg')).map(async (f) => ({ f, s: await stat(join(photoDir, f)) })));
      let total = files.reduce((n, x) => n + x.s.size, 0);
      for (const x of files.sort((a, b) => a.s.mtimeMs - b.s.mtimeMs)) {
        if (total <= cacheBytes * 0.9) break;
        await rm(join(photoDir, x.f), { force: true });
        total -= x.s.size;
      }
    } catch (err) {
      log.warn('photo cache trim failed', { err: String(err) });
    } finally {
      trimming = false;
    }
  }

  /** The cached file of an asset, fetched from Immich if it is not there yet. */
  async function cached(asset: string, signal?: AbortSignal): Promise<string> {
    const file = join(photoDir, asset + '.jpg');
    try {
      await utimes(file, new Date(), new Date());
      return file;
    } catch {
      /* not cached yet */
    }
    const pending = fetching.get(asset);
    if (pending) return pending;
    const p = (async () => {
      const bytes = await o.immich!.preview(asset, signal);
      if (!isJpeg(bytes)) throw new PhotoError(502, 'Immich sent a preview that is not a JPEG; set Image settings > Preview > Format to JPEG in Immich');
      if (bytes.length > MAX_FILE_BYTES) throw new PhotoError(502, 'the preview is ' + Math.round(bytes.length / 1000) + ' KB, over the ' + MAX_FILE_BYTES / 1000 + ' KB budget');
      await mkdir(photoDir, { recursive: true });
      const tmp = file + '.' + process.pid + '.tmp';
      await writeFile(tmp, bytes);
      await rename(tmp, file); // atomic: a reader never sees half a file
      void trim();
      return file;
    })().finally(() => fetching.delete(asset));
    fetching.set(asset, p);
    return p;
  }

  return {
    configured: !!o.immich,
    allowed,

    /** The albums a profile may open, for Sofa Home (GET /api/photos/albums?profile=). A name and count come from Immich. */
    async albumsFor(profile: Profile, signal?: AbortSignal): Promise<PhotoAlbum[]> {
      const l = o.layout();
      const ids = profile === 'kids' ? l.kidsMode.albums ?? [] : [...usedAlbums(l)];
      const all = await immichAlbums(signal);
      return ids.flatMap((id) => all.filter((a) => a.id === id)); // an album that no longer exists in Immich just drops out
    },

    /** Every Immich album with its Kids Mode approval, for Companion's pickers (GET /api/photos/albums). */
    async allAlbums(signal?: AbortSignal): Promise<PhotoAlbum[]> {
      const approved = o.layout().kidsMode.albums ?? [];
      return (await immichAlbums(signal)).map((a) => ({ ...a, kids: approved.indexOf(a.id) >= 0 }));
    },

    /** An album's images for the slideshow, as paths, in a fresh random order. */
    async images(profile: Profile, album: string, signal?: AbortSignal): Promise<{ name: string; images: string[] }> {
      must(profile, album);
      const l = await listing(album, signal);
      return { name: l.name, images: shuffled(l.ids).slice(0, SLIDESHOW_IMAGES).map((id) => mediaPath(profile, album, id)) };
    },

    /** One random photo of an album, already in the cache, for a photo widget. null when the album has no photos. */
    async pick(profile: Profile, album: string, signal?: AbortSignal): Promise<{ path: string; name: string } | null> {
      must(profile, album);
      const l = await listing(album, signal);
      if (!l.ids.length) return null;
      const id = l.ids[Math.floor(random() * l.ids.length)];
      await cached(id, signal);
      return { path: mediaPath(profile, album, id), name: l.name };
    },

    /** The cache file behind /api/media/<profile>/<album>/<asset>.jpg. Throws PhotoError. */
    async file(profile: Profile, album: string, asset: string, signal?: AbortSignal): Promise<string> {
      if (!UUID.test(asset)) throw new PhotoError(404, 'no such photo');
      must(profile, album);
      const l = await listing(album, signal);
      if (l.ids.indexOf(asset) < 0) throw new PhotoError(404, 'no such photo in this album');
      try {
        return await cached(asset, signal);
      } catch (err) {
        if (err instanceof PhotoError) throw err;
        throw new PhotoError(502, 'Immich is not reachable');
      }
    },

    /** Size of the cache, for tests and the status log. */
    async cacheSize(): Promise<number> {
      try {
        const names = (await readdir(photoDir)).filter((f) => f.endsWith('.jpg'));
        return (await Promise.all(names.map((f) => stat(join(photoDir, f))))).reduce((n, s) => n + s.size, 0);
      } catch {
        return 0;
      }
    },
  };
}

export type Photos = ReturnType<typeof createPhotos>;
