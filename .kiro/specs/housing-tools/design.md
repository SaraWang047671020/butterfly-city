# Design Document

Approved by the user on 2026-11-24 (「設計核准，查完資料就繼續」). `simulation.md` "Policy tool limits" updated as Requirement 1.2 proposed.

## Overview

Three changes, in this order, each ending with the full suite, the backtest and a browser check:

1. **Limits** (Requirement 2): the default range of 0 to 2 times the real value is replaced by Documented_Limits; where none exists, only the Annual_Budget limits a field.
2. **Budget on screen** (Requirement 3): the Budget_Bar and the cost and trade-off lines of the Policy_Dialog.
3. **The two tools** (Requirements 4, 5): `sublease` and `holdingTax` rules in the Rule_Registry, their Policy_Cards and dialogs, and the sublease Application of the life story.

## What exists in the Engine

- `checkLimit` (`src/simulation/budget.ts`) already reads an absolute bound `limit.<tool>.<field>.max` before the factor `limit.<tool>.<field>.upperFactor`, and `.upperMin`; the commuter pass subsidy is already bounded by the pass price.
- `params.json` has only factor limits (`lowerFactor` 0 and `upperFactor` 2 for social housing starts, rent subsidy households and amount), all with the source "game default".
- `planBudget` fixes the Annual_Budget per year from the real track at stage 0 (sum of the real charges of every tool); per-tool ceilings default to the Annual_Budget, so they do not bind.

## Limits (Requirement 2)

`checkLimit` looks up, in this order: `limit.<tool>.<field>.max.<area>.<year>`, `limit.<tool>.<field>.max.<area>`, `limit.<tool>.<field>.max`; WHEN none exists, `upper = Infinity` and the field is limited by the Annual_Budget only. The factor parameters are removed from `params.json` and from the parameter specs; `lower` becomes `limit.<tool>.<field>.min` (0, source "a count or an amount cannot be negative").

| Field | Upper limit | Source (research of 2026-11-24) |
|---|---|---|
| socialHousing.unitsStarted (scope city-year) | the documented capacity of the city per year | research item 1 |
| rentSubsidy.households (city, quarter) | the applications of the city and year | data.gov.tw 132047, 122939 (life-story research) |
| rentSubsidy.amount (city, quarter) | the largest amount a household could receive in the period | research item 2 |
| commuterPass.subsidy | the pass price (unchanged) | params |
| sublease.unitsMatched (city, quarter) | none (budget only) unless the research finds a programme quota | research item 3 |
| holdingTax.lowestRate / highestRate (city) | the statutory range of the date | House Tax Act, `holding-tax-rates.csv` |

The UI keeps the "lower limit · real · upper limit" line; an infinite upper limit reads "no upper limit: the budget decides".

## Budget on screen (Requirement 3)

- **Budget_Bar**: one bar per year on the Turn_Bar block (wide screens) or as "NT$… left" next to ☰ (narrow screens, full bar in the menu): segments spent and committed per tool, then left; each segment's tool named in words in a legend; values from the BudgetLedger the controller already keeps.
- **Policy_Dialog**: under the field, "This change costs NT$… this year; NT$… stays." and, when it does not fit, "NT$… missing: lower another tool this year (social housing NT$…, rent subsidy NT$…, sublease NT$…)". Computed by the controller with `checkBudget` on the draft.

## Sublease_Tool (Requirement 4)

`src/simulation/rules/sublease.ts`, city level, flow effect, modelled on the rent subsidy rule:

- Field `unitsMatched` (integer, city, quarter); real values `subleaseUnitsMatched` of the policy track.
- **Effect**: a matched unit houses a renter household at the programme rent: the household's rent falls by `(1 − sublease.rentShare) × market rent of a dwelling`; no pass-through (the programme sets the rent). The difference in units is allocated to districts by renter households, as the rent subsidy does; Ghost groups as the rent subsidy's (`source: 'sublease'`).
- **Lag**: `sublease.lag` quarters from matching to move-in (research item 3, else `gap`, central 1).
- **Cost**: `sublease.unitCost` per unit per quarter (service fees, the rent gap of 包租, insurance; research item 3, else `gap` with a range), spread by `sublease.costSchedule`.
- **Life story**: `apply` gains `benefit: 'sublease'`; odds from units matched per track, as the rent subsidy; the real odds from the research, or `gap`. New Life_Event option texts drafted for approval.

## Holding_Tax_Tool (Requirement 5)

`src/simulation/rules/holding-tax.ts`, city level, stock effect:

- Fields `lowestRate`, `highestRate` (percent of assessed house value, city); real values from the policy track (`holdingTaxRateLowestTier`, `holdingTaxRateHighestTier`).
- **Vacancy**: the low-use homes of a district (`lowUseHousingCount`, history) change by `ε × Δrate ÷ rate_real` of their level, where ε comes from Segú (2020: −13 % for the French tax), converted to Taiwan's tax base with a documented assumption (Requirement 1.3), as a range.
- **Rent**: the released homes join the rental stock; the rent of the district falls by `released ÷ rental stock × supply elasticity` (a sourced range, or `gap`).
- **Revenue**: `houseTaxRevenue` (policy track, NT$ thousand per quarter) scales with the rate: `revenue_player = revenue_real × rate_player ÷ rate_real × (1 − vacancy shrink of the base)`; the difference of a year is added to the next year's Annual_Budget. `BudgetLedger` gains `extra[y]` (revenue added) and `checkBudget` reads `annualBudget[y] + extra[y]`; with the real rates `extra` is 0, so the real track is unchanged.
- **Cost line** of the dialog: owners of several or vacant homes pay more; renters gain through released homes; both with numbers.

## Testing

Property tests: no accepted setting outside a Documented_Limit; spending ≤ `annualBudget + extra` every year; with all tools on their real values, every indicator equals today's (the new rules contribute exactly 0). Unit tests of both rules by hand. The backtest (`npm run backtest`) passes.

## Research results

Full notes with sources S1 to S26: `data/research/housing-tools-2026-11-24.md`.

| Item | Found | Proposed use |
|---|---|---|
| Social housing capacity | Central plan, revision 2 (2022-04): Taipei 26,000 and New Taipei 33,000 units over 2017–2024. No per-year start series published for either city. | `limit.socialHousing.unitsStarted.max.<city>` = allocation ÷ 8 years: Taipei 3,250, New Taipei 4,125 per year, status `secondary`, method stated |
| Rent subsidy maximum per household per month | 2015–2021 central programme: Taipei 5,000, New Taipei 4,000. From 2022-07 (300億 programme) with multipliers: Taipei 14,400, New Taipei 9,000 | `limit.rentSubsidy.amount.max.<city>.<year>` by period |
| Rent subsidy households | Applications per city and year (life-story research, data.gov.tw 132047, 122939) | `limit.rentSubsidy.households.max.<city>.<year>` |
| Sublease cost | Phase 5 management fees per month: Taipei 3,000 (包租) / 1,700 (代管), New Taipei 2,600 / 1,500; programme budgeting average about 2,200 per month; insurance 3,500 per year | `sublease.unitCost` central about NT$55,000 per unit per year, range from the fee table |
| Sublease rent | Phases 1–3: 80 % of market rent (包租), 90 % (代管); from phase 4 capped at appraised market rent | `sublease.rentShare` range 0.8 to 1.0, central 0.85 |
| Sublease lag | Only the rule (7 + 7 working days of review and inspection); no measured average | `sublease.lag` 1 quarter, status `gap` |
| Sublease matches | Cumulative to 2026-10-31: Taipei 21,006, New Taipei 56,578; no per-year figures | real track from `sublease-phases.csv` as today |
| Low-use housing | District tables from 2009 to 2025 H2 (MOI E1040) | add to the Data_Files (Requirement 5.3 met) |
| 囤房稅 2.0 | Both cities: 3.2 % (≤ 2 homes), 3.8 % (3–4), 4.2 % (5–6), 4.8 % (7+); New Taipei from a news report of the council vote | real track; statutory range as the limit |

