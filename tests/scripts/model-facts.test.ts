// Model_Facts (story-layer Requirement 2, Property 3): validation of the committed file, round trip, merge of one
// writer's keys, and the backtest sentence.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { backtestSentence, parseModelFacts, serializeModelFacts, updateModelFacts } from '../../scripts/lib/model-facts.ts';
import { validateModelFacts } from '../../src/data/story-loader.ts';

const limits = JSON.parse(fs.readFileSync('data/config/model-limits.json', 'utf8')) as {
  templates: { backtestResult: Parameters<typeof backtestSentence>[0] };
};

describe('model-facts.json', () => {
  it('the committed file passes the app validation and round-trips', () => {
    const text = fs.readFileSync('public/data/model-facts.json', 'utf8');
    const v = validateModelFacts(JSON.parse(text));
    expect(v.ok ? 'ok' : v.error).toBe('ok');
    expect(serializeModelFacts(parseModelFacts(text))).toBe(text);
  });

  it('a writer changes only its own keys and stops on a missing value', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'facts-')), 'model-facts.json');
    updateModelFacts({ commuteModelled: 54.2, commuteSurvey: 57 }, file);
    updateModelFacts({ backtestResult: { en: 'text', 'zh-Hant': '文字' } }, file);
    expect(parseModelFacts(fs.readFileSync(file, 'utf8'))).toEqual({ schemaVersion: 1, backtestResult: { en: 'text', 'zh-Hant': '文字' }, commuteModelled: 54.2, commuteSurvey: 57 });
    expect(() => updateModelFacts({ commuteModelled: Number.NaN }, file)).toThrow(/commuteModelled/);
  });

  it('backtestSentence picks met or notMet per check and fills the numbers at 3 decimals', () => {
    const t = backtestSentence(limits.templates.backtestResult, {
      direction: true,
      ratioMet: false,
      range: true,
      ratio: 2.5,
      toleranceLow: 0.5,
      toleranceHigh: 2,
    });
    expect(t['zh-Hant']).toContain('2.500 倍');
    expect(t['zh-Hant']).toContain('範圍外');
    expect(t['zh-Hant']).not.toMatch(/{[A-Za-z]+}/);
    expect(t.en).toContain('same direction');
    expect(t.en).toContain('2.500 times');
    expect(t.en).toContain('outside the range of 0.500 to 2.000');
    expect(t.en).not.toMatch(/\{[A-Za-z]+\}/);
  });
});
