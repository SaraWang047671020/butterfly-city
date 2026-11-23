/**
 * Model_Facts (story-layer Requirement 2, task 2): public/data/model-facts.json with the three values of the model
 * limitations page. Each writer merges only its own keys (read, merge, write); a missing value stops the writer.
 * Implemented by Claude Code (2026-11-23).
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './paths.ts';

export interface ModelFacts {
  readonly schemaVersion: 1;
  /** Modelled mean one-way commute from New Taipei to Taipei, minutes, not rounded. */
  readonly commuteModelled?: number;
  /** Survey figure, minutes. */
  readonly commuteSurvey?: number;
  /** The filled backtest sentences of the tpass-2023 case. */
  readonly backtestResult?: string;
}

export const MODEL_FACTS_FILE = path.join(ROOT, 'public', 'data', 'model-facts.json');

/** Stable serialization: fixed key order, 2-space indent, trailing newline. */
export function serializeModelFacts(f: ModelFacts): string {
  const out: Record<string, unknown> = { schemaVersion: 1 };
  for (const k of ['backtestResult', 'commuteModelled', 'commuteSurvey'] as const) if (f[k] !== undefined) out[k] = f[k];
  return `${JSON.stringify(out, null, 2)}\n`;
}

/** Parses and checks a Model_Facts text; throws with the field name on a bad value. */
export function parseModelFacts(text: string): ModelFacts {
  const v = JSON.parse(text) as Record<string, unknown>;
  if (v['schemaVersion'] !== 1) throw new Error('model-facts.json: schemaVersion must be 1');
  for (const k of ['commuteModelled', 'commuteSurvey'] as const) {
    if (v[k] !== undefined && !(typeof v[k] === 'number' && Number.isFinite(v[k]) && (v[k] as number) > 0)) {
      throw new Error(`model-facts.json: ${k} must be a positive number`);
    }
  }
  if (v['backtestResult'] !== undefined && !(typeof v['backtestResult'] === 'string' && v['backtestResult'] !== '')) {
    throw new Error('model-facts.json: backtestResult must be text');
  }
  return v as unknown as ModelFacts;
}

/** Merges `patch` into the file (created when missing). Throws, writing nothing, on a missing value in the patch. */
export function updateModelFacts(patch: Omit<ModelFacts, 'schemaVersion'>, file: string = MODEL_FACTS_FILE): ModelFacts {
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === null || (typeof v === 'number' && !Number.isFinite(v))) throw new Error(`model facts: no value for ${k}`);
  }
  const current: ModelFacts = fs.existsSync(file) ? parseModelFacts(fs.readFileSync(file, 'utf8')) : { schemaVersion: 1 };
  const next: ModelFacts = { ...current, ...patch, schemaVersion: 1 };
  fs.writeFileSync(file, serializeModelFacts(next));
  return next;
}

export interface BacktestSentenceInput {
  readonly direction: boolean;
  readonly ratioMet: boolean;
  readonly range: boolean;
  readonly ratio: number;
  readonly toleranceLow: number;
  readonly toleranceHigh: number;
}

type Sentences = { readonly met: string; readonly notMet: string };

/** The backtestResult text from templates.backtestResult of model-limits.json; throws on a missing sentence or a leftover placeholder. */
export function backtestSentence(
  templates: { readonly direction: Sentences; readonly ratio: Sentences; readonly range: Sentences; readonly join: string },
  x: BacktestSentenceInput,
): string {
  const pick = (s: Sentences | undefined, ok: boolean, name: string): string => {
    const t = s?.[ok ? 'met' : 'notMet'];
    if (typeof t !== 'string' || t === '') throw new Error(`model facts: templates.backtestResult.${name} has no ${ok ? 'met' : 'notMet'} sentence`);
    return t;
  };
  const fill = (t: string) =>
    t
      .replaceAll('{ratio}', x.ratio.toFixed(3))
      .replaceAll('{toleranceLow}', x.toleranceLow.toFixed(3))
      .replaceAll('{toleranceHigh}', x.toleranceHigh.toFixed(3));
  const text = templates.join
    .replace('{direction}', fill(pick(templates.direction, x.direction, 'direction')))
    .replace('{ratio}', fill(pick(templates.ratio, x.ratioMet, 'ratio')))
    .replace('{range}', fill(pick(templates.range, x.range, 'range')));
  if (/\{[A-Za-z0-9_.]+\}/.test(text)) throw new Error(`model facts: unfilled placeholder in backtestResult: ${text}`);
  return text;
}
