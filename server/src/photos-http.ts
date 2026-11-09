// The photo endpoints, called from server.ts:
//   GET /api/media/<profile>/<album>/<asset>.jpg   a cached JPEG. No credentials: an <img> on the TV cannot send any. The path
//                                                  is the capability (unguessable ids) and photos.ts checks profile and album.
//   GET /api/photos/albums?profile=household|kids  the albums a profile may open (Sofa Home, Companion)
//   GET /api/photos/albums                         every Immich album with its Kids Mode approval (Companion only)
//   GET /api/photos/albums/<album>/images?profile= up to 200 image paths for the slideshow (Sofa Home, Companion)
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PROFILES, UUID, type PhotoAlbumsResponse, type PhotoImagesResponse, type Profile } from '@sofa/shared';
import { log } from './log.ts';
import { PhotoError, type Photos } from './photos.ts';

const json = (res: ServerResponse, status: number, body: unknown): true => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
  return true;
};
// null: no profile given; undefined: not a profile
const profileOf = (v: string | null): Profile | null | undefined => (v === null ? null : (PROFILES as readonly string[]).indexOf(v) >= 0 ? (v as Profile) : undefined);

/** Answers a /api/media or /api/photos request; false if the path is not one of ours. `access` says who is asking. */
export async function photoRoute(photos: Photos, req: IncomingMessage, res: ServerResponse, access: { companion: boolean; tv: boolean }): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;
  const media = /^\/api\/media\/(household|kids)\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.jpg$/.exec(path);
  const images = /^\/api\/photos\/albums\/([0-9a-f-]{36})\/images$/.exec(path);
  if (!media && !images && path !== '/api/photos/albums') return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method not allowed' });
  const fail = (err: unknown): true => {
    if (!(err instanceof PhotoError)) throw err;
    if (err.status === 502) log.warn('photos', { path, err: err.message });
    return json(res, err.status, { error: err.message });
  };

  if (media) {
    try {
      const file = await photos.file(media[1] as Profile, media[2], media[3]);
      const size = (await stat(file)).size;
      // A photo never changes under its id, so the TV may keep it; private because it is the household's.
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': size, 'Cache-Control': 'private, max-age=86400, immutable' });
      if (req.method === 'HEAD') res.end();
      else createReadStream(file).on('error', () => res.destroy()).pipe(res);
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return json(res, 404, { error: 'no such photo' }); // trimmed from the cache just now
      return fail(err);
    }
    return true;
  }

  if (!access.companion && !access.tv) return json(res, 401, { error: 'not signed in' });
  const profile = profileOf(url.searchParams.get('profile'));
  if (profile === undefined) return json(res, 400, { error: 'profile must be household or kids' });
  try {
    if (images) {
      if (!UUID.test(images[1]) || !profile) return json(res, 400, { error: 'expected an album id and ?profile=' });
      return json(res, 200, { id: images[1], ...(await photos.images(profile, images[1])) } satisfies PhotoImagesResponse);
    }
    if (profile) return json(res, 200, { albums: await photos.albumsFor(profile) } satisfies PhotoAlbumsResponse);
    if (!access.companion) return json(res, 403, { error: 'only Companion lists every album' });
    return json(res, 200, { albums: await photos.allAlbums() } satisfies PhotoAlbumsResponse);
  } catch (err) {
    return fail(err);
  }
}
