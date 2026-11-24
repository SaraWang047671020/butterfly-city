# Implementation Plan: housing-tools

Claude Code implements this spec (recorded in `KIRO-LOG.md`). Requirements and design approved 2026-11-24; `simulation.md` limits updated. Commit after the full suite, the backtest and the browser check of the task.

## Tasks

- [x] 1. Approvals: requirements, design, `simulation.md`
- [x] 2. Limits
  - [x] 2.1 `checkLimit`: area and year specific `.max` ids, no upper limit without one; remove the factor parameters; `.min` 0
  - [x] 2.2 Documented_Limits in `params.json` (via the pipeline config) with sources: rent subsidy households (applications), rent subsidy amount (programme maximum), social housing starts (city capacity)
  - [x] 2.3 UI line (done with 2.1: "no upper limit" line, slider ends where the budget runs out via `affordableValue`; texts approved 2026-11-24) "no upper limit: the budget decides"; tests; backtest
- [ ] 3. Budget on screen (after the Design_Proposal): Budget_Bar, cost and trade-off lines in the Policy_Dialog
- [ ] 4. Sublease_Tool: rule, parameters with sources, Policy_Card and dialog, life-story Application
- [ ] 5. Holding_Tax_Tool: rule, revenue into the next year's budget (`BudgetLedger.extra`), Policy_Card and dialog
- [ ] 6. Finish: neutrality review of the new texts, browser checks, docs
