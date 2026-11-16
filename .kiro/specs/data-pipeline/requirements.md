# Requirements Document

## Introduction

The data pipeline is a set of local Node scripts that turn the raw open data already downloaded into `data/raw/` into the static files the web app reads:

- `public/data/districts.json`: basic attributes and boundary geometry for the 41 districts of Taipei City and New Taipei City.
- `public/data/history.json`: the real quarterly baseline, one value per district, indicator and quarter, for 2015Q1 through 2025Q4 (44 quarters).
- `public/data/policy-track.json`: the real value of each of the 5 player policy tools (social housing construction, sublease and rental management, rent subsidy, holding tax, commuter pass subsidy) for every quarter from 2015Q1 through 2025Q4, each value with its source and an estimate flag. The simulation engine reads it as its Real_Policy_Track.
- `data/SOURCES.md`: agency, dataset name, URL, year and license for every output field, plus every interpolation and estimation method.

One command, `npm run data`, runs the whole build. The build reads local files only and never downloads anything; downloading stays in `scripts/download.ts`. Every output is checked against a schema before it is written, and a failed check stops the build with a clear error.

The build follows the "Decisions" section of `data/DATA-CHECK.md` (income, rural rents, MRT ridership, house-price-to-income ratio). It reuses the existing code in `scripts/lib/` (CSV reader, the 41-district table with official codes, time helpers, zip reader, paths), `scripts/geo/` (shapefile reader, shared-border simplifier, TWD97 converter) and `scripts/sources/`.

`history.json` is the real baseline that the simulation engine must reproduce exactly when the player changes nothing (zero-delta identity in `simulation.md`). Its values must therefore be stable and reproducible.

### Out of scope

- `public/data/events.json` and `public/data/params.json`.
- Simulation parameters in `params.json`: coefficients, lags, unit costs, tool limits and budget ceilings. The pipeline produces only the real values of the 5 tools (Requirement 12), not the limits, costs or elasticities that act on them.
- Policy tools removed from the project scope (MRT extension, TOD floor-area bonus, parks, green space and street trees). Air quality (PM2.5) was removed with the parks tool.
- The 41×41 commute-time matrix and district adjacency, which `tech.md` places in `districts.json`. They need their own method (DATA-CHECK.md item 12) and are deferred to a later spec unless the user decides otherwise (see Open Questions).
- Downloading or refreshing raw data.
- The web app's loading and validation code in `src/data/`.

## Glossary

- **Pipeline**: the set of Node scripts under `scripts/` that builds the Output_Files from the Raw_Directory.
- **Build_Command**: the npm script `npm run data`, which runs the whole Pipeline.
- **Raw_Directory**: `data/raw/`, holding the downloaded source files.
- **Output_Files**: `public/data/districts.json`, `public/data/history.json`, `public/data/policy-track.json` and `data/SOURCES.md`.
- **Districts_File**: `public/data/districts.json`.
- **History_File**: `public/data/history.json`.
- **Policy_Track_File**: `public/data/policy-track.json`.
- **Sources_Document**: `data/SOURCES.md`.
- **Schema_Validator**: the Pipeline component that checks a built Output_File against its schema before the file is written.
- **District_Code**: the official 8-digit administrative code of a district (TOWNCODE in the MOI boundary data), as listed in `scripts/lib/districts.ts`.
- **Quarter_Key**: a string of the form `YYYYQn`, from `2015Q1` to `2025Q4`.
- **Indicator**: a named quarterly measure for a district in the History_File, with one unit.
- **City_Indicator**: a named quarterly measure for a whole city (Taipei or New Taipei) in the History_File.
- **Value_Record**: one value of an Indicator or City_Indicator for one Quarter_Key, together with its Estimate_Flag and, where applicable, its Method_Id.
- **Policy_Tool**: one of the 5 player tools in `product.md`: social housing construction, sublease and rental management, rent subsidy, vacant or multiple-home holding tax, and commuter pass subsidy.
- **Policy_Series**: a named quarterly series of one Policy_Tool, with one unit, for each of the 41 districts or for each of the 2 cities.
- **Track_Record**: one value of a Policy_Series for one district or city and one Quarter_Key, together with its Source_Id, its Estimate_Flag and, where applicable, its Method_Id.
- **Source_Entry**: one record describing a source dataset: agency, dataset name, URL, year or years covered, and license (or the literal text `not stated`).
- **Source_Id**: the identifier of a Source_Entry, matching the source ids used by `scripts/download.ts`.
- **Estimate_Flag**: the boolean field `estimated` on a Value_Record or Track_Record. `true` means the value is not a direct observation for that district and quarter.
- **Method_Id**: an identifier of a documented interpolation or estimation method, described in the Sources_Document.
- **Thin_Cell**: a district and quarter whose number of source records is below the minimum count configured for that Indicator.
- **Reference_District**: a district whose rent trend is borrowed by a district with too few rental records (DATA-CHECK.md decision 2).
- **Seasonal_Share**: the fraction of an annual total assigned to one quarter, taken from observed data of another period or station.
- **Active_Station**: an MRT or LRT station whose line section had opened on or before the last day of a given quarter.

## Requirements

### Requirement 1: Single build command

**User Story:** As the developer, I want one command that rebuilds all output data, so that I can regenerate the site data from raw files without remembering individual steps.

#### Acceptance Criteria

1. WHEN the developer runs the Build_Command from the repository root, THE Pipeline SHALL build all four Output_Files (the Districts_File, the History_File, the Policy_Track_File and the Sources_Document) in a single invocation, without requiring any other command, manual step or interactive input.
2. WHEN the Build_Command is run once in PowerShell and once in Git Bash on Windows on the same Raw_Directory contents, THE Pipeline SHALL produce byte-identical Output_Files and the same exit code in both shells.
3. THE Pipeline SHALL consist only of TypeScript files that Node 26 runs directly through its built-in type stripping, without a separate compile step or custom loader, and SHALL therefore use only erasable TypeScript syntax (no `enum`, no `namespace` and no parameter properties).
4. WHEN the Pipeline completes successfully, THE Pipeline SHALL exit with code 0 and print to standard output one line for each Indicator, each City_Indicator and each Policy_Series, giving its name, its total number of Value_Records or Track_Records and its number of those with the Estimate_Flag set to `true`.
5. IF any step of the Pipeline fails, THEN THE Pipeline SHALL stop without running later steps, print the name of the failing step and the cause of the failure, exit with a non-zero code, and leave every existing Output_File unchanged.
6. THE Build_Command SHALL perform every file operation (creating directories, writing, copying and deleting files) through Node scripts only, and its npm script definition SHALL contain no POSIX-only shell commands (such as `rm`, `cp` or `mkdir -p`) and no inline environment-variable assignment syntax.

### Requirement 2: Offline build from local raw data

**User Story:** As the developer, I want the build to read only local files, so that builds are reproducible and do not depend on government websites being online.

#### Acceptance Criteria

1. THE Pipeline SHALL read input data only from files in the Raw_Directory and from files committed in the repository.
2. WHEN the developer runs the Build_Command on a machine with all network connections disabled, THE Pipeline SHALL complete the build with exit code 0 and produce Output_Files byte-identical to those produced from the same Raw_Directory with network connections enabled.
3. IF one or more raw files required by the Pipeline are missing from the Raw_Directory, THEN THE Pipeline SHALL exit with a non-zero code before writing any Output_File and print, for every missing file (not only the first one found), the file path relative to the repository root and the `node scripts/download.ts <source-id>` command with the Source_Id of the Source_Entry that provides the file.
4. IF a raw file cannot be parsed into the expected columns, THEN THE Pipeline SHALL exit with a non-zero code and print the file path relative to the repository root (plus the entry name when the file is read from inside a zip archive), the 1-based row number where parsing failed, the expected column names and the column names found in that file.
5. IF the Pipeline exits with a non-zero code, THEN THE Pipeline SHALL leave every Output_File that existed before the run byte-identical to its state before the run, and SHALL create no Output_File that did not exist before the run.
6. WHEN the developer runs the Build_Command twice on an unchanged Raw_Directory and unchanged repository files, THE Pipeline SHALL produce Output_Files that are byte-identical between the two runs.

### Requirement 3: Districts file

**User Story:** As the web app, I want one file with the attributes and boundaries of all 41 districts, so that I can draw the map and label districts.

#### Acceptance Criteria

1. THE Districts_File SHALL contain exactly 41 district entries, one for each District_Code listed in `scripts/lib/districts.ts`, keyed by District_Code, and no entry for any other code.
2. THE Districts_File SHALL give each district entry its District_Code, its city (exactly `Taipei` or `New Taipei`, the values of `city` in `scripts/lib/districts.ts`), its romanized display name as listed in `scripts/lib/districts.ts`, its land area in square kilometres as a number greater than 0 rounded to 2 decimal places, and its centroid as longitude and latitude in decimal degrees rounded to 5 decimal places, where the centroid lies inside the bounding box of that district's boundary geometry.
3. THE Districts_File SHALL contain the boundary geometry of each district, produced by the existing shared-border simplifier in `scripts/geo/simplify.ts` with a tolerance of 40 metres and coordinates rounded to at most 5 decimal places, the same settings as the defaults of `scripts/build-boundaries.ts`. (This assumes boundaries are embedded in the Districts_File, the current default. The Open Question on a separate `boundaries.geojson` may move this criterion and criteria 4 and 8.)
4. THE Districts_File SHALL store every boundary ring as a closed ring of at least 4 positions whose first and last positions are equal, with exterior rings clockwise and holes counterclockwise as determined by the sign of the ring's planar area in longitude–latitude coordinates, matching the d3-geo convention used by `scripts/build-boundaries.ts`.
5. THE Districts_File SHALL reference, for the boundary geometry and for each attribute (city, display name, land area, centroid), the Source_Id of the Source_Entry the value comes from, and each referenced Source_Id SHALL match a Source_Entry in the Sources_Document.
6. THE Districts_File SHALL list district entries in ascending District_Code order.
7. IF the boundary source data in the Raw_Directory lacks a record for any District_Code in `scripts/lib/districts.ts`, has more than one record for a District_Code, or has a record whose TOWNCODE is in Taipei City or New Taipei City but not listed in `scripts/lib/districts.ts`, THEN THE Pipeline SHALL exit with a non-zero code, print each missing, duplicated or unexpected code, and leave any existing Districts_File unchanged.
8. THE Pipeline SHALL produce boundary geometry in which the number of mismatched border edges after simplification is less than or equal to the number before simplification, where a mismatched border edge is an edge used by exactly one ring whose two endpoints each lie on the boundaries of more than one district.
9. IF a Source_Id referenced by the Districts_File has no matching Source_Entry in the Sources_Document, THEN THE Pipeline SHALL exit with a non-zero code, print the unmatched Source_Id and the field that references it, and leave any existing Districts_File unchanged.

### Requirement 4: History file structure

**User Story:** As the simulation engine, I want a complete real baseline for every district and quarter, so that I can add policy deltas to it and reproduce reality when nothing changes.

#### Acceptance Criteria

1. THE History_File SHALL list exactly 44 Quarter_Keys, from `2015Q1` to `2025Q4`, in chronological order, with no duplicates and no gaps.
2. THE History_File SHALL contain, for each Indicator, exactly one Value_Record for every combination of the 41 District_Codes in `scripts/lib/districts.ts` and the 44 Quarter_Keys, which is 1,804 Value_Records per Indicator. It SHALL contain no Value_Record for any other District_Code or Quarter_Key.
3. THE History_File SHALL contain, for each City_Indicator, exactly one Value_Record for each of the two cities (Taipei and New Taipei) and each of the 44 Quarter_Keys, which is 88 Value_Records per City_Indicator. It SHALL contain no Value_Record for any other city or Quarter_Key.
4. THE History_File SHALL give each Indicator and City_Indicator a name that is unique across all Indicators and City_Indicators, a unit, an English description of 1 to 200 characters, and one or more Source_Ids. Each of those Source_Ids SHALL match a Source_Entry in the Sources_Document.
5. THE History_File SHALL give every Value_Record a value that is a finite number (not NaN and not infinite) and an Estimate_Flag that is the boolean `true` or `false`, except for the Value_Records allowed by criterion 8.
6. WHEN a Value_Record has the Estimate_Flag set to `true`, THE History_File SHALL give that Value_Record exactly one Method_Id, and that Method_Id SHALL match a method described in the Sources_Document.
7. WHEN a Value_Record has the Estimate_Flag set to `false`, THE History_File SHALL give that Value_Record a non-null value and no Method_Id.
8. IF no documented method can produce a value for a district or city and a quarter, THEN THE History_File SHALL store the value as `null` with the Estimate_Flag set to `true` and a Method_Id that names the reason the value is missing. The Sources_Document SHALL describe that reason. *(Open question: should `null` values be allowed at all? A `null` baseline cannot take a policy delta, so the engine's zero-delta identity would need a special case. The alternative is to require an estimation method for every cell and fail the build when none applies. Until the user decides, this criterion stays and every `null` Value_Record counts toward the estimated total printed under Requirement 1, criterion 4.)*
9. IF the built History_File breaks any of criteria 1 to 8, THEN THE Schema_Validator SHALL stop the Pipeline with a non-zero exit code before the History_File is written, leave any existing History_File unchanged, and print the Indicator or City_Indicator name, the District_Code or city, the Quarter_Key, and the criterion that failed.
10. WHEN the Build_Command runs twice on the same Raw_Directory contents, THE Pipeline SHALL produce a byte-identical History_File both times.

### Requirement 5: Population indicator

**User Story:** As a player, I want each district's real population per quarter, so that ghost counts and migration start from real numbers.

#### Acceptance Criteria

1. THE Pipeline SHALL set the population Indicator of a district for a quarter to an integer count of persons. The value SHALL equal the sum of the population column (`people_total` or `人口數`) over all village rows of that district for the last month of the quarter (March, June, September or December), where a village row belongs to a district when its source column (`site_id` or `區域別`) names that district's city and district.
2. THE Pipeline SHALL take each month's village rows from exactly one source, as follows: 2015-01 to 2017-12 from the MOI village CSV files (data.gov.tw 32973); 2018-01 to 2020-08 from the household-registration API JSON files for ODRP010; 2020-09 to 2025-12 from the household-registration API JSON files for ODRP060; and 2021-03 and 2024-08 from the data.gov.tw 131138 CSV files instead of the API files.
3. THE Pipeline SHALL set the Estimate_Flag of every population Value_Record to `false`.
4. WHEN the Pipeline matches a source column value to a district, THE Pipeline SHALL treat `臺` and `台` as the same character and SHALL ignore village rows whose city is neither Taipei City nor New Taipei City.
5. IF a village row names Taipei City or New Taipei City but its district part matches none of the 41 districts in `scripts/lib/districts.ts`, THEN THE Pipeline SHALL exit with a non-zero code without writing any Output_File, and print the file path, the row number and the unmatched source column value.
6. IF the source file for a quarter's last month has no village rows for one of the 41 districts, or a matched row's population value is not a non-negative integer, THEN THE Pipeline SHALL exit with a non-zero code without writing any Output_File, and print the file path, the month and the District_Code concerned.

### Requirement 6: Migration indicators

**User Story:** As a player, I want real move-in and move-out counts per district, so that I can compare simulated migration with what happened.

#### Acceptance Criteria

1. THE Pipeline SHALL set the move-in and move-out Indicators of each of the 41 districts for each quarter from 2015Q1 to 2025Q4 to the sums of the district's monthly move-in and monthly move-out counts of the three months of that quarter, expressed as integer counts of persons.
2. IF monthly migration data exists for every month of a quarter, THEN THE Pipeline SHALL set the Estimate_Flag of the migration Value_Records of that district and quarter to `false` and attach no Method_Id.
3. THE Pipeline SHALL derive the 2015 January to November migration counts of each district in four steps: (a) subtract the observed December 2015 count from the district's 2015 annual total (Taipei DBAS a05002802, New Taipei data.gov.tw 124872, where `percent3` is move-in and `percent20` is move-out); (b) split the remainder across January to November in proportion to the same district's January to November 2016 monthly counts; (c) round each month to a non-negative integer; (d) make the eleven monthly values sum exactly to the remainder.
4. THE Pipeline SHALL set the Estimate_Flag of the 2015Q1, 2015Q2, 2015Q3 and 2015Q4 migration Value_Records to `true` with the Method_Id of the 2015 seasonal split, including 2015Q4 because its October and November counts are estimated.
5. THE Pipeline SHALL compute the monthly move-in count of a district as the sum of `in_total_m` and `in_total_f` over all villages whose official administrative code belongs to that district, and the monthly move-out count as the sum of `out_total_m` and `out_total_f` over the same villages. The source for each month is data.gov.tw 32975 for 2015-12 to 2017-12, ris.gov.tw API ODRP011 for 2018-01 to 2025-12 except 2024-08, and data.gov.tw 77144 for 2024-08.
6. IF the raw data has no village records for a district in any month from 2015-12 to 2025-12, THEN THE Pipeline SHALL exit with a non-zero code and print the district code, the month and the Source_Id expected to supply that month.
7. IF a district's 2015 annual move-in or move-out total is less than its observed December 2015 count for the same Indicator, THEN THE Pipeline SHALL exit with a non-zero code and print the district code, the Indicator name, the annual total and the December 2015 count.

### Requirement 7: Income indicators

**User Story:** As a player, I want income levels per district that can be compared across districts and over time, so that rent burden is computed from consistent numbers.

#### Acceptance Criteria

1. THE Pipeline SHALL produce, for each of Taipei City and New Taipei City, a City_Indicator of disposable income per household in NT$ per household per year, taken from that city's rows of the DGBAS Family Income and Expenditure Survey series (data.gov.tw 9415) for years 2015 to 2025 and interpolated to one Value_Record for every Quarter_Key from `2015Q1` to `2025Q4`.
2. THE Pipeline SHALL produce a dimensionless district Indicator of relative median income for each of the 41 districts and each income year 2014 to 2023. Each value SHALL equal the median income in the district's total (合計) row of the FIA file (data.gov.tw 103066) for that income year, divided by the median of the total-row median incomes of all districts of the same city in the same income-year file.
3. THE Pipeline SHALL produce a district Indicator of estimated household income in NT$ per household per year for every district and every Quarter_Key from `2015Q1` to `2025Q4`. Each value SHALL equal the city disposable income City_Indicator of the district's city multiplied by the district's relative median income Indicator for the same Quarter_Key. Every such Value_Record SHALL have the Estimate_Flag set to `true` and the Method_Id of this combination method.
4. THE Pipeline SHALL compute each relative median income value from figures in a single income-year FIA file only. THE Pipeline SHALL write no FIA income level in NT$, and no ratio or difference between FIA income levels of two different income years, to the History_File.
5. THE Pipeline SHALL extrapolate each district's relative median income for income years 2024 and 2025 from a linear trend fitted only to that district's relative median income values of income years 2019 to 2023. Changing any FIA input of income years 2014 to 2018 SHALL leave the extrapolated values unchanged. The Pipeline SHALL set the Estimate_Flag of the resulting Value_Records to `true` with the Method_Id of the extrapolation.
6. THE Pipeline SHALL apply one annual-to-quarterly interpolation method, documented in the Sources_Document, to the DGBAS disposable income series and to the relative median income series. Each quarterly value SHALL lie within the closed range spanned by the annual values of the same year and of the adjacent years that exist in the series. The Pipeline SHALL set the Estimate_Flag of every interpolated Value_Record to `true` with the Method_Id of that interpolation.
7. WHEN every FIA median income amount of one income-year file is multiplied by the same positive factor, THE Pipeline SHALL produce a History_File whose income Indicator and City_Indicator Value_Records are identical to those built from the unscaled file.
8. IF an FIA income-year file from 2014 to 2023 lacks a total row for any of the 41 districts, or a district total row has a median income that is missing, non-numeric, or not greater than 0, THEN THE Pipeline SHALL exit with a non-zero code, print the file path and the District_Code of each affected district, and write no Output_Files.
9. IF the DGBAS series has no numeric disposable income per household value greater than 0 for Taipei City or New Taipei City in any year from 2015 to 2025, THEN THE Pipeline SHALL exit with a non-zero code, print the city and each missing year, and write no Output_Files.

### Requirement 8: Sale price indicator

**User Story:** As a player, I want each district's real housing sale price per quarter, so that housing pressure starts from real transactions.

#### Acceptance Criteria

1. THE Pipeline SHALL set the sale price Indicator of a district for a quarter, for every one of the 41 districts and every quarter from 2015Q1 to 2025Q4, to the median `單價元平方公尺` value, in New Taiwan dollars per square metre, of the residential building sales that pass criterion 2 and whose transaction date falls in that quarter. When the count of qualifying sales is even, the median is the arithmetic mean of the two middle values.
2. THE Pipeline SHALL count a real-price registration record as a residential building sale only if all of the following hold: its `交易標的` value includes a building (房地(土地+建物), 房地(土地+建物)+車位, or 建物), its `主要用途` value is a residential use (a value containing 住家用 or 住宅), and its `單價元平方公尺` value is a number greater than 0. Records that are land-only, parking-only, non-residential, or have an empty or zero unit price SHALL be excluded.
3. WHEN reading a `{season}_{a|f}_lvr_land_a.csv` file, THE Pipeline SHALL skip both header rows, assign each record to Taipei City for `a` files or New Taipei City for `f` files, and map the `鄉鎮市區` value to that city's official district administrative code.
4. THE Pipeline SHALL bucket each record into a quarter by its `交易年月日` value. The ROC year is converted by adding 1911 to the first three digits, and the month comes from the next two digits. The publication season of the file containing the record SHALL NOT affect the quarter, so records published in season files after 2025Q4 still count toward their 2015Q1–2025Q4 transaction quarter.
5. IF a record's `交易年月日` value is not a valid seven-digit ROC date, falls outside 2015Q1–2025Q4, or its `鄉鎮市區` value does not map to one of the 41 districts, THEN THE Pipeline SHALL exclude that record from all medians and report the count of excluded records by reason in the Pipeline run output.
6. THE Pipeline SHALL remove duplicate real-price registration records that share the same `編號` value, within and across all season files, keeping exactly one record per `編號` value before computing medians.
7. IF a district and quarter is a Thin_Cell for sales, as defined by the sales count threshold documented in the design, THEN THE Pipeline SHALL compute the value with the documented pooling method for thin districts, set the Estimate_Flag to `true`, and record the Method_Id of that pooling method. This applies to quarters with zero qualifying sales.
8. IF a district and quarter is not a Thin_Cell for sales, THEN THE Pipeline SHALL set the Estimate_Flag of that sale price Indicator to `false`.
9. IF the documented pooling method cannot produce a value for a Thin_Cell because the pooled set also contains zero qualifying sales, THEN THE Pipeline SHALL stop with a non-zero exit status, report an error naming the district code and quarter, and leave every existing Output_File unchanged. This criterion has no exceptions: no fallback value, default value or further pooling step replaces the halt.

### Requirement 9: Rent indicator

**User Story:** As a player, I want each district's rent level per quarter, so that rent burden and ghosts are computed from real rents.

#### Acceptance Criteria

1. THE Pipeline SHALL compute each district's relative rent level as the median monthly rent per square meter of the district's qualifying rental records divided by the median monthly rent per square meter of all qualifying rental records in the same city. A qualifying rental record is a record from the real-price registration rental files (`lvr_land_c`) that meets all of these conditions: its `主要用途` is residential; its `總額元` is greater than 0; its `建物總面積平方公尺` is greater than 0; and its `租賃年月日` falls between 2015Q1 and 2025Q4. Monthly rent per square meter is `總額元` divided by `建物總面積平方公尺`. Records from all 44 quarters are pooled into one relative level per district.
2. THE Pipeline SHALL compute each city's quarterly rent index as the mean of the three monthly values of the CPI rent (房租) sub-index in that quarter. Taipei districts use the Taipei City CPI rent sub-index published by the Taipei City Department of Budget, Accounting and Statistics. New Taipei districts use the DGBAS national CPI rent sub-index. Selecting the series assigned to the district's city is part of the correctness of the rent index: a rent index computed from any other series for a district is invalid.
3. THE Pipeline SHALL set the rent Indicator of a district for a quarter, in TWD per square meter per month, to the district's relative rent level × the city base rent level × (the city rent index for that quarter ÷ the mean city rent index of the base year 2024). The city base rent level is the median monthly rent per square meter of all qualifying rental records in that city with a `租賃年月日` in 2024. THE Sources_Document SHALL document this formula, the base year, and the CPI series used for each city.
4. IF a district has fewer than 30 qualifying rental records across 2015Q1–2025Q4, which is the minimum count configured for the rent Indicator, THEN THE Pipeline SHALL set the district's rent Indicator for each quarter to the Reference_District's rent Indicator for that quarter × (the district's median monthly rent (the 50th percentile) ÷ the Reference_District's median monthly rent (the 50th percentile) in the MOI district rent statistics for contracts valid on 2024-12-31, row "all types"). THE Pipeline SHALL also set the Estimate_Flag to `true` with the Method_Id of the reference-district method for all 44 quarters of that district.
5. IF a district has fewer than 30 qualifying rental records across 2015Q1–2025Q4 and is not covered by the MOI district rent statistics (Shiding, Pinglin, Shimen, Pingxi, Shuangxi, Wulai), THEN THE Pipeline SHALL replace the rent-statistics ratio in criterion 4 with the ratio of the mean of the district's sale price Indicator over the four quarters of 2024 to the same mean for the Reference_District. THE Pipeline SHALL also set the Estimate_Flag to `true` with the Method_Id of the sale-price-ratio method for all 44 quarters of that district.
6. THE Sources_Document SHALL list, for each district that uses a Reference_District, the assigned Reference_District, the method applied (rent-statistics ratio or sale-price ratio), the district's qualifying rental record count, and the ratio value used.
7. THE Pipeline SHALL take each district's Reference_District from a fixed assignment table, not from a nearest-district calculation at build time. Each assigned Reference_District must be in the same city and have at least 30 qualifying rental records across 2015Q1–2025Q4, and must share a border with the district. IF no district of the same city that borders the district has at least 30 qualifying rental records, THEN the assigned Reference_District MAY instead be a district of the same city that has at least 30 qualifying rental records and shares a border with a district that borders the district, and the Sources_Document SHALL state that the second rule was used.
8. IF a district below the minimum count of 30 qualifying rental records has no entry in the Reference_District assignment table, or its assigned Reference_District breaks any condition in criterion 7, THEN THE Pipeline SHALL stop the build without writing any output file and report an error that names the district and the condition it breaks.
9. IF any monthly value of the CPI rent sub-index needed for a quarter from 2015Q1 to 2025Q4 is missing from the raw input, THEN THE Pipeline SHALL stop the build without writing any output file and report an error that names the city series and the missing month.
10. IF the city of a district maps to a CPI rent series other than the series assigned to that city in criterion 2 (for example, through a misconfigured mapping table), THEN THE Pipeline SHALL stop the build with a non-zero exit code without writing any Output_File, and report an error that names the District_Code and the CPI rent series it was mapped to.

### Requirement 10: House-price-to-income ratio

**User Story:** As a player, I want the house-price-to-income ratio for all 44 quarters, so that affordability can be compared across the whole period.

#### Acceptance Criteria

1. THE Pipeline SHALL compute the house-price-to-income ratio as a City_Indicator for Taipei and New Taipei only. It SHALL produce one Value_Record per city for every Quarter_Key from `2015Q1` to `2025Q4`, which is 44 per city and 88 in total. It SHALL NOT produce a district-level house-price-to-income Indicator.
2. THE Pipeline SHALL compute each house-price-to-income Value_Record by dividing two values and rounding the result to 2 decimal places. The numerator is the median total price, in NT$, of that city's residential sale records in the real-price registration data whose transaction date falls in the Quarter_Key. A residential sale record is a sale whose main building use is residential, which excludes land-only and parking-space-only transactions. The denominator is the annual DGBAS disposable income per household that the citywide income City_Indicator gives for the same city and Quarter_Key.
3. THE Pipeline SHALL set the Estimate_Flag of every house-price-to-income Value_Record to `true` and attach the Method_Id of the computation. The Sources_Document entry for that Method_Id SHALL state the formula, the residential sale filter, the income source, and the fact that the MOI ratio uses the same median-price and median-disposable-income definitions with its own sample.
4. IF a city and Quarter_Key has fewer than 100 qualifying residential sale records, or has no Value_Record in the citywide income City_Indicator, THEN THE Pipeline SHALL exit with a non-zero code, print the city, the Quarter_Key, and the record count or the missing income Value_Record, and write no output file.
5. WHERE a hand-entered reference table of MOI city ratios is committed in the repository, THE Pipeline SHALL print one line for each row in the table. Each row lists a city, a Quarter_Key from `2016Q3` to `2025Q4`, the MOI ratio, and the source PDF file name. Each printed line SHALL show the city, the Quarter_Key, the computed ratio, the MOI ratio, and the signed difference (computed minus MOI) to 2 decimal places, followed by one summary line giving the largest absolute difference per city. These differences SHALL change neither the output values nor the exit code.
6. IF a row in the reference table names a city other than Taipei or New Taipei, has a Quarter_Key outside `2016Q3` to `2025Q4`, has a ratio that is not a positive number, or repeats a city and Quarter_Key already listed, THEN THE Pipeline SHALL exit with a non-zero code, print the row number and the reason the row is invalid, and write no output file.
7. IF no reference table is present in the repository, THEN THE Pipeline SHALL print one line stating that house-price-to-income validation was skipped and continue the build with an unchanged exit code.

### Requirement 11: MRT ridership indicator

**User Story:** As a player, I want MRT ridership per district per quarter, so that transit use starts from real counts.

#### Acceptance Criteria

1. THE Pipeline SHALL assign each station to the one district whose boundary polygon contains the station point. For the 7 border stations in DATA-CHECK.md item 11 (Gongguan, Taipower Building, Zhongshan, Minquan W. Rd., Shuanglian, Yuanshan, Yongan Market), it SHALL use that point-in-polygon district, and the Sources_Document SHALL list each of the 7 with both its point district and its address district.
2. THE Pipeline SHALL map every station name in the annual series (data.gov.tw 133184) and in the daily station files (data.gov.tw 128683) to exactly one station in the station-to-district table through a station alias table (for example `板橋Y` and `南京復興BR`). Where several rows map to the same station in a year, it SHALL add their entries together.
3. WHEN the Pipeline reads the annual series, THE Pipeline SHALL exclude the non-station rows `一日票`, `團體票` and `其他` from all station totals and from every MRT ridership Indicator value.
4. THE Pipeline SHALL treat a station as an Active_Station in a quarter if all three conditions hold: the station appears in the annual series, the station's line section has an opening date in DATA-CHECK.md item 10.5 (for example Dingpu 2015-07-06, Circular Line 2020-01-31), and that opening date is on or before the last day of the quarter.
5. THE Pipeline SHALL set the MRT ridership Indicator of a district for each quarter from 2015Q1 to 2025Q4 to the sum of the quarterly entries of the Active_Stations assigned to that district.
6. THE Pipeline SHALL compute the four Seasonal_Shares (Q1 to Q4) of a station in three steps. First, for each year in 2015–2016 during which the station was open from January 1 to December 31, it SHALL divide the station's entries in each quarter, summed from the daily entry files (data.gov.tw 128683), by the station's entries for that whole year. Second, it SHALL average each quarter's share over those years. Third, it SHALL check that the four averaged shares sum to 1 within an absolute tolerance of 1e-9.
7. WHILE a station is an Active_Station in all four quarters of a year in 2015–2025, THE Pipeline SHALL set the station's entries for each quarter of that year to the station's annual entries from the annual series multiplied by the station's Seasonal_Share for that quarter. This criterion holds on its own, independent of criteria 13 and 14.
8. IF a station was not open for any full calendar year in 2015–2016 (including every Circular Line station), THEN THE Pipeline SHALL use the Seasonal_Shares of one comparable station that was open for all of 2015 and 2016. The Sources_Document SHALL name the comparable station for each such station.
9. THE Pipeline SHALL set the Estimate_Flag of every quarterly ridership Value_Record derived from annual totals to `true`, together with the Method_Id of the seasonal split.
10. WHILE a district has no Active_Station in a quarter, THE Pipeline SHALL set that district's MRT ridership value for that quarter to 0 with the Estimate_Flag set to `false`.
11. IF a station name other than the excluded non-station rows has no alias table entry, or an Active_Station has no annual value for a year it is active, THEN THE Pipeline SHALL stop with an error naming the station and the year, and SHALL leave the existing output files unchanged.
12. THE Sources_Document SHALL state that ridership for the Danhai LRT, the Ankeng LRT and the Sanying Line (opened 2026, after the 2015–2025 range) is not included because no station-level source was found. It SHALL also state that the MRT ridership Indicator of a district with stations on these lines counts only its Active_Stations.
13. WHEN the Pipeline computes a station's quarterly entries for the year in which the station opens, THE Pipeline SHALL rescale the Seasonal_Shares of the quarters in which the station is an Active_Station so that those shares sum to 1, set the station's entries for each of those quarters to its annual entries multiplied by the rescaled share, and set the station's entries for every other quarter of that year to 0. This criterion holds on its own, independent of criteria 7 and 14.
14. THE Pipeline SHALL produce, for every station and every year in 2015–2025 in which the station is an Active_Station in at least one quarter, quarterly entries whose sum differs from the station's annual entries in the annual series by at most 1 rider. This criterion holds on its own, independent of criteria 7 and 13.

> **Open question (entries only or entries + exits):** criteria 5–7 currently count entries only. If entries + exits is chosen, three things change. The Indicator becomes the sum of quarterly entries plus quarterly exits. Seasonal_Shares are computed separately from the daily entry files and the daily exit files. Each series is split by its own shares.

### Requirement 12: Real policy track

**User Story:** As the simulation engine, I want the real value of each of the 5 policy tools for every quarter from 2015Q1 to 2025Q4, each with its source, so that the player's settings start from what really happened and every difference from reality can be measured and explained.

#### Acceptance Criteria

1. THE Pipeline SHALL build the Policy_Track_File, which contains one Policy_Series for each series named in criteria 4 to 12 and no other Policy_Series.
2. THE Policy_Track_File SHALL contain, for each district-level Policy_Series, exactly one Track_Record for every combination of the 41 District_Codes and the 44 Quarter_Keys (1,804 Track_Records), and for each city-level Policy_Series, exactly one Track_Record for each of the two cities (Taipei and New Taipei) and each of the 44 Quarter_Keys (88 Track_Records).
3. THE Policy_Track_File SHALL give each Policy_Series a name that is unique across all Policy_Series, Indicators and City_Indicators, the Policy_Tool it belongs to, a unit, an English description of 1 to 200 characters and one or more Source_Ids. THE Policy_Track_File SHALL give each Track_Record a finite value, one Source_Id that matches a Source_Entry in the Policy_Track_File, and an Estimate_Flag. THE Policy_Track_File SHALL give each Track_Record with the Estimate_Flag set to `true` exactly one Method_Id that matches a method described in the Sources_Document. For an estimated Track_Record, the Source_Id names the main source the estimate starts from.
4. THE Pipeline SHALL set the social housing starts Policy_Series (units whose construction began, per district) of a district for a quarter to the sum of the unit counts (`household_num`) of all projects in the NLMA social housing portal files, of any status, whose construction start date (`strStartDate`, ROC year plus 1911) falls in that quarter and whose per-project detail file names that district, counting each `setupplan_guid` once, and SHALL set the Estimate_Flag of every such Track_Record to `false`. The value SHALL be 0 when no project qualifies.
5. IF a project has an empty or unparseable `strStartDate`, no per-project detail file, or a `TownCode` that is not one of the 41 District_Codes, THEN THE Pipeline SHALL exclude it from the social housing starts Policy_Series without estimating a date or district, continue the build, and print the project's `setupplan_guid`, the reason, its unit count and the total units excluded per city.
6. THE Pipeline SHALL set the rent subsidy households Policy_Series (households receiving the subsidy in the quarter, per city) of a city for a quarter to the sum of the households that MOI reports for the integrated housing subsidy plan (the program that ran until 2022) and for the central expanded rent subsidy plan (the program paid from 2022Q4), counting a program with no figure for that quarter as 0, and SHALL set the Estimate_Flag to `false`.
7. THE Pipeline SHALL set the rent subsidy amount Policy_Series (TWD per subsidized household per month, per city) of a city for each quarter of 2023 to the city's 2023 total subsidy amount divided by its 2023 household-months in MOI dataset 169800, with the Estimate_Flag set to `true` and the Method_Id of the annual-average method. THE Pipeline SHALL set the same Policy_Series for every other quarter to that 2023 value with the Estimate_Flag set to `true` and the Method_Id of the carry method, because no official amount per household is published for other years.
8. THE Pipeline SHALL set the sublease units matched Policy_Series (units matched in the quarter, per city) of a city for each quarter to an estimate built from the cumulative matches by program phase and channel (city-run or central) that MOI published as of 2026-10-31. The estimate SHALL spread each phase's total evenly over the days from the phase start date to the start date of the next phase of the same channel (or to the publication date for the last phase), SHALL count only the days up to the end of 2025Q4, SHALL give whole units that sum exactly to the counted part of each phase and channel total, and SHALL set the Estimate_Flag to `true` with the Method_Id of the phase-spread method. THE Pipeline SHALL read the phase start dates and totals from a committed table in which every row names its source.
9. THE Pipeline SHALL set the holding tax lowest-tier rate and the holding tax highest-tier rate Policy_Series (percent of assessed house value, per city) for a quarter to the rate that the House Tax Act or the city's ordinance sets for non-owner-occupied residential buildings and that is in force on the last day of the quarter, read from a committed table of effective-dated rates in which every row cites the legal text, its article or version and its effective date, and SHALL set the Estimate_Flag to `false`.
10. IF no legal text in the committed table gives the rate of a city on the last day of a quarter (New Taipei City before 2017-07-01), THEN THE Pipeline SHALL set both holding tax rates of that city and quarter to the lower limit of the statutory range of the House Tax Act in force, with the Estimate_Flag set to `true` and the Method_Id of the statutory-minimum method.
11. THE Pipeline SHALL set the house tax revenue Policy_Series (NT$ thousand per quarter, per city) of a city for each quarter to one quarter of the net house tax collections of the city's calendar year from MOF dataset 6742, with the Estimate_Flag set to `true` and the Method_Id of the even-split method. THE Sources_Document SHALL state that the series covers all house tax and not only the tax on non-owner-occupied residential buildings, and that real collections are concentrated in one month of the year.
12. THE Pipeline SHALL set the commuter pass price Policy_Series (TWD per 30-day pass, per city) of a city for a quarter to the price of the commuter pass product in force on the last day of the quarter, or to 0 when no commuter pass product was offered, read from a committed table of pass products with start dates and sources, with the Estimate_Flag set to `false`. THE Pipeline SHALL also set, for every city and quarter, the commuter pass subsidy Policy_Series (the city's subsidy per pass on top of the pass price, in TWD per 30-day pass) to 0 with the Estimate_Flag set to `true` and the Method_Id of the definition method, and the commuter passes sold Policy_Series (passes sold in the quarter) to a documented estimate with the Estimate_Flag set to `true` and the Method_Id of the passes-sold method, 0 in every quarter with a pass price of 0. THE Sources_Document SHALL state the assumption behind each of these two Method_Ids.
13. WHEN a program of a Policy_Tool had not started on the last day of a quarter, THE Pipeline SHALL set every Track_Record of that Policy_Tool for that quarter to 0.
14. IF a Policy_Series, district or city and quarter cannot be taken from a source and no documented method can produce its value, THEN THE Pipeline SHALL exit with a non-zero code before writing any Output_File and print the Policy_Series name, the District_Code or city and the Quarter_Key.
15. IF a committed table read by the Policy_Track_File has a row with an invalid date, a date that is not later than the previous row of the same city and series, a non-positive rate or price, or no source, THEN THE Pipeline SHALL exit with a non-zero code and print the table path, the row number and the reason.
16. THE Sources_Document SHALL state, for each Policy_Series that has estimated Track_Records, the share of its Track_Records with the Estimate_Flag set to `true`, the assumption of each Method_Id it uses, and the data that would replace the estimate.

### Requirement 13: Social housing indicator

**User Story:** As a player, I want the real number of social housing units completed per district, so that my own construction can be compared with what was built.

#### Acceptance Criteria

1. THE Pipeline SHALL set the social housing completions Indicator of a district for a Quarter_Key to the sum of unit counts (`household_num`, parsed as an integer) of all projects in the NLMA social housing portal list files that meet three conditions: the status is `已完工`, the per-project detail file has a `TownCode` equal to that District_Code, and the actual completion date (`strEndDate`, ROC year plus 1911) falls within that Quarter_Key. If no project meets these conditions, the value SHALL be 0.
2. THE Pipeline SHALL set the social housing stock Indicator of a district for a Quarter_Key to the sum of unit counts of all projects that meet the conditions of criterion 1 for that District_Code and whose actual completion date is on or before the last day of that Quarter_Key. This sum SHALL include projects completed before 2015Q1, including the older Taipei public rental sites completed from 1971 onward.
3. THE Pipeline SHALL exclude from both the completions and the stock Indicators every project whose status is not `已完工`, including projects with status `興建中` that have only an expected completion date.
4. THE Pipeline SHALL set the Estimate_Flag to `false` on every Value_Record of the social housing completions and stock Indicators, because these values are observations from the portal files.
5. IF a project with status `已完工` has an empty or unparseable `strEndDate`, has no per-project detail file, or has a `TownCode` that is not one of the 41 District_Codes, THEN THE Pipeline SHALL exclude that project from both Indicators without estimating a date or district, continue the build, and print the project's `setupplan_guid`, the reason for exclusion, its unit count, and the total units excluded per city.
6. IF a project's `household_num` is not a string representing a non-negative integer, THEN THE Pipeline SHALL exit with a non-zero code and print the file path, the `setupplan_guid` and the invalid value.
7. IF the same `setupplan_guid` appears more than once across the portal list files, THEN THE Pipeline SHALL count that project's units only once in each Indicator.

### Requirement 14: Provenance for every field

**User Story:** As a teacher, I want every number to name its source, so that students can check where it came from.

#### Acceptance Criteria

1. THE Pipeline SHALL keep exactly one registry of Source_Entries. Each Source_Entry SHALL have a Source_Id that is unique within the registry, plus a non-empty agency, a non-empty dataset name, an absolute `http` or `https` URL, the years covered as a first and last four-digit year with first ≤ last, and a non-empty license.
2. IF a source states no license, THEN THE Pipeline SHALL record the license of that Source_Entry as `not stated`. IF a source does state a license, THEN THE Pipeline SHALL record the license name and version as the source states them (for example, Open Government Data License, version 1.0).
3. THE Pipeline SHALL give every field of the Districts_File, and every Indicator and City_Indicator of the History_File, and every Policy_Series of the Policy_Track_File, at least one Source_Id that exists in the registry. This includes fields marked `estimated: true` and fields derived through a Method_Id.
4. IF an Output_File references a Source_Id or Method_Id that the registry or the method list does not define, THEN THE Schema_Validator SHALL report the unknown identifier and the path where it occurs, and SHALL mark the validation run as failed.
5. IF a Source_Entry is missing a required attribute, has an empty value for one, has a URL that is not an absolute `http` or `https` URL, or has a first covered year later than its last covered year, THEN THE Schema_Validator SHALL report the Source_Id and the attribute that is invalid, and SHALL mark the validation run as failed.
6. WHEN the Pipeline records a Source_Entry URL that contains an `api_key` query parameter or any other credential value, THE Pipeline SHALL replace the credential value with a fixed redaction placeholder and keep the rest of the URL unchanged.
7. IF any Source_Entry URL or Output_File contains an `api_key` query parameter whose value is not the redaction placeholder, THEN THE Schema_Validator SHALL report the Source_Id or path where it occurs and SHALL mark the validation run as failed.

### Requirement 15: Sources document

**User Story:** As a teacher, I want a readable document of all sources and methods, so that I can explain the data to students and cite it correctly.

#### Acceptance Criteria

1. WHEN the Pipeline completes successfully, THE Pipeline SHALL write the Sources_Document from the same registry of Source_Entries and Method_Ids used to build the History_File, the Policy_Track_File and the Districts_File, with a notice at the top stating that the file is generated by the Build_Command and must not be edited by hand.
2. WHEN the Pipeline runs twice on the same Raw_Directory contents and the same committed files, THE Pipeline SHALL produce byte-identical Sources_Document files.
3. THE Sources_Document SHALL list, for every field of the Districts_File, every Indicator and City_Indicator of the History_File and every Policy_Series of the Policy_Track_File, the Source_Id, agency, dataset name, URL, years covered and license of each Source_Entry it depends on. The fields are grouped by Output_File, and the license is the literal text `not stated` when the source gives no license.
4. THE Sources_Document SHALL describe every Method_Id that appears in the Output_Files, including the annual-to-quarterly interpolation method and every estimation method. Each description SHALL state the input series, the calculation steps, the Indicators, City_Indicators or Policy_Series and Quarter_Keys it applies to, and whether it sets the Estimate_Flag to `true`.
5. THE Sources_Document SHALL list each known data gap from DATA-CHECK.md that affects an output field or a Policy_Series, with the DATA-CHECK.md item number, the affected fields, the affected Quarter_Key range or district list, and the Method_Id used to handle the gap.
6. THE Sources_Document SHALL contain no term from the banned-term list, which the Pipeline keeps in a committed file seeded from the examples in `neutrality.md`, checked as a case-insensitive whole-word match. The list covers loaded wording (at least "failed", "disastrous", "brilliant" and "finally") and the names of political parties and politicians. A name that is part of an official policy or dataset title is exempt.
7. WHERE a Source_Entry refers to a Wikipedia page, THE Sources_Document SHALL show the page title, the URL, the license CC BY-SA and a statement that the page is cited as a reference and no text is copied from it.
8. IF a field, Indicator or City_Indicator in the Output_Files refers to a Source_Id or Method_Id that has no registry entry, or a Source_Entry lacks the agency, dataset name, URL, years covered or license, THEN THE Pipeline SHALL print the missing identifier or field name, exit with a non-zero code and leave every existing Output_File unchanged.
9. IF the generated Sources_Document text contains a term from the committed banned-term list described in criterion 6, THEN THE Pipeline SHALL print each matched term with its line number, exit with a non-zero code and leave every existing Output_File unchanged.

### Requirement 16: Schema validation

**User Story:** As the developer, I want every output checked before it is written, so that a malformed file never reaches the web app.

#### Acceptance Criteria

1. THE Schema_Validator SHALL check the Districts_File, the History_File and the Policy_Track_File for required fields, field types, the 41 District_Codes, the 44 Quarter_Keys and the allowed value range of each Indicator. For each check, it SHALL report an error when any of these holds:
   - a required field is missing;
   - a field has a type other than the one its schema declares;
   - a field holds `null` where the schema does not allow `null`;
   - the Estimate_Flag is not a boolean;
   - a District_Code appears that is not one of the 41 District_Codes;
   - one of the 41 District_Codes is missing or appears more than once;
   - an Indicator, City_Indicator or Policy_Series does not hold exactly one Value_Record or Track_Record for each of the 44 Quarter_Keys from `2015Q1` to `2025Q4`;
   - a Quarter_Key is duplicated, missing or outside that span.
2. THE Schema_Validator SHALL reject any numeric value other than `null` that is `NaN`, `Infinity` or `-Infinity`. This check SHALL run on the in-memory object before it is serialized to JSON.
3. THE Schema_Validator SHALL reject a value below 0 in any count Indicator or count Policy_Series (population, move-in, move-out, ridership, social housing completions and stock, social housing units started, sublease units matched, rent subsidy households and commuter passes sold).
4. THE Schema_Validator SHALL reject a value below 0 or above 100 in any Indicator whose unit is a percentage or a 0–100 index. A value of exactly 0 or exactly 100 SHALL pass.
5. IF the Schema_Validator finds one or more errors, THEN THE Pipeline SHALL:
   - finish validating every Output_File rather than stop at the first error;
   - print each error with the file name and the JSON path of the failing value;
   - exit with a non-zero code.
6. THE Pipeline SHALL build and validate every Output_File in memory before it writes any Output_File to disk.
7. IF the Schema_Validator finds one or more errors in any Output_File, THEN THE Pipeline SHALL leave every existing Output_File byte-identical to its state before the run, and SHALL create no Output_File that did not exist before the run.
8. WHEN the Schema_Validator reports zero errors for every Output_File, THE Pipeline SHALL write all Output_Files in the same run. IF a write fails, THEN THE Pipeline SHALL restore every Output_File already written in that run to its content before the run, delete every Output_File written in that run that did not exist before the run, so that the files on disk match their state before the run (consistent with criterion 7 and Requirement 2 criterion 5), and then print the file name of the failed write and exit with a non-zero code.
9. THE Schema_Validator SHALL run using only the packages already listed in `package.json`, unless the developer approves a validation dependency under the project dependency policy.
10. FOR ALL valid History_File objects, serializing to JSON and then parsing and validating SHALL report zero errors and produce an object deep-equal to the original (round-trip property).
11. FOR ALL valid Districts_File objects, serializing to JSON and then parsing and validating SHALL report zero errors and produce an object deep-equal to the original (round-trip property).
12. FOR ALL valid Policy_Track_File objects, serializing to JSON and then parsing and validating SHALL report zero errors and produce an object deep-equal to the original (round-trip property).

### Requirement 17: Deterministic output

**User Story:** As the simulation engine, I want the baseline to be identical on every build, so that the zero-delta identity check stays stable.

#### Acceptance Criteria

1. WHEN the Build_Command runs twice on the same Raw_Directory contents, THE Pipeline SHALL produce Output_Files that are byte-identical between the two runs. This SHALL hold whether the two runs use the same shell or different shells (Git Bash and PowerShell), and whether they use the same machine or different machines.
2. THE Pipeline SHALL write object keys, district entries, Quarter_Keys, Indicators, City_Indicators and Source_Entries in the fixed order documented in the Sources_Document. District entries SHALL be ordered by ascending District_Code, and Quarter_Keys SHALL be ordered chronologically from 2015Q1 to 2025Q4.
3. THE Pipeline SHALL round each numeric value to the fixed number of decimal places documented for its Indicator or City_Indicator, between 0 and 6 places. The value SHALL be written with no exponent notation, with no trailing zeros after the decimal point, and with no negative zero. For example, 1.50 SHALL be written as 1.5, and -0 SHALL be written as 0.
4. THE Pipeline SHALL derive every value in the Output_Files from the Raw_Directory contents and the Pipeline scripts only. The Output_Files SHALL exclude the current date and time, the absolute file paths of the machine, environment variable values, and random values.
5. THE Pipeline SHALL write every Output_File as UTF-8 without a byte-order mark. Every line SHALL end with a single LF character with no CR character, and the file SHALL end with exactly one LF.
6. THE Pipeline SHALL write each JSON Output_File with one fixed indentation width documented in the Sources_Document. The Pipeline SHALL produce identical output for identical data, independent of the order in which input records were read or values were computed.
7. WHEN the Pipeline lists the files in a directory under the Raw_Directory, THE Pipeline SHALL sort the file names in ascending order, compared by Unicode code point. It SHALL process the files in that sorted order and SHALL NOT use the order returned by the file system.

### Requirement 18: Tests

**User Story:** As the developer, I want unit tests for parsing and transformation, so that changes to the scripts do not silently change the baseline.

#### Acceptance Criteria

1. THE Pipeline SHALL have, for each function in `scripts/` that parses a raw file or transforms parsed records into Value_Records or Districts_File fields, at least one Vitest unit test in `tests/scripts/`. Each test SHALL build its fixture input in memory with no more than 50 rows per fixture and compare the output against literal expected values written in the test file and checked by hand.
2. THE Pipeline SHALL have, for each parsing function, at least one Vitest test that passes input missing an expected column and checks that the function reports the row number and the expected column names, as defined in Requirement 2 criterion 4.
3. THE Pipeline SHALL have Vitest tests that pass malformed Districts_File, History_File and Policy_Track_File objects to the Schema_Validator and check that each object is rejected and that the reported JSON path equals the expected JSON path. For each of the three files, the malformed objects SHALL cover at least one case of each of the following: a missing required field, a field of the wrong type, a District_Code not in `scripts/lib/districts.ts`, and a Quarter_Key outside `2015Q1` to `2025Q4`. For the Districts_File, they SHALL also cover a district count other than 41.
4. THE Pipeline SHALL have Vitest tests that pass one valid in-memory Districts_File object, one valid in-memory History_File object and one valid in-memory Policy_Track_File object to the Schema_Validator and check that both are accepted with no reported errors.
5. THE Pipeline SHALL have a property-based test, written with fast-check, that generates annual series of 1 to 11 consecutive years within 2015 to 2025, with finite values from 0 to 1,000,000,000. The test SHALL run at least 100 generated cases and check that the annual-to-quarterly interpolation output meets the property recorded in the Sources_Document for that interpolation's Method_Id. The output SHALL also contain exactly 4 finite quarterly values for each input year, keyed by Quarter_Keys of that year.
6. IF a property-based test case fails, THEN THE test run SHALL report the failure as a failed test and print the shrunk counterexample annual series.
7. WHEN the developer runs `npx vitest --run`, THE Pipeline tests SHALL finish with exit code 0 and zero failed tests. WHEN the developer runs `npm run typecheck`, THE Pipeline tests and scripts SHALL finish with exit code 0 and zero type errors under TypeScript strict mode. Compliance with this criterion SHALL be shown only by actually running `npx vitest --run` and `npm run typecheck` and observing exit code 0 from each command, and SHALL NOT be assumed without running them.
8. WHILE `data/raw/` is empty or absent and no network access is available, THE Pipeline tests SHALL produce the same pass and fail results as when `data/raw/` is fully populated.

## Open Questions

These need a decision from the user before or during design. The requirements above use the default in brackets.

1. **Boundaries in `districts.json`.** The user asked for GeoJSON boundaries inside `districts.json`, but `scripts/build-boundaries.ts` already writes a separate `public/data/boundaries.geojson` (113 KB). Options: (a) embed the geometry in `districts.json` and stop writing `boundaries.geojson`; (b) embed it and keep writing `boundaries.geojson`, with duplicated data; (c) keep geometry only in `boundaries.geojson` and reference the file from `districts.json`. [Default in Requirement 3: (a).]
2. **Schema validation library.** `tech.md` requires approval before adding a dependency. Options: a hand-written validator with no dependency, or a library such as Zod or Ajv. [Default: hand-written.] The same schema will later be needed in `src/data/`; should the schema types live in `src/types/` and be imported by the scripts?
3. **Commute matrix and adjacency.** `tech.md` places adjacency and the 41×41 commute-time matrix in `districts.json`. Adjacency can be derived from shared borders with little work; the commute matrix needs its own method. Include adjacency now, and defer the matrix? [Default: both deferred.]
4. **Indicator list.** The draft has population, move-in, move-out, city disposable income, relative median income, estimated household income, sale price, rent, house-price-to-income ratio, MRT ridership, social housing completions and stock. PM2.5 was removed with the parks tool. Add or remove any? Candidates not included: renting-household share (2020 census only, one year), MRT station count per district, mortgage rate and CPI (national or city, may belong in `params.json` or events).
5. **Annual-to-quarterly interpolation.** Options: mean-preserving (the four quarters of a year average to the annual value), linear between mid-year points, or a step (same value all year). [Default: mean-preserving, so a property test can check it.]
6. **Thin-cell thresholds and pooling.** Rent: a district needs at least 30 qualifying rental records across 2015Q1–2025Q4, otherwise it uses a Reference_District (Requirement 9.4). [Default: 30.] Sale prices: the minimum records per district and quarter and the pooling method (for example a rolling four-quarter window, or the annual pool) are still open. [Default: decided in design, documented in SOURCES.md.]
7. **Reference districts for rural rents.** Who picks each Reference_District: a fixed hand-written table, or the nearest district with enough records? [Default in Requirement 9.7: a fixed hand-written table of bordering districts in the same city. Decided 2026-11-11: when no bordering district qualifies, a district that borders a bordering district is allowed (Pinglin → Xindian).]
8. **House-price-to-income ratio level.** City level only (matching the MOI releases) or also per district? [Default in Requirement 10.1: city level only.] The MOI PDFs are not parsed; validation against them uses a hand-entered reference table (Requirements 10.5–10.7) unless a PDF parser dependency is approved.
9. **Removed.** PM2.5 (air quality) left the scope together with the parks, green space and street trees tool. The number is kept so that other references to question numbers stay valid.
10. **Border stations.** Assign the 7 border stations by point location or by official address. [Default in Requirement 11.1: point-in-polygon, with both the point district and the address district listed in SOURCES.md.]
11. **Missing values.** Requirement 4.8 allows `null` with `estimated: true` and a reason. The user asked that every missing value be estimated; confirm whether `null` is acceptable at all, or whether every cell must have a number.
12. **MRT ridership unit.** Entries only, or entries plus exits.
13. **fast-check dependency.** Requirement 18.5 uses fast-check. `tech.md` names it as the property-based testing library, but it is not installed yet. Adding it needs the user's approval under the dependency policy.
14. **Rent base year.** Requirement 9.3 uses 2024 as the base year for the city base rent level and the CPI rent index. Confirm 2024, or choose another year.
15. **Real policy track assumptions.** Five points in the policy track are not settled by any source. [Defaults in Requirement 12.] (a) The city commuter pass subsidy is defined as 0 on top of the published pass price, because no local-government share is published (Requirement 12.12). (b) Commuter passes sold are estimated from the one published cumulative figure (Requirement 12.12). (c) The 2023 rent subsidy amount per household is carried to every other quarter (Requirement 12.7). (d) New Taipei City's holding tax rate before 2017-07-01 is the statutory minimum (Requirement 12.10). (e) The first sublease phase starts in 2017Q1, the first year of the Taipei yearly series (Requirement 12.8). Confirm each, or supply a better source.
