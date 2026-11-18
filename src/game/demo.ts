// Demo_Save at run time. Pure: no DOM, no I/O. The Save_Code and summary text are passed in (main.ts imports the generated file).
import { decodeSaveCode } from '../save/codec.ts';
import type { SaveValidationContext } from '../save/codec.ts';
import type { DemoSummary, Save } from '../types/save.ts';
import type { DistrictCode } from '../types/data-files.ts';
import type { DemoDescriptionView } from '../types/view.ts';

export type DemoSource =
  | { readonly ok: true; readonly save: Save; readonly summary: DemoSummary }
  | { readonly ok: false; readonly reason: string };

/** Order of the two effect lines in the description (Requirements 14.26, 14.27). */
export type DemoEffectOrder = readonly ['ghost', 'rentBurden'] | readonly ['rentBurden', 'ghost'];

function fail(reason: string): DemoSource {
  return { ok: false, reason };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Returns a DemoSummary or a reason text. Never throws. */
export function parseDemoSummary(text: string): { readonly ok: true; readonly summary: DemoSummary } | { readonly ok: false; readonly reason: string } {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'The demo summary is not valid JSON.' };
  }
  if (!isObj(v)) return { ok: false, reason: 'The demo summary must be an object.' };
  const gd = v.ghostDifference;
  const rb = v.rentBurden;
  if (v.comparisonQuarter !== '2021Q1') return { ok: false, reason: 'The demo summary comparisonQuarter must be 2021Q1.' };
  if (v.fallbackStep !== 0 && v.fallbackStep !== 1 && v.fallbackStep !== 2) {
    return { ok: false, reason: 'The demo summary fallbackStep must be 0, 1 or 2.' };
  }
  if (!isObj(gd) || !isNum(gd.central) || !isNum(gd.min) || !isNum(gd.max)) {
    return { ok: false, reason: 'The demo summary ghostDifference must hold central, min and max numbers.' };
  }
  if (!isNum(v.ghostThreshold) || !isNum(v.rentBurdenThreshold)) {
    return { ok: false, reason: 'The demo summary thresholds must be numbers.' };
  }
  if (!isObj(rb) || typeof rb.district !== 'string' || rb.district === '' || !isNum(rb.difference)) {
    return { ok: false, reason: 'The demo summary rentBurden must hold a district and a difference.' };
  }
  return {
    ok: true,
    summary: {
      comparisonQuarter: '2021Q1',
      fallbackStep: v.fallbackStep,
      ghostDifference: { central: gd.central, min: gd.min, max: gd.max },
      ghostThreshold: v.ghostThreshold,
      rentBurden: { district: rb.district, difference: rb.difference },
      rentBurdenThreshold: v.rentBurdenThreshold,
    },
  };
}

/** Decodes the Demo_Save_Code and parses the summary. The loaded save has `demo: true` (Requirement 14.9). */
export function readDemo(ctx: SaveValidationContext, code: string, summaryText: string): DemoSource {
  try {
    if (code.trim() === '') return fail('The demo save is empty.');
    const decoded = decodeSaveCode(code, ctx);
    if (!decoded.ok) {
      const e = decoded.error;
      return fail(`The demo save is not valid (${e.step} at ${e.path}): ${e.reason}`);
    }
    if (!decoded.save.demo) return fail('The demo save does not have the demo flag set.');
    const parsed = parseDemoSummary(summaryText);
    if (!parsed.ok) return fail(parsed.reason);
    return { ok: true, save: decoded.save, summary: parsed.summary };
  } catch {
    return fail('The demo could not be read.');
  }
}

/** Ghost difference first for Fallback_Step 0 and 1, Rent_Burden difference first for step 2. */
export function demoEffectOrder(step: 0 | 1 | 2): DemoEffectOrder {
  return step === 2 ? ['rentBurden', 'ghost'] : ['ghost', 'rentBurden'];
}

/** Builds the description shown before loading (Requirement 14.10). `districtName` maps a District_Code to its display name. */
export function describeDemo(
  save: Save,
  summary: DemoSummary,
  districtName: (code: DistrictCode) => string,
): DemoDescriptionView {
  return {
    entries: save.timeline.map((t) => ({
      quarter: t.quarter,
      tool: t.tool,
      field: t.field,
      area: t.area,
      kind: t.kind,
      value: t.kind === 'value' ? t.after : null,
    })),
    fallbackStep: summary.fallbackStep,
    comparisonQuarter: summary.comparisonQuarter,
    ghostDifference: { ...summary.ghostDifference },
    rentBurden: {
      district: summary.rentBurden.district,
      districtName: districtName(summary.rentBurden.district),
      difference: summary.rentBurden.difference,
    },
  };
}
