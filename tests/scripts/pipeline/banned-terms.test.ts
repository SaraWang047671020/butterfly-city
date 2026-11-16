import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BANNED_TERMS_EXEMPT_FILE,
  BANNED_TERMS_FILE,
  bannedTermsStep,
  checkBannedTerms,
  parseTermList,
} from '../../../scripts/pipeline/banned-terms.ts';
import type { BuildContext } from '../../../scripts/pipeline/context.ts';
import { BannedTermError, DataError } from '../../../scripts/pipeline/errors.ts';
import { INDICATOR_SPECS, POLICY_SERIES_SPECS } from '../../../scripts/pipeline/registry/indicators.ts';
import { METHOD_REGISTRY } from '../../../scripts/pipeline/registry/methods.ts';
import { SOURCE_REGISTRY } from '../../../scripts/pipeline/registry/sources.ts';
import type { BuildState } from '../../../scripts/pipeline/run.ts';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const readRepo = (rel: string): string => fs.readFileSync(path.join(ROOT, ...rel.split('/')), 'utf8');

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value !== null && typeof value === 'object') for (const v of Object.values(value)) strings(v, out);
  return out;
}

describe('parseTermList', () => {
  it('skips comments and blank lines, trims, and handles CRLF', () => {
    expect(parseTermList('# header\r\n\r\n  failed \r\n國民黨\n# x\nKMT')).toEqual(['failed', '國民黨', 'KMT']);
  });
});

describe('checkBannedTerms', () => {
  it('matches Latin terms case-insensitively with 1-based line numbers', () => {
    expect(checkBannedTerms('ok\nIt Finally rose', ['finally'], [])).toEqual([{ term: 'finally', line: 2 }]);
  });

  it('does not match a term inside a longer word', () => {
    expect(checkBannedTerms('unfailed finally_x failedly KMTs', ['failed', 'finally', 'KMT'], [])).toEqual([]);
  });

  it('matches next to punctuation and non-ASCII characters', () => {
    expect(checkBannedTerms('(failed), 後failed。', ['failed'], [])).toEqual([{ term: 'failed', line: 1 }]);
  });

  it('matches CJK terms as substrings', () => {
    expect(checkBannedTerms('甲\n某國民黨員', ['國民黨'], [])).toEqual([{ term: '國民黨', line: 2 }]);
  });

  it('ignores a match inside an exempt phrase on the same line', () => {
    const exempt = ['New Party Housing Act'];
    expect(checkBannedTerms('The new party housing act applies', ['New Party'], exempt)).toEqual([]);
    expect(checkBannedTerms('The New Party Housing Act and the New Party', ['New Party'], exempt)).toEqual([
      { term: 'New Party', line: 1 },
    ]);
    expect(checkBannedTerms('New Party\nNew Party Housing Act', ['New Party'], exempt)).toEqual([
      { term: 'New Party', line: 1 },
    ]);
  });

  it('reports a term once per line', () => {
    expect(checkBannedTerms('failed failed', ['failed'], [])).toHaveLength(1);
  });
});

describe('committed term lists', () => {
  const terms = parseTermList(readRepo(BANNED_TERMS_FILE));
  const exempt = parseTermList(readRepo(BANNED_TERMS_EXEMPT_FILE));

  it('parse and contain the neutrality.md examples and party names', () => {
    for (const t of ['failed', 'disastrous', 'brilliant', 'finally', 'KMT', 'DPP', 'TPP', '國民黨', '民進黨', '民眾黨']) {
      expect(terms).toContain(t);
    }
    expect(new Set(terms).size).toBe(terms.length);
  });

  it('are UTF-8 with LF line endings', () => {
    expect(readRepo(BANNED_TERMS_FILE)).not.toContain('\r');
    expect(readRepo(BANNED_TERMS_EXEMPT_FILE)).not.toContain('\r');
  });

  it('match no registry text (sources, methods, indicators, policy series)', () => {
    const text = strings([SOURCE_REGISTRY, METHOD_REGISTRY, INDICATOR_SPECS, POLICY_SERIES_SPECS])
      .flatMap((s) => s.split(/\r?\n/))
      .join('\n');
    expect(checkBannedTerms(text, terms, exempt)).toEqual([]);
  });
});

describe('bannedTermsStep', () => {
  const files: Record<string, string> = {
    [BANNED_TERMS_FILE]: '# t\nfinally\n',
    [BANNED_TERMS_EXEMPT_FILE]: '# e\n',
  };
  const read = (rel: string): string => files[rel] ?? '';
  const ctx = {} as BuildContext;

  it('passes clean text', () => {
    const state: BuildState = { sourcesDoc: 'clean\ntext' } as BuildState;
    expect(() => bannedTermsStep(read).run(ctx, state)).not.toThrow();
  });

  it('throws BannedTermError listing term and line', () => {
    const state: BuildState = { sourcesDoc: 'a\nb Finally' } as BuildState;
    try {
      bannedTermsStep(read).run(ctx, state);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(BannedTermError);
      expect((e as BannedTermError).hits).toEqual([{ term: 'finally', line: 2 }]);
      expect((e as BannedTermError).details).toEqual(['line 2: "finally"']);
    }
  });

  it('throws DataError when sourcesDoc is absent', () => {
    expect(() => bannedTermsStep(read).run(ctx, {} as BuildState)).toThrow(DataError);
  });
});
