# Implementation Plan: Data Pipeline

## Overview

This plan builds `npm run data`, which turns `data/raw/` and the committed tables in `data/config/` into `public/data/districts.json`, `public/data/history.json`, `public/data/policy-track.json` and `data/SOURCES.md`, as described in `design.md`.

The order follows the design: shared helpers first, then the district file and each indicator, then the real policy track, then validation and the transactional write, and finally `SOURCES.md`. Each task keeps its property-based tests (fast-check 4.10.2, at least 100 runs, tagged `// Feature: data-pipeline, Property <n>: <title>`) next to the code they test. Tests live in `tests/scripts/pipeline/` and `tests/data/` and never read `data/raw/` (Requirement 18.8). Every task ends with `npx vitest --run` and `npm run typecheck` passing.

## Tasks

- [x] 1. Shared numeric, interpolation and serialization helpers
  - [x] 1.1 Implement `scripts/pipeline/numeric.ts`
    - `codePointCompare`, `median`, `stableSum`, `mean`, `roundTo`, `apportion` (largest remainder, ties to the lower index, all-zero weights become equal weights) and `linearFit`, as in the design's numeric helper table
    - Add example tests in `tests/scripts/pipeline/numeric.test.ts` for even and odd medians, `-0`, empty input errors and an all-zero `apportion`
    - _Requirements: 6.3, 11.14, 17.1, 17.3_
  - [x] 1.2 Implement `scripts/pipeline/interpolate.ts`
    - `annualToQuarterly` with the minmod slope limiter and offsets (−3/8, −1/8, +1/8, +3/8); flat first, last and turning-point years
    - _Requirements: 7.1, 7.6_
  - [x] 1.3 Implement `scripts/pipeline/serialize.ts`
    - `formatNumber` and `serializeJson`: 2-space indentation, primitive-only containers on one line, insertion key order, no exponent, no `-0`, LF only, one trailing LF, no BOM; throw on `NaN`, `±Infinity` and exponent tokens
    - Add `.gitattributes` with `public/data/*.json text eol=lf` and `data/SOURCES.md text eol=lf`
    - _Requirements: 17.3, 17.5_
  - [x] 1.4 Write property tests for the shared helpers
    - **Property 1: Interpolation preserves the annual mean and stays within neighbouring values**
    - **Validates: Requirements 7.1, 7.6, 18.5**
    - **Property 2: Apportionment yields non-negative integers that sum to the total**
    - **Validates: Requirements 6.3, 11.14**
    - **Property 22: Number and text formatting**
    - **Validates: Requirements 17.3, 17.5**

- [x] 2. Raw reader, preflight manifest, errors and step runner
  - [x] 2.1 Implement `errors.ts`, `raw-reader.ts` and `context.ts`
    - `PipelineError`, `ParseError`, `DataError`, `MissingInputsError`, `ValidationFailedError`, `BannedTermError`, `WriteError` with plain field declarations (no parameter properties)
    - `RawReader` with code-point sorted `list`, `exists`, `readBytes`, `readText` (UTF-8 with BOM stripped, or Big5) and repository-relative `display` paths, including `zip!entry` paths
    - `BuildContext` holding the reader, the 41 districts, the 44 quarters and a logger
    - _Requirements: 2.4, 17.4, 17.7_
  - [x] 2.2 Implement `manifest.ts` and the preflight step
    - Every row of the design's manifest table, including the `policy` row and the three committed tables in `data/config/`
    - One `MissingInputsError` that lists every missing path with `node scripts/download.ts <download-id>`; a missing committed table is listed without a download command
    - _Requirements: 2.3_
  - [x] 2.3 Implement `run.ts`, `scripts/build-data.ts` and the `data` npm script
    - Fixed list of named steps; delete stale `*.pipeline-tmp` files first; on a thrown error print `step <name> failed: <message>` and set `process.exitCode = 1`; on success print the summary lines
    - Add `"data": "node scripts/build-data.ts"` to `package.json`, with no `rm`, `cp`, `mkdir -p` or `VAR=value` syntax
    - Add the static tests: no file under `scripts/pipeline/` imports `scripts/lib/http.ts` or `scripts/lib/datagov.ts` or calls `fetch`; the `data` script has no POSIX-only syntax; no test file reads `data/raw/`
    - _Requirements: 1.1, 1.3, 1.5, 1.6, 2.1, 2.2, 18.8_
  - [x] 2.4 Write property tests for the reader and preflight
    - **Property 24: Directory listings are sorted by code point**
    - **Validates: Requirements 17.7**
    - **Property 26: Preflight lists every missing raw file**
    - **Validates: Requirements 2.3**

- [x] 3. Schema types and source, method and indicator registries
  - [x] 3.1 Implement `src/types/data-files.ts`
    - `ValueRecord`, `Indicator`, `SourceEntry`, `MethodEntry`, `HistoryFile`, `DistrictsFile`, `PolicyToolId`, `TrackRecord`, `PolicySeries` and `PolicyTrackFile`, with erasable syntax only and no DOM or Node APIs
    - Add `src` to the `include` list of `tsconfig.json`
    - _Requirements: 3.1, 4.1, 4.2, 12.3, 14.1_
  - [x] 3.2 Implement `registry/sources.ts`, `registry/methods.ts` and `registry/indicators.ts`
    - Every Source_Entry of the design's source registry table, including the `policy/` sources; `redactUrl` for credential query parameters
    - The indicator list (10 district and 2 city indicators) and the policy series list (10 series) in their fixed orders
    - The method registry starts with the district-file methods; each later task adds the Method_Entries it uses
    - _Requirements: 4.9, 14.1, 14.2, 14.6, 14.7_
  - [x] 3.3 Write property test for credential redaction
    - **Property 27: Credential redaction**
    - **Validates: Requirements 14.6, 14.7**

- [x] 4. Geometry helpers and the districts file
  - [x] 4.1 Implement `scripts/pipeline/geo.ts`
    - `ringAreaKm2` (spherical excess, radius 6,371.0072 km), `centroid`, `haversineKm`, `districtAt` (point in polygon, error when a point is in two districts), `adjacency` (shared edges by 7-decimal vertex key) and the mismatched-edge count moved from `build-boundaries.ts`
    - _Requirements: 3.2, 11.1_
  - [x] 4.2 Implement `scripts/pipeline/districts-file.ts`
    - Check that the unfiltered shapefile has each of the 41 codes exactly once; simplify with 40 m and 5 decimals; stop when the mismatched-edge count rises; area with 2 decimals and centroid with 5 decimals from unsimplified rings; entries sorted by code; embedded provenance, sources and methods
    - Retire `scripts/build-boundaries.ts` and the `data:boundaries` script. Delete `public/data/boundaries.geojson` (Decision D1) only after a test confirms that `districts.json` holds 41 districts with boundaries and a search of the repository (`src/`, `scripts/`, `tests/`, `index.html`, `vite.config.ts`, docs) finds no other reader of the file
    - _Requirements: 3.1, 3.2, 3.3, 3.6, 3.7, 3.8_
  - [x] 4.3 Write property tests for the geometry helpers
    - **Property 13: Point-in-polygon district lookup**
    - **Validates: Requirements 11.1**
    - **Property 19: Area and centroid of district shapes**
    - **Validates: Requirements 3.2**

- [x] 5. Population and migration indicators
  - [x] 5.1 Implement `parsers/household.ts` and `parsers/migration-annual.ts`
    - ODRP005, ODRP014, ODRP002 and ODRP011 in CSV and JSON layouts; Taipei a05002802 and New Taipei 124872 annual tables; 台/臺 normalization; `ParseError` with row, expected and found columns
    - One fixture test and one missing-column test per parser
    - _Requirements: 2.4, 5.5, 18.1, 18.2_
  - [x] 5.2 Implement `indicators/population.ts` and `indicators/migration.ts`
    - Month to file table (2017-12 and 2018-03 checked by example tests); population from last-of-quarter months; quarterly migration as sums of three months; 2015-01 to 2015-11 split with `apportion` and `migration-2015-seasonal-split`; `DataError` for a negative remainder, a missing month or an invalid count
    - _Requirements: 5.1, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4, 6.6, 6.7_
  - [x] 5.3 Write property tests for population and migration
    - **Property 3: Migration quarters are monthly sums with the correct flags**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4**
    - **Property 4: Population equals the sum of the district's village rows**
    - **Validates: Requirements 5.1, 5.3, 5.4**

- [x] 6. Income indicators
  - [x] 6.1 Implement `parsers/income.ts`
    - FIA files through `districtTotals` and DGBAS 9415 (`年`, `臺北市-元`, `新北市-元`); fixture and missing-column tests
    - _Requirements: 2.4, 18.1, 18.2_
  - [x] 6.2 Implement `indicators/income.ts`
    - `cityDisposableIncome` by `annualToQuarterly`; relative median income per FIA year; 2024–2025 from `linearFit` over 2019–2023; `householdIncome` from unrounded values; method ids per the design; `DataError` for missing district rows, non-positive medians and missing DGBAS years
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.7, 7.8, 7.9_
  - [x] 6.3 Write property tests for income
    - **Property 5: Relative income is scale-invariant per income year and composes into household income**
    - **Validates: Requirements 7.2, 7.3, 7.4, 7.7**
    - **Property 6: Income extrapolation ignores income years before 2019**
    - **Validates: Requirements 7.5**

- [x] 7. Real-price registration, sale price and price-to-income ratio
  - [x] 7.1 Implement `parsers/lvr.ts`
    - Skip the two header rows, city from the file name, typed records, strict 7-digit ROC dates (`rocDate7ToQuarter`), qualifying filters, exclusion counts by reason, and de-duplication by `編號` in sorted file order
    - _Requirements: 8.2, 8.4, 8.5, 8.6, 9.1_
  - [x] 7.2 Implement `indicators/sale-price.ts` and `indicators/price-to-income.ts`
    - Median for district-quarters with at least 10 sales; symmetric pooled window otherwise, without a cap; stop on a window with zero sales
    - City ratio of median total price to `cityDisposableIncome`, stop below 100 sales; optional `data/config/moi-price-to-income.csv` comparison printed as a note that never changes outputs
    - _Requirements: 8.1, 8.7, 8.8, 8.9, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_
  - [x] 7.3 Write property tests for registration records, sale price and price-to-income
    - **Property 7: Sale-price medians, thin-cell flags and pooled windows**
    - **Validates: Requirements 8.1, 8.7, 8.8**
    - **Property 8: Sale and rental filters match their definitions and exclusions are counted**
    - **Validates: Requirements 8.2, 8.5, 9.1**
    - **Property 9: Quarter bucketing ignores the publication season and duplicates**
    - **Validates: Requirements 8.4, 8.6**
    - **Property 12: Price-to-income ratio is the median total price over income**
    - **Validates: Requirements 10.2, 10.3**

- [x] 8. Rent indicator
  - [x] 8.1 Implement `parsers/cpi.ts`, `parsers/rent-stats.ts`, `tables/cpi-series.ts` and `tables/rent-reference.ts`
    - Taipei DBAS CSV and DGBAS XML rent sub-index; MOI rent statistics ODS (P50 of the `不分類` row, Decision D17); the fixed reference table with the second rule for Pinglin (Decision D7)
    - Fixture tests with `makeOds`, and missing-column tests
    - _Requirements: 9.4, 9.6, 9.10, 18.1, 18.2_
  - [x] 8.2 Implement `indicators/rent.ts`
    - `rent-relative-cpi` for districts with at least 30 records (base year 2024); `rent-reference-stats` or `rent-reference-sale-ratio` for the others; checks of the reference table against adjacency, city and record count; checks of the CPI mapping; stop on a missing CPI month
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10_
  - [x] 8.3 Write property tests for rent
    - **Property 10: Rent formula reproduces the base level in the base year**
    - **Validates: Requirements 9.1, 9.2, 9.3**
    - **Property 11: Reference districts follow their reference by a constant ratio**
    - **Validates: Requirements 9.4, 9.5**

- [x] 9. MRT entries indicator
  - [x] 9.1 Implement `parsers/mrt.ts` and `tables/mrt-stations.ts`
    - Annual station series and Big5 daily files; `MrtRowEntry` per annual-series row, `NON_STATION_ROWS` and `BORDER_STATIONS`
    - _Requirements: 11.2, 11.11, 11.12, 18.1, 18.2_
  - [x] 9.2 Implement `indicators/mrt.ts`
    - Station district by `districtAt`; seasonal shares from 2015–2016 full years or a comparable station; activation per annual-series row; `apportion` with zero weights for inactive quarters; 0 and not estimated for districts without an active row
    - _Requirements: 11.1, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 11.10, 11.11, 11.13, 11.14_
  - [x] 9.3 Write property tests for MRT entries
    - **Property 14: Seasonal shares are non-negative and sum to one**
    - **Validates: Requirements 11.6**
    - **Property 15: MRT quarterly entries respect opening dates and annual totals**
    - **Validates: Requirements 11.4, 11.5, 11.7, 11.9, 11.10, 11.13, 11.14**

- [x] 10. Social housing completions and stock
  - [x] 10.1 Implement `parsers/social-housing.ts` and `indicators/social-housing.ts`
    - List and detail JSON with completion (`strEndDate`) and start (`strStartDate`) dates; de-duplication by `setupplan_guid`; completions and stock including stock before 2015; exclusions printed with guid, reason, units and per-city totals; stop on an invalid `household_num`
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7_
  - [x] 10.2 Write property test for social housing
    - **Property 18: Social housing completions, stock and deduplication**
    - **Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.7**

- [x] 11. Policy raw sources, parsers and committed tables
  - [x] 11.1 Add the `policy` download source in `scripts/sources/`
    - Fetch the four raw files into `data/raw/policy/housing/` (E3010 6_1_3 and 6_3_1 JSON, data.gov.tw 169800 and 6742 CSV); record the exact URLs; document the command in `data/DOWNLOAD.md`
    - _Requirements: 2.3, 14.1_
  - [x] 11.2 Create the committed tables in `data/config/`
    - `holding-tax-rates.csv`, `commuter-pass-products.csv` and `sublease-phases.csv` with the columns and values in the design, a source on every row, and the statutory House Tax Act rows
    - _Requirements: 12.8, 12.9, 12.10, 12.12_
  - [x] 11.3 Implement `parsers/rent-subsidy.ts`, `parsers/house-tax.ts` and `parsers/policy-tables.ts`
    - ROC quarter headers (`104Q1` → 2015Q1), city labels, comma-separated numbers; MOF 6742 labels such as `90年/ 新北市(改制後)`; row checks of the committed tables with table path, row number and reason
    - Fixture and missing-column tests for each parser, and one example test for a table row whose date is not later than the previous row
    - _Requirements: 2.4, 12.15, 18.1, 18.2_
  - [x] 11.4 Write property test for effective-dated lookup
    - **Property 16: Effective-dated lookup**
    - **Validates: Requirements 12.9, 12.10, 12.12, 12.13, 12.15**

- [x] 12. Policy track builders and the policy track file
  - [x] 12.1 Implement the builders in `scripts/pipeline/policy/`
    - `social-housing-starts.ts`, `rent-subsidy.ts` (with the 1,000–10,000 guard), `sublease.ts` (phase spread by day to the next phase start of the same channel), `holding-tax.ts` (two rate series and the even split of house tax revenue) and `commuter-pass.ts` (price, subsidy 0 by definition, passes sold from the lower bound of more than 5.15 million passes to 2019-10-31 (Newtalk, 2019-11-27, quoting the Taipei City Department of Transportation), spread over 564 days and split by population, with the daily rate held afterwards; Property 33 checks the exact 5,150,000 over 2018Q2 to 2019Q4)
    - Add the policy Method_Entries; 0 before each program starts; `DataError` naming the series, district or city and quarter when no value can be produced
    - _Requirements: 12.4, 12.5, 12.6, 12.7, 12.8, 12.9, 12.10, 12.11, 12.12, 12.13, 12.14_
  - [x] 12.2 Implement `scripts/pipeline/policy-file.ts`
    - Series in the fixed order, values rounded to their decimals, one Source_Id per Track_Record, embedded Source_Entries and Method_Entries
    - _Requirements: 12.1, 12.2, 12.3_
  - [x] 12.3 Write property tests for the policy builders
    - **Property 17: Sublease phase spread conserves the counted totals**
    - **Validates: Requirements 12.8, 12.13**
    - **Property 31: Social housing starts bucketing, de-duplication and exclusion**
    - **Validates: Requirements 12.4, 12.5**
    - **Property 32: Rent subsidy households and amount**
    - **Validates: Requirements 12.6, 12.7**
    - **Property 33: House tax and commuter passes sold conserve their totals**
    - **Validates: Requirements 12.11, 12.12**

- [x] 13. Schema validator and history file assembly
  - [x] 13.1 Implement `src/data/validate.ts`
    - `validateDistrictsFile`, `validateHistoryFile` and `validatePolicyTrackFile` with the rules in the design's validator tables; collect every error with file, JSON path, rule and message; run on in-memory objects before serialization
    - Example tests in `tests/data/`: one valid file of each type; a missing field, a wrong type, an unknown district code and an out-of-range quarter per file; 40 districts; percentages of exactly 0 and 100; `null` with a `missing-reason` method passes and with an estimation method fails
    - _Requirements: 3.4, 3.5, 3.9, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 12.2, 12.3, 14.3, 14.4, 14.5, 14.7, 16.1, 16.2, 16.3, 16.4, 16.5, 18.3, 18.4_
  - [x] 13.2 Implement `scripts/pipeline/history-file.ts`
    - Indicators in the fixed order, values rounded once at assembly, embedded Source_Entries and Method_Entries referenced by the file
    - _Requirements: 4.1, 4.9, 4.10, 14.2_
  - [x] 13.3 Write property tests for validation and round trip
    - **Property 20: The validator detects every injected defect**
    - **Validates: Requirements 3.1, 3.4, 3.5, 3.9, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 12.2, 12.3, 14.3, 14.4, 14.5, 14.7, 16.1, 16.2, 16.3, 16.4, 16.5**
    - **Property 21: Serialize, parse and validate round trip**
    - **Validates: Requirements 16.10, 16.11, 16.12**

- [x] 14. Transactional writer and full build wiring
  - [x] 14.1 Implement `scripts/pipeline/write.ts`
    - Snapshot, stage to `<target>.pipeline-tmp`, commit in the order districts → history → policy-track → sources, roll back on any stage or commit failure, injected `WriteFs` for tests
    - _Requirements: 2.5, 16.6, 16.7, 16.8_
  - [x] 14.2 Wire every step into `run.ts`
    - Preflight, districts, each indicator, the policy track, history and policy-track assembly, validation of all files, and the write step; one summary line per indicator and per policy series; non-fatal notes after success
    - Runner tests: a failing step stops later steps and prints its name; validation errors prevent any call to the injected `WriteFs`; the summary is printed
    - _Requirements: 1.1, 1.4, 1.5, 16.5, 16.6, 16.7_
  - [x] 14.3 Write property tests for the writer and the full build
    - **Property 23: Output is independent of input order and does not mutate inputs**
    - **Validates: Requirements 2.6, 3.6, 4.10, 15.2, 17.1, 17.2, 17.6**
    - **Property 25: Transactional write restores the previous state on failure**
    - **Validates: Requirements 2.5, 16.7, 16.8**
    - **Property 30: Summary counts match the file**
    - **Validates: Requirements 1.4**

- [x] 15. SOURCES.md, banned-term check and final build
  - [x] 15.1 Implement `scripts/pipeline/banned-terms.ts` and the term lists
    - `data/config/banned-terms.txt` and `data/config/banned-terms-exempt.txt` seeded from `neutrality.md`; Latin terms on word boundaries, case-insensitive; CJK terms as substrings; exempt phrases ignored
    - _Requirements: 15.6, 15.9_
  - [x] 15.2 Implement `scripts/pipeline/sources-doc.ts` and add the render and check steps to `run.ts`
    - The nine sections in the design's order, including the policy series section with the share of estimated Track_Records, each method's assumption and the data that would replace it, every committed table row, and the known data gaps (items 1, 2a, 2b, 3b, 4, 7, 10); no date, path or environment value in the text
    - Rendering tests for the notice, the disclosure sentence, reference districts, MRT notes, the policy series section, data gaps and the Wikipedia attribution format
    - _Requirements: 9.6, 11.12, 12.11, 12.12, 12.16, 15.1, 15.2, 15.3, 15.4, 15.5, 15.7, 15.8, 15.9_
  - [x] 15.3 Write property tests for SOURCES.md and the banned-term check
    - **Property 28: SOURCES.md covers every referenced source and method**
    - **Validates: Requirements 15.3, 15.4**
    - **Property 29: Banned-term detection**
    - **Validates: Requirements 15.6, 15.9**
  - [x] 15.4 Run the full build and confirm
    - Run `npm run data` on the local `data/raw/`, then run it once in PowerShell and once in Git Bash and compare the hashes of the four outputs; run `npx vitest --run` and `npm run typecheck` and report both exit codes
    - _Requirements: 1.2, 2.2, 17.1, 18.7_

- [ ] 16. Shared total-price filter and pooled-window helper (Decision D28)
  - [ ] 16.1 Add `totalPriceSales` to `scripts/pipeline/indicators/lvr-input.ts` and switch the price-to-income builder to it
    - Predicate `r.totalPrice > 0 && r.districtCode !== undefined && r.quarter !== undefined`, with the doc comment from the design; this is the only implementation of `總價元 > 0` in the pipeline
    - Extract `cityTotalPrices(sales, districts, quarters)` in `indicators/price-to-income.ts`: it groups `totalPriceSales(sales)` by `"<city>|<quarter>"` in input order. `buildPriceToIncome` calls it in place of its inline `!(r.totalPrice > 0) || …` check; its signature, result, error messages, the 100-sale halt and the MOI comparison note stay the same
    - _Requirements: 10.2, 10.4, 19.2, 19.6_
  - [ ] 16.2 Create `scripts/pipeline/indicators/pooled-window.ts` and switch the sale price builder to it
    - `bucketByDistrictQuarter`, `PooledWindowOptions`, `PooledWindowSeries` and `pooledWindowSeries` as in the design; the window loop moves from `buildSalePrice` without changes to its logic
    - `buildSalePrice` calls them with `pick = (r) => r.unitPrice`, `minCount = SALE_MIN_COUNT`, method `sale-price-pooled-window` and error code `no-sales-for-sale-price`; export `SALE_MIN_COUNT` from `sale-price.ts` if it is not exported yet. The signature, the result (`series`, `windowCounts`, `unrounded`) and the error message of `buildSalePrice` stay the same
    - _Requirements: 8.1, 8.7, 8.8, 8.9, 19.4_
  - [ ] 16.3 Check that `salePrice` and `priceToIncomeRatio` are unchanged after the refactor
    - Run `sale-price.test.ts`, `price-to-income.test.ts` and Properties 7 and 12 in `properties-lvr.test.ts` without editing any of their fixtures or expected values; all must pass
    - Add example tests in `price-to-income.test.ts` for `totalPriceSales` (total price 0, negative, `NaN`, missing district and missing quarter are excluded; input order is kept) and for `cityTotalPrices` (grouping by city and quarter, input order), plus one `buildPriceToIncome` case on the existing fixture with an added record whose `總價元` is 0, which leaves the literal expected series unchanged
    - Add example tests in `sale-price.test.ts` for `bucketByDistrictQuarter` (records outside the districts or quarters are ignored) and `pooledWindowSeries` (own median, radius-1 window, full-period window, and an empty widest window that throws a `DataError` with the given error code)
    - _Requirements: 8.1, 8.7, 8.8, 8.9, 10.2, 10.3, 18.1, 19.6_

- [ ] 17. Median total price indicator and indicator ids
  - [ ] 17.1 Add `HISTORY_INDICATOR_IDS` and `HistoryIndicatorId` to `src/types/data-files.ts`
    - The 13 ids of Requirement 4.11 in order, `as const`, erasable syntax only; `IndicatorBase.id` stays `string`
    - `tests/data/helpers.ts` defines its own 3-id fixture list with the same name. Keep its values; rename it to `FIXTURE_INDICATOR_IDS` (and update its users) if a test needs to import the new export next to it
    - _Requirements: 4.11_
  - [ ] 17.2 Add the `medianTotalPrice` spec and the `median-total-price-pooled-window` method to the registries
    - `registry/indicators.ts`: the design's entry directly after `salePrice` (unit `TWD per transaction`, kind `positive`, decimals 0, source `lvr/moi-25119`, the 140-character description); the comment above `INDICATOR_SPECS` says 11 district indicators
    - `registry/methods.ts`: the design's entry directly after `sale-price-pooled-window`, with its four steps (the `總價元 > 0` condition shared with the price-to-income numerator, the sale price window rule, the median, and the numerator role against the district household income indicator)
    - Header comment of `history-file.ts`: "thirteen" indicator series and "11" district indicators
    - _Requirements: 4.11, 14.2, 14.3, 19.1, 19.4, 19.7, 19.9_
  - [ ] 17.3 Implement `scripts/pipeline/indicators/median-total-price.ts`
    - `TOTAL_PRICE_POOLED_METHOD`, `districtTotalPriceCells` (`bucketByDistrictQuarter(totalPriceSales(sales), districts, quarters, (r) => r.totalPrice)`), `MedianTotalPriceResult` and `buildMedianTotalPrice`, as in the design
    - The window is decided by `m(d, q)`, the count of total-price sales; `minCount` is the imported `SALE_MIN_COUNT`; decimals come from the `medianTotalPrice` spec; values are rounded with `roundTo`, so a .5 median rounds away from zero; `zeroTotalPrice` counts qualifying sales whose `總價元` is not greater than 0
    - An empty widest window throws `DataError('no-sales-for-median-total-price', 'district <code> <quarter>', ['no qualifying sales with a total price in <first>..<last>, the widest window'])`; no fallback value
    - No district price-to-income value is computed
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6_
  - [ ] 17.4 Add `medianTotalPriceStep` and wire it into `run.ts`
    - Step name `median-total-price` in `median-total-price.ts`; it reuses `state.lvrSales ??= loadLvr(ctx, 'sale')`, sets `state.medianTotalPrice` and `state.medianTotalPriceWindowCounts`, and adds the note `median total price: <k> qualifying sales excluded, 總價元 not greater than 0` without repeating the sale exclusion notes
    - `BuildState` gains `medianTotalPrice?` and `medianTotalPriceWindowCounts?`; `DEFAULT_STEPS` runs the step directly after `salePriceStep()`; `historyFileStep` needs no change because it finds series by indicator id
    - Update runner tests in `run.test.ts` and `run-full.test.ts` that list step names or count indicators (13 indicators, 11 district)
    - _Requirements: 1.4, 4.1, 4.11, 19.1, 19.5_
  - [ ] 17.5 Write the Requirement 19.10 example tests in `tests/scripts/pipeline/median-total-price.test.ts`
    - In-memory fixtures of at most 50 rows with literal expected values: a district-quarter with exactly 10 sales (own median, not estimated, no method); a district-quarter with fewer than 10 that uses a radius-1 window (estimated, `median-total-price-pooled-window`); a sale with `總價元` = 0 that is excluded from `medianTotalPrice` while its unit price still counts for `salePrice`; an even count whose median is the mean of the two middle values, including a .5 result rounded away from zero; a district whose widest window has no sale with a positive total price, which throws `no-sales-for-median-total-price` naming the district and quarter
    - One step test: the step sets both state fields and adds the exclusion note with the right count
    - _Requirements: 18.1, 19.2, 19.3, 19.4, 19.5, 19.10_
  - [ ] 17.6 Write property test for the shared total-price filter
    - **Property 34: Median total price and price-to-income count the same sales**
    - In `tests/scripts/pipeline/properties-total-price.test.ts`; generated records cover random `交易標的`, `主要用途`, unit price, total price including 0, invalid and out-of-range dates, unknown district names and duplicate `編號`; the oracle is the predicate of Requirements 8.2–8.6 plus `總價元 > 0`; compares `districtTotalPriceCells` with the oracle and `cityTotalPrices` with the union of the district cells of each city
    - **Validates: Requirements 19.2, 19.6, 10.2**
  - [ ] 17.7 Write property test for median total price values
    - **Property 35: Median total price medians, thin-cell flags and pooled windows**
    - In `tests/scripts/pipeline/properties-median-total-price.test.ts`; total prices are 0 or positive integers, and each district has at least one sale with a positive total price
    - **Validates: Requirements 19.1, 19.2, 19.3, 19.4**
  - [ ] 17.8 Write property test for the shared window rule
    - **Property 36: Median total price uses the sale price window rule**
    - In `tests/scripts/pipeline/properties-median-total-price.test.ts`; every total price is positive, and the `windowCounts` maps of `buildMedianTotalPrice` and `buildSalePrice` are equal
    - **Validates: Requirements 19.4**

- [ ] 18. Indicator-set validator rule (Decision D29)
  - [ ] 18.1 Add the `indicator-set` rule to `validateHistoryFile` in `src/data/validate.ts`
    - The `id`s of `indicators` equal `ctx.indicatorIds` exactly and in the same order; a missing id is reported at `$.indicators`, an unexpected id or an expected id at the wrong position at `$.indicators[i].id`; same structure as `policy-series-set`; update the comment on `ValidateContext.indicatorIds`
    - Confirm that the pipeline's validation step passes `INDICATOR_SPECS.map((s) => s.id)`
    - No `medianTotalPrice`-specific range code: the existing `positive` kind check covers Requirement 19.9
    - _Requirements: 4.11, 16.5, 19.9_
  - [ ] 18.2 Write validator and registry example tests
    - `tests/data/validate.test.ts`: a history file whose `indicators` miss one id, add one, or swap two fails with rule `indicator-set` at the expected path; with the 13 ids of `HISTORY_INDICATOR_IDS`, a `medianTotalPrice` value of 0 and one of −1 fail with rule `range` at `$.indicators[6].series["<code>"][<i>].value`
    - `tests/scripts/pipeline/registry.test.ts`: `INDICATOR_SPECS.map((s) => s.id)` equals the literal list of Requirement 4.11 and `HISTORY_INDICATOR_IDS` element by element; the `medianTotalPrice` spec has unit `TWD per transaction`, kind `positive`, decimals 0, sources `['lvr/moi-25119']` and a description of 1 to 200 characters; the `median-total-price-pooled-window` method follows `sale-price-pooled-window` and its steps name `總價元`
    - Run Property 20 in `tests/data/properties-validation.test.ts`. If a defect that changes an indicator `id` now also produces an `indicator-set` error, allow that extra error while still requiring the defect's own path (Decision D29)
    - _Requirements: 4.11, 16.5, 18.3, 18.4, 19.1, 19.9_

- [ ] 19. Checkpoint - Ensure all tests pass
  - Run `npx vitest --run` and `npm run typecheck`. Ensure all tests pass, ask the user if questions arise.

- [ ] 20. SOURCES.md rendering and DATA-CHECK.md
  - [ ] 20.1 Update `scripts/pipeline/sources-doc.ts` and pass the window counts from `run.ts`
    - The `KNOWN_GAPS` row for item 2a lists `fields: ['salePrice', 'medianTotalPrice']` and `methods: ['sale-price-pooled-window', 'median-total-price-pooled-window']`; its text and scope stay the same
    - `SourcesDocInput` gains `medianTotalPriceWindowCounts`; section 9 gains the table "Thin median total price cells" after "Thin sale price cells", rendered the same way, with an intro line stating that the window counts only sales with a total price greater than 0; the render step in `run.ts` passes the field from `BuildState`
    - Sections 2, 3 and 5 follow from the registries; check that no extra code is needed. The banned-term check must pass on the new text
    - _Requirements: 15.3, 15.4, 15.6, 19.7, 19.8_
  - [ ] 20.2 Write rendering tests in `tests/scripts/pipeline/sources-doc.test.ts`
    - Rendered from the real registries: a `medianTotalPrice` row in section 3 with the `lvr/moi-25119` entry; a `median-total-price-pooled-window` entry in section 5 whose text names `總價元`, the sale price window rule and the district household income indicator; a 2a row in section 9 that lists both indicators and both pooled-window methods; the "Thin median total price cells" table
    - Run Property 28 in `properties-sources-doc.test.ts` unchanged
    - _Requirements: 15.3, 15.4, 19.7, 19.8_
  - [ ] 20.3 Edit `data/DATA-CHECK.md` items 2a and 7
    - Add the two sentences from the design: in item 2a after "For these districts, a quarterly median price is not meaningful…", and in item 7 after "**No district-level values.**". The file is hand-written, not generated; keep the wording neutral and free of the terms in `data/config/banned-terms.txt`
    - _Requirements: 19.7, 19.8_

- [ ] 21. Rebuild history.json and run the final checks
  - [ ] 21.1 Rebuild `public/data/` and confirm the outputs
    - `data/raw/` is gitignored. Before building, check that every input of the preflight manifest exists, in particular the real-price registration files under `data/raw/lvr/`. If any file is missing, stop without touching the outputs, report each missing path with its `node scripts/download.ts <download-id>` command from `data/DOWNLOAD.md` (the preflight `MissingInputsError` lists them), and leave this task open
    - Run `npm run data` and confirm exit code 0
    - Compare with the committed outputs (`git show HEAD:public/data/history.json` and the others), using a throwaway command that is not added to the repository: `history.json` has the 13 indicators of Requirement 4.11 in order, with `medianTotalPrice` at index 6 holding 41 × 44 records; the `salePrice` and `priceToIncomeRatio` series and every other existing indicator deep-equal the committed version; `districts.json` and `policy-track.json` are byte-identical; `data/SOURCES.md` differs only in the `medianTotalPrice` rows, the new method, the 2a gap row and the new thin-cell table
    - Report the number of estimated `medianTotalPrice` cells and the count in the exclusion note
    - Run `npx vitest --run` and `npm run typecheck` and report both exit codes
    - _Requirements: 1.4, 4.10, 4.11, 16.6, 17.1, 18.7, 19.1_

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["1.4", "2.1"] },
    { "id": 3, "tasks": ["2.2"] },
    { "id": 4, "tasks": ["2.3", "2.4"] },
    { "id": 5, "tasks": ["3.1"] },
    { "id": 6, "tasks": ["3.2"] },
    { "id": 7, "tasks": ["3.3", "4.1"] },
    { "id": 8, "tasks": ["4.2", "4.3"] },
    { "id": 9, "tasks": ["5.1"] },
    { "id": 10, "tasks": ["5.2"] },
    { "id": 11, "tasks": ["5.3", "6.1"] },
    { "id": 12, "tasks": ["6.2"] },
    { "id": 13, "tasks": ["6.3", "7.1"] },
    { "id": 14, "tasks": ["7.2"] },
    { "id": 15, "tasks": ["7.3", "8.1"] },
    { "id": 16, "tasks": ["8.2"] },
    { "id": 17, "tasks": ["8.3", "9.1"] },
    { "id": 18, "tasks": ["9.2"] },
    { "id": 19, "tasks": ["9.3", "10.1"] },
    { "id": 20, "tasks": ["10.2", "11.1", "11.2"] },
    { "id": 21, "tasks": ["11.3"] },
    { "id": 22, "tasks": ["11.4", "12.1"] },
    { "id": 23, "tasks": ["12.2"] },
    { "id": 24, "tasks": ["12.3", "13.1"] },
    { "id": 25, "tasks": ["13.2"] },
    { "id": 26, "tasks": ["13.3", "14.1"] },
    { "id": 27, "tasks": ["14.2"] },
    { "id": 28, "tasks": ["14.3", "15.1"] },
    { "id": 29, "tasks": ["15.2"] },
    { "id": 30, "tasks": ["15.3"] },
    { "id": 31, "tasks": ["15.4"] },
    { "id": 32, "tasks": ["16.1", "16.2", "17.1"] },
    { "id": 33, "tasks": ["16.3", "17.2", "18.1"] },
    { "id": 34, "tasks": ["17.3"] },
    { "id": 35, "tasks": ["17.4", "17.6", "18.2"] },
    { "id": 36, "tasks": ["17.5", "17.7", "20.1"] },
    { "id": 37, "tasks": ["17.8", "20.2", "20.3"] },
    { "id": 38, "tasks": ["21.1"] }
  ]
}
```

Tasks in the same wave touch different files. Tasks that add Method_Entries to `registry/methods.ts` or steps to `run.ts` are in different waves. Tasks 17.3 and 17.4 both edit `median-total-price.ts`, and tasks 17.4 and 20.1 both edit `run.ts`, so each pair is in different waves.

## Notes

- Decisions D7 (Pinglin → Xindian through the second rule of Requirement 9.7) and D17 (median rent) were approved on 2026-11-11 and are already in the requirements and design.
- Task 4 retires `build-boundaries.ts`. The user approved deleting `public/data/boundaries.geojson`, but only after checking that `districts.json` holds the boundaries of all 41 districts and that no other code reads `boundaries.geojson`.
- The policy track assumptions in Decisions D22 to D25 (Open Question 15 of the requirements) are implemented with the stated defaults and flagged as estimated. If the user changes one, only task 11.2 or 12.1 changes.
- The hook in `.kiro/hooks/test-after-spec-task.json` runs `npm test` after each task.
- Tasks 16 to 21 implement Requirement 19 and Requirement 4.11 (added 2026-11-16 for the game-ui spec) with Decisions D28 and D29. The two extractions in task 16 must not change `salePrice` or `priceToIncomeRatio`: task 16.3 checks this with the existing tests, and task 21.1 checks it on the rebuilt `history.json`.
- As in tasks 1 to 15, the test sub-tasks of tasks 16 to 21 are not marked optional, because the user asked for Properties 34 to 36, the Requirement 19.10 examples and the regression check.
- Task 21.1 needs the gitignored raw files in `data/raw/`. Without them it stops and lists the missing files and their download commands from `data/DOWNLOAD.md`.
