// String tests for the UI_Strings_Module (game-ui task 14.2; Requirements 15.4, 19.13, 8.12).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BANNED_TERMS_EXEMPT_FILE,
  BANNED_TERMS_FILE,
  checkBannedTerms,
  parseTermList,
} from '../../scripts/pipeline/banned-terms.ts';
import { SCENARIO_EFFECT_IDS } from '../../src/simulation/params.ts';
import { DISCLOSURE_TEXT, quarterLabel, UI_STRINGS } from '../../src/ui/strings.ts';
import { EN } from '../../src/ui/strings/en.ts';
import { ZH } from '../../src/ui/strings/zh-Hant.ts';

/** Every string of the module with its dotted key (array items get an index). */
function flatten(value: unknown, key: string, out: Array<[string, string]>): Array<[string, string]> {
  if (typeof value === 'string') out.push([key, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => flatten(v, `${key}[${i}]`, out));
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) flatten(v, key === '' ? k : `${key}.${k}`, out);
  }
  return out;
}

const ALL = flatten(UI_STRINGS, '', []);

describe('UI_STRINGS', () => {
  it('contains strings', () => {
    expect(ALL.length).toBeGreaterThan(100);
  });

  it('contains no banned term in either language (15.4, play-loop 12.7)', () => {
    const terms = parseTermList(readFileSync(BANNED_TERMS_FILE, 'utf8'));
    const exempt = parseTermList(readFileSync(BANNED_TERMS_EXEMPT_FILE, 'utf8'));
    expect(terms.length).toBeGreaterThan(0);
    const found: string[] = [];
    for (const [key, text] of [...flatten(EN, '', []), ...flatten(ZH, 'zh-Hant', [])]) {
      for (const hit of checkBannedTerms(text, terms, exempt)) found.push(`${key}: "${hit.term}"`);
    }
    expect(found).toEqual([]);
  });

  it('contains no "Strong response", "Weak response" or "Central" (19.13)', () => {
    const found: string[] = [];
    for (const [key, text] of ALL) {
      for (const word of ['Strong response', 'Weak response', 'Central']) {
        if (text.includes(word)) found.push(`${key}: "${word}"`);
      }
    }
    expect(found).toEqual([]);
  });

  it('has equal numbers of benefit and cost statements per tool (8.12)', () => {
    const tools = Object.entries(UI_STRINGS.policy.effects);
    expect(tools.length).toBeGreaterThan(0);
    for (const [tool, e] of tools) {
      expect(e.benefits.length, tool).toBeGreaterThan(0);
      expect(e.benefits.length, tool).toBe(e.costs.length);
    }
  });

  it('has a display name for every Scenario effect id', () => {
    const names: Readonly<Record<string, string>> = UI_STRINGS.rangeSource.parameterNames;
    for (const id of SCENARIO_EFFECT_IDS) {
      expect(names[id]?.trim().length ?? 0, id).toBeGreaterThan(0);
    }
  });

  it('shows the Disclosure_Text verbatim', () => {
    const expected =
      'Initial data and events come from real open data. Policy outcomes are simulated, not predicted.';
    expect(DISCLOSURE_TEXT).toBe(expected);
    expect(UI_STRINGS.app.disclosure).toBe(expected);
  });

  it('marks user-authored text with TODO(user text)', () => {
    expect(UI_STRINGS.errors.timelineCap).toContain('TODO(user text)');
    const source = readFileSync('src/ui/strings/en.ts', 'utf8');
    expect(source).toMatch(/TODO\(user text\): review the wording of the effect statements/);
    expect(source).toMatch(/TODO\(user text\): wording of the timeline-cap message/);
  });
});

describe('English and Traditional Chinese (play-loop Requirement 12.3)', () => {
  const en = new Map(flatten(EN, '', []));
  const zh = new Map(flatten(ZH, '', []));
  const placeholders = (t: string) => [...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

  it('uses English outside a browser', () => {
    expect(UI_STRINGS).toBe(EN);
  });

  it('has the same keys in both languages', () => {
    expect([...zh.keys()].sort()).toEqual([...en.keys()].sort());
  });

  it('has the same Placeholders in each pair of strings', () => {
    const differ: string[] = [];
    for (const [key, text] of en) {
      const other = zh.get(key) ?? '';
      if (placeholders(text).join(',') !== placeholders(other).join(',')) differ.push(key);
    }
    expect(differ).toEqual([]);
  });

  it('has a Chinese text for every key that is not a language name or a pure Placeholder', () => {
    const untranslated = [...en].filter(
      ([key, text]) =>
        zh.get(key) === text &&
        /[A-Za-z]{3}/.test(text.replace(/\{\w+\}/g, '')) &&
        !/^app\.language(En|Zh)$/.test(key) &&
        !key.startsWith('errors.timelineCap'),
    );
    expect(untranslated.map(([k]) => k)).toEqual([]);
  });

  it('labels quarters per language', () => {
    expect(quarterLabel('2016Q3')).toBe('2016 Q3');
    expect(quarterLabel('not a quarter')).toBe('not a quarter');
  });
});
