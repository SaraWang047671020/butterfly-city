import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { redactUrl } from '../../../scripts/pipeline/registry/sources.ts';

// Feature: data-pipeline, Property 27: Credential redaction
// **Validates: Requirements 14.6, 14.7**

const CREDENTIAL_NAMES = ['api_key', 'key', 'token', 'access_token', 'client_secret', 'secret'];
const CREDENTIAL_RE = /^(api_?key|key|token|access_token|client_secret|secret)$/i;

/**
 * Local stand-in for the validator's credential check: true when any query parameter has a
 * credential name and a value other than REDACTED. Task 13.1's validator (src/data/validate.ts)
 * will be wired in here once it exists.
 */
function hasCredential(url: string): boolean {
  const q = url.indexOf('?');
  if (q < 0) return false;
  const hash = url.indexOf('#', q);
  const query = url.slice(q + 1, hash < 0 ? url.length : hash);
  return query.split('&').some((pair) => {
    const eq = pair.indexOf('=');
    if (eq < 0) return false;
    return CREDENTIAL_RE.test(pair.slice(0, eq)) && pair.slice(eq + 1) !== 'REDACTED';
  });
}

const word = fc.stringMatching(/^[A-Za-z0-9_.~-]{1,12}$/);

const credName = fc
  .tuple(
    fc.constantFrom(...CREDENTIAL_NAMES),
    fc.array(fc.boolean(), { minLength: 12, maxLength: 12 }),
  )
  .map(([name, flips]) =>
    [...name].map((c, i) => (flips[i] ? c.toUpperCase() : c.toLowerCase())).join(''),
  );

const plainName = word.filter((n) => !CREDENTIAL_RE.test(n));
const credValue = fc.stringMatching(/^[A-Za-z0-9%_.~-]{1,24}$/).filter((v) => v !== 'REDACTED');

interface Param {
  name: string;
  value: string;
  secret: boolean;
}

const param: fc.Arbitrary<Param> = fc.oneof(
  fc.record({ name: credName, value: credValue, secret: fc.constant(true) }),
  fc.record({ name: plainName, value: fc.stringMatching(/^[A-Za-z0-9%_.~-]{0,24}$/), secret: fc.constant(false) }),
);

const urlParts = fc.record({
  scheme: fc.constantFrom('http', 'https'),
  host: fc.stringMatching(/^[a-z]{1,10}(\.[a-z]{1,10}){0,2}\.(com|tw|org)$/),
  path: fc.array(word, { maxLength: 4 }).map((s) => (s.length ? `/${s.join('/')}` : '')),
  params: fc.array(param, { minLength: 0, maxLength: 6 }),
  hash: fc.option(word, { nil: undefined }),
});

describe('Property 27: Credential redaction', () => {
  it('redacts credential values, keeps everything else, is idempotent, and clears the credential check', () => {
    fc.assert(
      fc.property(urlParts, ({ scheme, host, path, params, hash }) => {
        const build = (redact: boolean): string => {
          const query = params
            .map((p) => `${p.name}=${p.secret && redact ? 'REDACTED' : p.value}`)
            .join('&');
          return `${scheme}://${host}${path}${query ? `?${query}` : ''}${hash !== undefined ? `#${hash}` : ''}`;
        };
        const original = build(false);
        const redacted = redactUrl(original);

        expect(redacted).toBe(build(true));
        expect(redactUrl(redacted)).toBe(redacted);
        expect(hasCredential(redacted)).toBe(false);
        if (params.some((p) => p.secret)) {
          expect(hasCredential(original)).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('leaves URLs without credentials untouched', () => {
    expect(redactUrl('https://example.com/a?page=2')).toBe('https://example.com/a?page=2');
    expect(redactUrl('https://example.com/a')).toBe('https://example.com/a');
  });
});
