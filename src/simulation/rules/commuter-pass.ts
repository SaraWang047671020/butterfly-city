// Commuter pass subsidy tool (Requirement 5). City level, flow effect.
// Field `subsidy` (TWD per pass per month, upper limit is the pass price); track-only field `passesSold`.
// Pure functions. The rule works from the Policy_Difference (player minus real), never from absolute values.

import type { CityName, DistrictCode, QuarterKey } from '../../types/data-files.ts';
import type {
  AreaKey,
  CauseLinks,
  EngineError,
  ParameterSpec,
  RuleContext,
  ToolEffects,
  ToolRule,
  ToolSetting,
} from '../../types/simulation.ts';
import { CITY_ORDER, MAX_LAG, QUARTER_COUNT } from '../constants.ts';
import { policyValueInvalid, realNetPriceZero } from '../errors.ts';
import { roundHalfUp } from '../numeric.ts';
import { expandId, scalar } from '../params.ts';
import { quarterAt, quarterIndex } from '../quarter.ts';

const TOOL_ID = 'commuterPass';
const SUBSIDY = 'subsidy';
const PASSES_SOLD = 'passesSold';
const LAG_ID = 'commuterPass.lag';
const UNIT_COST_ID = 'commuterPass.unitCost';
const ELASTICITY_ID = 'commuterPass.elasticity';
const PRICE_TEMPLATE = 'commuterPass.price.<city>.<quarter>';
const MRT_ENTRIES = 'mrtEntries';

function priceId(city: CityName, quarter: QuarterKey): string {
  return expandId(PRICE_TEMPLATE, { city, quarter });
}

function pricePerQuarterSpecs(): ParameterSpec[] {
  const specs: ParameterSpec[] = [];
  for (const city of CITY_ORDER) {
    for (let i = 0; i < QUARTER_COUNT; i += 1) {
      specs.push({
        id: priceId(city, quarterAt(i)),
        role: 'derivation',
        check: { kind: 'non-negative' },
      });
    }
  }
  return specs;
}

function fieldValue(setting: ToolSetting, field: string, area: AreaKey): number | undefined {
  const byArea = Object.hasOwn(setting, field) ? setting[field] : undefined;
  if (byArea === undefined || !Object.hasOwn(byArea, area)) return undefined;
  return byArea[area];
}

/** Real setting of this tool in quarter `q`, or undefined when the track has no entry. */
function realToolSetting(ctx: RuleContext, q: QuarterKey): ToolSetting | undefined {
  for (const entry of ctx.realTrack) {
    if (entry.quarter === q) return Object.hasOwn(entry.tools, TOOL_ID) ? entry.tools[TOOL_ID] : undefined;
  }
  return undefined;
}

/** Net price of the real setting in quarter q: price minus real subsidy. */
function realNetPrice(price: number, real: ToolSetting, city: CityName): number {
  return price - (fieldValue(real, SUBSIDY, city) ?? Number.NaN);
}

/**
 * Relative change of the net pass price, rho = -delta / N where N is the real net price.
 * Exactly 0 when the difference is 0, and 0 when the tool is inactive or N is not positive
 * (checkSetting reports those cases as errors before any effect is computed).
 */
function relativeChange(delta: number, price: number, real: ToolSetting, city: CityName): number {
  if (delta === 0 || !(price > 0)) return 0;
  const net = realNetPrice(price, real, city);
  return net > 0 ? -delta / net : 0;
}

function sortedUnique(ids: readonly string[]): readonly string[] {
  return [...new Set(ids)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export const commuterPassRule: ToolRule = {
  id: TOOL_ID,
  level: 'city',
  effect: 'flow',
  fields: [{ id: SUBSIDY, area: 'city', limitScope: 'quarter' }],
  trackOnlyFields: [PASSES_SOLD],
  lagParameterId: LAG_ID,
  modifiable: [MRT_ENTRIES],

  parameters(): readonly ParameterSpec[] {
    return [
      { id: LAG_ID, role: 'lag', check: { kind: 'integer', min: 0, max: MAX_LAG } },
      { id: UNIT_COST_ID, role: 'cost', check: { kind: 'positive' } },
      { id: ELASTICITY_ID, role: 'effect', check: { kind: 'finite' } },
      { id: 'commuterPass.costSchedule', role: 'schedule', check: { kind: 'schedule' }, optional: true },
      ...pricePerQuarterSpecs(),
    ];
  },

  checkSetting(player, real, quarter, ctx): EngineError | null {
    for (const city of CITY_ORDER) {
      const price = scalar(ctx.params, priceId(city, quarter));
      if (!Number.isFinite(price) || price < 0) {
        return policyValueInvalid(TOOL_ID, SUBSIDY, city, quarter, null, 'pass price is missing or negative');
      }
      if (price > 0) {
        const realSubsidy = fieldValue(real, SUBSIDY, city);
        if (realSubsidy !== undefined && price - realSubsidy === 0) {
          return realNetPriceZero(city, quarter);
        }
      }
      const value = fieldValue(player, SUBSIDY, city);
      if (value === undefined || !Number.isFinite(value)) {
        return policyValueInvalid(TOOL_ID, SUBSIDY, city, quarter, value === undefined ? null : value, 'not a finite number');
      }
      if (value < 0) {
        return policyValueInvalid(TOOL_ID, SUBSIDY, city, quarter, value, 'below 0');
      }
      if (value > price) {
        return policyValueInvalid(
          TOOL_ID,
          SUBSIDY,
          city,
          quarter,
          value,
          price === 0 ? 'no commuter pass product exists, only 0 is accepted' : `above the pass price ${price}`,
        );
      }
    }
    return null;
  },

  difference(player, real, quarter, ctx): Readonly<Record<AreaKey, number>> {
    const out: Record<AreaKey, number> = {};
    for (const city of CITY_ORDER) {
      const price = scalar(ctx.params, priceId(city, quarter));
      if (!(price > 0)) {
        out[city] = 0;
        continue;
      }
      const p = fieldValue(player, SUBSIDY, city) ?? Number.NaN;
      const r = fieldValue(real, SUBSIDY, city) ?? Number.NaN;
      out[city] = p - r;
    }
    return out;
  },

  charge(player, real, quarter, ctx): { readonly real: number; readonly difference: number } {
    const elasticity = scalar(ctx.params, ELASTICITY_ID);
    const unitCost = scalar(ctx.params, UNIT_COST_ID);
    let realTotal = 0;
    let differenceTotal = 0;
    for (const city of CITY_ORDER) {
      const price = scalar(ctx.params, priceId(city, quarter));
      if (!(price > 0)) continue;
      const realSubsidy = fieldValue(real, SUBSIDY, city) ?? Number.NaN;
      const sold = fieldValue(real, PASSES_SOLD, city) ?? Number.NaN;
      const delta = (fieldValue(player, SUBSIDY, city) ?? Number.NaN) - realSubsidy;
      const rho = relativeChange(delta, price, real, city);
      const adjusted = Math.max(0, sold * (1 + elasticity * rho));
      realTotal += realSubsidy * sold * 3 * unitCost;
      differenceTotal += delta * adjusted * 3 * unitCost;
    }
    return { real: roundHalfUp(realTotal), difference: roundHalfUp(differenceTotal) };
  },

  effects(active, t, ctx): ToolEffects {
    const lag = scalar(ctx.params, LAG_ID);
    const q = quarterAt(quarterIndex(t) - lag);
    const elasticity = scalar(ctx.params, ELASTICITY_ID);
    const real = realToolSetting(ctx, q) ?? {};
    const tIndex = quarterIndex(t) - quarterIndex(ctx.baseline.quarters[0] ?? t);
    const entries = ctx.baseline.indicators[MRT_ENTRIES];

    const mrt: Record<DistrictCode, number> = {};
    const cost: Record<DistrictCode, number> = {};
    for (const district of ctx.baseline.districts) {
      const delta = Object.hasOwn(active, district.city) ? (active[district.city] ?? 0) : 0;
      const price = scalar(ctx.params, priceId(district.city, q));
      const rho = relativeChange(delta, price, real, district.city);
      const series = entries !== undefined && Object.hasOwn(entries, district.code) ? entries[district.code] : undefined;
      const base = series?.[tIndex];
      const entriesNow = typeof base === 'number' && Number.isFinite(base) ? base : 0;
      mrt[district.code] = entriesNow * elasticity * rho;
      cost[district.code] = delta;
    }

    const links: CauseLinks = {
      parameterIds: sortedUnique([
        LAG_ID,
        ELASTICITY_ID,
        // The lagged quarter can fall before the first quarter, where no price parameter exists (13.7).
        ...CITY_ORDER.map((city) => priceId(city, q)).filter((id) => Object.hasOwn(ctx.params, id)),
      ]),
      sourceIds: sortedUnique(ctx.baseline.indicatorSources[MRT_ENTRIES] ?? []),
    };
    return {
      deltas: { [MRT_ENTRIES]: mrt },
      links: { [MRT_ENTRIES]: links },
      commuteCostDelta: cost,
    };
  },
};
