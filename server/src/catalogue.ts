// The widget catalogue (ADR 0003): every widget type the Server knows, in the order Companion lists them.
// A new type is one adapter module and one line here (Sessions 12 to 14).
import { calendarAdapter, type CalendarReader } from './adapters/calendar.ts';
import { statusAdapter, type StatusDeps } from './adapters/status.ts';
import { Unavailable, type WidgetAdapter } from './widgets.ts';

export type CatalogueDeps = StatusDeps & { calendar?: CalendarReader }; // calendar: absent without Home Assistant

export function createCatalogue(deps: CatalogueDeps): WidgetAdapter[] {
  return [statusAdapter(deps), calendarAdapter({ read: deps.calendar ?? (() => Promise.reject(new Unavailable('Home Assistant is not set up'))), timeZone: deps.timeZone })];
}
