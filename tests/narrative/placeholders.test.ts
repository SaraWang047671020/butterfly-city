// story-layer task 7 (Requirements 2.10, 3.5, 8.3): every Template fills from a complete fixture; an unknown
// Placeholder or a missing value fails with Template_Id and Placeholder. Also the one schema check of income-spread.json.
import fc from 'fast-check';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

import { validateCitizenFile, validateIncomeSpread } from '../../src/data/story-loader.ts';
import { FillError, fillTemplate, placeholdersOf } from '../../src/narrative/fill.ts';
import { PLACEHOLDER_REGISTRY } from '../../src/narrative/registry.ts';

const read = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8')) as unknown;
const citizens = read('data/config/citizens.json') as { templates: Record<string, Record<string, string>> };
const limits = read('data/config/model-limits.json') as { sections: { items: { id: string; text: string }[] }[] };
const codes = new Set((read('public/data/districts.json') as { districts: { code: string }[] }).districts.map((d) => d.code));

/** Every Template with its Template_Id (not the templates.backtestResult block of model-limits.json). */
const templates: [string, string][] = [
  ...Object.entries(citizens.templates).flatMap(([g, states]) => Object.entries(states).map(([s, t]) => [`${g}.${s}`, t] as [string, string])),
  ...limits.sections.flatMap((s) => s.items.map((it) => [`limits.${it.id}`, it.text] as [string, string])),
];
const fixture = Object.fromEntries(Object.keys(PLACEHOLDER_REGISTRY).map((k) => [k, `<${k}>`]));

describe('Templates and the Placeholder registry', () => {
  it('every Placeholder of every Template is in the registry', () => {
    const unknown = templates.flatMap(([id, t]) => placeholdersOf(t).filter((p) => !(p in PLACEHOLDER_REGISTRY)).map((p) => `${id}: {${p}}`));
    expect(unknown).toEqual([]);
  });

  it('every Template fills from a complete fixture and leaves no placeholder', () => {
    const errors: string[] = [];
    for (const [id, t] of templates) {
      try {
        expect(fillTemplate(id, t, fixture)).not.toMatch(/\{[A-Za-z0-9_.]+\}/);
      } catch (e) {
        if (e instanceof FillError) errors.push(`${e.templateId}: {${e.placeholder}}`);
        else throw e;
      }
    }
    expect(errors).toEqual([]);
  });

  it('Property 1 and 2: fill replaces every placeholder; a missing value names Template_Id and Placeholder', () => {
    const name = fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{0,6}$/);
    fc.assert(
      fc.property(fc.uniqueArray(name, { minLength: 1, maxLength: 4 }), fc.string({ maxLength: 8 }), (names, text) => {
        const clean = text.replace(/[{}<>]/g, '');
        const template = names.map((n) => `${clean}{${n}}`).join(' ') + ` {${names[0]}}`;
        const values = Object.fromEntries(names.map((n) => [n, `<${n}>`]));
        const out = fillTemplate('t.x', template, values);
        expect(out).not.toMatch(/\{[A-Za-z0-9_.]+\}/);
        expect(out.split(`<${names[0]}>`).length - 1).toBe(2);
        const missing = { ...values };
        delete missing[names[names.length - 1]!];
        try {
          fillTemplate('t.x', template, missing);
          expect.unreachable();
        } catch (e) {
          expect(e).toBeInstanceOf(FillError);
          expect((e as FillError).templateId).toBe('t.x');
          expect((e as FillError).placeholder).toBe(names[names.length - 1]);
        }
      }),
    );
  });
});

describe('story files', () => {
  it('citizens.json passes the loader validation', () => {
    const r = validateCitizenFile(read('data/config/citizens.json'), codes);
    expect(r.ok ? 'ok' : r.error).toBe('ok');
  });

  it('income-spread.json has 41 finite positive sigmas for the codes of districts.json', () => {
    const r = validateIncomeSpread(read('public/data/income-spread.json'), codes);
    expect(r.ok ? 'ok' : r.error).toBe('ok');
  });

  it('public/data copies equal data/config', () => {
    for (const f of ['citizens.json', 'model-limits.json']) {
      expect(fs.readFileSync(`public/data/${f}`, 'utf8')).toBe(fs.readFileSync(`data/config/${f}`, 'utf8'));
    }
  });
});
