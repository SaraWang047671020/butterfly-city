/**
 * Fixed reference-district assignment for districts with fewer than 30 qualifying rental records
 * (Requirements 9.4 to 9.8, Decision D7). Not a nearest-district calculation at build time.
 *
 * Entries are keyed by the official district code of the thin district. `relation` records which rule of
 * Requirement 9.7 the entry relies on:
 *   - `borders`: the reference shares a border with the district.
 *   - `two-borders-away`: second rule. Allowed only when no bordering district of the same city has 30 records;
 *     the reference then borders a district that borders the district. SOURCES.md says that the second rule was used.
 *
 * `expectedRatioMethod` is informational (the design table). The method actually used is derived at build time
 * by `ratioMethodFor`: the rent-statistics ratio when both districts appear in the MOI statistics, else the
 * sale-price ratio (Requirement 9.5).
 */
import { DataError } from '../errors.ts';

export type RatioMethod = 'rent-statistics' | 'sale-price';
export type ReferenceRelation = 'borders' | 'two-borders-away';

export interface RentReferenceEntry {
  /** District code of the reference district. */
  readonly reference: string;
  readonly relation: ReferenceRelation;
  readonly expectedRatioMethod: RatioMethod;
}

export const RENT_REFERENCE: Readonly<Record<string, RentReferenceEntry>> = {
  '65000190': { reference: '65000180', relation: 'borders', expectedRatioMethod: 'sale-price' }, // Shiding -> Shenkeng
  '65000200': { reference: '65000060', relation: 'two-borders-away', expectedRatioMethod: 'sale-price' }, // Pinglin -> Xindian
  '65000220': { reference: '65000210', relation: 'borders', expectedRatioMethod: 'sale-price' }, // Shimen -> Sanzhi
  '65000240': { reference: '65000120', relation: 'borders', expectedRatioMethod: 'sale-price' }, // Pingxi -> Ruifang
  '65000250': { reference: '65000120', relation: 'borders', expectedRatioMethod: 'sale-price' }, // Shuangxi -> Ruifang
  '65000260': { reference: '65000120', relation: 'borders', expectedRatioMethod: 'rent-statistics' }, // Gongliao -> Ruifang
  '65000290': { reference: '65000060', relation: 'borders', expectedRatioMethod: 'sale-price' }, // Wulai -> Xindian
};

/** Minimum qualifying rental records for a district to use its own records. */
export const MIN_RENT_RECORDS = 30;

/** The ratio method of a district: statistics when both districts are in the MOI rent statistics. */
export function ratioMethodFor(district: string, reference: string, statsDistricts: ReadonlySet<string>): RatioMethod {
  return statsDistricts.has(district) && statsDistricts.has(reference) ? 'rent-statistics' : 'sale-price';
}

export interface UsedReference {
  readonly district: string;
  readonly reference: string;
  readonly relation: ReferenceRelation;
  /** True when the second rule of Requirement 9.7 applies. */
  readonly secondRule: boolean;
  /** Qualifying rental records of the district. */
  readonly recordCount: number;
}

export interface ReferenceCheckResult {
  /** Entries for districts below the minimum, in district-code order. */
  readonly used: readonly UsedReference[];
  /** Notes for table entries whose district has enough records (entry unused). */
  readonly notes: readonly string[];
}

export interface ReferenceCheckInput {
  /** Qualifying rental records 2015Q1-2025Q4 per district code; a missing code counts as 0. */
  readonly recordCounts: ReadonlyMap<string, number>;
  /** District code -> codes of the districts that share a border with it. */
  readonly adjacency: ReadonlyMap<string, readonly string[]>;
  /** Every district with its city. */
  readonly districts: readonly { readonly code: string; readonly city: string }[];
  readonly table?: Readonly<Record<string, RentReferenceEntry>>;
  readonly minRecords?: number;
}

/**
 * Checks the table against the record counts and adjacency (Requirements 9.7 and 9.8). Throws DataError
 * naming the district and the condition it breaks.
 */
export function checkReferenceTable(input: ReferenceCheckInput): ReferenceCheckResult {
  const { recordCounts, adjacency, districts } = input;
  const table = input.table ?? RENT_REFERENCE;
  const min = input.minRecords ?? MIN_RENT_RECORDS;
  const cityOf = new Map(districts.map((d) => [d.code, d.city]));
  const count = (code: string) => recordCounts.get(code) ?? 0;
  const neighbours = (code: string) => adjacency.get(code) ?? [];
  function fail(district: string, condition: string, detail: string): never {
    throw new DataError(`rent-reference-${condition}`, district, [`district ${district}: ${detail}`]);
  }

  for (const code of Object.keys(table)) {
    if (!cityOf.has(code)) fail(code, 'unknown-district', 'the table has an entry for a code that is not one of the 41 districts');
  }

  const used: UsedReference[] = [];
  const notes: string[] = [];
  for (const d of [...districts].sort((a, b) => (a.code < b.code ? -1 : 1))) {
    const records = count(d.code);
    const entry = table[d.code];
    if (records >= min) {
      if (entry) notes.push(`reference entry for ${d.code} is unused: ${records} qualifying records (at least ${min})`);
      continue;
    }
    if (!entry) {
      fail(d.code, 'missing-entry', `${records} qualifying records (below ${min}) and no entry in the reference table`);
    }
    const ref = entry.reference;
    if (cityOf.get(ref) !== d.city) fail(d.code, 'same-city', `reference ${ref} is not in ${d.city}`);
    if (count(ref) < min) fail(d.code, 'reference-records', `reference ${ref} has ${count(ref)} qualifying records (below ${min})`);
    const bordering = neighbours(d.code);
    if (entry.relation === 'borders') {
      if (!bordering.includes(ref)) fail(d.code, 'border', `reference ${ref} does not share a border with the district`);
    } else {
      const enough = bordering.filter((n) => cityOf.get(n) === d.city && count(n) >= min);
      if (enough.length > 0) {
        fail(d.code, 'second-rule', `bordering district ${enough[0]} of the same city has at least ${min} records, so the second rule does not apply`);
      }
      if (!bordering.some((n) => neighbours(n).includes(ref))) {
        fail(d.code, 'two-borders-away', `reference ${ref} does not share a border with any district that borders the district`);
      }
    }
    used.push({ district: d.code, reference: ref, relation: entry.relation, secondRule: entry.relation === 'two-borders-away', recordCount: records });
  }
  return { used, notes };
}
