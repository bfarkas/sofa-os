// The widget catalogue (ADR 0003): every widget type the Server knows, in the order Companion lists them.
// A new type is one adapter module and one line here (Sessions 12 to 14).
import { photoAdapter, type PhotoDeps } from './adapters/photo.ts';
import { statusAdapter, type StatusDeps } from './adapters/status.ts';
import type { WidgetAdapter } from './widgets.ts';

export type CatalogueDeps = StatusDeps & PhotoDeps;

export function createCatalogue(deps: CatalogueDeps): WidgetAdapter[] {
  return [statusAdapter(deps), photoAdapter(deps)];
}
