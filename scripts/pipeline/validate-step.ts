/**
 * Validation step (Requirements 16.5, 16.6): runs the shared validators over the three assembled files in
 * memory, collects every error of every file and throws one ValidationFailedError. The write step comes
 * after this step, so nothing is written when validation fails.
 */
import {
  validateDistrictsFile,
  validateHistoryFile,
  validatePolicyTrackFile,
  type ValidationContext,
} from '../../src/data/validate.ts';
import type { BuildContext } from './context.ts';
import { DataError, ValidationFailedError, type ValidationIssue } from './errors.ts';
import { INDICATOR_SPECS, POLICY_SERIES_SPECS } from './registry/indicators.ts';
import { readRawTextFiles, readTdxSecrets, scanForCredentials, type ScanFile } from './credentials-scan.ts';
import { serializeJson } from './serialize.ts';
import type { BuildState, Step } from './run.ts';

/** The expected sets: the 41 district codes, the 44 quarters, the indicator ids and the policy series ids. */
export function buildValidationContext(ctx: BuildContext): ValidationContext {
  return {
    districtCodes: ctx.districts.map((d) => d.code),
    quarters: [...ctx.quarters],
    indicatorIds: INDICATOR_SPECS.map((s) => s.id),
    policySeriesIds: POLICY_SERIES_SPECS.map((s) => s.id),
  };
}

/** `override` replaces the context built from the registry; tests use it with synthetic files. */
export function validateStep(
  override?: ValidationContext,
  envOverride?: Readonly<Record<string, string | undefined>>,
): Step {
  return {
    name: 'validate',
    run(ctx: BuildContext, state: BuildState) {
      const missing: string[] = [];
      if (state.districtsFile === undefined) missing.push('districts file: run the districts step first');
      if (state.historyFile === undefined) missing.push('history file: run the history file step first');
      if (state.policyTrackFile === undefined) missing.push('policy-track file: run the policy file step first');
      if (state.districtsFile === undefined || state.historyFile === undefined || state.policyTrackFile === undefined) {
        throw new DataError('missing-step-output', 'validation input', missing);
      }
      const vctx = override ?? buildValidationContext(ctx);
      const errors: ValidationIssue[] = [
        ...validateDistrictsFile(state.districtsFile, vctx),
        ...validateHistoryFile(state.historyFile, vctx),
        ...validatePolicyTrackFile(state.policyTrackFile, vctx),
      ];
      // A file that cannot be serialized (for example a non-finite number) is already reported by the
      // validators above, so it is left out of the scan instead of throwing here.
      const outputs: ScanFile[] = [];
      const named: [string, unknown][] = [
        ['public/data/districts.json', state.districtsFile],
        ['public/data/history.json', state.historyFile],
        ['public/data/policy-track.json', state.policyTrackFile],
      ];
      for (const [p, value] of named) {
        try {
          outputs.push({ path: p, text: serializeJson(value) });
        } catch {
          // reported by the validators
        }
      }
      const env = envOverride ?? process.env;
      const findings = scanForCredentials([...outputs, ...readRawTextFiles(ctx.reader)], readTdxSecrets(env));
      for (const f of findings) {
        errors.push({
          file: f.path,
          path: `line ${f.line}`,
          rule: 'credential',
          message: `contains a credential (${f.kind}); the value is not shown`,
        });
      }
      if (errors.length > 0) throw new ValidationFailedError(errors);
    },
  };
}
