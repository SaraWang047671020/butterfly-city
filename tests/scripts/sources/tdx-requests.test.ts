import { describe, expect, it } from 'vitest';
import { stationRequests } from '../../../scripts/sources/stations.ts';
import { timetableRequests } from '../../../scripts/sources/tdx-rail.ts';

const urls = (): string[] => [...timetableRequests(), ...stationRequests()].map((r) => r.url);
const has = (kind: string, op: string): boolean => urls().some((u) => u.includes(`/${kind}/${op}?`));

describe('TDX request builders (no network)', () => {
  it('sends no S2STravelTime or Frequency request for NTDLRT or NTALRT', () => {
    for (const kind of ['S2STravelTime', 'Frequency']) {
      for (const op of ['NTDLRT', 'NTALRT']) expect(has(kind, op)).toBe(false);
    }
  });

  it('requests StationTimeTable for all four operators', () => {
    for (const op of ['TRTC', 'NTMC', 'NTDLRT', 'NTALRT']) expect(has('StationTimeTable', op)).toBe(true);
  });

  it('requests Frequency and S2STravelTime for TRTC and NTMC', () => {
    for (const op of ['TRTC', 'NTMC']) {
      expect(has('Frequency', op)).toBe(true);
      expect(has('S2STravelTime', op)).toBe(true);
    }
  });
});
