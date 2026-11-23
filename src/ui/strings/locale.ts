// Locale of the App (play-loop Requirement 12.1). index.html sets <html lang> from the stored choice or the browser
// language before any module runs, so every module that reads UI_STRINGS at load time gets the right set. Without a
// document (tests, scripts) the locale is English.

export type Locale = 'en' | 'zh-Hant';

/** Browser storage key of the language choice; written by main.ts (src/ui does not touch storage). */
export const LANG_KEY = 'butterflycity.lang.v1';

export function currentLocale(): Locale {
  const lang = typeof document === 'undefined' ? '' : document.documentElement.lang;
  return lang === 'zh-Hant' ? 'zh-Hant' : 'en';
}
