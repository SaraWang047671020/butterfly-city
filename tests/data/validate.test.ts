import { describe, expect, it } from 'vitest';
import {
  validateDistrictsFile,
  validateHistoryFile,
  validatePolicyTrackFile,
} from '../../src/data/validate.ts';
import type { ValidationError } from '../../src/data/validate.ts';
import {
  DISTRICT_CODES,
  validContext,
  validDistrictsFile,
  validHistoryFile,
  validPolicyTrackFile,
} from './helpers.ts';

const ctx = validContext();
const D0 = DISTRICT_CODES[0] as string;

/** "rule path" strings, for exact assertions. */
const brief = (errors: readonly ValidationError[]): string[] => errors.map((e) => `${e.rule} ${e.path}`);

describe('validateHistoryFile', () => {
  it('accepts a valid file and tags errors with the file name', () => {
    expect(validateHistoryFile(validHistoryFile(), ctx)).toEqual([]);
    const f = validHistoryFile();
    delete f.quarters;
    expect(validateHistoryFile(f, ctx)[0]?.file).toBe('history.json');
  });

  it('reports a missing field with its path', () => {
    const f = validHistoryFile();
    delete f.indicators[1].unit;
    expect(brief(validateHistoryFile(f, ctx))).toEqual(['required $.indicators[1].unit']);
  });

  it('reports a wrong type with the full record path', () => {
    const f = validHistoryFile();
    f.indicators[0].series[D0][17].value = '12';
    expect(brief(validateHistoryFile(f, ctx))).toEqual([`type $.indicators[0].series["${D0}"][17].value`]);
  });

  it('reports an unknown district code and a missing one', () => {
    const f = validHistoryFile();
    f.indicators[0].series['99999999'] = f.indicators[0].series[D0];
    expect(brief(validateHistoryFile(f, ctx))).toEqual(['district-code $.indicators[0].series["99999999"]']);
    const g = validHistoryFile();
    delete g.indicators[0].series[D0];
    expect(brief(validateHistoryFile(g, ctx))).toEqual(['district-code $.indicators[0].series']);
  });

  it('reports an out-of-range, duplicate or mis-sized quarter list', () => {
    const f = validHistoryFile();
    f.quarters[43] = '2026Q1';
    expect(brief(validateHistoryFile(f, ctx))).toEqual(['quarter-span $.quarters[43]']);
    const g = validHistoryFile();
    g.quarters[1] = g.quarters[0];
    expect(brief(validateHistoryFile(g, ctx))).toContain('quarter-span $.quarters[1]');
    const h = validHistoryFile();
    h.indicators[2].series.Taipei.pop();
    expect(brief(validateHistoryFile(h, ctx))).toEqual(['quarter-span $.indicators[2].series["Taipei"]']);
  });

  it('accepts percentages of exactly 0 and 100 and rejects 101', () => {
    const f = validHistoryFile();
    f.indicators[0].kind = 'percent';
    f.indicators[0].series[D0][0].value = 0;
    f.indicators[0].series[D0][1].value = 100;
    for (const rec of Object.values(f.indicators[0].series).flat() as { value: number }[]) {
      if (rec.value > 100) rec.value = 50;
    }
    expect(validateHistoryFile(f, ctx)).toEqual([]);
    f.indicators[0].series[D0][2].value = 101;
    expect(brief(validateHistoryFile(f, ctx))).toEqual([`range $.indicators[0].series["${D0}"][2].value`]);
  });

  it('applies the range rule of each kind', () => {
    const f = validHistoryFile();
    f.indicators[0].series[D0][0].value = -1; // count must be ≥ 0
    f.indicators[1].series[D0][0].value = 0; // positive must be > 0
    expect(brief(validateHistoryFile(f, ctx))).toEqual([
      `range $.indicators[0].series["${D0}"][0].value`,
      `range $.indicators[1].series["${D0}"][0].value`,
    ]);
  });

  it('rejects values with more decimals than declared', () => {
    const f = validHistoryFile();
    f.indicators[1].series[D0][0].value = 400.25;
    expect(brief(validateHistoryFile(f, ctx))).toEqual([`decimals $.indicators[1].series["${D0}"][0].value`]);
  });

  it('rejects NaN and Infinity on the in-memory object', () => {
    const f = validHistoryFile();
    f.indicators[0].series[D0][0].value = Number.NaN;
    f.indicators[0].series[D0][1].value = Number.POSITIVE_INFINITY;
    expect(brief(validateHistoryFile(f, ctx))).toEqual([
      `finite $.indicators[0].series["${D0}"][0].value`,
      `finite $.indicators[0].series["${D0}"][1].value`,
    ]);
  });

  it('accepts null with a missing-reason method and rejects it with an estimation method', () => {
    const f = validHistoryFile();
    f.indicators[1].series[D0][3] = { value: null, estimated: true, method: 'no-data-reason' };
    expect(validateHistoryFile(f, ctx)).toEqual([]);
    f.indicators[1].series[D0][3].method = 'trend-extrapolation';
    expect(brief(validateHistoryFile(f, ctx))).toEqual([`estimate $.indicators[1].series["${D0}"][3].method`]);
    f.indicators[1].series[D0][3].method = 'interp-annual-quarterly';
    expect(brief(validateHistoryFile(f, ctx))).toEqual([`estimate $.indicators[1].series["${D0}"][3].method`]);
  });

  it('checks the estimate rules', () => {
    const f = validHistoryFile();
    f.indicators[0].series[D0][0] = { value: 5, estimated: true }; // no method
    f.indicators[0].series[D0][1] = { value: 5, estimated: false, method: 'trend-extrapolation' };
    f.indicators[0].series[D0][2] = { value: null, estimated: false };
    f.indicators[0].series[D0][3] = { value: 5, estimated: true, method: 'unknown-method' };
    const p = `$.indicators[0].series["${D0}"]`;
    expect(brief(validateHistoryFile(f, ctx))).toEqual([
      `estimate ${p}[0].method`,
      `estimate ${p}[1].method`,
      `no-data ${p}[2].value`,
      `method-ref ${p}[3].method`,
    ]);
  });

  it('checks source references, source entries and credentials', () => {
    const f = validHistoryFile();
    f.indicators[0].sources = ['test/source-a', 'test/missing'];
    f.sources[1].url = 'ftp://example.org/x';
    f.sources[0].url = 'https://example.org/data?api_key=SECRET&x=1';
    f.sources[0].years = [2025, 2015];
    f.sources[1].license = '';
    expect(brief(validateHistoryFile(f, ctx)).sort()).toEqual(
      [
        'source-ref $.indicators[0].sources[1]',
        'source-entry $.sources[1].url',
        'credential $.sources[0].url',
        'source-entry $.sources[0].years',
        'required $.sources[1].license',
      ].sort(),
    );
  });

  it('checks ids, description length and decimals declaration', () => {
    const f = validHistoryFile();
    f.indicators[1].id = 'population';
    f.indicators[1].description = '';
    f.indicators[2].description = 'x'.repeat(201);
    f.indicators[2].decimals = 7;
    expect(brief(validateHistoryFile(f, ctx)).sort()).toEqual(
      ['unique-id $.indicators[1].id', 'description $.indicators[1].description', 'description $.indicators[2].description', 'decimals $.indicators[2].decimals'].sort(),
    );
  });

  it('never throws on garbage', () => {
    const garbage: unknown[] = [null, undefined, 1, 'x', [], {}, { quarters: 5, indicators: {}, sources: 'a', methods: null }, { indicators: [null, 1, { series: [] }] }];
    for (const g of garbage) {
      expect(() => validateHistoryFile(g, ctx)).not.toThrow();
      expect(validateHistoryFile(g, ctx).length).toBeGreaterThan(0);
    }
  });
});

describe('validateDistrictsFile', () => {
  it('accepts a valid file', () => {
    expect(validateDistrictsFile(validDistrictsFile(), ctx)).toEqual([]);
    const f = validDistrictsFile();
    delete f.districts;
    expect(validateDistrictsFile(f, ctx)[0]?.file).toBe('districts.json');
  });

  it('reports a missing field and a wrong type', () => {
    const f = validDistrictsFile();
    delete f.districts[3].name;
    f.districts[4].areaKm2 = '5';
    expect(brief(validateDistrictsFile(f, ctx))).toEqual(['required $.districts[3].name', 'type $.districts[4].areaKm2']);
  });

  it('reports an unknown district code and a missing one', () => {
    const f = validDistrictsFile();
    f.districts[5].code = '99999999';
    expect(brief(validateDistrictsFile(f, ctx))).toEqual(['district-code $.districts[5].code', 'district-code $.districts']);
  });

  it('rejects 40 districts', () => {
    const f = validDistrictsFile();
    f.districts.splice(10, 1);
    const errors = validateDistrictsFile(f, ctx);
    expect(brief(errors)).toContain('district-code $.districts');
    expect(errors[0]?.message).toContain('expected 41');
  });

  it('requires ascending order', () => {
    const f = validDistrictsFile();
    [f.districts[1], f.districts[2]] = [f.districts[2], f.districts[1]];
    expect(brief(validateDistrictsFile(f, ctx))).toEqual(['district-code $.districts[2].code']);
  });

  it('checks the city, area and decimals', () => {
    const f = validDistrictsFile();
    f.districts[0].city = 'Keelung';
    f.districts[1].areaKm2 = 0;
    f.districts[2].areaKm2 = 1.234;
    expect(brief(validateDistrictsFile(f, ctx))).toEqual([
      'type $.districts[0].city',
      'range $.districts[1].areaKm2',
      'decimals $.districts[2].areaKm2',
    ]);
  });

  it('puts the centroid inside the bounding box (out-of-range centroid fails)', () => {
    const f = validDistrictsFile();
    f.districts[0].centroid = [130, 25];
    expect(brief(validateDistrictsFile(f, ctx))).toEqual(['centroid $.districts[0].centroid']);
    const g = validDistrictsFile();
    g.districts[0].centroid = [121.000001, 24.9];
    expect(brief(validateDistrictsFile(g, ctx))).toContain('decimals $.districts[0].centroid[0]');
  });

  it('checks geometry type, closure, winding and coordinate precision', () => {
    const base = '$.districts[0].geometry';
    const f = validDistrictsFile();
    f.districts[0].geometry.coordinates[0].reverse(); // counterclockwise exterior
    expect(brief(validateDistrictsFile(f, ctx))).toEqual([`winding ${base}.coordinates[0]`]);

    const g = validDistrictsFile();
    g.districts[0].geometry.coordinates[0][4] = [0, 0];
    expect(brief(validateDistrictsFile(g, ctx))).toContain(`ring ${base}.coordinates[0]`);

    const h = validDistrictsFile();
    h.districts[0].geometry.coordinates[0].pop();
    h.districts[0].geometry.coordinates[0].pop();
    expect(brief(validateDistrictsFile(h, ctx))).toContain(`ring ${base}.coordinates[0]`);

    const i = validDistrictsFile();
    i.districts[0].geometry.type = 'Point';
    expect(brief(validateDistrictsFile(i, ctx))).toEqual([`type ${base}.type`]);

    const j = validDistrictsFile();
    j.districts[0].geometry.coordinates[0][1][0] = 121.1234567;
    expect(brief(validateDistrictsFile(j, ctx))).toContain(`decimals ${base}.coordinates[0][1][0]`);
  });

  it('accepts a MultiPolygon whose hole is counterclockwise and rejects a clockwise hole', () => {
    const f = validDistrictsFile();
    const outer = f.districts[0].geometry.coordinates[0];
    const hole = [
      [121.01, 24.91],
      [121.02, 24.91],
      [121.02, 24.92],
      [121.01, 24.92],
      [121.01, 24.91],
    ]; // counterclockwise
    f.districts[0].geometry = { type: 'MultiPolygon', coordinates: [[outer, hole]] };
    expect(validateDistrictsFile(f, ctx)).toEqual([]);
    hole.reverse();
    expect(brief(validateDistrictsFile(f, ctx))).toEqual(['winding $.districts[0].geometry.coordinates[0][1]']);
  });

  it('checks provenance and source references', () => {
    const f = validDistrictsFile();
    f.provenance.name.sources = ['test/unknown'];
    f.provenance.areaKm2.method = 'nope';
    expect(brief(validateDistrictsFile(f, ctx))).toEqual([
      'source-ref $.provenance.name.sources[0]',
      'method-ref $.provenance.areaKm2.method',
    ]);
  });

  it('never throws on garbage', () => {
    const garbage: unknown[] = [null, 3, [], {}, { districts: [null, 5, { geometry: { type: 'Polygon', coordinates: [[1, [2]]] } }] }];
    for (const g of garbage) {
      expect(() => validateDistrictsFile(g, ctx)).not.toThrow();
      expect(validateDistrictsFile(g, ctx).length).toBeGreaterThan(0);
    }
  });
});

describe('validatePolicyTrackFile', () => {
  it('accepts a valid file', () => {
    expect(validatePolicyTrackFile(validPolicyTrackFile(), ctx)).toEqual([]);
    const f = validPolicyTrackFile();
    delete f.policySeries;
    expect(validatePolicyTrackFile(f, ctx)[0]?.file).toBe('policy-track.json');
  });

  it('reports a missing field and a wrong type', () => {
    const f = validPolicyTrackFile();
    delete f.policySeries[2].unit;
    f.policySeries[0].series[D0][5].value = 'x';
    expect(brief(validatePolicyTrackFile(f, ctx))).toEqual([
      `type $.policySeries[0].series["${D0}"][5].value`,
      'required $.policySeries[2].unit',
    ]);
  });

  it('reports an unknown district or city code', () => {
    const f = validPolicyTrackFile();
    f.policySeries[0].series['99999999'] = f.policySeries[0].series[D0];
    f.policySeries[1].series.Keelung = f.policySeries[1].series.Taipei;
    expect(brief(validatePolicyTrackFile(f, ctx))).toEqual([
      'district-code $.policySeries[0].series["99999999"]',
      'district-code $.policySeries[1].series["Keelung"]',
    ]);
  });

  it('reports an out-of-range quarter', () => {
    const f = validPolicyTrackFile();
    f.quarters[0] = '2014Q4';
    expect(brief(validatePolicyTrackFile(f, ctx))).toEqual(['quarter-span $.quarters[0]']);
  });

  it('requires exactly the expected policy series, a valid tool and unique ids', () => {
    const f = validPolicyTrackFile();
    f.policySeries.pop();
    f.policySeries[0].tool = 'parks';
    f.policySeries[1].id = 'population';
    f.policySeries[2].id = 'extraSeries';
    expect(brief(validatePolicyTrackFile(f, ctx)).sort()).toEqual(
      [
        'tool $.policySeries[0].tool',
        'unique-id $.policySeries[1].id',
        'policy-series-set $.policySeries[1].id',
        'policy-series-set $.policySeries[2].id',
        'policy-series-set $.policySeries', // three ids are missing: the popped, the renamed twice
        'policy-series-set $.policySeries',
        'policy-series-set $.policySeries',
      ].sort(),
    );
  });

  it('checks Track_Record source, estimate and null rules', () => {
    const f = validPolicyTrackFile();
    const s = f.policySeries[1].series.Taipei;
    s[0] = { value: 1, source: 'test/nowhere', estimated: false };
    s[1] = { value: 1, source: 'test/source-a', estimated: true };
    s[2] = { value: 1, source: 'test/source-a', estimated: false, method: 'trend-extrapolation' };
    s[3] = { value: null, source: 'test/source-a', estimated: true, method: 'no-data-reason' };
    s[4] = { value: 1, source: 'test/source-a', estimated: true, method: 'trend-extrapolation' };
    const p = '$.policySeries[1].series["Taipei"]';
    expect(brief(validatePolicyTrackFile(f, ctx))).toEqual([
      `track-source ${p}[0].source`,
      `estimate ${p}[1].method`,
      `estimate ${p}[2].method`,
      `type ${p}[3].value`,
    ]);
  });

  it('checks the range of percentages, accepting exactly 0 and 100', () => {
    const f = validPolicyTrackFile();
    f.policySeries[4].series.Taipei[0].value = 0;
    f.policySeries[5].series.Taipei[0].value = 100;
    expect(validatePolicyTrackFile(f, ctx)).toEqual([]);
    f.policySeries[5].series.Taipei[1].value = 100.5;
    expect(brief(validatePolicyTrackFile(f, ctx))).toEqual(['range $.policySeries[5].series["Taipei"][1].value']);
  });

  it('requires the lowest-tier rate not to exceed the highest-tier rate', () => {
    const f = validPolicyTrackFile();
    f.policySeries[4].series['New Taipei'][7].value = 4;
    expect(brief(validatePolicyTrackFile(f, ctx))).toEqual(['rate-order $.policySeries[4].series["New Taipei"][7].value']);
  });

  it('rejects credentials in source URLs', () => {
    const f = validPolicyTrackFile();
    f.sources[0].url = 'https://example.org/x?token=abc';
    expect(brief(validatePolicyTrackFile(f, ctx))).toEqual(['credential $.sources[0].url']);
  });

  it('never throws on garbage', () => {
    const garbage: unknown[] = [null, 'x', [], {}, { policySeries: [1, { level: 'city', series: [] }], sources: [null], methods: [[]] }];
    for (const g of garbage) {
      expect(() => validatePolicyTrackFile(g, ctx)).not.toThrow();
      expect(validatePolicyTrackFile(g, ctx).length).toBeGreaterThan(0);
    }
  });
});
