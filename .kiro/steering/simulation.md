---
inclusion: fileMatch
fileMatchPattern: 'src/simulation/**'
---

# Simulation Model: Principles and Invariants

## Core model: deltas on a real baseline

- Each quarter's baseline is **real historical data** from `history.json`.
- The engine only computes the change caused by **the difference between the player's policies and the real policies**, and adds that change to the real baseline.
- The real policy track (what was actually built, opened, subsidized, or taxed each quarter) is input data. The player's policy is expressed relative to it.
- **Zero-delta identity (the most important correctness check)**: if the player changes nothing, every output indicator for every district and every quarter must equal the real historical baseline exactly.

## Events in Historical mode

- The real baseline in `history.json` already contains the effect of every real event (interest rate changes, COVID-19, central bank credit controls, TPASS, the New Youth Housing Loan, earthquakes, and so on). **An event must never add to or subtract from an indicator directly.** Applying it again would count it twice and break the zero-delta identity.
- An event may only change **how strongly the player's policy difference acts**. Example: while a rate-rise event is active, a city with more social housing than reality shows a smaller rent shock than the real baseline. Such an event modifier is a multiplier on a policy-difference effect, with its own cited parameter (and a low / central / high range if contested).
- When the player's policy difference is zero, the modifier has nothing to scale, so the result stays equal to the real baseline.
- An event without a modifier is **narrative and explanation only**: it appears on the timeline and in "Why?" with its real date, measured impact and sources, and changes no number.
- This rule is for Historical mode. Future mode (random events) will define its own rule when it is designed.

## Determinism and purity

- The engine is a set of pure functions: `step(state, policies, events, params) -> nextState`.
- No DOM, no network, no storage, no `Date.now()`, no unseeded `Math.random()`, no module-level mutable state.
- Inputs are treated as immutable (`readonly` types). Never mutate arguments.
- The same starting state, policies, and events always produce the same result.
- Future mode randomness uses an explicit seeded PRNG passed in as input. The seed is part of the save.

## Rules and parameters

- 10–15 rules total. One rule per file in `src/simulation/rules/`.
- All parameters live in one parameter table (`params.json`, typed in `src/types/`). No magic numbers inside rule logic.
- Every parameter entry has: `value`, `unit`, `source` (citation + URL), and optionally `range` with `low` / `high` and their sources.
- A parameter that studies disagree on has three values: `low`, `central` and `high`, each with its own source (see `neutrality.md`). `low` ≤ `central` ≤ `high` numerically. A parameter that is not contested has one `value`.
- The headline result uses the `central` values. The engine can also run with every contested parameter at `low` and at `high`, and the interface shows the result as a range (minimum and maximum of the three runs, with the central result marked). The three runs are a scenario range, not a statistical interval, and the interface says so.
- Baseline data does not depend on parameters, so the zero-delta identity holds in all three runs.

## Time lags

- Policy effects enter a lag pipeline (`lag.ts`) and take effect after their cited delay. Delays from the brief:
  - Social housing: 3–5 years to completion
- Every other tool's lag must also be cited in the parameter table. Do not guess.
- Spending happens when committed; effects happen when the lag completes.

## Inter-district linkage

- When rent in a district rises too much, part of its population moves to nearby districts reachable by commute, using the 41×41 commute-time matrix. The MVP uses a single matrix for the 2025Q4 rail network in every quarter; per-quarter matrices are future work and are listed in the model limitations. The player cannot change the network.
- Migration conserves people: total outflow from districts equals total inflow to other districts (plus any explicitly modeled exit from the metro area).
- Migration thresholds and shares are cited parameters.

## Ghosts

- A resident becomes a ghost when rent burden or commute time crosses a cited threshold, or when they are displaced.
- Ghost counts per district are derived only from simulation output, never set by UI code.
- Ghost counts are non-negative integers.

## Explainability

- Every output number must be decomposable into contributing causes (baseline, each policy delta, each event, migration) via `explain.ts`.
- The cause contributions must sum to the displayed value (within floating-point tolerance).
- Each cause links to its parameter or data source.
- When an event modifier changes the size of a policy-difference effect, the breakdown shows the effect without the modifier and, as a separate cause, the amount the modifier added or removed. The two still sum to the displayed value.

## Policy tool limits

- The player adjusts each of the 5 tools relative to its real value. Every tool has a **lower and an upper limit** for each year. The default range is **0 to 2 times the real value** of that year. A tool uses a different range only when a documented reason requires it (for example a statutory range such as the house tax rates in the House Tax Act, or a physical limit such as the number of buildable sites).
- Spending is also limited by the **real municipal budget**. The total over the 5 tools in a year never exceeds the real total for that year, and each tool has a ceiling taken from real city budget figures where they exist.
- Every limit and ceiling is a row in the parameter table with `value`, `unit` and `source`. Where no real figure exists for a tool and year, the row is marked `estimated` with its method, as in the data pipeline.
- The interface and the engine both enforce the limits. An adjustment outside a limit is rejected, not clipped silently, and the player sees which limit applies and why.

## Invariants (must be tested)

Property-based tests with fast-check over arbitrary valid policies, event sequences, and seeds:

1. **Budget never overspent**: allocated spending ≤ available budget, for every year.
2. **Bounded indicators**: every 0–100 indicator stays within [0, 100] for every district and quarter.
3. **Determinism**: identical inputs produce identical outputs.
4. **Zero-delta identity**: real policies produce exactly the real baseline.
5. **Population conservation** in migration.
6. **Explanation sums**: cause contributions sum to the displayed value.
7. **Non-negative counts**: population, housing units, and ghosts are never negative.
8. **No input mutation**: inputs are deep-equal before and after a step.
9. **Events never move indicators on their own**: with every tool at its real value, any set of events gives exactly the real baseline.
10. **Tool limits and budget**: every accepted tool setting lies within its limits, and spending never exceeds the real total or any tool ceiling.
11. **Parameter order**: `low` ≤ `central` ≤ `high` for every contested parameter, and the zero-delta identity holds under all three.
12. **Range contains the central result**: for every output, the displayed minimum ≤ central ≤ maximum.

Use example-based unit tests for each individual rule with hand-checked numbers.
