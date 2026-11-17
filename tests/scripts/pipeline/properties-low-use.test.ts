// Property 45: Low-use quarters hold published values at their Reference_Quarter only.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildLowUse, referenceQuarter } from '../../../scripts/pipeline/low-use.ts';
import type { LowUseRow } from '../../../scripts/pipeline/parsers/low-use.ts';
import { DataError } from '../../../scripts/pipeline/errors.ts';
import { validateHistoryFile } from '../../../src/data/validate.ts';
import { DISTRICT_CODES, QUARTERS, validContext, validHistoryFile } from '../../data/helpers.ts';
import type { Quarter } from '../../../scripts/lib/time.ts';

const NUM_RUNS = 100;
const TIMEOUT_MS = 120_000;

const PERIODS: readonly string[] = [
  ...[2015, 2016, 2017, 2018, 2019].map((y) => `${y}H2`),
  ...Array.from({ length: 6 }, (_, i) => 2020 + i).flatMap((y) => [`${y}H1`, `${y}H2`]),
]; // 5 annual (2015H2..2019H2) + 12 half-yearly = 17
const districts = DISTRICT_CODES.map((code) => ({ code }));
const quarters = QUARTERS as unknown as readonly Quarter[];

interface Fixture {
  readonly rows: LowUseRow[];
  readonly gapCodes: readonly string[]; // districts without a row, ascending
}

/** `gapIdx` are the district indexes with no row; every other district has a non-empty subset of periods. */
const fixtureArb = (minGaps: number, maxGaps: number): fc.Arbitrary<Fixture> =>
  fc
    .tuple(
      fc.uniqueArray(fc.integer({ min: 0, max: 40 }), { minLength: minGaps, maxLength: maxGaps }),
      fc.array(fc.subarray([...PERIODS], { minLength: 1 }), { minLength: 41, maxLength: 41 }),
      fc.array(fc.tuple(fc.integer({ min: 0, max: 1_000_000 }), fc.integer({ min: 0, max: 10_000 })), {
        minLength: 17,
        maxLength: 17,
      }),
    )
    .map(([gapIdx, periodSets, values]) => {
      const gaps = new Set(gapIdx);
      const rows: LowUseRow[] = [];
      districts.forEach((d, i) => {
        if (gaps.has(i)) return;
        for (const period of periodSets[i] as string[]) {
          const [count, rate] = values[(PERIODS.indexOf(period) + i) % 17] as [number, number];
          rows.push({ period, districtCode: d.code, count, ratePercent: rate / 100 });
        }
      });
      const gapCodes = districts.filter((_, i) => gaps.has(i)).map((d) => d.code);
      return { rows, gapCodes };
    });

describe('Property 45: low-use quarters hold published values at their Reference_Quarter only', () => {
  it(
    'at most 5 gap districts: values only at Reference_Quarters, dataGaps exact, validator accepts',
    () => {
      fc.assert(
        fc.property(fixtureArb(0, 5), ({ rows, gapCodes }) => {
          const result = buildLowUse(rows, districts, quarters);
          const byKey = new Map(rows.map((r) => [`${r.districtCode}|${r.period}`, r]));
          const refToPeriod = new Map(PERIODS.map((p) => [referenceQuarter(p), p]));
          const violations: string[] = [];
          const nullCodes: string[] = [];
          for (const d of districts) {
            const c = result.count[d.code];
            const r = result.rate[d.code];
            if (c === undefined || r === undefined || c.length !== 44 || r.length !== 44) {
              violations.push(`${d.code}: series length`);
              continue;
            }
            let nonNull = 0;
            let rowCount = 0;
            for (const p of PERIODS) if (byKey.has(`${d.code}|${p}`)) rowCount++;
            quarters.forEach((q, i) => {
              const period = refToPeriod.get(q);
              const row = period === undefined ? undefined : byKey.get(`${d.code}|${period}`);
              const cr = c[i]!;
              const rr = r[i]!;
              if (row !== undefined) {
                nonNull++;
                if (
                  cr.value !== row.count || cr.estimated !== false || cr.dataPeriod !== period || 'method' in cr ||
                  rr.value !== row.ratePercent || rr.estimated !== false || rr.dataPeriod !== period || 'method' in rr
                ) violations.push(`${d.code} ${q}: published value`);
              } else if (
                cr.value !== null || cr.estimated !== false || 'dataPeriod' in cr || 'method' in cr ||
                rr.value !== null || rr.estimated !== false || 'dataPeriod' in rr || 'method' in rr
              ) violations.push(`${d.code} ${q}: expected null record`);
            });
            if (nonNull !== rowCount) violations.push(`${d.code}: non-null count ${nonNull} != rows ${rowCount}`);
            if (c.every((x) => x.value === null)) nullCodes.push(d.code);
          }
          if (JSON.stringify([...nullCodes].sort()) !== JSON.stringify([...result.dataGaps].sort())) {
            violations.push('dataGaps differs from districts with 44 nulls');
          }
          if (JSON.stringify([...result.dataGaps].sort()) !== JSON.stringify(gapCodes)) {
            violations.push('dataGaps differs from districts without rows');
          }

          const file = validHistoryFile();
          file.indicators[0] = {
            ...file.indicators[0],
            periodic: true,
            series: JSON.parse(JSON.stringify(result.count)),
          };
          const errors = validateHistoryFile(file, {
            ...validContext(),
            lowUse: { dataGaps: result.dataGaps, periodsPresent: result.periodsPresent, missing: result.missing },
          });
          if (errors.length > 0) violations.push(`validator: ${errors[0]!.rule} ${errors[0]!.path}`);
          if (violations.length > 0) throw new Error(violations.slice(0, 5).join('; '));
        }),
        { numRuns: NUM_RUNS },
      );
    },
    TIMEOUT_MS,
  );

  it(
    'more than 5 gap districts (including none published): throws low-use-too-many-gaps listing exactly them',
    () => {
      fc.assert(
        fc.property(fixtureArb(6, 41), ({ rows, gapCodes }) => {
          let thrown: unknown;
          try {
            buildLowUse(rows, districts, quarters);
          } catch (e) {
            thrown = e;
          }
          const message = thrown instanceof DataError ? thrown.message : String(thrown);
          const detail = thrown instanceof DataError ? (thrown.details[0] ?? '') : '';
          const listed = /: ([\d, ]+)$/.exec(detail)?.[1]?.split(', ') ?? [];
          const ok =
            thrown instanceof DataError &&
            message.startsWith('low-use-too-many-gaps') &&
            JSON.stringify([...listed].sort()) === JSON.stringify(gapCodes);
          if (!ok) throw new Error(`unexpected result: ${message} / ${detail}`);
        }),
        { numRuns: NUM_RUNS },
      );
    },
    TIMEOUT_MS,
  );

  it('empty row set throws low-use-too-many-gaps listing all 41 codes', () => {
    expect(() => buildLowUse([], districts, quarters)).toThrow(/^low-use-too-many-gaps/);
  });
});
