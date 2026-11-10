// The `daycycle` Layout background (Session 29): one of four pictures by the TV's clock, fixed hours (decided 2026-11-10; no sun.sun).
import { COLORS, textOn } from './tokens.ts';

export const DAY_PERIODS = ['morning', 'midday', 'evening', 'night'] as const;
export type DayPeriod = (typeof DAY_PERIODS)[number];

/** morning 06 to 10, midday 10 to 17, evening 17 to 21, night 21 to 06 (a whole hour 0 to 23). */
export function periodAt(hour: number): DayPeriod {
  return hour >= 6 && hour < 10 ? 'morning' : hour >= 10 && hour < 17 ? 'midday' : hour >= 17 && hour < 21 ? 'evening' : 'night';
}

/** The picture in the Sofa Home package (and in Companion's preview), 1920 x 1080. */
export const dayImage = (p: DayPeriod): string => 'img/day-' + p + '.jpg';

/**
 * Mean colour of the top 350 rows of each picture (where the clock, date and greeting sit), measured on the 1920 x 1080 export
 * with the REC 709 luminance of assets/brand/v2/wallpaper/day-cycle (mean linear luminance 0.36, 0.33, 0.14, 0.01).
 */
export const DAY_SKY: Record<DayPeriod, string> = { morning: '#90a2b9', midday: '#649dd4', evening: '#7e586e', night: '#0b1c37' };

/** Mean water luminance (0 to 255, as grey) from measurements.json, for the footer, which sits on the water below the widgets. */
export const DAY_WATER: Record<DayPeriod, string> = { morning: '#696969', midday: '#737373', evening: '#4a4a4a', night: '#202020' };

/** The text colour on the wallpaper for a period: ink in the day, ivory on the evening and night skies (textOn of the measured colour). */
export const dayInk = (p: DayPeriod): string => textOn(DAY_SKY[p]);

/** The footer's colour: the water is a mid tone to dark in every period, so this is ivory throughout (the sky's ink would not read there). */
export const dayFootInk = (p: DayPeriod): string => textOn(DAY_WATER[p]);

/** A soft halo behind the text on the wallpaper (clock, date, greeting): dark behind ivory, light behind ink. The evening's glow measured 2.45:1 under ivory alone. */
export const dayShadow = (p: DayPeriod): string => (dayInk(p) === COLORS.ivory ? '0 1px 3px rgba(0, 0, 0, 0.35), 0 2px 14px rgba(0, 0, 0, 0.55)' : '0 1px 10px rgba(255, 255, 255, 0.45)');
