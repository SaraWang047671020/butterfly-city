// UI_Strings_Module (game-ui Requirement 15.3; play-loop Requirement 12): every UI chrome string of the Game_Screen,
// in English (strings/en.ts) and Traditional Chinese (strings/zh-Hant.ts). The set is chosen once at load time from
// the locale; changing the language reloads the page. Placeholders are written as {name} and filled with
// `fillTemplate`. Numbers are formatted by the caller.

import type { EngineErrorCode } from '../types/simulation.ts';
import { DISCLOSURE_TEXT, EN, ENGINE_ERROR_EN, type UiStrings } from './strings/en.ts';
import { currentLocale, type Locale } from './strings/locale.ts';
import { ENGINE_ERROR_ZH, ZH } from './strings/zh-Hant.ts';

export type { UiStrings } from './strings/en.ts';
export type { Locale } from './strings/locale.ts';
export { DISCLOSURE_TEXT };

/** Replaces each {name} with values[name]; an unknown name stays as written. */
export function fillTemplate(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);
}

export const LOCALE: Locale = currentLocale();

export const UI_STRINGS: UiStrings = LOCALE === 'zh-Hant' ? ZH : EN;

const ENGINE_ERROR_TEXT = LOCALE === 'zh-Hant' ? ENGINE_ERROR_ZH : ENGINE_ERROR_EN;

/** Player-facing Engine_Error text built from `code` and `details`; names no Scenario (Requirement 9.4). */
export function buildEngineErrorText(
  code: EngineErrorCode,
  details: Readonly<Record<string, string | number | boolean | null>>,
): string {
  const base = ENGINE_ERROR_TEXT[code];
  const parts = Object.entries(details).map(([k, v]) => `${k}: ${String(v)}`);
  const head = fillTemplate(UI_STRINGS.errors.engine, { code, text: base });
  return parts.length === 0 ? head : `${head} (${parts.join(', ')})`;
}

/** A Quarter_Key ("2016Q3") in the label form of the locale: "2016 Q3" or "2016 年第 3 季" (play-loop 12.6). */
export function quarterLabel(quarter: string): string {
  const m = /^(\d{4})Q([1-4])$/.exec(quarter);
  return m === null ? quarter : fillTemplate(UI_STRINGS.app.quarter, { year: m[1] ?? '', q: m[2] ?? '' });
}

/** A unit text from the data files or the view model in the language of the locale; unknown units stay as written. */
export function unitLabel(unit: string): string {
  const names: Readonly<Record<string, string>> = UI_STRINGS.unitNames;
  return names[unit] ?? unit;
}

/** A city name ("Taipei", "New Taipei") in the language of the locale. */
export function cityLabel(city: string): string {
  const names: Readonly<Record<string, string>> = UI_STRINGS.cityNames;
  return names[city] ?? city;
}
