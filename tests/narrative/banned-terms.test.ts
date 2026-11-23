// story-layer task 7 (Requirements 7.1 to 7.4, 8.4): raw and filled story text contains no banned term.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

import { BANNED_TERMS_EXEMPT_FILE, BANNED_TERMS_FILE, checkBannedTerms, parseTermList } from '../../scripts/pipeline/banned-terms.ts';
import { fillTemplate } from '../../src/narrative/fill.ts';
import { PLACEHOLDER_REGISTRY } from '../../src/narrative/registry.ts';

const terms = parseTermList(fs.readFileSync(BANNED_TERMS_FILE, 'utf8'));
const exempt = parseTermList(fs.readFileSync(BANNED_TERMS_EXEMPT_FILE, 'utf8'));
const citizens = JSON.parse(fs.readFileSync('data/config/citizens.json', 'utf8')) as {
  personas: Record<string, unknown>[];
  templates: Record<string, Record<string, string>>;
};
const limits = JSON.parse(fs.readFileSync('data/config/model-limits.json', 'utf8')) as {
  page: Record<string, string>;
  sections: { title: string; items: { id: string; title: string; text: string }[] }[];
  templates: { backtestResult: Record<string, string | Record<string, string>> };
};

function hits(label: string, text: string): string[] {
  return checkBannedTerms(text, terms, exempt).map((h) => `${label}: "${h.term}"`);
}

describe('story text neutrality', () => {
  it('raw Templates, Persona fields, page fields and the backtest sentences have no banned term', () => {
    const found: string[] = [];
    for (const [g, states] of Object.entries(citizens.templates)) for (const [s, t] of Object.entries(states)) found.push(...hits(`${g}.${s}`, t));
    for (const p of citizens.personas) for (const k of ['intro', 'picker', 'household']) if (typeof p[k] === 'string') found.push(...hits(`${String(p['id'])}.${k}`, p[k] as string));
    for (const [k, v] of Object.entries(limits.page)) found.push(...hits(`page.${k}`, v));
    for (const s of limits.sections) {
      found.push(...hits(`section ${s.title}`, s.title));
      for (const it of s.items) found.push(...hits(`limits.${it.id}`, `${it.title}\n${it.text}`));
    }
    for (const [k, v] of Object.entries(limits.templates.backtestResult)) {
      if (typeof v === 'string') found.push(...hits(`backtestResult.${k}`, v));
      else for (const [kk, vv] of Object.entries(v)) found.push(...hits(`backtestResult.${k}.${kk}`, vv));
    }
    expect(found).toEqual([]);
  });

  it('filled Templates have no banned term', () => {
    const values = Object.fromEntries(Object.keys(PLACEHOLDER_REGISTRY).map((k) => [k, '12.3']));
    values['name'] = 'Ting';
    values['homeDistrict'] = 'Zhonghe';
    values['workDistrict'] = 'Xinyi';
    values['realQuarter'] = '2019Q2';
    const found: string[] = [];
    for (const [g, states] of Object.entries(citizens.templates)) {
      for (const [s, t] of Object.entries(states)) found.push(...hits(`${g}.${s}`, fillTemplate(`${g}.${s}`, t, values)));
    }
    expect(found).toEqual([]);
  });
});
