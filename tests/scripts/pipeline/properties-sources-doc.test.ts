import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkBannedTerms } from '../../../scripts/pipeline/banned-terms.ts';
import { renderSourcesDoc, type SourcesDocInput } from '../../../scripts/pipeline/sources-doc.ts';
import { validDistrictsFile, validHistoryFile, validPolicyTrackFile, type Json } from '../../data/helpers.ts';

const NUM_RUNS = 100;

// ---------------------------------------------------------------------------------------------
// Property 28
// ---------------------------------------------------------------------------------------------

const word = fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{0,7}$/);
const phrase = fc.array(word, { minLength: 1, maxLength: 3 }).map((w) => w.join(' '));

interface GenSource {
  readonly agency: string;
  readonly dataset: string;
  readonly urlPath: string;
  readonly years: readonly [number, number];
  readonly license: string;
}

const genSource: fc.Arbitrary<GenSource> = fc.record({
  agency: phrase,
  dataset: phrase,
  urlPath: fc.stringMatching(/^[a-z0-9]{1,10}$/),
  years: fc.tuple(fc.integer({ min: 2000, max: 2020 }), fc.integer({ min: 0, max: 10 })).map(([a, d]) => [a, a + d] as const),
  license: phrase,
});

const INDICATORS = ['population', 'rent', 'priceToIncomeRatio'] as const;

const registryArb = fc
  .record({
    sources: fc.array(genSource, { minLength: 1, maxLength: 5 }),
    methodCount: fc.integer({ min: 0, max: 4 }),
  })
  .chain(({ sources, methodCount }) =>
    fc.record({
      sources: fc.constant(sources),
      methodCount: fc.constant(methodCount),
      // For each indicator, a non-empty set of source indexes.
      refs: fc.tuple(
        ...INDICATORS.map(() => fc.uniqueArray(fc.integer({ min: 0, max: sources.length - 1 }), { minLength: 1, maxLength: sources.length })),
      ),
    }),
  );

function buildInput(g: { sources: GenSource[]; methodCount: number; refs: number[][] }): SourcesDocInput {
  const history: Json = validHistoryFile();
  const ids = g.sources.map((_, i) => `gen/s${i}`);
  history.sources.push(
    ...g.sources.map((s, i) => ({
      id: ids[i],
      agency: s.agency,
      dataset: s.dataset,
      url: `https://example.gov.tw/${s.urlPath}`,
      years: [...s.years],
      license: s.license,
    })),
  );
  INDICATORS.forEach((_, k) => {
    history.indicators[k].sources = (g.refs[k] as number[]).map((i) => ids[i]);
  });
  const methodIds: string[] = [];
  for (let m = 0; m < g.methodCount; m++) {
    const id = `gen-method-${m}`;
    methodIds.push(id);
    history.methods.push({
      id,
      kind: 'estimation',
      title: `Generated method ${m}`,
      inputs: ['test/source-a'],
      steps: ['Step one.'],
      appliesTo: ['rent'],
      quarters: '2015Q1–2025Q4',
      setsEstimated: true,
    });
    const codes = Object.keys(history.indicators[1].series);
    history.indicators[1].series[codes[m] as string][0] = { value: 400, estimated: true, method: id };
  }
  return {
    districtsFile: validDistrictsFile(),
    historyFile: history,
    policyTrackFile: validPolicyTrackFile(),
    holdingTaxRates: [],
    commuterPassProducts: [],
    subleasePhases: [],
  };
}

describe('data-pipeline properties: SOURCES.md', () => {
  // Feature: data-pipeline, Property 28: SOURCES.md covers every referenced source and method
  it('Property 28: SOURCES.md covers every referenced source and method', () => {
    // **Validates: Requirements 15.3, 15.4**
    fc.assert(
      fc.property(registryArb, (g) => {
        const text = renderSourcesDoc(buildInput(g));
        const all = text.split('\n');
        const start = all.findIndex((l) => l.startsWith('## 3.'));
        const end = all.findIndex((l) => l.startsWith('## 4.'));
        const sec3 = all.slice(start, end);
        const histStart = sec3.findIndex((l) => l === '### history.json');
        const histEnd = sec3.findIndex((l) => l === '### policy-track.json');
        const hist = sec3.slice(histStart, histEnd);

        INDICATORS.forEach((ind, k) => {
          const rows = hist.filter((l) => l.startsWith(`| ${ind} | `));
          const refs = g.refs[k] as number[];
          expect(rows).toHaveLength(refs.length);
          for (const i of refs) {
            const s = g.sources[i] as GenSource;
            const row = rows.find((r) => r.includes(`\`gen/s${i}\``));
            expect(row).toBeDefined();
            expect(row).toContain(s.agency);
            expect(row).toContain(s.dataset);
            expect(row).toContain(`https://example.gov.tw/${s.urlPath}`);
            expect(row).toContain(`${s.years[0]}–${s.years[1]}`);
            expect(row).toContain(s.license);
          }
        });

        const s5 = text.slice(text.indexOf('## 5.'), text.indexOf('## 6.'));
        for (let m = 0; m < g.methodCount; m++) {
          expect(s5).toContain(`### gen-method-${m}\n`);
        }
        // Every source of the registry has its own section too.
        for (let i = 0; i < g.sources.length; i++) {
          expect(text).toContain(`### gen/s${i}\n`);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Property 29
// ---------------------------------------------------------------------------------------------

const TERMS = ['failed', 'finally'] as const;
const EXEMPT = ['failed safe', 'finally clause'] as const; // exempt phrase i contains TERMS[i]
const DECOYS = ['finallyx', 'unfailed', 'failedx', 'xfinally', 'failed_x'] as const;

// Alphabet without f, a, i, l, e, d, n, y: no filler word can contain a banned term or a part of one.
const filler = fc.stringMatching(/^[bcghkmopqrstuvwxz]{1,8}$/);

type CaseMode = 'lower' | 'upper' | 'title';
const caseMode = fc.constantFrom<CaseMode>('lower', 'upper', 'title');

function applyCase(s: string, mode: CaseMode): string {
  if (mode === 'lower') return s;
  if (mode === 'upper') return s.toUpperCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

interface LineSpec {
  readonly words: string[];
  readonly banned: boolean[]; // per term: inserted outside any exempt phrase
  readonly exempt: boolean[]; // per exempt phrase: inserted
  readonly decoys: string[];
  readonly modes: CaseMode[];
  readonly positions: number[];
}

const lineSpec: fc.Arbitrary<LineSpec> = fc.record({
  words: fc.array(filler, { minLength: 0, maxLength: 6 }),
  banned: fc.array(fc.boolean(), { minLength: TERMS.length, maxLength: TERMS.length }),
  exempt: fc.array(fc.boolean(), { minLength: EXEMPT.length, maxLength: EXEMPT.length }),
  decoys: fc.array(fc.constantFrom(...DECOYS), { maxLength: 2 }),
  modes: fc.array(caseMode, { minLength: 8, maxLength: 8 }),
  positions: fc.array(fc.nat(100), { minLength: 8, maxLength: 8 }),
});

function renderLine(spec: LineSpec): { text: string; terms: string[] } {
  const tokens = [...spec.words];
  let n = 0;
  const insert = (token: string): void => {
    const pos = (spec.positions[n] as number) % (tokens.length + 1);
    tokens.splice(pos, 0, token);
    n++;
  };
  const terms: string[] = [];
  TERMS.forEach((t, i) => {
    if (spec.banned[i]) {
      insert(applyCase(t, spec.modes[n] as CaseMode));
      terms.push(t);
    }
  });
  EXEMPT.forEach((p, i) => {
    if (spec.exempt[i]) insert(applyCase(p, spec.modes[n] as CaseMode));
  });
  for (const d of spec.decoys) insert(applyCase(d, spec.modes[n] as CaseMode));
  return { text: tokens.join(' '), terms };
}

describe('data-pipeline properties: banned-term check', () => {
  // Feature: data-pipeline, Property 29: Banned-term detection
  it('Property 29: Banned-term detection', () => {
    // **Validates: Requirements 15.6, 15.9**
    fc.assert(
      fc.property(fc.array(lineSpec, { minLength: 1, maxLength: 12 }), (specs) => {
        const rendered = specs.map(renderLine);
        const text = rendered.map((r) => r.text).join('\n');
        const expected: Array<{ term: string; line: number }> = [];
        rendered.forEach((r, i) => {
          for (const term of TERMS) if (r.terms.includes(term)) expected.push({ term, line: i + 1 });
        });
        const hits = checkBannedTerms(text, TERMS, EXEMPT);
        expect(hits.map((h) => ({ term: h.term, line: h.line }))).toEqual(expected);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
