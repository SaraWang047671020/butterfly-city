// Home_Rent_File (play-loop task 6.4): the premium by floor-area band, the city fallback, the committed file, and the
// Character's rent with the premium.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { homePremiumOf, validateHomeRentFile, type HomeRentFile } from '../../src/data/character-loader.ts';
import { characterNumbers } from '../../src/game/life/numbers.ts';
import { bandIndex, homeRentFileOf, MIN_RECORDS } from '../../scripts/story/home-rent.ts';
import type { LvrRecord } from '../../scripts/pipeline/parsers/lvr.ts';

const lease = (district: string, area: number, rent: number): LvrRecord =>
  ({ id: '', kind: 'rental', districtCode: district, quarter: '2020Q1', target: '', use: '住家用', unitPrice: 0, totalPrice: 0, rent, area }) as LvrRecord;

describe('homeRentFileOf', () => {
  it('divides the median rent per m² of a band by the median of all leases of the district', () => {
    const small = Array.from({ length: MIN_RECORDS }, () => lease('A', 20, 10_000)); // 500 per m²
    const big = Array.from({ length: MIN_RECORDS + 1 }, () => lease('A', 100, 25_000)); // 250 per m²
    const f = homeRentFileOf([...small, ...big], [{ code: 'A', city: 'Taipei' }]);
    // all leases: 61 values, median 250 → small band 500 / 250 = 2
    expect(f.premium['A']?.[0]).toBe(2);
    expect(f.premium['A']?.[3]).toBe(1);
    expect(f.fallback['A']).toEqual([false, true, true, false]);
  });

  it('uses the city premium of a band when the district has too few leases', () => {
    const city = [...Array.from({ length: MIN_RECORDS }, () => lease('A', 20, 9_000)), ...Array.from({ length: MIN_RECORDS + 1 }, () => lease('A', 100, 30_000))];
    const f = homeRentFileOf([...city, lease('B', 20, 1)], [{ code: 'A', city: 'Taipei' }, { code: 'B', city: 'Taipei' }]);
    expect(f.fallback['B']?.[0]).toBe(true);
    expect(f.premium['B']?.[0]).toBeGreaterThan(1);
  });

  it('puts an area in the first band whose limit is at or above it', () => {
    expect(bandIndex(20)).toBe(0);
    expect(bandIndex(40)).toBe(0);
    expect(bandIndex(41)).toBe(1);
    expect(bandIndex(500)).toBe(3);
  });
});

describe('committed home-rent.json', () => {
  it('passes the validator for the 41 districts and prices small homes above the district mean', () => {
    const districts = JSON.parse(fs.readFileSync('public/data/districts.json', 'utf8')) as { districts: { code: string }[] };
    const v = validateHomeRentFile(JSON.parse(fs.readFileSync('public/data/home-rent.json', 'utf8')), new Set(districts.districts.map((d) => d.code)));
    expect(v.ok ? 'ok' : v.error).toBe('ok');
    if (!v.ok) return;
    for (const p of Object.values(v.value.premium)) expect(p[0]).toBeGreaterThan(1);
  });
});

describe('Character rent with the premium', () => {
  it('multiplies the district rent per m² by the premium of the home size', () => {
    const file: HomeRentFile = { schemaVersion: 1, bands: [{ id: 'upTo40', maxArea: 40 }, { id: 'over40', maxArea: null }], premium: { A: [1.7, 1] } };
    const n = characterNumbers(
      { home: 'A', tenure: 'renting', married: false, members: [{ kind: 'self', occupation: 'x', workCode: null, pronouns: 'she', look: { body: 'a', hair: 'short', colour: 'teal' } }] },
      2015,
      290,
      { industryOf: new Map([['x', 'Q']]), earnings: { Q: { '2015': 50_000 } }, dwellingSize: new Map([[1, 20]]), commute: { codes: [], minutes: [] }, homePremium: homePremiumOf(file) },
    );
    expect(n.rent).toBeCloseTo(290 * 1.7 * 20); // 9,860
  });
});
