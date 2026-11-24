// story-layer task 7 (Requirements 7.1 to 7.4, 8.4): raw and filled story text contains no banned term.
// Both languages of every text (play-loop Requirement 12.7): each LocalText is checked in English and Chinese.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

import { BANNED_TERMS_EXEMPT_FILE, BANNED_TERMS_FILE, checkBannedTerms, parseTermList } from '../../scripts/pipeline/banned-terms.ts';
import { fillTemplate } from '../../src/narrative/fill.ts';
import { PLACEHOLDER_REGISTRY } from '../../src/narrative/registry.ts';

type LocalText = { en: string; 'zh-Hant': string };

const terms = parseTermList(fs.readFileSync(BANNED_TERMS_FILE, 'utf8'));
const exempt = parseTermList(fs.readFileSync(BANNED_TERMS_EXEMPT_FILE, 'utf8'));
const citizens = JSON.parse(fs.readFileSync('data/config/citizens.json', 'utf8')) as {
  personas: Record<string, unknown>[];
  templates: Record<string, Record<string, LocalText>>;
};
const limits = JSON.parse(fs.readFileSync('data/config/model-limits.json', 'utf8')) as {
  page: Record<string, LocalText>;
  sections: { title: LocalText; items: { id: string; title: LocalText; text: LocalText }[] }[];
  templates: { backtestResult: Record<string, string | LocalText | Record<string, LocalText>> };
};
const isLocal = (x: unknown): x is LocalText => typeof x === 'object' && x !== null && 'en' in x;

function hits(label: string, text: string | LocalText): string[] {
  const texts = typeof text === 'string' ? [text] : [text.en, text['zh-Hant']];
  return texts.flatMap((t) => checkBannedTerms(t, terms, exempt).map((h) => `${label}: "${h.term}"`));
}

describe('story text neutrality', () => {
  it('raw Templates, Persona fields, page fields and the backtest sentences have no banned term', () => {
    const found: string[] = [];
    for (const [g, states] of Object.entries(citizens.templates)) for (const [s, t] of Object.entries(states)) found.push(...hits(`${g}.${s}`, t));
    for (const p of citizens.personas) {
      for (const k of ['name', 'intro', 'picker', 'household']) {
        const v = p[k];
        if (isLocal(v)) found.push(...hits(`${String(p['id'])}.${k}`, v));
      }
    }
    for (const [k, v] of Object.entries(limits.page)) found.push(...hits(`page.${k}`, v));
    for (const s of limits.sections) {
      found.push(...hits(`section ${s.title.en}`, s.title));
      for (const it of s.items) found.push(...hits(`limits.${it.id}`, it.title), ...hits(`limits.${it.id}`, it.text));
    }
    for (const [k, v] of Object.entries(limits.templates.backtestResult)) {
      if (k === 'notes') continue;
      if (typeof v === 'string' || isLocal(v)) found.push(...hits(`backtestResult.${k}`, v));
      else for (const [kk, vv] of Object.entries(v)) found.push(...hits(`backtestResult.${k}.${kk}`, vv));
    }
    expect(found).toEqual([]);
  });

  it('filled Templates have no banned term', () => {
    const values = Object.fromEntries(Object.keys(PLACEHOLDER_REGISTRY).map((k) => [k, '12.3']));
    const en = { ...values, name: 'Ting', homeDistrict: 'Zhonghe', workDistrict: 'Xinyi', realQuarter: '2019 Q2' };
    const zh = { ...values, name: '小婷', homeDistrict: '中和區', workDistrict: '信義區', realQuarter: '2019 年第 2 季' };
    const found: string[] = [];
    for (const [g, states] of Object.entries(citizens.templates)) {
      for (const [s, t] of Object.entries(states)) {
        found.push(...hits(`${g}.${s}`, fillTemplate(`${g}.${s}`, t.en, en)));
        found.push(...hits(`${g}.${s} (zh-Hant)`, fillTemplate(`${g}.${s}`, t['zh-Hant'], zh)));
      }
    }
    expect(found).toEqual([]);
  });
});
