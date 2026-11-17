import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import { scanForCredentials, type ScanFile } from '../../../scripts/pipeline/credentials-scan.ts';

/**
 * Property 49: The credentials scan finds every injected secret and never prints it.
 * Only generated fake secrets are used.
 * **Validates: Requirements 25.5, 25.6**
 */

// Background lines use lowercase letters without q and x, digits and spaces, so they can contain neither
// a generated secret (upper case) nor the words "access_token" or "authorization".
const backgroundLine = fc.stringMatching(/^[a-pr-wyz0-9 ]{0,30}$/);
const secretValue = fc.stringMatching(/^[A-Z0-9]{8,20}$/);
const kindArb = fc.constantFrom('secret', 'access_token', 'authorization');
const dirArb = fc.constantFrom('stations', 'fares', 'timetables', 'out');

interface Scenario {
  readonly files: { path: string; lines: string[] }[];
  readonly secrets: string[];
  readonly kind: 'secret' | 'access_token' | 'authorization';
  readonly fileIndex: number;
  readonly lineIndex: number; // insert position, 0..lines.length
  readonly payload: string;
}

const scenarioArb: fc.Arbitrary<Scenario> = fc
  .record({
    dirs: fc.array(dirArb, { minLength: 1, maxLength: 4 }),
    fileLines: fc.array(fc.array(backgroundLine, { maxLength: 12 }), { minLength: 4, maxLength: 4 }),
    secrets: fc.array(secretValue, { minLength: 1, maxLength: 3 }),
    kind: kindArb,
    fileSel: fc.nat(),
    lineSel: fc.nat(),
    pick: fc.nat(),
    payload: secretValue,
  })
  .map((r) => {
    const files = r.dirs.map((d, i) => ({ path: `${d}/file-${i}.json`, lines: r.fileLines[i] as string[] }));
    const fileIndex = r.fileSel % files.length;
    const lineIndex = r.lineSel % ((files[fileIndex] as { lines: string[] }).lines.length + 1);
    return { files, secrets: r.secrets, kind: r.kind, fileIndex, lineIndex, payload: r.payload };
  });

function insertedLine(s: Scenario): string {
  if (s.kind === 'secret') return `abc ${s.secrets[s.payload.length % s.secrets.length]} def`;
  if (s.kind === 'access_token') return `{"access_token": "${s.payload}"}`;
  return `Authorization: Bearer ${s.payload}`;
}

function toScanFiles(s: Scenario, withInsert: boolean): ScanFile[] {
  return s.files.map((f, i) => {
    const lines = [...f.lines];
    if (withInsert && i === s.fileIndex) lines.splice(s.lineIndex, 0, insertedLine(s));
    return { path: f.path, text: lines.join('\n') };
  });
}

describe('Property 49: credentials scan', () => {
  it(
    'finds the inserted line, never echoes matched text, and is silent without it',
    () => {
      fc.assert(
        fc.property(scenarioArb, (s) => {
          const line = insertedLine(s);
          const target = (s.files[s.fileIndex] as { path: string }).path;
          const findings = scanForCredentials(toScanFiles(s, true), s.secrets);
          const hit = findings.some((f) => f.path === target && f.line === s.lineIndex + 1);
          const only = findings.length === 1;
          const serialized = JSON.stringify(findings);
          const leaks =
            serialized.includes(line) ||
            serialized.includes(s.payload) ||
            s.secrets.some((x) => serialized.includes(x)) ||
            findings.some((f) => Object.keys(f).some((k) => k !== 'path' && k !== 'line' && k !== 'kind'));
          const clean = scanForCredentials(toScanFiles(s, false), s.secrets).length === 0;
          return hit && only && !leaks && clean;
        }),
        { numRuns: 200, endOnFailure: true },
      );
    },
    120_000,
  );
});
