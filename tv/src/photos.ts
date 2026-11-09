// Photos on the TV without the DOM: asking the Server for albums and pictures, and deciding what may be loaded.
// photoview.ts draws; slideshow.ts decides the order. Sofa Home loads only paths that look like the Server's own media
// paths for the profile it asked about, whatever an answer says.
import { parseMediaPath, UUID, type PhotoAlbum, type Profile } from '@sofa/shared';
import type { CardView } from './widgets.ts';

export const SLIDESHOW_MS = 8000; // a picture stays this long in the album slideshow
export const AMBIENT_MS = 15000; // and in the ambient view
export const BACKGROUND_MS = 60000; // and behind the Dashboard

/** The album behind a photo card, or null if the card is not a photo from the Server. Its OK opens that album's ambient view. */
export function albumOfCard(v: CardView): string | null {
  if (v.state !== 'ok' || v.card.template !== 'photo') return null;
  const m = parseMediaPath(v.card.image);
  return m && m.profile === 'household' ? m.album : null;
}

/** A Layout background "image": "<album id>/<asset id>" as a household media path, or null if it is not one. */
export function backgroundImage(spec: string): string | null {
  const [album, asset, ...rest] = spec.split('/');
  const path = album && asset && !rest.length ? '/api/media/household/' + album.toLowerCase() + '/' + asset.toLowerCase() + '.jpg' : '';
  return parseMediaPath(path) ? path : null;
}

export interface AlbumImages {
  name: string;
  images: string[]; // Server paths, all for the asked profile
}

type Get = (path: string) => Promise<unknown>;

/** GET with the device token; rejects on any status but 200. */
export function authedGet(fetchFn: typeof fetch, server: string, token: string): Get {
  return (path) =>
    fetchFn(server + path, { headers: { Authorization: 'Bearer ' + token } }).then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
}

/** The pictures of an album for a profile; anything that is not that profile's media path is dropped. */
export function fetchImages(get: Get, album: string, profile: Profile): Promise<AlbumImages> {
  return get('/api/photos/albums/' + album + '/images?profile=' + profile).then((a) => {
    const v = a as { name?: unknown; images?: unknown };
    if (!v || typeof v.name !== 'string' || !Array.isArray(v.images)) throw new Error('not an album');
    const images = (v.images as unknown[]).filter((p): p is string => {
      const m = typeof p === 'string' ? parseMediaPath(p) : null;
      return !!m && m.profile === profile && m.album === album;
    });
    return { name: v.name, images };
  });
}

/** Reads GET /api/photos/albums?profile=; entries that are not albums are dropped. */
export function parseAlbums(value: unknown): PhotoAlbum[] | null {
  const v = value as { albums?: unknown };
  if (!v || !Array.isArray(v.albums)) return null;
  return (v.albums as PhotoAlbum[]).filter((a) => a && typeof a.id === 'string' && UUID.test(a.id) && typeof a.name === 'string' && a.name.length <= 120 && typeof a.count === 'number');
}

export interface AlbumsOptions {
  fetchAlbums(): Promise<unknown>;
  onChange(albums: PhotoAlbum[]): void;
  intervalMs?: number;
}

/** Keeps a list of albums fresh: now, on refresh() and every interval. A failed fetch keeps the last list. */
export function startAlbums(o: AlbumsOptions): { stop(): void; refresh(): void } {
  let stopped = false, fetching = false;
  function refresh(): void {
    if (stopped || fetching) return;
    fetching = true;
    o.fetchAlbums()
      .then(parseAlbums)
      .then(
        (list) => {
          if (list && !stopped) o.onChange(list);
        },
        () => {},
      )
      .then(() => {
        fetching = false;
      });
  }
  refresh();
  const timer = setInterval(refresh, o.intervalMs || 120_000);
  return {
    stop(): void {
      stopped = true;
      clearInterval(timer);
    },
    refresh,
  };
}
