import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MissingInputsError } from '../../../scripts/pipeline/errors.ts';
import { preflight, requiredInputs } from '../../../scripts/pipeline/manifest.ts';
import { codePointCompare } from '../../../scripts/pipeline/numeric.ts';
import { MemoryRawReader } from '../../../scripts/pipeline/raw-reader.ts';

const NUM_RUNS = 100;
const allCommitted = () => true;

// A single character from the BMP (without surrogates) or from the supplementary planes.
const bmpChar = fc
  .integer({ min: 0x21, max: 0xffff })
  .filter((c) => (c < 0xd800 || c > 0xdfff) && c !== 0x2f && c !== 0x5c)
  .map((c) => String.fromCodePoint(c));
const astralChar = fc.integer({ min: 0x10000, max: 0x10ffff }).map((c) => String.fromCodePoint(c));
const nameArb = fc
  .array(fc.oneof(bmpChar, astralChar), { minLength: 1, maxLength: 6 })
  .map((chars) => chars.join(''))
  .filter((n) => n !== '.' && n !== '..');

/** Reference order: compare arrays of code points, independent of codePointCompare. */
function referenceCompare(a: string, b: string): number {
  const ca = Array.from(a, (ch) => ch.codePointAt(0) ?? 0);
  const cb = Array.from(b, (ch) => ch.codePointAt(0) ?? 0);
  const n = Math.min(ca.length, cb.length);
  for (let i = 0; i < n; i++) {
    const d = (ca[i] ?? 0) - (cb[i] ?? 0);
    if (d !== 0) return d;
  }
  return ca.length - cb.length;
}

// Feature: data-pipeline, Property 24: Directory listings are sorted by code point
describe('Property 24: Directory listings are sorted by code point', () => {
  it('lists names in codePointCompare order, whatever order the files were added in', () => {
    // **Validates: Requirements 17.7**
    const shuffledNames = fc
      .uniqueArray(nameArb, { minLength: 1, maxLength: 30 })
      .chain((names) => fc.shuffledSubarray(names, { minLength: names.length, maxLength: names.length }));
    fc.assert(
      fc.property(shuffledNames, (names) => {
        const files: Record<string, string> = {};
        for (const n of names) files[`dir/${n}`] = 'x';
        const listed = new MemoryRawReader(files).list('dir');
        expect([...listed]).toEqual([...names].sort(codePointCompare));
        expect([...listed]).toEqual([...names].sort(referenceCompare));
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

const BOUNDARY_FILES = [
  'boundaries/town-1140318/TOWN_MOI_1140318.shp',
  'boundaries/town-1140318/TOWN_MOI_1140318.dbf',
];

/** Every raw file the manifest requires, as in-memory fixtures. */
function completeFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const input of requiredInputs(new MemoryRawReader({}))) {
    if (input.committed === true || input.directory === true) continue;
    if (input.path.includes('*')) continue;
    files[input.path] = 'x';
  }
  for (const p of BOUNDARY_FILES) files[p] = 'x';
  files['social-housing/nlma-portal-dashboard/00B4DBB9.json'] = '{}';
  return files;
}

const COMPLETE = completeFiles();
const DOWNLOAD_IDS = new Map<string, string>();
for (const input of requiredInputs(new MemoryRawReader(COMPLETE))) {
  if (input.downloadId !== undefined) DOWNLOAD_IDS.set(input.path, input.downloadId);
}
// Removing the .shp changes which boundary edition is detected, so it is not a removable manifest file.
const REMOVABLE = Object.keys(COMPLETE).filter((p) => DOWNLOAD_IDS.has(p) && !p.endsWith('.shp'));

function missingDetails(files: Record<string, string>): readonly string[] | undefined {
  try {
    preflight(new MemoryRawReader(files), allCommitted);
  } catch (e) {
    expect(e).toBeInstanceOf(MissingInputsError);
    return (e as MissingInputsError).details;
  }
  return undefined;
}

// Feature: data-pipeline, Property 26: Preflight lists every missing raw file
describe('Property 26: Preflight lists every missing raw file', () => {
  it('fails with every removed file listed once with its download command', () => {
    // **Validates: Requirements 2.3**
    fc.assert(
      fc.property(fc.subarray(REMOVABLE, { minLength: 1, maxLength: 40 }), (removed) => {
        const files = { ...COMPLETE };
        for (const p of removed) delete files[p];
        const details = missingDetails(files);
        expect(details).toBeDefined();
        const expected = removed.map((p) => `data/raw/${p}: node scripts/download.ts ${DOWNLOAD_IDS.get(p)}`);
        expect([...(details ?? [])].sort()).toEqual([...expected].sort());
        expect(new Set(details).size).toBe(details?.length);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('does not throw when nothing is removed', () => {
    // **Validates: Requirements 2.3**
    expect(missingDetails({ ...COMPLETE })).toBeUndefined();
  });
});
