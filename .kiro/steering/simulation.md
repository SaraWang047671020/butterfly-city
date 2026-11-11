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
- Contested parameters present a range from different studies (see `neutrality.md`). The engine uses one documented central value; the "Why?" view shows the range.

## Time lags

- Policy effects enter a lag pipeline (`lag.ts`) and take effect after their cited delay. Delays from the brief:
  - Social housing: 3–5 years to completion
  - MRT extension: 6–8 years to opening
- Every other tool's lag must also be cited in the parameter table. Do not guess.
- Spending happens when committed; effects happen when the lag completes.

## Inter-district linkage

- When rent in a district rises too much, part of its population moves to nearby districts reachable by commute, using the 41×41 commute-time matrix.
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

Use example-based unit tests for each individual rule with hand-checked numbers.
