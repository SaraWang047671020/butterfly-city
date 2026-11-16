# Engine input formats

This file lists what `scripts/backtest/adapt.ts` reads from `public/data/` and what the simulation engine then validates. It is the reference for the data task that produces `params.json` and the commute matrix. Sources: `scripts/backtest/adapt.ts`, `src/types/simulation.ts`, `src/types/data-files.ts`, `src/simulation/validate.ts`, `src/simulation/params.ts`, and the "Required parameters" table of `.kiro/specs/simulation-engine/design.md`.

Status of `public/data/` at the time of writing: `districts.json`, `history.json` and `policy-track.json` exist. `params.json` and `commute-matrix.json` do not exist, and `districts.json` has no `commuteMatrix` field. `adapt.ts` reports `missing input: params.json` until `params.json` exists.

## 1. `public/data/params.json`

### Top-level shape

Either of these is accepted. `adapt.ts` uses `raw.parameters` when it is an object, and otherwise treats the whole file as the table.

```json
{ "schemaVersion": 1, "parameters": { "<parameterId>": { ... }, "...": { ... } } }
```

Use the wrapped form. With the unwrapped form, any top-level metadata key (such as `schemaVersion`) would be read as a parameter and fail validation.

Keys are parameter ids. `adapt.ts` merges this table with the `commuterPass.price.<city>.<quarter>` parameters that it builds from `policy-track.json` (the same id in `params.json` is overwritten by the track value). Do not put pass prices in `params.json`.

### Entry: scalar parameter (`ScalarParameter`)

```json
{
  "kind": "scalar",
  "value": 0.8,
  "unit": "share",
  "source": { "citation": "Agency, dataset", "url": "https://..." },
  "status": "secondary",
  "range": {
    "low": 0.5, "high": 0.9,
    "lowSource":  { "citation": "...", "url": "https://..." },
    "highSource": { "citation": "...", "url": "https://..." }
  },
  "estimated": { "method": "How the value was derived" },
  "assumption": "Text, required for a gap parameter that has a value"
}
```

| Field | Rule (checked in stage 0, `params.ts`) |
|---|---|
| `kind` | `"scalar"` or `"schedule"`. A scalar where a schedule is required (or the reverse) is `missing`. |
| `value` | Finite number, within the check of the parameter (see section 1.3). |
| `unit` | Non-empty string (`unit-empty`). |
| `source.citation`, `source.url` | Both non-empty (`source-empty`). |
| `status` | Required. One of `verified`, `check`, `secondary`, `gap` (`status-missing`, `status-unknown`). |
| `estimated` | Object `{ "method": non-empty string }`. Required when `status` is `secondary` or `gap` (`estimated-missing`, `estimated-method-empty`). |
| `assumption` | Non-blank string. Required when `status` is `gap` (`assumption-missing`). |
| `range` | Optional. `low` and `high` finite with `low <= high`, and `low <= value <= high` (`range-invalid`, `value-outside-range`). `lowSource` and `highSource` need non-empty `citation` and `url` (`source-empty`). |

Special cases: `socialHousing.lag` needs `estimated.method` containing the text `NLMA` (`lag-derivation-missing`). `ghost.rentThreshold` must have no `range` (`range-not-allowed`). `unit-share` parameters (`socialHousing.rentRatio`) need `0 < value <= 1` and a range inside 0 to 1.

Only the ranged effect parameters `socialHousing.rentPerUnit`, `socialHousing.rentRatio`, `commuterPass.elasticity`, `rentSubsidy.passThrough`, `ghost.commuteThreshold` and `ghost.shareCommuteWithin` change between the `low`, `central` and `high` Scenarios. For them, `range.low` is the strongest effect (or the lowest threshold).

### Entry: schedule parameter (`ScheduleParameter`)

Used for `<tool>.costSchedule` (charge spread over quarters).

```json
{
  "kind": "schedule",
  "offsets": [0, 1, 2, 3],
  "shares": [0.25, 0.25, 0.25, 0.25],
  "unit": "share of charge per quarter offset",
  "source": { "citation": "...", "url": "https://..." },
  "status": "secondary",
  "estimated": { "method": "..." }
}
```

`offsets` are distinct integers 0 to 43, `shares` are non-negative with the same length, and the shares sum to 1 within 1e-9. `socialHousing.costSchedule` is required. `commuterPass.costSchedule` and `rentSubsidy.costSchedule` are optional (without one, the whole charge falls in the commit quarter). Same `unit`, `source`, `status` and metadata rules as scalars.

### 1.3 Required parameter ids

| Id | Check | Notes |
|---|---|---|
| `socialHousing.lag` | integer 0–43 | `estimated.method` must contain `NLMA` |
| `socialHousing.unitCost` | positive | `range` allowed, not varied |
| `socialHousing.costSchedule` | schedule | required |
| `socialHousing.rentPerUnit` | finite | ranged: low −2.5 %, value 0, high +6.5 % (converted units) |
| `socialHousing.rentRatio` | 0 < v ≤ 1 | ranged: 0.5 / 0.8 / 0.9 |
| `commuterPass.lag` | integer 0–43 | |
| `commuterPass.unitCost` | positive | |
| `commuterPass.elasticity` | finite | ranged: −0.5 / −0.3 / −0.2 |
| `commuterPass.costSchedule` | schedule, optional | |
| `rentSubsidy.lag` | integer 0–43 | |
| `rentSubsidy.unitCost` | positive | TWD of budget per TWD of subsidy, cited value 1 |
| `rentSubsidy.passThrough` | share, optional | ranged: 0.16 / 0.50 / 0.78 |
| `rentSubsidy.costSchedule` | schedule, optional | |
| `rentSubsidy.nationalBudget`, `rentSubsidy.nationalHouseholds` | non-negative, optional | reference only |
| `housing.dwellingSize` | positive | m² |
| `housing.householdSize.Taipei`, `housing.householdSize.New Taipei` | positive | persons per household |
| `housing.renterRate.Taipei`, `housing.renterRate.New Taipei` | share | |
| `commute.jobShare.<code>` (41 ids, one per District_Code) | share; the 41 values sum to 1 ± 1e-9 | |
| `migration.threshold` | non-negative | percentage points |
| `migration.share`, `migration.exitShare` | share | |
| `migration.weightTime`, `migration.weightBurden`, `migration.weightCost` | non-negative | |
| `migration.commuteCostPerMinute` | non-negative | TWD per minute per month |
| `ghost.size` | positive; must also be an integer ≥ 1 | default 1,000 |
| `ghost.shareRent`, `ghost.shareCommuteWithin`, `ghost.shareBoth` | share | `shareBoth ≤ min(shareRent, 1 − shareCommuteWithin.high)`; `shareCommuteWithin` ranged (low = share within 45 min, value = high = share within 60 min) |
| `ghost.sensitivityRent` | share (0 to 1) | status `gap` with `assumption` until a source exists |
| `ghost.sensitivityCommute` | non-negative | |
| `ghost.commuteThreshold` | positive | ranged 45 / 60 / 60 |
| `ghost.rentThreshold` | positive | 50 percent, no range |
| `ghost.atRiskThreshold` | optional | never read by the engine |
| `limit.socialHousing.unitsStarted.lowerFactor` | share (0 to 1) | default 0 |
| `limit.socialHousing.unitsStarted.upperFactor` | finite, ≥ 1 | default 2 |
| `limit.socialHousing.unitsStarted.upperMin`, `.min`, `.max` | non-negative, optional | absolute limits must include every real value |
| `limit.commuterPass.subsidy.lowerFactor` | share | the upper limit is the pass price |
| `limit.rentSubsidy.households.lowerFactor`, `.upperFactor` | share; finite ≥ 1 | |
| `limit.rentSubsidy.amount.lowerFactor`, `.upperFactor` | share; finite ≥ 1 | |
| `budget.ceiling.<tool>.<year>` | non-negative integer, optional | tools `socialHousing`, `commuterPass`, `rentSubsidy`; years 2015–2025; without one, the ceiling is the Annual_Budget |

The limit ids for `commuterPass` and `rentSubsidy` are not declared as `ParameterSpec` entries by their rules today, so stage 0 does not report them as missing. `budget.checkLimit` reads them with `scalar()`, which returns NaN when absent, so they must be present (see mismatch 4).

Ids that `adapt.ts` generates itself, not to be placed in `params.json`:

- `commuterPass.price.<city>.<quarter>`, for city `Taipei` and `New Taipei` and every quarter 2015Q1–2025Q4 (88 ids). Built from the `commuterPassPrice` series of `policy-track.json`. Status is `verified` for a real value, and `secondary` with `estimated.method` for an estimated value. Unit is the series unit.

## 2. `public/data/commute-matrix.json` and the fallback field

```json
{ "codes": ["63000010", "...", "65000290"], "minutes": [[0, 12.5, "..."], "..."] }
```

Rules (`validate.ts` step 4, `checkCommuteMatrix`):

- `codes` has exactly 41 entries, in ascending District_Code order, and equals `baseline.districts` in the same order. The engine baseline order is the ascending order of the codes in `districts.json`.
- `minutes` is 41 rows of 41 numbers, indexed as `minutes[origin][destination]` in the order of `codes`.
- Every value is a finite number and non-negative. The diagonal is exactly 0. The matrix need not be symmetric.
- The unit is minutes of one-way travel.

Fallback: when `commute-matrix.json` does not exist (only the "missing input" case), `adapt.ts` uses the `commuteMatrix` field of `districts.json`, with the same `{ "codes", "minutes" }` shape. If the file exists but is invalid JSON, there is no fallback. If neither exists, the result is `missing input: commute-matrix.json`.

The matrix is one fixed matrix for all quarters (see "Model limitations" in the simulation-engine design).

## 3. Other inputs that `adapt.ts` reads

### `districts.json`

- Needs a `districts` array of `{ code, city }` (the full `DistrictsFile` shape already provides this). `city` is `Taipei` or `New Taipei`. The engine orders districts by ascending `code`.
- Optional `commuteMatrix` (section 2).

### `history.json` (`HistoryFile`)

- `quarters`: the 44 keys `2015Q1`…`2025Q4`, consecutive.
- Only indicators with `level: "district"` are used. For each, every one of the 41 codes needs a series. Each series element's `value` is used as is (`number`); a `null` value fails baseline validation.
- Required district indicators (read by the rules): `population`, `householdIncome` (TWD per household per year, divided by 12 by the engine), `rent` (TWD per m² per month), `socialHousingStock` (units), `mrtEntries` (entries per quarter). Other indicators are carried but unused.
- Each indicator's `sources` list becomes `indicatorSources`. Every Source_Id in the `sources` of the five required indicators must exist in `history.sources[].id` (the Baseline source registry), or stage 0 returns `rule-reference-missing`.
- Each indicator needs at least one source, so that the Baseline Cause has a link (Requirement 13.7).

### `policy-track.json` (`PolicyTrackFile`)

- `quarters`: the 44 keys. Each series has one record per quarter, aligned by index.
- Series ids that must exist (the `TRACK_FIELDS` map), with the tool field they feed:

| Series id | Level | Tool field |
|---|---|---|
| `socialHousingUnitsStarted` | district (41 codes) | `socialHousing.unitsStarted` |
| `commuterPassSubsidy` | city | `commuterPass.subsidy` |
| `commuterPassesSold` | city | `commuterPass.passesSold` (track-only) |
| `rentSubsidyHouseholds` | city | `rentSubsidy.households` |
| `rentSubsidyAmountPerHousehold` | city | `rentSubsidy.amount` |
| `commuterPassPrice` | city | becomes `commuterPass.price.<city>.<quarter>` |

- City keys are `Taipei` and `New Taipei`. Each record needs `value`, `source` (a Source_Id in `file.sources`; an unknown id gives a parameter with citation = the id and an empty `url`, which then fails `source-empty`) and `estimated` (with `method` when true).
- Values must be finite and non-negative; `unitsStarted` and `households` must be integers.
- Other series (`sublease…`, `holdingTax…`, `houseTaxRevenue`) are ignored.

## 4. Check against the files in `public/data/` (nothing was changed)

Read on the date of writing:

| File | Result |
|---|---|
| `history.json` | 44 quarters, 2015Q1–2025Q4. District indicators present with 41 codes each: `population`, `moveIn`, `moveOut`, `relativeMedianIncome`, `householdIncome`, `salePrice`, `rent`, `mrtEntries`, `socialHousingCompletions`, `socialHousingStock`. All five required ones exist. City indicators `cityDisposableIncome`, `priceToIncomeRatio` are skipped by `adapt.ts`. |
| `policy-track.json` | 44 quarters. All six series ids needed by `adapt.ts` exist with the expected levels (`socialHousingUnitsStarted` 41 keys, the others 2 keys). Extra series for sublease and holding tax are ignored. |
| `districts.json` | 41 districts, ascending codes `63000010`…`65000290`, cities `Taipei` and `New Taipei`. No `commuteMatrix` field. |
| `params.json` | Does not exist. |
| `commute-matrix.json` | Does not exist. |

## 5. Mismatches and points to watch

1. `params.json` and the commute matrix are not produced yet. Both are needed; the engine has no defaults.
2. `src/types/data-files.ts` has no type for `params.json` or the matrix file (they are typed only in `src/types/simulation.ts`: `ParameterTable`, `CommuteMatrix`). The `tech` steering file lists `params.json` as a pipeline output and describes the matrix as part of `districts.json` ("adjacency and commute-time matrix"); `adapt.ts` accepts the matrix in either place. Pick one place and keep `adapt.ts` and the web loader consistent. This file recommends `commute-matrix.json`.
3. `history.json` metadata fields (`estimated`, `method`) are not read by `adapt.ts`, so the estimate flags of baseline values do not reach the engine. This is expected today; the engine takes plain numbers.
4. The limit ids of `commuterPass` and `rentSubsidy` (section 1.3) are required in practice but are not declared in those rules' `parameters()`. A missing id would produce NaN limits instead of a `parameters-invalid` error. This is a gap in the engine's validation, not in the data files.
5. `adapt.ts` does not check that every `source` of a track record is in `file.sources` before building the pass price parameter; an unknown id only shows up as `source-empty` for the price parameter.
6. `history.json` stores `householdIncome` per year; the engine divides by 12. Keep the unit `TWD per household per year`.
7. District codes in `commute.jobShare.<code>` are the same 8-digit codes as `districts.json`. City parameters use the display names `Taipei` and `New Taipei`, including the space.
