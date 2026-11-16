/**
 * Policy track step (task 12.1): reads the four raw policy files through `ctx.reader` and the three committed
 * tables from `data/config/`, runs the builders and stores the ten series in `state.policyTrack`.
 *
 * It needs the population step (city populations) and reuses `state.socialHousing` when the social housing step
 * has run; otherwise it loads the portal files itself. It is not part of DEFAULT_STEPS yet (task 14.2 wires it).
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../../lib/paths.ts';
import type { BuildContext } from '../context.ts';
import { DataError } from '../errors.ts';
import { loadSocialHousing } from '../indicators/social-housing.ts';
import { parseHouseTax6742 } from '../parsers/house-tax.ts';
import {
  parseCommuterPassProducts,
  parseHoldingTaxRates,
  parseSubleasePhases,
} from '../parsers/policy-tables.ts';
import { parseE3010, parseRentAmount169800 } from '../parsers/rent-subsidy.ts';
import type { BuildState, Step } from '../run.ts';
import {
  buildCommuterPassPrice,
  buildCommuterPassesSold,
  buildCommuterPassSubsidy,
  cityPopulation,
} from './commuter-pass.ts';
import { buildHoldingTaxRates, buildHouseTaxRevenue } from './holding-tax.ts';
import { buildRentSubsidyAmount, buildRentSubsidyHouseholds } from './rent-subsidy.ts';
import { buildSocialHousingStarts } from './social-housing-starts.ts';
import { buildSubleaseUnits } from './sublease.ts';
import type { PolicyTrackSeries } from './track.ts';

export const POLICY_RAW_FILES = {
  e3010Integrated: 'policy/housing/pip-e3010-6_1_3-taipei-newtaipei.json',
  e3010Expanded: 'policy/housing/pip-e3010-6_3_1-taipei-newtaipei.json',
  rentAmount: 'policy/housing/datagov-169800.csv',
  houseTax: 'policy/housing/datagov-6742.csv',
} as const;

export const HOLDING_TAX_TABLE = 'data/config/holding-tax-rates.csv';
export const COMMUTER_PASS_TABLE = 'data/config/commuter-pass-products.csv';
export const SUBLEASE_TABLE = 'data/config/sublease-phases.csv';

/** Reads a committed repository file by repository-relative path (`/` separators). */
export type CommittedReader = (repoRelPath: string) => string;

export const fsCommittedReader: CommittedReader = (repoRelPath) =>
  fs.readFileSync(path.join(ROOT, ...repoRelPath.split('/')), 'utf8').replace(/^\uFEFF/, '');

export function policyStep(readCommitted: CommittedReader = fsCommittedReader): Step {
  return {
    name: 'policy-track',
    run(ctx: BuildContext, state: BuildState) {
      const { reader, districts, quarters } = ctx;
      if (state.population === undefined) {
        throw new DataError('missing-step-output', 'commuterPassesSold population', ['run the population step before the policy track step']);
      }
      const load = state.socialHousing ?? loadSocialHousing(ctx);
      const read = (rel: string): [string, string] => [reader.readText(rel), reader.display(rel)];

      const starts = buildSocialHousingStarts(load.projects, load.details, districts, quarters);
      const sublease = buildSubleaseUnits(parseSubleasePhases(readCommitted(SUBLEASE_TABLE), SUBLEASE_TABLE), quarters);
      const households = buildRentSubsidyHouseholds(
        parseE3010(...read(POLICY_RAW_FILES.e3010Integrated)),
        parseE3010(...read(POLICY_RAW_FILES.e3010Expanded)),
        quarters,
      );
      const amount = buildRentSubsidyAmount(parseRentAmount169800(...read(POLICY_RAW_FILES.rentAmount)), quarters);
      const rates = buildHoldingTaxRates(parseHoldingTaxRates(readCommitted(HOLDING_TAX_TABLE), HOLDING_TAX_TABLE), quarters);
      const revenue = buildHouseTaxRevenue(parseHouseTax6742(...read(POLICY_RAW_FILES.houseTax)), quarters);
      const price = buildCommuterPassPrice(parseCommuterPassProducts(readCommitted(COMMUTER_PASS_TABLE), COMMUTER_PASS_TABLE), quarters);
      const sold = buildCommuterPassesSold(price, cityPopulation(state.population, districts, quarters), quarters);

      const track: PolicyTrackSeries = {
        socialHousingUnitsStarted: starts.series,
        subleaseUnitsMatched: sublease,
        rentSubsidyHouseholds: households,
        rentSubsidyAmountPerHousehold: amount,
        holdingTaxRateLowestTier: rates.lowest,
        holdingTaxRateHighestTier: rates.highest,
        houseTaxRevenue: revenue,
        commuterPassPrice: price,
        commuterPassSubsidy: buildCommuterPassSubsidy(quarters),
        commuterPassesSold: sold,
      };
      state.policyTrack = track;
      state.policyNotes = starts.notes;
      state.notes.push(...starts.notes);
    },
  };
}
