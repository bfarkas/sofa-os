// The photo widget: one random photo of an Immich album on a tile. OK on it opens the ambient view of the same album
// (Sofa Home finds the album from the image path, shared/src/photos.ts).
import { mediaPath, parseMediaPath, STREAM, type Display } from '@sofa/shared';
import { PhotoError, type Photos } from '../photos.ts';
import { Unavailable, type WidgetAdapter, type WidgetResult } from '../widgets.ts';

export interface PhotoDeps {
  photos: Photos;
}

export function photoAdapter({ photos }: PhotoDeps): WidgetAdapter {
  return {
    type: 'photo',
    title: 'Photos',
    description: 'A photo from an Immich album, or from the newest photos of the whole library (the photostream, household only). OK opens it as a slideshow with the clock.',
    templates: ['photo'],
    sizes: ['small', 'medium', 'large'],
    defaultSize: 'medium',
    defaultFreshness: 'hourly', // a new photo every ten minutes
    fields: [
      { key: 'source', label: 'Photos from', kind: 'choice', default: 'album', options: [{ value: 'album', label: 'An album' }, { value: 'photostream', label: 'The photostream (newest photos)' }], help: 'The photostream is the whole library and the household\'s only: Kids Mode never shows it. Albums can be approved for kids.' },
      { key: 'album', label: 'Album', kind: 'album', required: true, when: { key: 'source', value: 'album' } },
      { key: 'title', label: 'Title', kind: 'text', maxLength: 40, help: 'Shown on the tile. The album name if empty.' },
    ],
    async read(config, ctx) {
      if (!photos.configured) throw new Unavailable('Immich is not set up');
      let pick;
      try {
        pick = await photos.pick('household', config.source === 'photostream' ? STREAM : String(config.album), ctx.signal);
      } catch (err) {
        if (err instanceof PhotoError) throw new Unavailable(err.status === 502 ? 'Photos are not reachable' : 'This album is not available');
        throw err;
      }
      if (!pick) return { empty: 'This album has no photos' };
      const card: Display = { template: 'photo', image: pick.path, caption: pick.name };
      return { title: typeof config.title === 'string' && config.title ? config.title : pick.name, card, detail: card };
    },
    // Kids see the tile only for an album approved for them, with an image path that the kids profile may load.
    forKids(result: WidgetResult): WidgetResult {
      if ('empty' in result) return result;
      const m = result.card.template === 'photo' ? parseMediaPath(result.card.image) : null;
      if (!m || !photos.allowed('kids', m.album)) return { empty: 'Nothing to show' };
      const card: Display = { template: 'photo', image: mediaPath('kids', m.album, m.asset), caption: result.card.template === 'photo' ? result.card.caption : undefined };
      return { ...result, card, detail: card };
    },
  };
}
