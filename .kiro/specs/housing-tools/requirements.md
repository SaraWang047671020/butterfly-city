# Requirements Document

Approved by the user on 2026-11-24 (「核准，開始查資料寫設計」).

## Introduction

This spec makes the budget the real constraint of the game and adds the two Coming_Soon_Tools: the sublease and rental management programme (包租代管) and the holding tax on multiple and vacant homes (囤房稅). It follows the user's decisions of 2026-11-24 (`KIRO-LOG.md`):

> 我覺得有一個很大的問題是現在政策範圍還是太少 … 現在好像沒有預算的問題，應該要加進去

### What the browser check showed (2026-11-24)

The limit that binds is not the budget but the default per-field range of `simulation.md` ("0 to 2 times the real value of that year"). Where the real value is 0 the upper limit is 0: in 2015Q3 the player cannot start a single social housing unit in Wanhua. On the real track TWD 219,866,191 of the 2015 budget stays unused, so the budget never forces a choice.

### Decisions of the user (2026-11-24)

1. Only documented limits stay: statutory ranges, physical or programme capacity, each with its source (option chosen: 「只留有依據的實際限制」). The budget becomes the constraint that forces choices.
2. Order: this spec, then `more-policies` (public transport fares, childcare, elder care, urban renewal), then back to `night-ghosts`.

### Who implements

Claude Code (recorded in `KIRO-LOG.md`).

### Out of scope

- The tools of `more-policies`; the budget rules here are written so that those tools join the same budget.
- Borrowing, debt or moving money from outside the five tools' real total (a later decision if the user wants it).

## Glossary

- **Annual_Budget**: the money the player can spend in a year on the Active_Tools: the real total spending of those tools in that year (as today, `simulation.md`), plus the holding-tax revenue above real history (Requirement 5.4).
- **Documented_Limit**: a lower or upper bound of a Tool_Field with a source: a statutory range (for example the House Tax Act rates), a programme capacity (for example eligible applicants), or a physical capacity (for example the social housing sites a city has). It replaces the default range of 0 to 2 times the real value.
- **Budget_Bar**: the main-screen view of the Annual_Budget: spent, committed and left, by tool.
- **Sublease_Tool**: the sublease and rental management programme: units matched per city and quarter.
- **Holding_Tax_Tool**: the house tax rates for non-owner-occupied homes per city (lowest and highest tier).

## Requirements

### Requirement 1: Approvals

1. THE Developer SHALL present a Design_Proposal of the Budget_Bar and of the Policy_Dialogs of the two tools at 1280 and 360 CSS pixels in both languages before these screens are built.
2. THE change of `simulation.md` ("Policy tool limits") SHALL be written as a proposed text and applied after the user's approval of this spec.
3. Every new parameter SHALL have a source or the status `gap` with an assumption, and contested values SHALL be ranges (`neutrality.md`).

### Requirement 2: Documented limits instead of the default range

1. THE default range of 0 to 2 times the real value SHALL be removed. Each Tool_Field SHALL have only Documented_Limits, each a parameter row with value, unit and source.
2. Where no documented upper limit exists for a field, THE field SHALL have no upper limit other than the Annual_Budget.
3. THE first Documented_Limits to research and set: social housing units started (the city's documented sites or construction capacity per year, by city); rent subsidy households (eligible applicants of the year, from the city datasets of the life-story research); rent subsidy amount per household (the legal or programme maximum of the year); commuter pass subsidy (not above the pass price); the two new tools (Requirements 4 and 5).
4. An adjustment outside a Documented_Limit SHALL be rejected with the limit, its reason and its source, as today.
5. THE backtest of the Engine (simulation-engine Requirement 20) SHALL still pass.

### Requirement 3: The budget on screen

1. THE main screen SHALL show the Budget_Bar of the Planning_Quarter's year: spent and committed by tool, and left, in words and numbers, not by colour only; on narrow screens it is in the menu with a short "NT$… left" next to ☰.
2. THE Policy_Dialog SHALL show, before Apply, the cost of the edit and what it leaves for the year, and WHERE the edit does not fit, how much the other tools would have to give up (for example "To start 500 more units here, about NT$… must come from another tool this year").
3. An edit that does not fit the Annual_Budget SHALL be rejected as today, with the amount missing.

### Requirement 4: Sublease_Tool (包租代管)

1. THE player SHALL set the units matched per city and quarter; its real values come from the policy track (`subleaseUnitsMatched`, `sublease-phases.csv`).
2. THE Engine SHALL house the matched units' tenants at the programme rent (central 80 % of market rent; disadvantaged households 50 % to 70 %, sourced), so fewer of them cross the rent line, with a lag from matching to move-in, sourced or `gap`.
3. THE cost per unit (service fees, the rent gap paid, insurance) SHALL come from the programme rules, or be `gap` with an assumption and a range.
4. THE life-story Applications SHALL gain a sublease Application (Life_Event option and odds from the units matched on each track), with its texts drafted for the user's approval.

### Requirement 5: Holding_Tax_Tool (囤房稅)

1. THE player SHALL set the lowest and highest tier rates per city within the statutory range of the year (House Tax Act: 1.5 % to 3.6 % before 2024-07-01, 2 % to 4.8 % after), from `holding-tax-rates.csv`.
2. THE Engine SHALL lower the low-use (vacant) housing of a city with a higher rate, from the sourced range (central: vacancy −13 % of its level, Segú 2020; the conversion from a share of rental value to a share of assessed value is a documented assumption), and the homes released join the rental stock, lowering rent.
3. THE low-use housing statistics (MOI 低度使用(用電)住宅, by district, every half year) SHALL be added to the Data_Files if district tables reach back to 2015, else the gap SHALL be recorded.
4. THE revenue above real history SHALL be added to the Annual_Budget of the next year (the rule of `product.md`: "Revenue from the holding tax may flow back into the budget"); a lower rate SHALL lower the next year's budget by the revenue lost.
5. THE Policy_Dialog SHALL show who bears the cost (owners of several or vacant homes) and who benefits (renters through the released homes), with the same detail on both sides (`neutrality.md`).

### Requirement 6: Tests

1. Property tests: no accepted setting is outside a Documented_Limit; spending never exceeds the Annual_Budget; with every tool on its real track, the results equal those of today (the new tools at their real values change nothing).
2. Unit tests of the two rules against hand-computed values; the backtest passes.

## Open questions (for the research and the design)

1. The documented capacity of social housing starts per city and year (site lists of Taipei and New Taipei).
2. The legal maximum of the rent subsidy amount per year (the city and central programme rules).
3. The sublease cost per unit to government and the lag from matching to move-in.
4. Whether the low-use housing tables by district reach back to 2015.
