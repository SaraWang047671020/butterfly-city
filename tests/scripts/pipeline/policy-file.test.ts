import { describe, expect, it } from 'vitest';
import { DISTRICTS } from '../../../scripts/lib/districts.ts';
import { createContext, memoryLogger } from '../../../scripts/pipeline/context.ts';
import { DataError } from '../../../scripts/pipeline/errors.ts';
import { MemoryRawReader } from '../../../scripts/pipeline/raw-reader.ts';
import { buildPolicyTrackFile, policyFileStep } from '../../../scripts/pipeline/policy-file.ts';
import { estimatedRecord, observed, type PolicyTrackSeries } from '../../../scripts/pipeline/policy/track.ts';
import { POLICY_SERIES_SPECS } from '../../../scripts/pipeline/registry/indicators.ts';
import { METHOD_REGISTRY } from '../../../scripts/pipeline/registry/methods.ts';
import { SOURCE_REGISTRY } from '../../../scripts/pipeline/registry/sources.ts';
import { createState } from '../../../scripts/pipeline/run.ts';
import { quartersBetween } from '../../../scripts/lib/time.ts';
import type { TrackRecord } from '../../../src/types/data-files.ts';

const quarters = quartersBetween();

function fixture(value = 1.23456): PolicyTrackSeries {
  const rec = (source: string, estimated: boolean): TrackRecord[] =>
    quarters.map(() => (estimated ? estimatedRecord(value, source, 'sublease-phase-spread') : observed(value, source)));
  const city = (source: string, estimated = false) => ({ Taipei: rec(source, estimated), 'New Taipei': rec(source, estimated) });
  return {
    socialHousingUnitsStarted: Object.fromEntries(DISTRICTS.map((d) => [d.code, rec('social-housing/nlma-portal', false)])),
    subleaseUnitsMatched: city('policy/moi-b5010', true),
    rentSubsidyHouseholds: city('policy/moi-e3010'),
    rentSubsidyAmountPerHousehold: city('policy/moi-169800'),
    holdingTaxRateLowestTier: city('policy/house-tax-act'),
    holdingTaxRateHighestTier: city('policy/taipei-ordinance'),
    houseTaxRevenue: city('policy/mof-6742'),
    commuterPassPrice: city('policy/trtc-products'),
    commuterPassSubsidy: city('policy/trtc-products'),
    commuterPassesSold: city('policy/taipei-dot-2019'),
  };
}

describe('buildPolicyTrackFile', () => {
  const file = buildPolicyTrackFile(fixture(), quarters);

  it('lists the series in the registry order with unique ids', () => {
    const ids = file.policySeries.map((s) => s.id);
    expect(ids).toEqual(POLICY_SERIES_SPECS.map((s) => s.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(file.schemaVersion).toBe(1);
    expect(file.quarters).toEqual(quarters);
  });

  it('has 41 x 44 district records and 2 x 44 records per city series', () => {
    for (const s of file.policySeries) {
      const keys = Object.keys(s.series);
      expect(keys.length).toBe(s.level === 'district' ? 41 : 2);
      const total = Object.values(s.series).reduce((n, r) => n + r.length, 0);
      expect(total).toBe(s.level === 'district' ? 1804 : 88);
    }
  });

  it('embeds every source and method referenced, in registry order', () => {
    const sourceIds = new Set(file.sources.map((s) => s.id));
    const methodIds = new Set(file.methods.map((m) => m.id));
    for (const s of file.policySeries) {
      for (const id of s.sources) expect(sourceIds.has(id)).toBe(true);
      for (const records of Object.values(s.series)) {
        for (const r of records) {
          expect(sourceIds.has(r.source)).toBe(true);
          if (r.estimated) expect(methodIds.has(r.method)).toBe(true);
        }
      }
    }
    const order = (ids: string[], registry: readonly { id: string }[]) => ids.map((id) => registry.findIndex((e) => e.id === id));
    const si = order(file.sources.map((s) => s.id), SOURCE_REGISTRY);
    expect(si).toEqual([...si].sort((a, b) => a - b));
    expect(file.methods.map((m) => m.id)).toEqual(
      METHOD_REGISTRY.filter((m) => methodIds.has(m.id)).map((m) => m.id),
    );
  });

  it('rounds values to the series decimals and keeps estimated, method and source', () => {
    const rate = file.policySeries.find((s) => s.id === 'holdingTaxRateLowestTier')!;
    expect(Object.values(rate.series)[0]![0]).toEqual({ value: 1.23, source: 'policy/house-tax-act', estimated: false });
    const sublease = file.policySeries.find((s) => s.id === 'subleaseUnitsMatched')!;
    expect(Object.values(sublease.series)[0]![0]).toEqual({
      value: 1,
      source: 'policy/moi-b5010',
      estimated: true,
      method: 'sublease-phase-spread',
    });
  });

  it('throws a DataError when a city series is missing', () => {
    const bad = { ...fixture(), commuterPassPrice: { Taipei: fixture().commuterPassPrice.Taipei } } as unknown as PolicyTrackSeries;
    expect(() => buildPolicyTrackFile(bad, quarters)).toThrow(DataError);
  });

  it('throws a DataError when a district or a quarter is missing', () => {
    const base = fixture();
    const { [DISTRICTS[0]!.code]: _dropped, ...rest } = base.socialHousingUnitsStarted;
    expect(() => buildPolicyTrackFile({ ...base, socialHousingUnitsStarted: rest }, quarters)).toThrow(DataError);
    const short = { ...base.rentSubsidyHouseholds, Taipei: base.rentSubsidyHouseholds.Taipei.slice(1) };
    expect(() => buildPolicyTrackFile({ ...base, rentSubsidyHouseholds: short }, quarters)).toThrow(DataError);
  });

  it('throws a DataError when a record cites a source that is not in the registry', () => {
    const base = fixture();
    const records = [...base.houseTaxRevenue.Taipei];
    records[3] = observed(5, 'policy/does-not-exist');
    expect(() => buildPolicyTrackFile({ ...base, houseTaxRevenue: { ...base.houseTaxRevenue, Taipei: records } }, quarters)).toThrow(DataError);
    records[3] = { value: 5, estimated: false } as unknown as TrackRecord;
    expect(() => buildPolicyTrackFile({ ...base, houseTaxRevenue: { ...base.houseTaxRevenue, Taipei: records } }, quarters)).toThrow(DataError);
  });
});

describe('policyFileStep', () => {
  it('sets state.policyTrackFile from state.policyTrack', () => {
    const ctx = createContext({ reader: new MemoryRawReader({}), logger: memoryLogger() });
    const state = createState();
    state.policyTrack = fixture();
    policyFileStep().run(ctx, state);
    expect(state.policyTrackFile?.policySeries).toHaveLength(10);
  });

  it('throws a DataError without the policy track', () => {
    const ctx = createContext({ reader: new MemoryRawReader({}), logger: memoryLogger() });
    expect(() => policyFileStep().run(ctx, createState())).toThrow(DataError);
  });
});
