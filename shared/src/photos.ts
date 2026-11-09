// Photos (Session 14): the Server path of an image, and the answers the photo endpoints give Sofa Home and Companion.
// Images come from Immich through the Server's media cache. The TV cannot send headers with an <img>, so a path is the whole
// address: /api/media/<profile>/<album>/<asset>.jpg. The Server serves it only if the profile may see that album and the
// asset is in it (ADR 0003, Photos). This file also runs on the TV (Chromium 56), so it uses no runtime API newer than ES2017.
import type { Profile } from './layout.ts';

/** Immich ids are UUIDs. Anything else is refused before it can reach an Immich URL or a file name. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const MEDIA = /^\/api\/media\/(household|kids)\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.jpg$/;

/** The path of one image. Ids are lower-cased so a path is the same however the id was written. */
export function mediaPath(profile: Profile, album: string, asset: string): string {
  return '/api/media/' + profile + '/' + album.toLowerCase() + '/' + asset.toLowerCase() + '.jpg';
}

/** Reads a path made by mediaPath; null for anything else. Sofa Home uses it to find the album behind a photo card. */
export function parseMediaPath(path: string): { profile: Profile; album: string; asset: string } | null {
  const m = MEDIA.exec(path);
  return m && UUID.test(m[2]) && UUID.test(m[3]) ? { profile: m[1] as Profile, album: m[2], asset: m[3] } : null;
}

/** An album as the Server lists it. `kids` is only sent to Companion: whether the album is approved for Kids Mode. */
export interface PhotoAlbum {
  id: string;
  name: string;
  count: number; // photos in it (Immich's own count; videos are not shown)
  kids?: boolean;
}

/** GET /api/photos/albums. With ?profile= (Sofa Home): the albums that profile may open. Without (Companion): every Immich album. */
export interface PhotoAlbumsResponse {
  albums: PhotoAlbum[];
}

/** GET /api/photos/albums/:id/images?profile=: up to SLIDESHOW_IMAGES image paths in a fresh random order. */
export interface PhotoImagesResponse {
  id: string;
  name: string;
  images: string[];
}

export const SLIDESHOW_IMAGES = 200;
