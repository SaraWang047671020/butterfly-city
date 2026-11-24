/**
 * Home_Rent_File (play-loop task 6.4, user decision 2026-11-24, option 1): how the rent per m² of a home of a given
 * size compares with the district rent per m² of the Engine, from the real-price registration rentals.
 *
 * The district `rent` of history.json is built from the median rent per m² of all qualifying residential leases
 * (scripts/pipeline/indicators/rent.ts). Small homes rent for more per m², so the player's Character (20 m² single,
 * 33 m² couple) was priced too low. For each district and floor-area band:
 *
 *   p(r)              = rent / area                                    per qualifying lease, 2015Q1 to 2025Q4
 *   premium(d, band)  = median{ p in d and band } / median{ p in d }  all quarters pooled
 *
 * A district with fewer than MIN_RECORDS leases in a band uses the city's premium of that band (same formula over
 * the city). The Character's rent per m² is the Engine's district rent per m² times the premium of its home's band,
 * so a policy still moves the Character's rent. The band is chosen by floor area as registered (建物總面積, which
 * includes shared areas). The rental type column (出租型態) is not used because the files before 2021 do not have it.
 */
import type { LvrRecord } from '../pipeline/parsers/lvr.ts';

export const HOME_BANDS: readonly { readonly id: string; readonly maxArea: number }[] = [
  { id: 'upTo40', maxArea: 40 },
  { id: 'upTo60', maxArea: 60 },
  { id: 'upTo90', maxArea: 90 },
  { id: 'over90', maxArea: Number.POSITIVE_INFINITY },
];
export const MIN_RECORDS = 30;

export interface HomeRentFile {
  readonly schemaVersion: 1;
  readonly source: { readonly citation: string; readonly url: string; readonly license: string };
  readonly method: string;
  readonly bands: readonly { readonly id: string; readonly maxArea: number | null }[];
  /** District_Code → premium per band (same order as `bands`), and whether it fell back to the city. */
  readonly premium: Readonly<Record<string, readonly number[]>>;
  readonly fallback: Readonly<Record<string, readonly boolean[]>>;
  readonly records: number;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function bandIndex(area: number): number {
  const i = HOME_BANDS.findIndex((b) => area <= b.maxArea);
  return i < 0 ? HOME_BANDS.length - 1 : i;
}

const round3 = (x: number): number => Math.round(x * 1000) / 1000;

/** Builds the file from qualifying rental records and the district list (code → city). */
export function homeRentFileOf(records: readonly LvrRecord[], districts: readonly { readonly code: string; readonly city: string }[]): HomeRentFile {
  const byDistrict = new Map<string, number[][]>();
  const byCity = new Map<string, number[][]>();
  const cityOf = new Map(districts.map((d) => [d.code, d.city]));
  const empty = () => HOME_BANDS.map(() => [] as number[]);
  let count = 0;
  for (const r of records) {
    if (r.kind !== 'rental' || r.districtCode === undefined || !(r.area > 0) || !(r.rent > 0)) continue;
    const city = cityOf.get(r.districtCode);
    if (city === undefined) continue;
    const p = r.rent / r.area;
    const b = bandIndex(r.area);
    if (!byDistrict.has(r.districtCode)) byDistrict.set(r.districtCode, empty());
    if (!byCity.has(city)) byCity.set(city, empty());
    byDistrict.get(r.districtCode)![b]!.push(p);
    byCity.get(city)![b]!.push(p);
    count += 1;
  }
  const premiumOf = (bands: number[][] | undefined): (number | null)[] => {
    if (bands === undefined) return HOME_BANDS.map(() => null);
    const all = bands.flat();
    if (all.length === 0) return HOME_BANDS.map(() => null);
    const base = median(all);
    return bands.map((xs) => (xs.length >= MIN_RECORDS ? median(xs) / base : null));
  };
  const cityPremium = new Map([...byCity.entries()].map(([c, bands]) => [c, premiumOf(bands)]));
  const premium: Record<string, number[]> = {};
  const fallback: Record<string, boolean[]> = {};
  for (const d of districts) {
    const own = premiumOf(byDistrict.get(d.code));
    const city = cityPremium.get(d.city) ?? HOME_BANDS.map(() => null);
    premium[d.code] = own.map((v, i) => round3(v ?? city[i] ?? 1));
    fallback[d.code] = own.map((v) => v === null);
  }
  return {
    schemaVersion: 1,
    source: {
      citation: 'MOI Department of Land Administration, real-price registration, rentals (實價登錄 租賃), data.gov.tw 25118',
      url: 'https://data.gov.tw/dataset/25118',
      license: 'Open Government Data License, version 1.0',
    },
    method: `Rent per m² of qualifying residential leases 2015Q1 to 2025Q4 (the filter of the rent indicator). For each district and floor-area band (registered total floor area, shared areas included), the median rent per m² of the band divided by the median rent per m² of all leases of the district. Bands with fewer than ${MIN_RECORDS} leases use the city's ratio of that band.`,
    bands: HOME_BANDS.map((b) => ({ id: b.id, maxArea: Number.isFinite(b.maxArea) ? b.maxArea : null })),
    premium,
    fallback,
    records: count,
  };
}

export function serializeHomeRentFile(f: HomeRentFile): string {
  return `${JSON.stringify(f, null, 2)}\n`;
}
