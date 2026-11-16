/**
 * Banned-term check (task 15.1, Requirements 15.6 and 15.9): neutrality check on the SOURCES.md text.
 *
 * Latin-script terms match case-insensitively on whole words (lookarounds on [A-Za-z0-9_], `iu` flags).
 * CJK terms match as substrings. A match inside an exempt phrase on the same line is ignored.
 * It is part of DEFAULT_STEPS (task 15.2), right after the SOURCES.md render step.
 */
import type { BuildContext } from './context.ts';
import { BannedTermError, DataError, type BannedTermHit } from './errors.ts';
import { fsCommittedReader, type CommittedReader } from './policy/step.ts';
import type { BuildState, Step } from './run.ts';

export const BANNED_TERMS_FILE = 'data/config/banned-terms.txt';
export const BANNED_TERMS_EXEMPT_FILE = 'data/config/banned-terms-exempt.txt';

/** One term per line; `#` comment lines and blank lines are skipped; surrounding whitespace is trimmed. */
export function parseTermList(text: string): string[] {
  const terms: string[] = [];
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    terms.push(line);
  }
  return terms;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A term is Latin-script when it has only Latin letters, digits and common punctuation. */
function isLatinTerm(term: string): boolean {
  return /^[\p{Script=Latin}\p{N}\s'’.\-_]+$/u.test(term);
}

function matchSpans(line: string, term: string): Array<[number, number]> {
  const source = isLatinTerm(term)
    ? `(?<![A-Za-z0-9_])${escapeRegExp(term)}(?![A-Za-z0-9_])`
    : escapeRegExp(term);
  const re = new RegExp(source, 'giu');
  const spans: Array<[number, number]> = [];
  for (const m of line.matchAll(re)) spans.push([m.index, m.index + m[0].length]);
  return spans;
}

function exemptSpans(line: string, exempt: readonly string[]): Array<[number, number]> {
  const lower = line.toLowerCase();
  const spans: Array<[number, number]> = [];
  for (const phrase of exempt) {
    const p = phrase.toLowerCase();
    if (p === '') continue;
    for (let at = lower.indexOf(p); at >= 0; at = lower.indexOf(p, at + 1)) spans.push([at, at + p.length]);
  }
  return spans;
}

/** Each term found on each line, once per term and line, ordered by line and then by list order. */
export function checkBannedTerms(
  text: string,
  terms: readonly string[],
  exempt: readonly string[] = [],
): BannedTermHit[] {
  const hits: BannedTermHit[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    let exemptRanges: Array<[number, number]> | undefined;
    for (const term of terms) {
      if (term === '') continue;
      const spans = matchSpans(line, term);
      if (spans.length === 0) continue;
      exemptRanges ??= exemptSpans(line, exempt);
      const ranges = exemptRanges;
      const found = spans.some(([s, e]) => !ranges.some(([xs, xe]) => xs <= s && e <= xe));
      if (found) hits.push({ term, line: i + 1 });
    }
  }
  return hits;
}

export function bannedTermsStep(readCommitted: CommittedReader = fsCommittedReader): Step {
  return {
    name: 'banned-terms',
    run(_ctx: BuildContext, state: BuildState) {
      if (state.sourcesDoc === undefined) {
        throw new DataError('missing-step-output', 'sourcesDoc', ['run the SOURCES.md render step before the banned-term check']);
      }
      const terms = parseTermList(readCommitted(BANNED_TERMS_FILE));
      const exempt = parseTermList(readCommitted(BANNED_TERMS_EXEMPT_FILE));
      const hits = checkBannedTerms(state.sourcesDoc, terms, exempt);
      if (hits.length > 0) throw new BannedTermError(hits);
    },
  };
}
