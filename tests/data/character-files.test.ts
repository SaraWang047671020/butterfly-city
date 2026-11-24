// Character_File and Wage_File (play-loop Requirements 2.3 to 2.5, 3.4, 11.1, 12.4): the committed files pass the
// validators, the wage parser reads the DGBAS XML shape, and the validators reject the documented problems.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { localTextProblem, validateCharacterFile, validateWageFile } from '../../src/data/character-loader.ts';
import { parseWagesXml, wageFileOf, WAGE_INDUSTRIES } from '../../scripts/story/wages.ts';
import {
  BANNED_TERMS_EXEMPT_FILE,
  BANNED_TERMS_FILE,
  checkBannedTerms,
  parseTermList,
} from '../../scripts/pipeline/banned-terms.ts';

const districts = JSON.parse(fs.readFileSync('public/data/districts.json', 'utf8')) as { districts: { code: string }[] };
const codes = new Set(districts.districts.map((d) => d.code));
const wages = JSON.parse(fs.readFileSync('public/data/wages.json', 'utf8')) as unknown;
const characters = JSON.parse(fs.readFileSync('data/config/characters.json', 'utf8')) as Record<string, unknown>;

describe('committed files', () => {
  it('wages.json has every industry of the Character_File for 2015 to 2025', () => {
    const w = validateWageFile(wages);
    expect(w.ok ? 'ok' : w.error).toBe('ok');
  });

  it('characters.json passes the validator with the wage industries', () => {
    const w = validateWageFile(wages);
    if (!w.ok) throw new Error(w.error);
    const c = validateCharacterFile(characters, codes, new Set(Object.keys(w.value.earnings)));
    expect(c.ok ? 'ok' : c.error).toBe('ok');
  });

  it('public/data/characters.json is a copy of data/config/characters.json', () => {
    expect(fs.readFileSync('public/data/characters.json', 'utf8')).toBe(fs.readFileSync('data/config/characters.json', 'utf8'));
  });

  it('the texts contain no banned term in either language (play-loop 12.7)', () => {
    const terms = parseTermList(fs.readFileSync(BANNED_TERMS_FILE, 'utf8'));
    const exempt = parseTermList(fs.readFileSync(BANNED_TERMS_EXEMPT_FILE, 'utf8'));
    const texts: string[] = [];
    const walk = (n: unknown): void => {
      if (typeof n === 'object' && n !== null && 'en' in n) texts.push(String((n as { en: unknown }).en), String((n as { 'zh-Hant'?: unknown })['zh-Hant'] ?? ''));
      else if (Array.isArray(n)) n.forEach(walk);
      else if (typeof n === 'object' && n !== null) Object.values(n).forEach(walk);
    };
    walk(characters);
    expect(texts.length).toBeGreaterThan(50);
    expect(texts.flatMap((t) => checkBannedTerms(t, terms, exempt).map((h) => h.term))).toEqual([]);
  });
});

describe('validators', () => {
  it('reject a text without Chinese or with different Placeholders', () => {
    expect(localTextProblem({ en: 'a', 'zh-Hant': '' })).toMatch(/Chinese/);
    expect(localTextProblem({ en: '{a} x', 'zh-Hant': '{b} x' })).toMatch(/Placeholders/);
    expect(localTextProblem({ en: '{a}', 'zh-Hant': '{a}' })).toBeNull();
  });

  it('reject an occupation whose industry has no wages', () => {
    const w = validateWageFile(wages);
    if (!w.ok) throw new Error(w.error);
    const bad = { ...characters, occupations: (characters['occupations'] as Record<string, unknown>[]).map((o, i) => (i === 0 ? { ...o, industry: 'Z' } : o)) };
    const r = validateCharacterFile(bad, codes, new Set(Object.keys(w.value.earnings)));
    expect(r.ok ? '' : r.error).toMatch(/industry Z/);
  });

  it('reject a missing wage year', () => {
    const w = wages as { earnings: Record<string, Record<string, number>> };
    const first = Object.keys(w.earnings)[0]!;
    const { ['2019']: _drop, ...rest } = w.earnings[first]!;
    const r = validateWageFile({ ...w, earnings: { ...w.earnings, [first]: rest } });
    expect(r.ok ? '' : r.error).toMatch(/2019/);
  });
});

describe('DGBAS 9663 parser', () => {
  const record = (period: string, v: string) =>
    `<每人每月經常性薪資><年月別_Year_and_month>${period}</年月別_Year_and_month>${Object.values(WAGE_INDUSTRIES)
      .map((i) => `<${i.zh}_${i.field}_金額_新臺幣元>${v}</${i.zh}_${i.field}_金額_新臺幣元>`)
      .join('')}</每人每月經常性薪資>`;

  it('reads year and month records, removes revision marks and treats "-" as no value', () => {
    const xml = `<DataCollection>${record('2015', '1000Ⓡ')}${record('201501', '-')}</DataCollection>`;
    const r = parseWagesXml(xml, 'x.xml');
    expect(r.map((x) => x.period)).toEqual(['2015', '201501']);
    expect(r[0]?.values['C']).toBe(1000);
    expect(r[1]?.values['C']).toBeNull();
  });

  it('uses the year record and stops when it is far from the monthly mean', () => {
    const months = (y: number, v: number) => Array.from({ length: 12 }, (_, m) => record(`${y}${String(m + 1).padStart(2, '0')}`, String(v))).join('');
    const years = (yearValue: number) => Array.from({ length: 11 }, (_, i) => record(String(2015 + i), String(yearValue)) + months(2015 + i, 1000)).join('');
    expect(wageFileOf(parseWagesXml(`<D>${years(1003)}</D>`, 'x'), 'x').earnings['C']?.['2015']).toBe(1003);
    expect(() => wageFileOf(parseWagesXml(`<D>${years(1100)}</D>`, 'x'), 'x')).toThrow(/year record differs/);
  });
});
