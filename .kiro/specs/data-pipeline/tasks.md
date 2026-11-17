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
  - [~] 16.1 Add `totalPriceSales` to `scripts/pipeline/indicators/lvr-input.ts` and switch the price-to-income builder to it
    - Predicate `r.totalPrice > 0 && r.districtCode !== undefined && r.quarter !== undefined`, with the doc comment from the design; this is the only implementation of `總價元 > 0` in the pipeline
    - Extract `cityTotalPrices(sales, districts, quarters)` in `indicators/price-to-income.ts`: it groups `totalPriceSales(sales)` by `"<city>|<quarter>"` in input order. `buildPriceToIncome` calls it in place of its inline `!(r.totalPrice > 0) || …` check; its signature, result, error messages, the 100-sale halt and the MOI comparison note stay the same
    - _Requirements: 10.2, 10.4, 19.2, 19.6_
  - [~] 16.2 Create `scripts/pipeline/indicators/pooled-window.ts` and switch the sale price builder to it
    - `bucketByDistrictQuarter`, `PooledWindowOptions`, `PooledWindowSeries` and `pooledWindowSeries` as in the design; the window loop moves from `buildSalePrice` without changes to its logic
    - `buildSalePrice` calls them with `pick = (r) => r.unitPrice`, `minCount = SALE_MIN_COUNT`, method `sale-price-pooled-window` and error code `no-sales-for-sale-price`; export `SALE_MIN_COUNT` from `sale-price.ts` if it is not exported yet. The signature, the result (`series`, `windowCounts`, `unrounded`) and the error message of `buildSalePrice` stay the same
    - _Requirements: 8.1, 8.7, 8.8, 8.9, 19.4_
  - [~] 16.3 Check that `salePrice` and `priceToIncomeRatio` are unchanged after the refactor
    - Run `sale-price.test.ts`, `price-to-income.test.ts` and Properties 7 and 12 in `properties-lvr.test.ts` without editing any of their fixtures or expected values; all must pass
    - Add example tests in `price-to-income.test.ts` for `totalPriceSales` (total price 0, negative, `NaN`, missing district and missing quarter are excluded; input order is kept) and for `cityTotalPrices` (grouping by city and quarter, input order), plus one `buildPriceToIncome` case on the existing fixture with an added record whose `總價元` is 0, which leaves the literal expected series unchanged
    - Add example tests in `sale-price.test.ts` for `bucketByDistrictQuarter` (records outside the districts or quarters are ignored) and `pooledWindowSeries` (own median, radius-1 window, full-period window, and an empty widest window that throws a `DataError` with the given error code)
    - _Requirements: 8.1, 8.7, 8.8, 8.9, 10.2, 10.3, 18.1, 19.6_

- [ ] 17. Median total price indicator and indicator ids
  - [x] 17.1 Add `HISTORY_INDICATOR_IDS` and `HistoryIndicatorId` to `src/types/data-files.ts`
    - The 13 ids of Requirement 4.11 in order, `as const`, erasable syntax only; `IndicatorBase.id` stays `string`
    - `tests/data/helpers.ts` defines its own 3-id fixture list with the same name. Keep its values; rename it to `FIXTURE_INDICATOR_IDS` (and update its users) if a test needs to import the new export next to it
    - _Requirements: 4.11_
  - [~] 17.2 Add the `medianTotalPrice` spec and the `median-total-price-pooled-window` method to the registries
    - `registry/indicators.ts`: the design's entry directly after `salePrice` (unit `TWD per transaction`, kind `positive`, decimals 0, source `lvr/moi-25119`, the 140-character description); the comment above `INDICATOR_SPECS` says 11 district indicators
    - `registry/methods.ts`: the design's entry directly after `sale-price-pooled-window`, with its four steps (the `總價元 > 0` condition shared with the price-to-income numerator, the sale price window rule, the median, and the numerator role against the district household income indicator)
    - Header comment of `history-file.ts`: "thirteen" indicator series and "11" district indicators
    - _Requirements: 4.11, 14.2, 14.3, 19.1, 19.4, 19.7, 19.9_
  - [~] 17.3 Implement `scripts/pipeline/indicators/median-total-price.ts`
    - `TOTAL_PRICE_POOLED_METHOD`, `districtTotalPriceCells` (`bucketByDistrictQuarter(totalPriceSales(sales), districts, quarters, (r) => r.totalPrice)`), `MedianTotalPriceResult` and `buildMedianTotalPrice`, as in the design
    - The window is decided by `m(d, q)`, the count of total-price sales; `minCount` is the imported `SALE_MIN_COUNT`; decimals come from the `medianTotalPrice` spec; values are rounded with `roundTo`, so a .5 median rounds away from zero; `zeroTotalPrice` counts qualifying sales whose `總價元` is not greater than 0
    - An empty widest window throws `DataError('no-sales-for-median-total-price', 'district <code> <quarter>', ['no qualifying sales with a total price in <first>..<last>, the widest window'])`; no fallback value
    - No district price-to-income value is computed
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6_
  - [~] 17.4 Add `medianTotalPriceStep` and wire it into `run.ts`
    - Step name `median-total-price` in `median-total-price.ts`; it reuses `state.lvrSales ??= loadLvr(ctx, 'sale')`, sets `state.medianTotalPrice` and `state.medianTotalPriceWindowCounts`, and adds the note `median total price: <k> qualifying sales excluded, 總價元 not greater than 0` without repeating the sale exclusion notes
    - `BuildState` gains `medianTotalPrice?` and `medianTotalPriceWindowCounts?`; `DEFAULT_STEPS` runs the step directly after `salePriceStep()`; `historyFileStep` needs no change because it finds series by indicator id
    - Update runner tests in `run.test.ts` and `run-full.test.ts` that list step names or count indicators (13 indicators, 11 district)
    - _Requirements: 1.4, 4.1, 4.11, 19.1, 19.5_
  - [~] 17.5 Write the Requirement 19.10 example tests in `tests/scripts/pipeline/median-total-price.test.ts`
    - In-memory fixtures of at most 50 rows with literal expected values: a district-quarter with exactly 10 sales (own median, not estimated, no method); a district-quarter with fewer than 10 that uses a radius-1 window (estimated, `median-total-price-pooled-window`); a sale with `總價元` = 0 that is excluded from `medianTotalPrice` while its unit price still counts for `salePrice`; an even count whose median is the mean of the two middle values, including a .5 result rounded away from zero; a district whose widest window has no sale with a positive total price, which throws `no-sales-for-median-total-price` naming the district and quarter
    - One step test: the step sets both state fields and adds the exclusion note with the right count
    - _Requirements: 18.1, 19.2, 19.3, 19.4, 19.5, 19.10_
  - [~] 17.6 Write property test for the shared total-price filter
    - **Property 34: Median total price and price-to-income count the same sales**
    - In `tests/scripts/pipeline/properties-total-price.test.ts`; generated records cover random `交易標的`, `主要用途`, unit price, total price including 0, invalid and out-of-range dates, unknown district names and duplicate `編號`; the oracle is the predicate of Requirements 8.2–8.6 plus `總價元 > 0`; compares `districtTotalPriceCells` with the oracle and `cityTotalPrices` with the union of the district cells of each city
    - **Validates: Requirements 19.2, 19.6, 10.2**
  - [~] 17.7 Write property test for median total price values
    - **Property 35: Median total price medians, thin-cell flags and pooled windows**
    - In `tests/scripts/pipeline/properties-median-total-price.test.ts`; total prices are 0 or positive integers, and each district has at least one sale with a positive total price
    - **Validates: Requirements 19.1, 19.2, 19.3, 19.4**
  - [~] 17.8 Write property test for the shared window rule
    - **Property 36: Median total price uses the sale price window rule**
    - In `tests/scripts/pipeline/properties-median-total-price.test.ts`; every total price is positive, and the `windowCounts` maps of `buildMedianTotalPrice` and `buildSalePrice` are equal
    - **Validates: Requirements 19.4**

- [ ] 18. Indicator-set validator rule (Decision D29)
  - [~] 18.1 Add the `indicator-set` rule to `validateHistoryFile` in `src/data/validate.ts`
    - The `id`s of `indicators` equal `ctx.indicatorIds` exactly and in the same order; a missing id is reported at `$.indicators`, an unexpected id or an expected id at the wrong position at `$.indicators[i].id`; same structure as `policy-series-set`; update the comment on `ValidateContext.indicatorIds`
    - Confirm that the pipeline's validation step passes `INDICATOR_SPECS.map((s) => s.id)`
    - No `medianTotalPrice`-specific range code: the existing `positive` kind check covers Requirement 19.9
    - _Requirements: 4.11, 16.5, 19.9_
  - [~] 18.2 Write validator and registry example tests
    - `tests/data/validate.test.ts`: a history file whose `indicators` miss one id, add one, or swap two fails with rule `indicator-set` at the expected path; with the 13 ids of `HISTORY_INDICATOR_IDS`, a `medianTotalPrice` value of 0 and one of −1 fail with rule `range` at `$.indicators[6].series["<code>"][<i>].value`
    - `tests/scripts/pipeline/registry.test.ts`: `INDICATOR_SPECS.map((s) => s.id)` equals the literal list of Requirement 4.11 and `HISTORY_INDICATOR_IDS` element by element; the `medianTotalPrice` spec has unit `TWD per transaction`, kind `positive`, decimals 0, sources `['lvr/moi-25119']` and a description of 1 to 200 characters; the `median-total-price-pooled-window` method follows `sale-price-pooled-window` and its steps name `總價元`
    - Run Property 20 in `tests/data/properties-validation.test.ts`. If a defect that changes an indicator `id` now also produces an `indicator-set` error, allow that extra error while still requiring the defect's own path (Decision D29)
    - _Requirements: 4.11, 16.5, 18.3, 18.4, 19.1, 19.9_

- [~] 19. Checkpoint - Ensure all tests pass
  - Run `npx vitest --run` and `npm run typecheck`. Ensure all tests pass, ask the user if questions arise.

- [ ] 20. SOURCES.md rendering and DATA-CHECK.md
  - [~] 20.1 Update `scripts/pipeline/sources-doc.ts` and pass the window counts from `run.ts`
    - The `KNOWN_GAPS` row for item 2a lists `fields: ['salePrice', 'medianTotalPrice']` and `methods: ['sale-price-pooled-window', 'median-total-price-pooled-window']`; its text and scope stay the same
    - `SourcesDocInput` gains `medianTotalPriceWindowCounts`; section 9 gains the table "Thin median total price cells" after "Thin sale price cells", rendered the same way, with an intro line stating that the window counts only sales with a total price greater than 0; the render step in `run.ts` passes the field from `BuildState`
    - Sections 2, 3 and 5 follow from the registries; check that no extra code is needed. The banned-term check must pass on the new text
    - _Requirements: 15.3, 15.4, 15.6, 19.7, 19.8_
  - [~] 20.2 Write rendering tests in `tests/scripts/pipeline/sources-doc.test.ts`
    - Rendered from the real registries: a `medianTotalPrice` row in section 3 with the `lvr/moi-25119` entry; a `median-total-price-pooled-window` entry in section 5 whose text names `總價元`, the sale price window rule and the district household income indicator; a 2a row in section 9 that lists both indicators and both pooled-window methods; the "Thin median total price cells" table
    - Run Property 28 in `properties-sources-doc.test.ts` unchanged
    - _Requirements: 15.3, 15.4, 19.7, 19.8_
  - [~] 20.3 Edit `data/DATA-CHECK.md` items 2a and 7
    - Add the two sentences from the design: in item 2a after "For these districts, a quarterly median price is not meaningful…", and in item 7 after "**No district-level values.**". The file is hand-written, not generated; keep the wording neutral and free of the terms in `data/config/banned-terms.txt`
    - _Requirements: 19.7, 19.8_

- [ ] 21. Rebuild history.json and run the final checks
  - [~] 21.1 Rebuild `public/data/` and confirm the outputs
    - `data/raw/` is gitignored. Before building, check that every input of the preflight manifest exists, in particular the real-price registration files under `data/raw/lvr/`. If any file is missing, stop without touching the outputs, report each missing path with its `node scripts/download.ts <download-id>` command from `data/DOWNLOAD.md` (the preflight `MissingInputsError` lists them), and leave this task open
    - Run `npm run data` and confirm exit code 0
    - Compare with the committed outputs (`git show HEAD:public/data/history.json` and the others), using a throwaway command that is not added to the repository: `history.json` has the 13 indicators of Requirement 4.11 in order, with `medianTotalPrice` at index 6 holding 41 × 44 records; the `salePrice` and `priceToIncomeRatio` series and every other existing indicator deep-equal the committed version; `districts.json` and `policy-track.json` are byte-identical; `data/SOURCES.md` differs only in the `medianTotalPrice` rows, the new method, the 2a gap row and the new thin-cell table
    - Report the number of estimated `medianTotalPrice` cells and the count in the exclusion note
    - Run `npx vitest --run` and `npm run typecheck` and report both exit codes
    - _Requirements: 1.4, 4.10, 4.11, 16.6, 17.1, 18.7, 19.1_

- [x] 22. Data supplement downloads, census employee table and credential scan
  - [x] 22.1 Add the TDX sources `fares` and `timetables` and the LRT operators of `stations` to `scripts/download.ts`
    - `fares` fetches the adult single-journey station-pair fares (TDX ODFare) of the Taipei Metro, the New Taipei Metro, the Danhai LRT and the Ankeng LRT into `data/raw/fares/`; `timetables` fetches the TDX timetable files of the same four operators into `data/raw/timetables/`; `stations` gains the Danhai LRT and Ankeng LRT operators where TDX serves their station-to-station travel times. The task fixes the exact file names and records them in `data/DOWNLOAD.md`
    - Credentials come only from `TDX_CLIENT_ID` and `TDX_CLIENT_SECRET`. IF either variable is absent or blank, THEN the source prints one message that names both variables (never a value), exits non-zero before any network call and writes no file. The access token stays in memory: it is never written to a file, a log line or an error message, and HTTP error text is redacted before it is printed
    - **The user must set both variables in the shell and run the download** (PowerShell: `$env:TDX_CLIENT_ID = '...'`; Git Bash: `export TDX_CLIENT_ID=...`). The agent does not run these sources without them and never asks for the values in the chat
    - `data/DOWNLOAD.md` gets one entry per new source with URL and query (the date retrieved is added in 22.8), and one entry for the 2021 DGBAS Industry and Service Census employee PDF (publisher, URL, table id, page, date retrieved) with the note that `scripts/download.ts` does not fetch it
    - _Requirements: 25.5, 25.7, 27.1, 28.7, 29.1_
  - [x] 22.2 Add the `low-use` source to `scripts/download.ts` and the `low-use` command to `scripts/check.ts`
    - `low-use` downloads the MOI district-level low-use housing statistics (the dataset is located and cited first: agency, dataset name, URL, years, license or `not stated`) into `data/raw/low-use/` and records URL, query and date retrieved in `data/DOWNLOAD.md`. IF no district-level dataset is found, THEN stop and report what was searched
    - `node scripts/check.ts low-use` is read-only: it prints the half-year periods (`YYYYH1` or `YYYYH2`) for which district-level values are present in the downloaded files, the number of districts with a value in each period, and the District_Codes without a value in each period. It contains no indicator code (Requirement 26.1)
    - _Requirements: 26.1, 27.1_
  - [x] 22.3 Create the census employee tables and the reader `scripts/pipeline/params/census-employees.ts`
    - `data/config/census-employees-2021.csv` (columns `district_code,employees,source_url,table_id,page`; 41 rows in ascending code order) and `data/config/census-employees-2021-totals.csv` (columns `city,employees,source_url,table_id,page`; rows `Taipei` and `New Taipei`), transcribed by hand from the 2021 DGBAS Industry and Service Census PDF, with the printed page number on every row. IF the PDF cannot be read by the agent, THEN stop and ask the user to supply the figures; no value is guessed
    - `parseCensusEmployees`, `parseCensusTotals` and `checkCensusTotals`: 41 rows, no missing, duplicate or unknown District_Code, `employees` a non-negative integer, `page` a positive integer, non-empty `source_url` and `table_id`, the 12 Taipei and 29 New Taipei sums equal to the printed totals; a mismatch throws `DataError` that names the city, the sum, the printed total and the difference. No PDF is read by the pipeline
    - Add a `census-check` step to `run.ts` that reads the two committed tables (no raw file) and runs the check before any output is written
    - _Requirements: 22.11, 28.1, 28.2, 28.3, 28.4, 28.7_
  - [x] 22.4 Implement `scripts/pipeline/credentials-scan.ts` and add it to the validation step
    - `scanForCredentials(files, secrets)` reports file path and 1-based line for each line that contains a non-empty value of `TDX_CLIENT_ID` or `TDX_CLIENT_SECRET`, an `access_token` key or an `Authorization` header value; no finding contains the matched text
    - The validation step scans the serialized Output_Files, `data/raw/fares/`, `data/raw/timetables/` and `data/raw/stations/` (read through `RawReader`, skipped when absent) and reports each finding as a `ValidationError` with rule `credential`; the scan reads the two environment variables once and never prints them
    - _Requirements: 25.5, 25.6, 27.3_
  - [x] 22.5 Write example tests for the download sources, the census reader and the scan
    - `tests/scripts/download-tdx.test.ts` with an injected environment and an injected HTTP function: absent or blank credentials stop before any request and the message names both variables but contains no value; an HTTP error body that contains the secret is redacted; no file contains the token
    - `tests/scripts/pipeline/census-employees.test.ts` (in-memory fixtures of at most 50 rows, literal expected values): a valid table, a missing column, a missing District_Code, a duplicate District_Code, a negative value, a non-integer value, and a city sum that differs from the printed total (the error text names the city and both figures)
    - `tests/scripts/pipeline/credentials-scan.test.ts`: one finding per kind (secret value, `access_token`, `Authorization`), the finding text never contains the secret, and a clean file gives no finding
    - _Requirements: 25.5, 25.6, 27.15, 28.8_
  - [x] 22.6 Write property test for the census totals check
    - **Property 46: Census employee totals check accepts exactly the consistent tables**
    - In `tests/scripts/pipeline/properties-census.test.ts`
    - **Validates: Requirements 28.3, 28.4, 28.9**
  - [x] 22.7 Write property test for the credentials scan
    - **Property 49: The credentials scan finds every injected secret and never prints it**
    - In `tests/scripts/pipeline/properties-credentials.test.ts`
    - **Validates: Requirements 25.5, 25.6**
  - [x] 22.8 Run the downloads and list the low-use periods, then STOP for user review
    - Stop first with a clear message if `TDX_CLIENT_ID` or `TDX_CLIENT_SECRET` is not set in the shell, and ask the user to set them and run `node scripts/download.ts fares timetables stations` (or run it with them); the agent does not continue the TDX part without them. Then add the date retrieved to `data/DOWNLOAD.md`
    - Run `node scripts/download.ts low-use` and `node scripts/check.ts low-use`. Report the periods with district values, the first and last period, and the districts missing in each period. **STOP here and wait for the user's review.** Do not write any low-use parser, builder, indicator or registry entry before the user has reviewed the list (task 27 starts only after that review)
    - Run `npx vitest --run` and `npm run typecheck` and report both exit codes
    - _Requirements: 25.5, 25.7, 26.1, 27.1_

- [x] 23. Commute inputs: constants, timetables, rail network and fare slope
  - [x] 23.0 Remove the four unsupported TDX requests and test the request builders
    - Edit `scripts/sources/tdx-rail.ts` (and `scripts/sources/stations.ts`, which has the S2STravelTime requests) so that no S2STravelTime or Frequency request is sent for NTDLRT or NTALRT; the `timetables` source requests the StationTimeTable of TRTC, NTMC, NTDLRT and NTALRT and the Frequency of TRTC and NTMC only; the `stations` source requests S2STravelTime for TRTC and NTMC only
    - Record in `data/DOWNLOAD.md` that TDX returns HTTP 400 (not supported) for S2STravelTime NTDLRT, S2STravelTime NTALRT, Frequency NTDLRT and Frequency NTALRT, with the date 2026-11-19
    - Add the request-builder unit test (`tests/scripts/sources/`, no network): the request list of the two sources contains no S2STravelTime or Frequency request for NTDLRT or NTALRT, contains the four StationTimeTable requests and the Frequency requests for TRTC and NTMC
    - _Requirements: 27.2, 27.3, 27.4, 27.16_
  - [x] 23.1 Implement the Parameter_Entry checker and the Commute_Config_File reader
    - `src/data/validate-params.ts` exports `checkParameterEntry` (scalar and schedule shapes of `src/types/simulation.ts`; finite `value`; non-empty `unit`; `source.citation` and `source.url`; known status; `estimated.method` for `secondary` and `gap`; non-blank `assumption` for `gap`; `low ≤ value ≤ high`; `lowSource` and `highSource` with citation and url when a `range` exists). Task 26 reuses it in `validateParamsFile`
    - `scripts/pipeline/commute/params.ts` reads `data/config/commute-params.json` through the checker: stop with a non-zero code naming the id for an absent id, a non-finite value, an empty `unit`, or a non-`gap` entry without a source; a `gap` entry with an assumption never blocks the build
    - _Requirements: 20.3, 20.8, 20.9, 25.3, 25.4_
  - [x] 23.2 Implement `scripts/pipeline/commute/timetable.ts`
    - Parse the TDX timetable files into per-line weekday trips (Monday to Friday service-day flags); `ParseError` with row, expected and found columns
    - Danhai LRT and Ankeng LRT run times (`interStationTimes`): for each pair of consecutive stations, the median over weekday trips with first-station departure at or after 07:00 and before 09:00 of (arrival at the next station minus departure at the first station), using the departure at the next station when its arrival is absent; no `StopTime` is added a second time; a pair with no sample or a zero or negative sample means the StationTimeTable lacks that line
    - Danhai LRT matching: split trips by SubRoute and direction (Green Mountain and Blue Coast share the first section); station order per group is the station file order (`index`), reversed for direction 1; per consecutive-station pair, when both stations have the same number of weekday trips in the group, pair trips by position; quality check per group only (every paired difference > 0 and max − min ≤ 2 minutes), never across SubRoutes or directions; when every group of a pair passes, the pair run time is the median of the group medians; a pair that fails or has no sample counts as missing and is listed. A pair with samples in only one direction uses that value for both directions (Ankeng K08–K09) and the method text says so. If any Danhai pair is misordered or missing: no operator-page fallback; the Danhai LRT is excluded from the rail network, Tamsui uses its nearest MRT station, and the model limitations and SOURCES.md state "The Danhai LRT is not included; the whole line lies within Tamsui District, so this affects only access times within Tamsui."
    - Headways for ALL lines (TRTC, NTMC, Danhai, Ankeng) from the StationTimeTable departures, not the Frequency files (kept on disk, unused): each direction separately, weekday departures at or after 07:00 and before 09:00, direction headway = median gap, measuring station = a station every train (SubRoute) of the line serves, line headway = mean of its two directions, at least 2 departures per direction, result never adjusted; Green G-3 (Qizhang–Xiaobitan) and Red Xinbeitou branch are separate lines excluded from their main line; Danhai shared section uses both SubRoutes combined; the build report lists per line station, direction, departure count and median; `lineHeadway` and `transferWaitFor` (half of it); a zero, negative or non-finite headway stops with the line name
    - A line that a StationTimeTable lacks (or a direction with fewer than 2 departures) is returned as `uncovered`; there is no run-time fallback table (Danhai: excluded as above; Ankeng: the build stops naming the line)
    - _Requirements: 2.4, 25.2, 25.15, 27.2, 27.3, 27.4, 27.16_
  - [x] 23.3 Create `data/config/commute-params.json` with the confirmed constants
    - Eight Parameter_Entries with the values, units, ranges, statuses and sources of Requirement 25 criteria 9 to 15 and 29.7: `commute.detourFactor` 1.417 (secondary, range 1.2 to 1.6, Boscoe et al. 2012, Cole and King 1968), `commute.walkSpeed` 1.37 (secondary, 1.07 to 1.46, Bohannon 1997, MUTCD 2009), `commute.roadSpeed.taipei` 16.7 (secondary, TomTom Traffic Index 2025, single quoted figure), `commute.roadSpeed.newTaipei` 16.7 (gap, assumption), `commute.accessTime` 5 (gap, range 0 to 10 as a sensitivity range, `lowSource` and `highSource` citation "sensitivity range, no study", url `.kiro/specs/data-pipeline/design.md`), `commute.transferWalk` 4.29 (verified, dataset 128417, range 1 to 11), `commute.transferWait` (secondary), `commute.tripsPerMonth` 44 (gap)
    - `commute.transferWait.value` is **filled from the timetables**: run the 23.2 parser on `data/raw/timetables/` (weekday 07:00 to 09:00) with a throwaway command, take the median of the per-line half-headways (all 12 headway groups count as lines; SOURCES.md lists the lines without timetable data; currently "BR (Wenhu Line) has no data in the TDX timetables and uses the default value", default = median of the other lines' half-headways, 2.5 minutes) and write it with its `estimated.method` (the window, the morning-work-commute trip type, no survey figure given as a reason). IF `data/raw/timetables/` is absent, THEN stop and ask the user to finish 22.8; for a line the timetables do not cover, use the weekday morning peak headway published on the Taipei Metro website and cite the page for that line
    - No `data/config/lrt-timetable.csv` is created and the preflight step does not require it (decided 2026-11-19). Cite no Wikipedia page for any entry, opening date, headway or run time
    - _Requirements: 25.2, 25.3, 25.9, 25.10, 25.11, 25.12, 25.13, 25.14, 25.15, 25.16, 29.7_
  - [x] 23.4 Implement `scripts/pipeline/commute/network.ts`
    - Stations from the TDX station files, edges from the station-to-station files (`RunTime` plus the `StopTime` of each intermediate station), the 2025Q4 line sections from the opening-date table of Requirement 11 criterion 4 (nothing after 2025-12-31), transfer walking time per interchange from dataset 128417 (an interchange the file lacks uses the mean and is listed as estimated); the Sanying Line (`LB`) and the Taoyuan Airport MRT are excluded; Danhai and Ankeng LRT edges from the station-to-station files, else `timetable.ts`; a Danhai LRT that `timetable.ts` cannot supply is excluded from the network (no fallback table)
    - `pathTime(a, b)` is the shortest in-vehicle time with ties broken by ascending station id; the module also returns, per line, which input supplied its run times (or that the line is excluded)
    - _Requirements: 24.4, 24.6, 24.10, 24.11, 25.1, 25.2_
  - [x] 23.5 Implement `scripts/pipeline/commute/fares.ts`
    - `parseFares` for the Fare_Table (`ParseError` on a missing column); `pairFaresWithTimes` pairs each fare with `pathTime` of the same station pair and excludes, counts and names by reason any pair without a fare or a path time; the Fare_Slope by least squares with an intercept (`linearFit`); the Uncapped_Range is the pairs shorter than the shortest pair charged the Fare_Cap, and all pairs when none is capped
    - `commuteCostEntry(pairs, tripsPerMonth)` returns the Parameter_Entry of `migration.commuteCostPerMinute`: `low` 0, `value` = all-pairs slope × trips, `high` = max(`value`, Uncapped_Range slope × trips), unit `TWD per minute per commuter per month`, status `secondary`, `lowSource` and `highSource` with citation and url, and an `estimated.method` with the six statements of Requirement 29 criterion 6. IF `value < 0` or a slope is non-finite, THEN throw `DataError` naming the id, the three values and the number of pairs; a lower Uncapped_Range slope does not stop the build. `pairFaresWithTimes` also excludes pairs with a station that is not in the network (absent from the TDX station-to-station travel time files or, for the Ankeng LRT, the StationTimeTable) and counts them by reason ("station not in network"); SOURCES.md lists the excluded station codes
    - A normalisation table maps `30-day pass` and `pass per month` to `commuter per month`; one 30-day pass is one commuter-month (Decision D44)
    - _Requirements: 29.2, 29.3, 29.4, 29.5, 29.6, 29.8, 29.9_
  - [x] 23.6 Wire `networkStep` and `fareSlopeStep` into `run.ts` and the manifest
    - `BuildState` gains `network` and `fareSlope`; `DEFAULT_STEPS` runs both after the policy steps and prints one line with the number of pairs used, the number excluded by reason, the slopes and the three values. Add the manifest rows for `data/raw/fares/`, `data/raw/timetables/`, the station files and `data/config/commute-params.json`, each with its `node scripts/download.ts <id>` command, so a missing file is listed by the preflight step. `npm run data` from this task on needs the downloads of task 22
    - _Requirements: 2.3, 25.7, 27.9, 29.2_
  - [x] 23.7 Write example tests for the commute inputs
    - Tests in `tests/scripts/pipeline/commute-*.test.ts` with fixtures of at most 50 rows and literal expected values: the reader (valid file, absent id, non-finite value, empty unit, a `gap` entry with an assumption that continues); the timetable parser (a missing column, a 07:00 to 09:00 window headway, a line that is uncovered); the network (opening-date filter, `LB` and Airport MRT excluded, tie broken by station id, a transfer that uses the mean); the Fare_Table parser; the pairing (a pair without a fare and a pair without a path time are excluded and counted); the three values on a fixture of at most 50 pairs, including a fixture in which the Uncapped_Range slope is lower than the all-pairs slope so that `high` equals `value`, a fixture with `value < 0` or a non-finite slope that throws `DataError`, a pair with a station absent from the travel time files excluded and counted with reason "station not in network", and a fixture without any pair at the Fare_Cap in which `high` equals `value`
    - Unit tests: the unit string of `migration.commuteCostPerMinute` multiplied by minutes gives `TWD per commuter per month`; this and the unit string of the `commuterPassSubsidy` Policy_Series denote the same quantity after the normalisation table
    - Tests on the committed `commute-params.json`: 1 `verified`, 4 `secondary`, 3 `gap`; every `gap` entry has an assumption; the build's computation of `commute.transferWait` (median of the per-line half-headways) is checked on an in-memory timetable fixture against a literal value, and the committed `value` is compared with the same computation through an injected reader, so the test never reads `data/raw/`; no `source`, `assumption` or `estimated.method` names the MOTC survey figure as a reason for a value and none cites Wikipedia
    - _Requirements: 18.8, 25.3, 25.8, 25.15, 25.16, 27.15, 29.8, 29.10_
  - [x] 23.8 Write property test for the fare slope
    - **Property 47: The fare slope recovers linear fares and scales with monthly trips**
    - In `tests/scripts/pipeline/properties-fares.test.ts`
    - **Validates: Requirements 29.3, 29.4, 29.11**
  - [x] 23.9 Write property test for the commute cost entry order
    - **Property 48: Commute cost entries keep their order or stop the build**
    - In `tests/scripts/pipeline/properties-fares.test.ts`
    - **Validates: Requirements 29.5**

- [ ] 24. Commute matrix file
  - [x] 24.1 Implement `scripts/pipeline/params/job-share.ts`
    - `jobShares(employees)` by `apportion(1_000_000, employees) / 1_000_000` over the 41 districts in code order; this task needs it for the survey check, and task 25 adds the Parameter_Entries. Unit `share of the 41-district total`
    - _Requirements: 22.10, 28.5_
  - [x] 24.2a Add the `villages` download source and `commute/centroids.ts` (required)
    - `scripts/download.ts`: source `villages` fetches ODRP019 ROC year 114 (4 pages, 7,752 rows, paged like the ODRP002 download) and the village boundary SHP of data.gov.tw dataset 130549 (ROC 114 edition, https://www.land.moi.gov.tw/chhtml/DownloadGovDoc?gsno=PY9YAR&gdid=533; inner zip folder 村里界歷史圖資_114, VILLAGE_NLSC_11401031.*; Village_Sanhe.* ignored) into `data/raw/villages/`; no new package. Record URL and date retrieved (2026-11-17) in `data/DOWNLOAD.md` and `data/SOURCES.md`
    - `centroids.ts`: village population = sum of the 6 `household_*_m` and `household_*_f` fields; join by the 11-digit village code only (VILLCODE ↔ district_code); District_Code = first 8 digits; district centroid = population-weighted mean of village polygon centroids; an unassigned area record (empty VILLNAME, code containing R or P) gets weight 0, is skipped and its code is listed in SOURCES.md; stop with the list on any other unmatched village code (message names the 2025-12 administrative changes), on a district without a village, and on a district whose village population sum differs from the ODRP019 district total; return the 5 districts with the largest weighted-to-geometric centroid distance
    - _Requirements: 24.12, 24.14, 24.15, 24.16, 27.1_
  - [x] 24.2 Implement `scripts/pipeline/commute/model.ts`
    - Rail time = access time to the nearest station + in-vehicle path time + per transfer the transfer walk and `commute.transferWait` + egress time from the destination station; `access(i, s) = min(walk(i, s), haversineKm × detourFactor ÷ roadSpeed(city of i) × 60 + accessTime)`; road time = straight-line distance between Population_Weighted_Centroids × detour factor ÷ road speed of the origin district's city + access time; walking time = distance × detour factor ÷ walking speed; all distances use the Population_Weighted_Centroid from task 24.2a; cell = the smaller of the two; diagonal 0; values rounded to 1 decimal place
    - A district without a centroid stops the build with its District_Code; the result does not depend on input order
    - _Requirements: 24.2, 24.3, 24.4, 24.5, 24.9, 24.10, 24.12, 24.13_
  - [x] 24.3 Implement `survey-check.ts`, `commute-file.ts` and `validateCommuteMatrix`
    - `survey-check.ts`: mean time from the New Taipei districts to the Taipei districts weighted by origin population (mean of 2025) and `jobShare` renormalized over the Taipei districts; the step prints `commute check: modelled <x> min, survey about 57 min, difference <±y>`. It changes no matrix cell, no constant, no parameter and not the exit code
    - `commute-file.ts` assembles `{ codes, minutes }` (exactly these two keys); `src/types/data-files.ts` gains `CommuteMatrixFile`; `src/data/validate.ts` gains `validateCommuteMatrix` (41 sorted codes equal to the district codes, 41 rows of 41 finite non-negative numbers, diagonal 0, one decimal place) and `ValidationError.file` accepts `'commute-matrix.json'`
    - _Requirements: 24.1, 24.2, 24.8, 27.4_
  - [x] 24.4 Add `commuteMatrixStep` and write the matrix file
    - `jobShare`, `commuteMatrix` and `commuteSurvey` in `BuildState`; the step runs after `networkStep`; the validation step validates the matrix with the other files; `write.ts` stages and commits `public/data/commute-matrix.json` after `policy-track.json` and before `SOURCES.md` with the same rollback; the summary prints the mean commute time for the comparison. Update the runner and writer tests that list files or steps
    - _Requirements: 16.5, 16.6, 24.1, 24.10, 27.10, 27.7_
  - [x] 24.5 Add the commute sections to `sources-doc.ts`
    - Each constant of `commute-params.json` with value, range, status, sources and, for `gap` entries, the assumption; the input that supplied the run times of each line; the interchanges that use the mean walking time; the pairs used and excluded for the fare slope; the model limitations (one fixed matrix for the 2025Q4 network, no change with the 2018 to 2023 openings, every off-diagonal cell estimated with the Commute_Model method, Airport MRT, buses and the Sanying Line not modelled, **Linkou has no other rail line so its times come from the road model only and are likely over-estimated**); the modelled mean, the survey figure of about 57 minutes and the signed difference reported as they are, with the statement that no constant, parameter or input was changed because of it
    - The banned-term check must pass on the new text
    - Also state: the Population_Weighted_Centroid method with its two sources and the retrieval date 2026-11-17; the access rule `min(walk, road + accessTime)` with the reason that residents far from a station usually reach it by scooter or bus; the 5 districts with the largest weighted-to-geometric centroid distance
    - _Requirements: 24.7, 24.8, 24.11, 24.12, 24.13, 24.16, 25.2, 25.3, 25.8, 25.14, 29.2_
  - [x] 24.6 Write example tests for the model, survey check, matrix file and validator
    - Fixtures of at most 50 rows with literal expected values: a rail cell with one transfer, a road cell that is faster than rail, the diagonal, a missing centroid stops the build, the survey mean on a 2 × 2 fixture, a matrix validator accepting a valid file and rejecting a non-zero diagonal, a negative cell, a wrong row count and wrong `codes`, and two runs on permuted inputs that give byte-identical serialized files
    - Centroid tests (fixtures of at most 50 rows): join by village code and not by name (two villages with the same name, different codes); an unmatched village code in either file stops the build and lists the code, except an unassigned area record (empty VILLNAME, code with R or P) which is skipped with weight 0; the district village population sum check fails with the District_Code on a mismatch; a district with no village stops the build; the weighted centroid on a fixture with literal expected coordinates; the access min rule (a near station picks walk, a far station picks the road branch with `accessTime`)
    - _Requirements: 24.1, 24.2, 24.3, 24.9, 24.10, 24.12, 24.13, 24.14, 24.15, 27.8_
  - [x] 24.7 Write property test for job shares
    - **Property 40: Job shares are largest-remainder shares that sum to 1**
    - In `tests/scripts/pipeline/properties-job-share.test.ts`
    - **Validates: Requirements 20.11, 22.10, 28.5**
  - [x] 24.8 Write property test for the commute model
    - **Property 44: The commute model takes the faster mode and is order independent**
    - In `tests/scripts/pipeline/properties-commute-model.test.ts`
    - **Validates: Requirements 24.2, 24.3, 24.4, 24.5, 24.10, 25.1**
  - [x] 24.9 Build `public/data/commute-matrix.json` and confirm
    - Stop with the preflight list if `data/raw/` lacks a file. Run `npm run data` twice and confirm exit code 0 and that the two `commute-matrix.json` files are byte-identical; confirm 41 × 41 values, a zero diagonal and the printed `commute check` line. Report the modelled mean and the signed difference to about 57 minutes as they are, with no adjustment
    - Also report the 5 districts with the largest distance between the Population_Weighted_Centroid and the geometric centroid (District_Code and kilometers)
    - Run `npx vitest --run` and `npm run typecheck` and report both exit codes
    - _Requirements: 24.1, 24.8, 24.10, 27.3_

- [ ] 25. Parameter table part 1: research values and values computed from our own data
  - [~] 25.1 Create the type 1 entries of `data/config/params-fixed.json` and the reader `params/fixed-table.ts`
    - The eight entries of Requirement 21 (`socialHousing.rentRatio` 0.5 / 0.8 / 0.9, `rentSubsidy.passThrough` 0.16 / 0.50 / 0.78, `commuterPass.elasticity` −0.5 / −0.3 / −0.2, `ghost.rentThreshold` 50, `ghost.commuteThreshold` 45 / 60 / 60, `rentSubsidy.nationalBudget`, `rentSubsidy.nationalHouseholds`, `rentSubsidy.lag` 1) with unit, citation, url, status and, for ranges, `lowSource` and `highSource`; the study cited and each range end stated without ranking
    - `fixed-table.ts` reads the file through `checkParameterEntry` and stops with the id and the rule for an empty unit, citation or url, an unknown status, or a range out of order
    - _Requirements: 20.3, 20.9, 20.10, 21.1, 21.2, 21.3, 21.4, 21.5, 21.6, 21.7, 21.8, 21.10_
  - [~] 25.2 Implement `params/social-housing.ts` and `data/config/social-housing-unit-cost-cases.csv`
    - `socialHousing.lag`: median of start-to-completion quarters of projects with status `已完工`, both dates parseable, completion from 2015Q1 to 2025Q4, each `setupplan_guid` once; `range` is the first and third quartile in whole quarters; `estimated.method` contains `NLMA`; fewer than 10 qualifying projects stops the build and prints the counts by exclusion reason
    - `socialHousing.unitCost` 5,450,000 / 7,800,000 / 8,600,000 from the three-project table, stopping when total ÷ dwellings differs from the stated figure by more than 1 percent; `socialHousing.rentPerUnit` for −2.5 percent, 0 and +6.5 percent × the 2024 median rent ÷ the median unit count of completed projects, with both assumptions stated in `estimated.method`
    - _Requirements: 21.9, 22.1, 22.2, 22.3, 22.4, 22.12_
  - [~] 25.3 Implement `params/housing.ts` and `parsers/census-tenure.ts`
    - `housing.dwellingSize` = median `建物總面積平方公尺` of the qualifying rental records, 2015Q1 to 2025Q4, both cities; `housing.householdSize.<city>` = Σ `people_total` ÷ Σ `household_no` of the ODRP014 file of 2020-12; `housing.renterRate.<city>` = renting households ÷ households from the 2020 census tenure table (DGBAS table 34); status `verified` with `estimated.method`, and the note that the renter rate is a single-year value
    - _Requirements: 22.5, 22.6, 22.12, 2.4_
  - [~] 25.4 Implement the rent-burden calculation in `params/ghost.ts`
    - `Φ` in `numeric.ts` (Abramowitz and Stegun 7.1.26); the FIA quartile reader (Q1 and Q3 of the district total row, income year 2023) in `parsers/income.ts`; `ghost.shareRent` and `ghost.sensitivityRent` for reference year 2023 as in the design; a district with Q1 ≤ 0 or Q1 ≥ Q3 stops the build with the District_Code and both quartiles; status `secondary`; `estimated.method` states the log-normal assumption and its limits (FIA income is per tax unit and excludes transfer income)
    - _Requirements: 22.7, 22.8, 22.12_
  - [~] 25.5 Implement the commute shares in `params/ghost.ts`
    - Parser for the 2020 census table 14 (`census2020-{taipei,ntpc}-s014-workplace.ods`; same district, other district of the city, other county, city or overseas); the workplace spreading by `jobShare`; `ghost.shareCommuteWithin` (value 60 minutes, `low` the 45-minute share, `high` = value) and `ghost.sensitivityCommute` (share in (59, 60]) from the Commute_Matrix; status `secondary`; `estimated.method` states the spreading rule and its effect in both directions (same-district commutes at 0 minutes; the other-county category placed in the other city of the pair, so Ghost counts may be under-estimated)
    - _Requirements: 22.9, 22.12, 2.4_
  - [~] 25.6 Create the job-share and commute-cost Parameter_Entries
    - `params/job-share.ts` builds the 41 `commute.jobShare.<code>` entries (status `secondary`, `estimated.method` states that the census excludes government agencies and public schools and under-counts districts such as Zhongzheng); `params/commute-cost.ts` wraps the `commuteCostEntry` of task 23 for the table. Add the Method text that the entry carries to the Sources_Document input
    - _Requirements: 20.10, 20.11, 22.10, 28.6, 29.6_
  - [~] 25.7 Add `paramsPart1Step` to `run.ts` and the manifest
    - The step builds the entries of 25.1 to 25.6 into `BuildState.paramsPart1` and prints one line per entry (id, low, value, high, status); manifest rows for the census tenure and table 14 files and for the committed tables. Task 26 consumes the state
    - _Requirements: 2.3, 27.2_
  - [~] 25.8 Add the type 1 and type 2 sections to `sources-doc.ts`
    - For each entry of this task the study or page cited, each range end with its study, the inputs, the steps and the data that would replace each assumption; the sections follow `neutrality.md` (no study ranked above another)
    - _Requirements: 21.10, 22.12_
  - [~] 25.9 Write example tests for the part 1 parsers and builders
    - Fixtures of at most 50 rows, literal expected values, and a missing-column test for each new parser (tenure, table 14, FIA quartiles): `socialHousing.lag` (median, quartiles, `NLMA` in the method, fewer than 10 projects stops), `unitCost` (the 1 percent check), `rentPerUnit`, `dwellingSize`, household size, renter rate, a district with Q1 ≥ Q3 stopping the build, the commute shares on a 3-district fixture, job share entries, and a fixed table with each rule violation
    - A static test: no module that computes a Parameter_Entry value imports from `scripts/backtest/`, reads `docs/BACKTEST.md` or reads a save file
    - _Requirements: 20.10, 21.1, 22.2, 22.4, 22.8, 27.15, 27.10_
  - [~] 25.10 Write property test for the rent-burden calculation
    - **Property 41: Rent-burden tail share and sensitivity are bounded and monotone**
    - In `tests/scripts/pipeline/properties-ghost.test.ts`
    - **Validates: Requirements 22.7**
  - [~] 25.11 Write property test for the commute shares
    - **Property 42: Commute shares are ordered and bounded**
    - In `tests/scripts/pipeline/properties-ghost.test.ts`
    - **Validates: Requirements 22.9**
  - [~] 25.12 Run the build and report the computed values
    - Run `npm run data`, confirm exit code 0 and report, with a throwaway command that is not added to the repository, the `value`, `low` and `high` of every entry of this task; stop and report if a value looks implausible (for example a share outside 0 to 1)
    - Run `npx vitest --run` and `npm run typecheck` and report both exit codes
    - _Requirements: 22.1, 22.7, 22.9, 29.3_

- [ ] 26. Parameter table part 2: gap parameters, id-set check and `params.json`
  - [~] 26.1 Add the type 3 entries to `data/config/params-fixed.json`
    - `migration.threshold`, `migration.weightTime`, `migration.weightBurden`, `migration.weightCost`, `ghost.size` 1,000, `commuterPass.lag` 0, `commuterPass.unitCost` and `rentSubsidy.unitCost` 1, and the seven `limit.*` factors (0 for each `lowerFactor`, 2 for each `upperFactor`; source "game default" with the repository path of `simulation.md`), each with Parameter_Status `gap`, an `estimated.method`, a non-blank `assumption` and the data that would replace it; `migration.commuteCostPerMinute` is not a gap entry
    - _Requirements: 23.1, 23.2, 23.3, 23.7_
  - [~] 26.2 Implement `params/migration-anchors.ts`
    - `migration.share` and `migration.exitShare` from their anchors in `data/raw/` as defined in the design's gap table, status `gap`, with an `assumption` that states why the anchor is only an approximation
    - _Requirements: 23.6_
  - [~] 26.3 Implement `params/derived.ts`
    - `ghost.shareBoth` = `shareRent × (1 − shareCommuteWithin.value)` with the independence assumption stated, checked against `min(shareRent, 1 − shareCommuteWithin.high)`; `socialHousing.costSchedule` equal shares over offsets 0 to `lag − 1`, the last share absorbing the rounding so the shares sum to 1 within 1e-9, with the even-payment assumption
    - _Requirements: 23.4, 23.5_
  - [~] 26.4 Implement `params/engine-ids.ts`
    - `ENGINE_EXTRA_IDS`, `OMITTED_OPTIONAL_IDS` (the five fixed ids plus the `budget.ceiling.` prefix), `engineIdSet()` from `collectParameterSpecs(RULE_REGISTRY)` minus `commuterPass.price.*` minus the omitted ids plus the extra ids and the 41 job-share ids, and `idSetDiff(built, engine)` returning `missing` and `extra` sorted by code point; an omitted optional id in the built table is `extra`, its absence is no difference; a present extra id once declared by the engine is counted once
    - _Requirements: 20.4, 20.5, 20.6, 20.7, 20.13_
  - [~] 26.5 Implement `validateParamsFile`
    - In `src/data/validate-params.ts`: the wrapped form with no other top-level key, ascending ids, `checkParameterEntry` on each entry, the engine's stage 0 checks (share and positive checks, schedule offsets and shares summing to 1 within 1e-9, `socialHousing.lag` containing `NLMA`, no `range` on `ghost.rentThreshold`, `shareBoth ≤ min(shareRent, 1 − shareCommuteWithin.high)`, the 41 job shares summing to 1 within 1e-9), the id set against `ctx.engineIdSet`, the Parameter_Source_Type counts; reuse the engine's pure functions if `src/simulation/params.ts` exports them, otherwise carry a copy with a parity test on one fixture set (Decision D33). `ParamsFile` type, `ValidationError.file` accepts `'params.json'`, `ValidationContext` gains `engineIdSet` and `sourceTypes`
    - _Requirements: 20.1, 20.2, 20.3, 20.8, 20.9, 23.8, 27.4_
  - [~] 26.6 Implement `params/params-file.ts` and `paramsStep`
    - Merge the part 1 entries, the fixed gap entries, the anchors and the derived entries; round each value to the decimals documented for its id; sort ids by code point; run `idSetDiff` and IF any id is missing or extra, THEN throw `DataError('params-id-set', ...)` that prints each id with its side, before any file is written; `BuildState.params`
    - _Requirements: 20.1, 20.4, 20.5, 20.6, 20.11_
  - [~] 26.7 Write `public/data/params.json` in the validation, write and summary steps
    - The validation step validates `params.json` with the other files and collects every error; `write.ts` stages and commits `params.json` after `commute-matrix.json`; the summary prints the number of ids, the entries by Parameter_Source_Type and by Parameter_Status. Update the runner and writer tests
    - _Requirements: 16.5, 16.6, 20.1, 27.10, 27.7_
  - [~] 26.8 Add the parameter table sections to `sources-doc.ts`
    - Every id with its Parameter_Source_Type (1, 2 or 3), unit, status and source; the Omitted_Optional_Ids with the default that the engine applies; every gap parameter with its value, assumption and the data that would replace it, with the statement that these values are not research results; the banned-term check must pass
    - _Requirements: 20.12, 23.7_
  - [~] 26.9 Write example tests for the parameter table
    - The Id_Set_Check with a missing id, an extra id and an omitted optional id present; malformed Params_File objects to the validator (one defect each); the counts on the built table (81 ids, 8 type 1, 54 type 2, 19 type 3; 8 `verified`, 1 `check`, 53 `secondary`, 19 `gap`); `shareBoth` and cost schedule on small fixtures; the validator parity test of Decision D33 when a copy is used
    - _Requirements: 20.4, 20.8, 23.4, 23.5, 27.8_
  - [~] 26.10 Write property test for the id-set difference
    - **Property 37: Id-set difference is the symmetric difference**
    - In `tests/scripts/pipeline/properties-params.test.ts`
    - **Validates: Requirements 20.4, 20.5, 20.6, 20.7, 20.13**
  - [~] 26.11 Write property test for the parameter validator
    - **Property 38: The parameter validator reports every injected defect at its path**
    - In `tests/data/properties-params.test.ts`
    - **Validates: Requirements 20.1, 20.2, 20.3, 20.8, 20.9, 23.8, 27.4**
  - [~] 26.12 Write property test for the params and matrix round trip
    - **Property 39: Params and commute matrix files round-trip**
    - In `tests/data/properties-params.test.ts`
    - **Validates: Requirements 24.1, 24.2, 27.4, 27.5**
  - [~] 26.13 Write property test for the derived gap parameters
    - **Property 43: Derived gap parameters meet the engine constraints**
    - In `tests/scripts/pipeline/properties-params.test.ts`
    - **Validates: Requirements 23.4, 23.5**
  - [~] 26.14 Build `public/data/params.json` and confirm
    - Run `npm run data`, confirm exit code 0, 81 ids and the printed counts; a second run gives a byte-identical `params.json`. Run `npx vitest --run` and `npm run typecheck` and report both exit codes
    - _Requirements: 20.1, 20.4, 27.7_

- [ ] 27. Low-use housing indicators (method decided: current-method files only; the period review of 22.8 is done)
  - [~] 27.1 Implement `parsers/low-use.ts`
    - `parseLowUse` returns `{ period, districtCode, count, ratePercent }` rows for the layout of the `moi-low-use-current-{period}-{63000,65000}.csv` files (district names matched with `districtByZh`; percentage or fraction detected; unknown layout stops with file, row, expected and found columns); annual values of ROC 104 to 108 map to 2015H2 to 2019H2, half-yearly values 2020H1 to 2025H2 are read as they are; the reader never opens a file named `moi-low-use-original-*`; `periodsPresent(rows)` returns the sorted periods with a district value; manifest rows for the 34 current-method files, so the preflight step lists each missing file with `node scripts/download.ts low-use` and exits non-zero before any output is written
    - _Requirements: 2.3, 2.4, 26.1, 26.3, 26.14_
  - [~] 27.2 Add the periodic-indicator rules to the types and the validator
    - `ValueRecord` accepts `null` with `estimated: false` and an optional `dataPeriod`; indicator specs get a `periodic` flag; `validateHistoryFile` gains `no-data` (a `null` with `estimated: false` only in a periodic indicator), `data-period` (`YYYYH1` or `YYYYH2` whose Reference_Quarter equals the record's quarter; rejected elsewhere), the range rules (rate 0 to 100, count a non-negative integer) and `low-use-gap` with `ctx.lowUse = { dataGaps, periodsPresent, missing }`: (a) the districts whose 44 records are all `null` equal `dataGaps` exactly; (b) read per district: a `null` is accepted at a Q1 or Q3, at any Q2 of 2015 to 2019, and at the Reference_Quarter of a period only when that district has no published value for that period; a `null` at the Reference_Quarter of a period with a published value for that district is rejected; (c) more than 5 entirely `null` districts for one indicator is an error that lists their District_Codes
    - _Requirements: 26.9, 26.13_
  - [~] 27.3 Add the two indicators to the registries and the id list
    - `registry/sources.ts` entry for the low-use dataset (agency, dataset name, URL, years, license or `not stated`); `registry/indicators.ts` specs for `lowUseHousingCount` (unit `dwellings`, kind `count`, 0 decimals) and `lowUseHousingRate` (unit `percent of dwellings`, kind `percent`, 2 decimals), both `periodic`, after `socialHousingStock`; `HISTORY_INDICATOR_IDS` and the 17.x and 18.x registry and runner tests that list 13 indicators (11 district) are updated to 15 (13 district and 2 city) as Requirement 4.11 states; the header comment of `history-file.ts` is updated
    - _Requirements: 4.11, 14.2, 26.2, 26.9_
  - [~] 27.4 Implement `scripts/pipeline/low-use.ts` and `lowUseStep`
    - For each district and each of the 44 quarters: the published value with `estimated: false`, no method and `dataPeriod` at the Reference_Quarter (Q2 of H1, Q4 of H2) of each period that has a value for that district; every other record `{ value: null, estimated: false }`; nothing is interpolated, held, extrapolated or pooled; `dataGaps` is computed from the built records; more than 5 entirely `null` districts (including no published period at all) throws `low-use-too-many-gaps` listing exactly those District_Codes before any file is written; `lowUseStep` runs before `historyFileStep`; the `null` records do not count in the estimated total printed by the summary
    - _Requirements: 1.4, 26.2, 26.3, 26.4, 26.5, 26.6, 26.7_
  - [~] 27.5 Add the low-use sections to `sources-doc.ts`
    - Agency, dataset, URL, years, license, the period convention with its reason, the periods with district values and the first and last, the mapping of ROC 104 to 108 to 2015H2 to 2019H2 (Reference_Quarter Q4) with the statement that Q2 of 2015 to 2019 is `null`, the statement that other quarters are `null` and not estimated, and the text of Requirement 26.15 (current and original methods, Xinyi 2019H2: 4.97 percent / 3,741 dwellings vs 5.32 percent / 4,006, only the current method used, original files kept and not read); per district the periods without a published value; the heading for the data gaps of the low-use indicators with one row per district and indicator (District_Code, romanized name, indicator id), or the sentence that no district is entirely without a value
    - _Requirements: 26.6, 26.8, 26.12, 26.15_
  - [~] 27.6 Write example tests for the low-use parser, builder and validator
    - Fixtures of at most 50 rows: a Reference_Quarter value with its `dataPeriod`; a quarter that no period covers; a period without a value for one district; an annual value of ROC 104 mapped to `2015H2` and quarter `2015Q4` with `2015Q2` `null`; a fixture directory with an `original` file holding a different value for the same district and period (the built value is the current-method value and the file is not opened); a district with no value in any period (44 `null`, on the gap list, the build continues); exactly 5 such districts (continues) and 6 (stops, the error lists the 6 codes); validator tests for a `null` accepted in a low-use indicator, a `null` rejected in another, a missing `dataPeriod`, a `dataPeriod` whose Reference_Quarter differs from the Quarter_Key, an entirely `null` district not on the list, a listed district with a non-null value, a `null` at the Reference_Quarter of a period that has a published value for that district, and more than 5 entirely `null` districts
    - _Requirements: 26.1, 26.10, 26.13, 27.15_
  - [~] 27.7 Write property test for the low-use builder
    - **Property 45: Low-use quarters hold published values at their Reference_Quarter only**
    - In `tests/scripts/pipeline/properties-low-use.test.ts`
    - **Validates: Requirements 26.3, 26.4, 26.5, 26.6, 26.7, 26.12, 26.13**

- [ ] 28. Full rebuild, backtest and report (needs tasks 16 to 27)
  - [~] 28.1 Rebuild every output and confirm
    - Before the build confirm that tasks 16 to 21 (`medianTotalPrice`) and 22 to 27 are done and that every raw input exists (including `data/raw/fares/`, `data/raw/timetables/` and the low-use files). If a file is missing, stop without touching the outputs and report each path with its `node scripts/download.ts <download-id>` command; if the TDX variables are unset, say so
    - Run `npm run data` twice, confirm exit code 0 both times, that all six outputs pass the schema validation, that the outputs of the two runs are byte-identical, that `history.json` holds the 15 indicators of Requirement 4.11 (13 district, 2 city) in order, and that the indicators that existed before deep-equal the committed version. Confirm that no output and no printed text contains a credential value (the scan of task 22.4 passes)
    - _Requirements: 4.11, 16.5, 17.1, 24.10, 25.6, 27.10, 27.7_
  - [~] 28.2 Run the backtest and update `docs/BACKTEST.md`
    - Run `npm run backtest` and confirm it reads `params.json` and `commute-matrix.json` without the message `missing input` and without a stage 0 parameter validation error; confirm `docs/BACKTEST.md` is updated
    - Report the TPASS backtest result as printed: the direction of the effect, the ratio to the real change, and each range check with pass or fail; state that it validates MRT entries only and does not validate migration. Do not change any parameter, constant or matrix cell in response to the result
    - _Requirements: 20.10, 27.13, 29.6_
  - [~] 28.3 Report the gap parameters and the commute survey gap
    - With a throwaway command that is not added to the repository, list every `gap` entry of `params.json` (19) and `commute-params.json` (3) with its value and assumption, and the modelled New Taipei to Taipei mean commute time against the survey figure of about 57 minutes with the signed difference, as reported, without comment that treats it as an error
    - _Requirements: 23.7, 24.8, 25.3, 25.8_
  - [~] 28.4 Run the final checks
    - Run `npx vitest --run` and `npm run typecheck` and report both exit codes
    - _Requirements: 18.7, 27.15, 27.9_

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
    { "id": 38, "tasks": ["21.1"] },
    { "id": 39, "tasks": ["22.1", "22.3"] },
    { "id": 40, "tasks": ["22.2", "22.4"] },
    { "id": 41, "tasks": ["22.5", "22.6", "22.7"] },
    { "id": 42, "tasks": ["22.8"] },
    { "id": 43, "tasks": ["23.0", "23.1", "23.2"] },
    { "id": 44, "tasks": ["23.3", "23.4"] },
    { "id": 45, "tasks": ["23.5"] },
    { "id": 46, "tasks": ["23.6"] },
    { "id": 47, "tasks": ["23.7", "23.8", "23.9"] },
    { "id": 48, "tasks": ["24.1", "24.2"] },
    { "id": 49, "tasks": ["24.3"] },
    { "id": 50, "tasks": ["24.4"] },
    { "id": 51, "tasks": ["24.5"] },
    { "id": 52, "tasks": ["24.6", "24.7", "24.8"] },
    { "id": 53, "tasks": ["24.9"] },
    { "id": 54, "tasks": ["25.1", "25.2", "25.3"] },
    { "id": 55, "tasks": ["25.4", "25.6"] },
    { "id": 56, "tasks": ["25.5"] },
    { "id": 57, "tasks": ["25.7"] },
    { "id": 58, "tasks": ["25.8"] },
    { "id": 59, "tasks": ["25.9", "25.10", "25.11"] },
    { "id": 60, "tasks": ["25.12"] },
    { "id": 61, "tasks": ["26.1", "26.2", "26.3", "26.4", "26.5"] },
    { "id": 62, "tasks": ["26.6"] },
    { "id": 63, "tasks": ["26.7"] },
    { "id": 64, "tasks": ["26.8"] },
    { "id": 65, "tasks": ["26.9", "26.10", "26.11", "26.12", "26.13"] },
    { "id": 66, "tasks": ["26.14"] },
    { "id": 67, "tasks": ["27.1", "27.2"] },
    { "id": 68, "tasks": ["27.3"] },
    { "id": 69, "tasks": ["27.4"] },
    { "id": 70, "tasks": ["27.5"] },
    { "id": 71, "tasks": ["27.6", "27.7"] },
    { "id": 72, "tasks": ["28.1"] },
    { "id": 73, "tasks": ["28.2"] },
    { "id": 74, "tasks": ["28.3", "28.4"] }
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
- Tasks 22 to 28 implement the data supplement (Requirements 20 to 29, Properties 37 to 49, Decisions D30 to D50). Each is one commit-sized unit and ends with `npx vitest --run` and `npm run typecheck` passing. As in tasks 1 to 21, test sub-tasks are not marked optional.
- Task 22.8 needs the user: the user sets `TDX_CLIENT_ID` and `TDX_CLIENT_SECRET` in the shell and may need to run the downloads. Without them the task stops with a message that names the two variables. No credential is stored in a file, a log line or an error message.
- Task 22.8 ends with a stop: the user reviews the low-use periods before task 27 starts. No low-use parser, builder, registry entry or indicator is written in tasks 22 to 26.
- Task 23 and later tasks add their manifest rows only when a step first reads the files, so `npm run data` keeps working after each commit. From task 23 on it needs the downloads of task 22.8.
- The pure `jobShares` function and Property 40 are in task 24 (not task 25) because the survey check of task 24.3 weights destinations by job share. The fare slope and `commuteCostEntry` are in task 23, and `networkStep` is built there because the fare pairing needs the rail-graph path times; task 25.6 wraps the entry for the table.
- `migration.commuteCostPerMinute` depends on simulation-engine task group 17 (adding the id to `SCENARIO_EFFECT_IDS` with direction-aware Scenario values) only for the Scenario range of that parameter: the strongest-effect Scenario takes `high` and the weakest takes `low`, which is 0. The pipeline writes `low ≤ value ≤ high` and does not change the engine.
- Tasks 16 to 21 (`medianTotalPrice`) must be done before task 28, the full rebuild. Task 27.3 changes the indicator list that tasks 17 and 18 define (13 indicators, 11 district) to 15 (13 district, 2 city) as Requirement 4.11 now states, and updates the tests that list the ids.
- Rule (b) of Requirement 26.13 is read per district: a `null` is allowed at any Q1 or Q3, at any Q2 of 2015 to 2019, and at a Reference_Quarter only when that district has no published value for that period (task 27.2).
- The Commute_Model constants and the gap to the MOTC survey figure of about 57 minutes are only reported. No constant, parameter or matrix cell is adjusted because of that figure or because of the TPASS backtest result.
