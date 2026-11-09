// The sample widget type: Sofa.OS's own status, which needs no external service. It proves the adapter path end to end
// (config schema, list template, full-screen detail, a missing reading as a dash).
import type { DatabaseSync } from 'node:sqlite';
import type { ListRow } from '@sofa/shared';
import type { AllowanceStatus } from '../allowance.ts';
import { currentSnapshot } from '../layout.ts';
import type { WidgetAdapter } from '../widgets.ts';

export interface StatusDeps {
  db: DatabaseSync;
  allowance: () => AllowanceStatus;
  homeAssistant: 'on' | 'dry run' | 'off'; // configured, configured as a dry run, or not set up
  timeZone: string;
  startedAt?: number;
}

export function duration(seconds: number): string {
  const m = Math.floor(seconds / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  return d ? d + ' d ' + (h % 24) + ' h' : h ? h + ' h ' + (m % 60) + ' min' : m + ' min';
}

export function statusAdapter(deps: StatusDeps): WidgetAdapter {
  const startedAt = deps.startedAt ?? Date.now();
  const when = new Intl.DateTimeFormat('en-GB', { timeZone: deps.timeZone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return {
    type: 'status',
    title: 'Sofa.OS',
    description: 'How the Server is doing: uptime, the published layout and Kids Mode.',
    templates: ['list'],
    sizes: ['small', 'medium', 'large'],
    defaultSize: 'medium',
    defaultFreshness: 'live',
    fields: [{ key: 'title', label: 'Title', kind: 'text', maxLength: 40, default: 'Sofa.OS' }],
    read(config, ctx) {
      const snap = currentSnapshot(deps.db);
      const kids = deps.allowance();
      const page = deps.db.prepare('SELECT page_count * page_size AS bytes FROM pragma_page_count(), pragma_page_size()').get() as { bytes: number };
      const kidsText = !kids.active ? 'Off' : kids.remainingSeconds > 0 ? duration(kids.remainingSeconds) + ' left' : 'Done for today';
      const rows: ListRow[] = [
        { label: 'Server', value: 'Up ' + duration((ctx.now - startedAt) / 1000) },
        { label: 'Layout', value: 'Revision ' + snap.revision },
        { label: 'Kids Mode', value: kidsText },
      ];
      return {
        title: String(config.title),
        card: { template: 'list', rows },
        detail: {
          template: 'list',
          rows: rows.concat([
            { label: 'Published', value: when.format(new Date(snap.publishedAt)) },
            { label: 'Home Assistant', value: deps.homeAssistant === 'on' ? 'On' : deps.homeAssistant === 'dry run' ? 'Dry run' : 'Not set up' },
            // Without Home Assistant the Server cannot tell whether the TV is on: a missing reading, shown as a dash.
            { label: 'TV', value: deps.homeAssistant === 'off' ? null : kids.tv === 'on' ? 'On' : kids.tv === 'off' ? 'Off' : 'Not confirmed' },
            { label: 'Database', value: (page.bytes / 1e6).toFixed(1), unit: 'MB' },
            { label: 'Node', value: process.version },
          ]),
        },
      };
    },
  };
}
