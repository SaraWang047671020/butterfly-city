/**
 * Text checks for card titles and descriptions (event-library Requirements 4.1, 4.3, 4.4, 4.6):
 * length, English-only characters and the banned terms of neutrality.md.
 */
import { checkBannedTerms } from '../pipeline/banned-terms.ts';

export const EVENT_BANNED_TERMS_FILE = 'data/config/event-banned-terms.txt';
export const TITLE_MAX = 80;
export const DESCRIPTION_MAX = 300;

/** Printable ASCII plus the en dash and the right single quote. */
const ENGLISH = /^[\x20-\x7E–’]*$/;

export interface TextIssue {
  readonly field: 'title' | 'description';
  readonly message: string;
}

/** The Traditional Chinese title and description: length and the banned terms (play-loop Requirement 12.7). */
export function checkCardTextZh(
  zh: { readonly title: string; readonly description: string },
  terms: readonly string[],
  exempt: readonly string[],
): TextIssue[] {
  const issues: TextIssue[] = [];
  const fields = [
    ['title', zh.title, TITLE_MAX],
    ['description', zh.description, DESCRIPTION_MAX],
  ] as const;
  for (const [field, text, max] of fields) {
    if (text.length < 1 || text.length > max) issues.push({ field, message: `zh length ${text.length}, allowed 1 to ${max}` });
    for (const hit of checkBannedTerms(text, terms, exempt)) issues.push({ field, message: `zh banned term "${hit.term}"` });
  }
  return issues;
}

export function checkCardText(
  card: { readonly title: string; readonly description: string },
  terms: readonly string[],
  exempt: readonly string[],
): TextIssue[] {
  const issues: TextIssue[] = [];
  const fields = [
    ['title', card.title, TITLE_MAX],
    ['description', card.description, DESCRIPTION_MAX],
  ] as const;
  for (const [field, text, max] of fields) {
    if (text.length < 1 || text.length > max) issues.push({ field, message: `length ${text.length}, allowed 1 to ${max}` });
    if (!ENGLISH.test(text)) {
      const bad = [...text].find((ch) => !ENGLISH.test(ch)) ?? '';
      issues.push({ field, message: `non-English character "${bad}" (U+${bad.codePointAt(0)?.toString(16).toUpperCase().padStart(4, '0')})` });
    }
    for (const hit of checkBannedTerms(text, terms, exempt)) issues.push({ field, message: `banned term "${hit.term}"` });
  }
  return issues;
}
