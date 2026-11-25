# Implementation Plan: housing-tools

Claude Code implements this spec (recorded in `KIRO-LOG.md`). Requirements and design approved 2026-11-24; `simulation.md` limits updated. Commit after the full suite, the backtest and the browser check of the task.

## Tasks

- [x] 1. Approvals: requirements, design, `simulation.md`
- [x] 2. Limits
  - [x] 2.1 `checkLimit`: area and year specific `.max` ids, no upper limit without one; remove the factor parameters; `.min` 0
  - [x] 2.2 Documented_Limits in `params.json` (via the pipeline config) with sources: rent subsidy households (applications), rent subsidy amount (programme maximum), social housing starts (city capacity)
  - [x] 2.3 UI line (done with 2.1: "no upper limit" line, slider ends where the budget runs out via `affordableValue`; texts approved 2026-11-24) "no upper limit: the budget decides"; tests; backtest
- [x] 3. Budget on screen (Design_Proposal approved 2026-11-25): Budget_Bar in the Turn_Bar, "left" label next to ☰ on narrow screens, Budget_Bar with the draft in the Policy_Dialog, cost and over lines. Deviation: every figure counts the year with the current values kept to its end (the year-end check), so on the real track 0 is left; see KIRO-LOG
- [x] 4. Sublease_Tool: rule, parameters with sources, Policy_Card and dialog, life-story Application
  - [x] 4.1 Rule `src/simulation/rules/sublease.ts` (stock effect, see the design deviation), parameters `sublease.unitCost`, `.rentShare`, `.lag`, `.costSchedule` with sources, the `ghost-rent-sublease` group, Policy_Card and dialog with the approved texts and the effect line; demo save adjusts sublease once
  - [x] 4.2 Life-story sublease Application (texts and the 30 % real odds approved 2026-11-25): tenure `sublease`, eligibility from 2017 with the social housing income limit, odds from the homes matched on each track, a seeded district of the city, rent at `rentShare` of market rent, end at a renewal above the income limit; Life_Events `subleaseOffer`, `subleaseEnd` and the rent-pressure option (6 options: the text loader now allows 6, life-story 7.1 says 2 to 4); `subleaseOffer` priority 85 and cooldown 8 instead of the drafted 70 and 4 (see KIRO-LOG); 5 new UI strings for the odds bars and the Two_Me_Panel drafted for approval
- [x] 5. Holding_Tax_Tool: rule, revenue into the next year's budget, Policy_Card and dialog. Revenue moves to the next year as a negative charge with `holdingTax.costSchedule` (offset 4) instead of `BudgetLedger.extra` (same effect, no new ledger field); low-use homes by city, not district (district tables not retrieved); three new strings awaiting approval (card short name, two Scenario parameter names)
- [ ] 6. Finish: neutrality review of the new texts, browser checks, docs
