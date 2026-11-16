import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DISTRICTS } from '../../../scripts/lib/districts.ts';
import type { Quarter } from '../../../scripts/lib/time.ts';
import { buildSocialHousing, dedupeProjects } from '../../../scripts/pipeline/indicators/social-housing.ts';
import type { SocialHousingDetail, SocialHousingProject } from '../../../scripts/pipeline/parsers/social-housing.ts';
import { PORTAL_CITY_LETTERS, PORTAL_TOWN_CODES } from '../../../scripts/pipeline/tables/social-housing-towns.ts';

const QUARTERS: Quarter[] = [];
for (let y = 2015; y <= 2025; y++) for (const q of [1, 2, 3, 4] as const) QUARTERS.push(`${y}Q${q}`);

/** Portal CityCode + TownCode for each of the 41 districts, inverted from the portal table. */
const PORTAL_OF = new Map<string, { cityCode: string; townCode: string }>();
for (const d of DISTRICTS) {
  for (const [key, name] of Object.entries(PORTAL_TOWN_CODES)) {
    const cityCode = key.slice(0, 1);
    if (name === d.name && PORTAL_CITY_LETTERS[cityCode] === d.city) {
      PORTAL_OF.set(d.code, { cityCode, townCode: key.slice(1) });
    }
  }
}

interface Spec {
  guid: string;
  status: string;
  district: number;
  year: number;
  month: number;
  day: number;
  units: number;
}

const specArb = fc.record({
  status: fc.constantFrom('已完工', '已完工', '興建中', '規劃中'),
  district: fc.integer({ min: 0, max: 40 }),
  year: fc.integer({ min: 1971, max: 2025 }),
  month: fc.integer({ min: 1, max: 12 }),
  day: fc.integer({ min: 1, max: 28 }),
  units: fc.integer({ min: 1, max: 600 }),
});
const specsArb = fc.array(specArb, { maxLength: 40 }).map((rows): Spec[] => rows.map((r, i) => ({ ...r, guid: `G${i}` })));

function toProject(s: Spec): SocialHousingProject {
  const roc = String(s.year - 1911).padStart(3, '0');
  return {
    guid: s.guid,
    status: s.status,
    householdNum: s.units,
    strStartDate: '',
    strEndDate: `${roc}/${String(s.month).padStart(2, '0')}/${String(s.day).padStart(2, '0')}`,
    city: DISTRICTS[s.district]!.city,
    file: 'f.json',
  };
}

function detailsOf(specs: Spec[]): Map<string, SocialHousingDetail> {
  const m = new Map<string, SocialHousingDetail>();
  for (const s of specs) {
    const p = PORTAL_OF.get(DISTRICTS[s.district]!.code);
    // Districts the portal table does not list (no project uses them) are resolved by their direct 8-digit code.
    m.set(s.guid, p === undefined ? { guid: s.guid, cityCode: '', townCode: DISTRICTS[s.district]!.code } : { guid: s.guid, ...p });
  }
  return m;
}

const quarterOf = (month: number): number => Math.ceil(month / 3);

describe('portal mapping fixture', () => {
  it('maps every table entry to a district', () => {
    expect(PORTAL_OF.size).toBe(Object.keys(PORTAL_TOWN_CODES).length);
  });
});

describe('data-pipeline properties: social housing', () => {
  // Feature: data-pipeline, Property 18: Social housing completions, stock and deduplication
  // Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.7
  it('Property 18: completions, stock and deduplication', () => {
    fc.assert(
      fc.property(specsArb, fc.array(fc.nat(), { maxLength: 15 }), (specs, dupPicks) => {
        const projects = specs.map(toProject);
        const details = detailsOf(specs);
        const result = buildSocialHousing(projects, details, DISTRICTS, QUARTERS);

        // Independent expectation: only completed projects, by end-date quarter.
        const expectedCompletions = new Map<string, number[]>();
        const expectedBase = new Map<string, number>();
        for (const d of DISTRICTS) {
          expectedCompletions.set(d.code, QUARTERS.map(() => 0));
          expectedBase.set(d.code, 0);
        }
        for (const s of specs) {
          if (s.status !== '已完工') continue;
          const code = DISTRICTS[s.district]!.code;
          if (s.year < 2015) expectedBase.set(code, expectedBase.get(code)! + s.units);
          else expectedCompletions.get(code)![(s.year - 2015) * 4 + quarterOf(s.month) - 1]! += s.units;
        }

        for (const d of DISTRICTS) {
          const comp = result.completions[d.code]!;
          const stock = result.stock[d.code]!;
          const ok = comp.length === 44 && stock.length === 44;
          expect(ok).toBe(true);
          expect(comp.map((r) => r.value)).toEqual(expectedCompletions.get(d.code));
          let bad = '';
          for (let i = 0; i < 44; i++) {
            const prev = i === 0 ? expectedBase.get(d.code)! : stock[i - 1]!.value!;
            if (comp[i]!.value! < 0) bad = `negative completions ${d.code} ${i}`;
            if (comp[i]!.estimated || stock[i]!.estimated) bad = `estimated ${d.code} ${i}`;
            if (stock[i]!.value! < prev) bad = `stock decreased ${d.code} ${i}`;
            if (stock[i]!.value! - prev !== comp[i]!.value) bad = `stock delta != completions ${d.code} ${i}`;
          }
          expect(bad).toBe('');
          expect(stock[0]!.value).toBe(expectedBase.get(d.code)! + comp[0]!.value!);
        }

        // Deduplication: extra copies of any projects (same guid) change nothing.
        // Applied in buildSocialHousing (via resolveProjectDistricts) and in dedupeProjects (the loader helper).
        const copies = dupPicks.filter(() => projects.length > 0).map((n) => {
          const p = projects[n % projects.length]!;
          return { ...p, householdNum: p.householdNum + 1000 }; // later copy must lose to the first one
        });
        const withDupes = [...projects, ...copies];
        expect(dedupeProjects(withDupes)).toEqual(projects);
        const again = buildSocialHousing(withDupes, details, DISTRICTS, QUARTERS);
        expect(again.completions).toEqual(result.completions);
        expect(again.stock).toEqual(result.stock);
      }),
      { numRuns: 100 },
    );
  }, 30000);
});
