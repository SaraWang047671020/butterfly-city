import { describe, expect, it } from 'vitest';
import {
  validateDistrictsFile,
  validateHistoryFile,
  validatePolicyTrackFile,
  validateCommuteMatrix,
} from '../../src/data/validate.ts';
import { validateParamsFile } from '../../src/data/validate-params.ts';
import { fixtureContext, readFixture } from './fixtures/index.ts';

const ctx = fixtureContext();

describe('fixture Data_Files', () => {
  it('districts.json validates', () => expect(validateDistrictsFile(readFixture('districts.json'), ctx)).toEqual([]));
  it('history.json validates and has medianTotalPrice', () => {
    const f = readFixture('history.json');
    expect(validateHistoryFile(f, ctx)).toEqual([]);
    expect(f.indicators.map((i: { id: string }) => i.id)).toContain('medianTotalPrice');
  });
  it('policy-track.json validates', () => expect(validatePolicyTrackFile(readFixture('policy-track.json'), ctx)).toEqual([]));
  it('params.json validates with 140 ids', () => {
    const f = readFixture('params.json');
    expect(validateParamsFile(f, ctx)).toEqual([]);
    expect(Object.keys(f.parameters)).toHaveLength(140);
  });
  it('commute-matrix.json validates', () => expect(validateCommuteMatrix(readFixture('commute-matrix.json'), ctx)).toEqual([]));
  it('events.json has at least one major event', () => {
    const f = readFixture('events.json');
    expect(f.events.some((e: { major: boolean }) => e.major)).toBe(true);
  });
});
