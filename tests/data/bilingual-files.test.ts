// play-loop Requirement 12.4: citizens.json, model-limits.json, model-facts.json and events.json hold each displayed
// text in both languages; the validators reject a text missing in one language and return the chosen language.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateCitizenFile, validateLimitsFile, validateModelFacts } from '../../src/data/story-loader.ts';
import { validateEventsFile } from '../../src/data/validate-events.ts';

const read = (p: string): Record<string, any> => JSON.parse(fs.readFileSync(p, 'utf8'));
const codes = new Set((read('public/data/districts.json')['districts'] as { code: string }[]).map((d) => d.code));

describe('bilingual story and event files', () => {
  it('citizens.json: Chinese when asked, and a missing Chinese text is rejected', () => {
    const c = read('data/config/citizens.json');
    const zh = validateCitizenFile(c, codes, 'zh-Hant');
    expect(zh.ok && zh.value.personas[0]?.name).toBe('小婷');
    const en = validateCitizenFile(c, codes, 'en');
    expect(en.ok && en.value.templates['commute']?.['none']).toBe('{name} does not commute.');
    delete c['templates']['rent']['below']['zh-Hant'];
    const r = validateCitizenFile(c, codes, 'en');
    expect(r.ok ? 'ok' : r.error).toMatch(/templates\.rent\.below: missing Traditional Chinese/);
  });

  it('citizens.json: different Placeholders in the two languages are rejected', () => {
    const c = read('data/config/citizens.json');
    c['templates']['rent']['below']['zh-Hant'] = '{name}這一季的房租。';
    const r = validateCitizenFile(c, codes);
    expect(r.ok ? 'ok' : r.error).toMatch(/Placeholders differ/);
  });

  it('model-limits.json: Chinese when asked, and a missing English text is rejected', () => {
    const m = read('data/config/model-limits.json');
    const zh = validateLimitsFile(m, 'zh-Hant');
    expect(zh.ok && zh.value.page.title).toBe('這個模型能告訴你什麼、不能告訴你什麼');
    delete m['sections'][0]['items'][0]['text']['en'];
    const r = validateLimitsFile(m);
    expect(r.ok ? 'ok' : r.error).toMatch(/items\[0\]\.text: missing English/);
  });

  it('model-facts.json: backtestResult in the chosen language', () => {
    const f = read('public/data/model-facts.json');
    const zh = validateModelFacts(f, 'zh-Hant');
    expect(zh.ok && zh.value.backtestResult).toMatch(/^模型的變化方向/);
    delete f['backtestResult']['zh-Hant'];
    expect(validateModelFacts(f).ok).toBe(false);
  });

  it('events.json: every card has a Chinese title and description; a card without one is rejected', () => {
    const e = read('public/data/events.json');
    expect(validateEventsFile(e)).toEqual([]);
    for (const c of e['events'] as { zh: { title: string; description: string } }[]) {
      expect(c.zh.title).toMatch(/[一-鿿]/);
      expect(c.zh.description).toMatch(/[一-鿿]/);
    }
    delete e['events'][0]['zh'];
    expect(validateEventsFile(e).some((x) => x.path === '$.events[0].zh')).toBe(true);
  });
});
