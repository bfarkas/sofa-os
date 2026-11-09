// The Immich client: the three calls Sofa.OS needs, against Immich v3.3.6's documented API (confirmed 2026-11-09 from the
// release's open-api spec). The API key needs exactly album.read, asset.read and asset.view. The key is sent as
// x-api-key and never logged; errors name the status and the path only.
import { UUID } from '@sofa/shared';

export interface ImmichAlbum {
  id: string;
  name: string;
  count: number; // Immich's assetCount (images and videos)
}

export interface ImmichApi {
  albums(signal?: AbortSignal): Promise<ImmichAlbum[]>;
  /** An album's name and the ids of its images (not videos), newest first, at most IMAGES_PER_ALBUM of them. */
  album(id: string, signal?: AbortSignal): Promise<{ name: string; assetIds: string[] }>;
  /** The newest images of the whole library (the key's user), newest first, at most STREAM_NEWEST of them. */
  stream(signal?: AbortSignal): Promise<string[]>;
  /** Immich's own "preview" rendition of an asset: the web-friendly picture it makes for every photo, HEIC and RAW included. */
  preview(assetId: string, signal?: AbortSignal): Promise<Uint8Array>;
}

/** shortcut: one page of 1000 (Immich's maximum page size); older photos of a bigger album are not shown, page when one is. */
export const IMAGES_PER_ALBUM = 1000;
export const STREAM_NEWEST = 300; // the photostream is a random pick from this many of the newest images
const TIMEOUT_MS = 15_000;

export interface ImmichConfig {
  url: string; // like http://immich_server:2283, no trailing slash
  apiKey: string;
}

type Json = Record<string, unknown>;

export function createImmich(cfg: ImmichConfig, fetchFn: typeof fetch = fetch): ImmichApi {
  async function call(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<Response> {
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    const res = await fetchFn(cfg.url + '/api' + path, {
      ...init,
      headers: { 'x-api-key': cfg.apiKey, accept: 'application/json', ...(init.headers as Record<string, string>) },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error('Immich answered ' + res.status + ' for ' + (init.method ?? 'GET') + ' ' + path);
    }
    return res;
  }
  const checkId = (id: string) => {
    if (!UUID.test(id)) throw new Error('not an Immich id');
    return id;
  };

  return {
    async albums(signal) {
      const list = (await (await call('/albums', {}, signal)).json()) as Json[];
      if (!Array.isArray(list)) throw new Error('Immich: unexpected album list');
      return list.flatMap((a) => (typeof a.id === 'string' && UUID.test(a.id) && typeof a.albumName === 'string' ? [{ id: a.id, name: a.albumName, count: Number(a.assetCount) || 0 }] : []));
    },
    async album(id, signal) {
      checkId(id);
      const info = (await (await call('/albums/' + id, {}, signal)).json()) as Json;
      const found = (await (
        await call('/search/metadata', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ albumIds: [id], type: 'IMAGE', size: IMAGES_PER_ALBUM }) }, signal)
      ).json()) as { assets?: { items?: Json[] } };
      const items = found.assets?.items;
      if (typeof info.albumName !== 'string' || !Array.isArray(items)) throw new Error('Immich: unexpected album');
      return { name: info.albumName, assetIds: items.flatMap((a) => (typeof a.id === 'string' && UUID.test(a.id) ? [a.id] : [])) };
    },
    async stream(signal) {
      const found = (await (await call('/search/metadata', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'IMAGE', order: 'desc', size: STREAM_NEWEST }) }, signal)).json()) as { assets?: { items?: Json[] } };
      const items = found.assets?.items;
      if (!Array.isArray(items)) throw new Error('Immich: unexpected photo list');
      return items.flatMap((a) => (typeof a.id === 'string' && UUID.test(a.id) ? [a.id] : []));
    },
    async preview(assetId, signal) {
      checkId(assetId);
      return new Uint8Array(await (await call('/assets/' + assetId + '/thumbnail?size=preview', { headers: { accept: 'image/jpeg' } }, signal)).arrayBuffer());
    },
  };
}
