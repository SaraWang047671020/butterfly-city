# Data Availability Check

Checked on 2026-11-11 (Asia/Taipei) by downloading the files, not by reading descriptions only.
Target coverage: 2015 Q1 – 2025 Q4, the 41 districts of Taipei City (12) and New Taipei City (29).

Downloaded raw files are in `data/raw/` (gitignored, not committed). Every number below can be
reproduced with the scripts in `scripts/` (see `data/DOWNLOAD.md`):

- `node scripts/download.ts <source|all>` downloads the raw files.
- `node scripts/check.ts <source|all>` prints the coverage reports that the tables below come from.

Each section names its source id, e.g. `lvr`.

> **Scope note (2026-11-11):** the project now has 5 policy tools: social housing, sublease, rent subsidy, holding tax and commuter pass subsidy. Section 8 (air quality) and sections 10.5 (MRT extension), 10.7 (TOD) and 10.8 (parks) describe data that is no longer used. They are kept as a record of what was checked.

**Status legend**: ✅ usable as is · ⚠️ usable with a documented gap or workaround · ❌ no source found yet

"OGDL v1" means 政府資料開放授權條款-第1版 (Open Government Data License, version 1.0), as stated on the
data.gov.tw dataset page.

## Summary

| # | Data | Status | Spatial level | Time level | 2015–2025 | 41 districts | License |
|---|---|---|---|---|---|---|---|
| 1 | Income (tax-filing median) | ⚠️ | Village → district totals | Year | 2015–2023 only; 2024–2025 must be estimated; series break in 2019. City-level DGBAS series complete 2015–2025 (decision 1) | 41/41 | OGDL v1 |
| 2a | Real-price registration, sales | ✅ | Transaction (address) | Day | Complete | 41/41, but 7 rural districts are very thin | OGDL v1 |
| 2b | Real-price registration, rentals | ⚠️ | Transaction (address) | Day | Complete files, but coverage grows ~10× over the period | 3 districts have zero records; 6 more have ≤12 in 11 years. The 2020 census shows these districts have only 26–168 renting households each | OGDL v1 |
| 3a | Population | ✅ | Village → district | Month | Complete (one month needs a CSV instead of the API) | 41/41 | OGDL v1 |
| 3b | In/out migration | ⚠️ | Village → district | Month (2016+), year (2015) | 2015 Jan–Nov only as annual totals | 41/41 | OGDL v1 |
| 4 | MRT station entries/exits | ⚠️ | Station | Day (2015–16), hour OD (2017+), year (2014+) | Complete for Taipei Metro AFC stations | Needs station→district mapping | OGDL v1 |
| 5 | Social housing projects | ✅ | Project (address + coordinates) | Completion date | Complete | Taipei 12/12 districts, New Taipei 17/29 have projects | None stated |
| 6 | Policy rate, mortgage rate, CPI | ✅ | National (CPI also Taipei City) | Day / month | Complete | n/a | OGDL v1 |
| 7 | House-price-to-income ratio | ⚠️ | City | Quarter | 2016 Q3 – 2025 Q4 (PDF); 2015 Q1 – 2016 Q2 not found | City only | Not stated on page |
| 8 | Air-quality stations | ✅ | Station | Hour | Complete | 16/41 districts have a station | OGDL v1 |
| 9 | District boundaries | ✅ | District polygon | 2025-03 edition | n/a | 41/41 | OGDL v1 |
| 10 | Policy tools, real 2015–2025 values | ⚠️ | City | Varies | Most tools covered; gaps in rent-subsidy amounts, New Taipei sublease by year, TPASS usage | n/a | Mostly OGDL v1; law and agency pages state none |
| 11 | MRT / LRT stations → districts | ✅ | Station point | Current network | Must be filtered by opening date | 21/41 districts have a station in the 2025 network (23/41 including the Sanying Line, opened 2026) | OGDL v1 (TDX terms not verified) |
| 12 | Commute-time inputs | ⚠️ | Station segment; district shares | Current network; 2020 | Rail network times yes; LRT times and a district OD matrix no | 41/41 for census shares | OGDL v1 (TDX terms not verified) |

The 41 districts (official code, source-file name, romanized name) are defined in `scripts/lib/districts.ts`.

---

## 1. Income: Ministry of Finance, comprehensive income tax by village (data.gov.tw 103066)

- **Agency**: Fiscal Information Agency, Ministry of Finance (財政部財政資訊中心)
- **Dataset**: 綜稅綜合所得總額全國各縣市鄉鎮村里統計分析表
- **Catalog page**: https://data.gov.tw/dataset/103066
- **Download URL pattern**: `https://www.fia.gov.tw/WEB/fia/ias/ias{ROC}/{ROC}_165-9.csv` (ROC year = Western year − 1911; e.g. `112` = income year 2023)
- **Format**: CSV, UTF-8. Amounts in NT$ thousand.
- **Spatial level**: village (村里). Each district also has a `合計` (total) row with households, total income, mean, **median**, Q1, Q3, SD, CV. The district median comes directly from that row; it is not derived from villages.
- **Time level**: year (income year).
- **Coverage**:
  - Downloaded income years 2014–2023 (`103`–`112`). All 10 files contain all 41 districts.
  - `113` (2024) and `114` (2025) return HTTP 404. The catalog lists the update schedule as every August; the 2024 file was not online when checked. 2024–2025 must be extrapolated and flagged `estimated: true`.
- **Series break (needs follow-up)**: from income year 2019 (`108`) the district medians drop by 20–30% in every district while household counts barely change. Examples (median, NT$ thousand, 2018 → 2019): Da'an 880 → 704, Wanhua 638 → 446, Banqiao 660 → 462, Pinglin 578 → 369. The dataset title also changes from 綜稅所得總額 to 綜稅綜合所得總額 at `109`. The cause is not documented in the files. Ask the FIA contact listed in the catalog (N108360@fia.gov.tw) before using levels across 2018/2019; growth rates within each side of the break are usable.
- **Header change**: the first column is `鄉鎮市區` up to `109` and `縣市別` from `110`.
- **Scope note**: the agency states that government transfer income, tax-exempt income and separately taxed income are excluded.
- **License**: OGDL v1.
- **Raw files**: `data/raw/income/103_165-9.csv` … `112_165-9.csv`.

## 2. Real-price registration: sales and rentals (Ministry of the Interior)

- **Agency**: Department of Land Administration, MOI (內政部地政司)
- **Catalog**: data.gov.tw 25119 (sales), 25118 (rentals), 77051 (all), 6215 (pre-sale). License OGDL v1.
- **Download URL pattern** (one season file per city and type):
  `https://plvr.land.moi.gov.tw/DownloadSeason?season={ROC}S{1-4}&fileName={city}_lvr_land_{type}.csv`
  - `city`: `a` = Taipei, `f` = New Taipei. `type`: `a` = sales of existing and new buildings, `b` = pre-sale (not downloaded), `c` = rentals.
- **Format**: CSV, UTF-8, two header rows (Chinese, then English).
- **Spatial level**: one row per transaction with district (`鄉鎮市區`) and partly masked address.
- **Time level**: transaction date (`交易年月日` / `租賃年月日`, ROC `yyymmdd`).
- **Important**: a season file contains records **published** in that season, not transactions **made** in it. Records must be re-bucketed by transaction date. I downloaded seasons `104S1`–`115S3` (2015 Q1 – 2026 Q3 publication) so late registrations of 2025 transactions are included. `115S4` is not published yet (returns a 441-byte error page). 2025 Q4 counts may still grow slightly.
- **Deduplication**: by the `編號` column; 2 duplicate sales and 16 duplicate rentals were found across seasons.

### 2a. Sales (residential use, building transactions, by transaction quarter)

All 41 districts have sales records in most years. The 34 other districts have at least 12 records in every quarter. These 7 rural New Taipei districts have quarters with no sales:

| District | Quarters with 0 sales (of 44) | Quarters with < 5 | Total 2015–2025 |
|---|---|---|---|
| Shiding | 16 | 44 | 43 |
| Pinglin | 35 | 44 | 13 |
| Shimen | 5 | 35 | 118 |
| Pingxi | 37 | 44 | 9 |
| Shuangxi | 3 | 39 | 108 |
| Gongliao | 2 | 26 | 180 |
| Wulai | 31 | 44 | 18 |

For these districts, a quarterly median price is not meaningful. Pool years, or borrow the trend from a neighboring district, and document the method. The pipeline pools thin cells for two indicators with the same window rule: the sale price per square metre (`salePrice`, `sale-price-pooled-window`) and the median total price (`medianTotalPrice`, `median-total-price-pooled-window`). The counts above are for the unit-price filter; the median total price also requires `總價元` > 0.

### 2b. Rentals: New Taipei rural districts (residential use, by transaction year)

Rental registration covers leases reported through brokers and rental-housing service businesses; self-managed leases by landlords are mostly not in the data. Counts therefore reflect registration coverage, not market size. Coverage grows strongly over the period, for example Banqiao 151 (2015) → 3,671 (2025) and Sanchong 58 → 3,454. Confirm the exact legal changes and effective dates with 地政司 before describing them in the UI.

All 12 Taipei districts have at least 13 residential rental records in every quarter. In New Taipei, 21 of 29 districts have at least one quarter with fewer than 10 records in 2015–2019. Districts with any quarter under 5 records:

| District | 2015 | 2016 | 2017 | 2018 | 2019 | 2020 | 2021 | 2022 | 2023 | 2024 | 2025 | Quarters < 5 | Quarters = 0 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Yingge | 2 | 9 | 11 | 11 | 19 | 25 | 96 | 203 | 333 | 592 | 799 | 17 | 5 |
| Ruifang | 2 | 1 | 2 | 0 | 0 | 1 | 8 | 23 | 26 | 66 | 79 | 31 | 19 |
| Luzhou | 12 | 17 | 17 | 47 | 65 | 80 | 198 | 285 | 528 | 968 | 1,214 | 7 | 0 |
| Wugu | 3 | 11 | 44 | 37 | 29 | 76 | 355 | 499 | 763 | 1,247 | 1,441 | 8 | 2 |
| Taishan | 19 | 21 | 32 | 34 | 24 | 44 | 81 | 146 | 277 | 535 | 691 | 5 | 0 |
| Shenkeng | 1 | 1 | 1 | 1 | 4 | 7 | 4 | 13 | 22 | 49 | 76 | 31 | 16 |
| Shiding | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 2 | 0 | 1 | 44 | 40 |
| **Pinglin** | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 44 | 44 |
| Sanzhi | 3 | 1 | 1 | 4 | 11 | 25 | 51 | 86 | 184 | 313 | 336 | 22 | 10 |
| Shimen | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 3 | 4 | 3 | 44 | 35 |
| Bali | 8 | 3 | 6 | 9 | 22 | 43 | 78 | 133 | 251 | 429 | 497 | 16 | 3 |
| **Pingxi** | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 44 | 44 |
| Shuangxi | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 1 | 1 | 44 | 41 |
| Gongliao | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 4 | 2 | 0 | 1 | 44 | 37 |
| Jinshan | 0 | 0 | 0 | 0 | 0 | 0 | 3 | 13 | 9 | 24 | 47 | 36 | 27 |
| Wanli | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 5 | 14 | 48 | 71 | 35 | 29 |
| **Wulai** | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 44 | 44 |

**Conclusion**: a quarterly district rent from real-price registration works for the 12 Taipei districts and the large New Taipei districts. It does not work for about 15 New Taipei districts before 2021, and never for Pinglin, Pingxi and Wulai.

### 2c. Further search for rural rent records (source id `rent`)

**Official sources checked:**

| Source | What it has | Rural districts | Result |
|---|---|---|---|
| MOI 全國行政區租金統計 (pip.moi.gov.tw/Publicize/Info/E1080), two ODS editions published 2024-08-29 and 2025-01-23 (the latter covers contracts valid on 2024-12-31) | Rent quartiles per district and housing type | 35/41; omits Shiding, Pinglin, Shimen, Pingxi, Shuangxi, Wulai | Built from the same registration data, so it has the same gap. No license stated on the page. |
| Taipei housing rent index (data.gov.tw 171234, OGDL v1) | Quarterly, citywide and by building type, 2018 Q3 – 2026 Q1 | Taipei only | Not district level |
| DGBAS CPI rent sub-index (item 6) | Monthly, national and Taipei City | n/a | Not district level |
| Real Estate Information Platform statistics query (Info/E3010): 租金單價, 租金補貼戶數 | Rent unit prices and rent-subsidy households | City level only | Not district level |
| data.gov.tw catalog search for 租金 / 房租 / 租屋 / 租賃所得 | Only subsidy programs and commercial rents | — | Nothing at district level |
| **2020 Population and Housing Census, table 34** (DGBAS, data.gov.tw 10906, OGDL v1) | Households by tenure (owned, renting, other) **per district** | **41/41** | **Found**, but it gives the number of renting households, not rent levels |

The census table explains the gap. In November 2020 the rural districts had very few renting households:

| District | Households | Renting | Share |
|---|---|---|---|
| Shimen | 2,068 | 26 | 1.3% |
| Pinglin | 1,162 | 41 | 3.5% |
| Pingxi | 1,214 | 64 | 5.3% |
| Shiding | 1,890 | 73 | 3.9% |
| Wulai | 1,055 | 94 | 8.9% |
| Shuangxi | 1,990 | 99 | 5.0% |
| Gongliao | 2,881 | 168 | 5.8% |
| Jinshan | 5,631 | 223 | 4.0% |
| Wanli | 5,446 | 568 | 10.4% |
| Ruifang | 13,188 | 730 | 5.5% |

For comparison: Wanhua 16,650 renting households (22.9%), Banqiao 28,837 (13.7%). The full 41-district table is printed by `node scripts/check.ts rent`. Saved as `data/raw/census/census2020-{taipei|ntpc}-s034-tenure.ods`.

**Unofficial sources assessed (not downloaded):**

- **Rental listing sites such as 591租屋網**: these show current asking rents only. They do not provide 2015–2025 history, and an asking rent is not a contract rent. They are commercial sites whose terms I did not verify. I also did not verify whether they currently list homes in Pinglin, Pingxi or Wulai. Collecting listings automatically would need the site's permission. These sites are outside the allowed sources in `tech.md`.
- **Real-price lookup sites** (sites that let you browse registration records): they republish the MOI registration data, so they have no additional records.
- **Industry or academic rent indices**: those found are city-level only.

**Implication for the model**: the districts without rent records are the districts with almost no renters. In the seven districts with almost no rental records (Shiding, Pinglin, Shimen, Pingxi, Shuangxi, Gongliao, Wulai), each has at most 168 renting households, which is well under 1,000 residents and so less than one ghost at the default scale. A documented fallback therefore has very little effect on ghost counts. It is still needed for the "Why?" view and for the followed-citizen text. Options: the rent level of a reference district scaled by a cited ratio, or the New Taipei median adjusted by the district's sale-price ratio. Either way the UI should mark the value as estimated.

**Raw files**: `data/raw/lvr/{season}_{a|f}_lvr_land_{a|c}.csv` (188 files). Counts per district code and quarter: `data/raw/_check/lvr-{a|c}-by-quarter.json` (written by `node scripts/check.ts lvr`). Rent context: `data/raw/rent-stats/`, `data/raw/census/`.

## 3. Population and migration

### 3a. Population (monthly, village level → district totals)

- **Agency**: Department of Household Registration, MOI (內政部戶政司). License OGDL v1 for all of the sources below.
- **2015-01 – 2017-12**: data.gov.tw 32973 村里戶數、單一年齡人口. One CSV per month at `https://opdadm.moi.gov.tw/api/v1/no-auth/resource/api/dataset/93B503C4-6799-400D-A3AE-A42464E91B3D/resource/{id}/download` (resource IDs are in the catalog JSON). All 36 months have all 41 districts. Sum of the 41 districts: 6,671,704 (2015-01) and 6,669,946 (2017-12).
- **2018-01 – 2025-12**: household-registration open API, `https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP014/{yyymm}?COUNTY={臺北市|新北市}` (JSON, no key; village rows with `district_code`, `household_no`, `people_total` and single-age columns). Only the last month of each quarter is downloaded (2018-03 to 2025-12, 32 months); all of them are returned by the API and have all 41 districts. Correction: ODRP010 and ODRP060 are births, deaths, marriages and divorces by village, not population, and are not used. The data.gov.tw 131138 CSV fallback is not needed.
- **Annual cross-check**: data.gov.tw 8410 各鄉鎮市區人口密度 has year-end population per district for 2013–2025 (not downloaded).
- **Taipei alternative**: data.gov.tw 131723 臺北市各區土地人口按月別 (Taipei DBAS statistics database) has monthly district population from 1998. Saved as `data/raw/population/taipei-131723.csv`.

### 3b. In/out migration

- **2016-01 – 2017-12 (plus 2015-12)**: data.gov.tw 32975 遷入遷出統計表, monthly CSV, village level. All 25 files have all 41 districts.
- **2018-01 – 2025-12**: API `ODRP011/{yyymm}?COUNTY=…` (data.gov.tw 77144). All months complete except **2024-08**, which the API does not return but is available as CSV in 77144 (downloaded, 41/41).
- **2015-01 – 2015-11: no monthly district file found.** Annual 2015 totals per district are available:
  - Taipei: Taipei DBAS statistics database, `funid=a05002802` (各區人口增加, annual, 2014–2025), columns include move-in and move-out counts per district. URL: `https://tsis.dbas.gov.taipei/statis/webMain.aspx?sys=220&ymf=10300&kind=21&type=0&funid=a05002802&cycle=4&outmode=12&compmode=0&outkind=1&deflst=2&nzo=1`. Saved as `data/raw/population/taipei-a05002802-cycle4.csv`.
  - New Taipei: data.gov.tw 124872 戶籍動態 (New Taipei DBAS), annual 1998–2024 per district, URL `https://data.ntpc.gov.tw/api/datasets/9c5b5e6f-2cfa-40f0-bc8f-172ad04471dc/csv/file`. The columns are unlabeled (`percent1`…`percent54`). I matched them against the MOI API for Banqiao 2018: `percent3` = total move-in (22,867) and `percent20` = total move-out (20,512), both exact matches.
  - Workaround: split the 2015 annual totals into quarters using the 2016 seasonal pattern, and document the method.
- **Granularity limit**: origin and destination are recorded only at the city level (from abroad, from Taipei, from New Taipei, from another district in the same city, and so on). **There is no district-to-district migration matrix.** The simulation's inter-district movement cannot be calibrated per district pair from this data; only each district's total in, out and within-city flows can.
- **Raw files**: `data/raw/population/ris/` (API JSON per month and county, plus CSV files).

## 4. MRT station entries and exits

All from Taipei Rapid Transit Corporation via data.taipei. License OGDL v1.

| Dataset | Catalog | Content | Period | Format |
|---|---|---|---|---|
| 臺北捷運各站進出量統計 | data.gov.tw 128683 | Daily entries and exits per station (one file per month) | 2015-01 – 2016-12 | CSV, **Big5** |
| 臺北捷運各站分時進出量統計 | data.gov.tw 128506 | Hourly origin–destination trips per station pair (one file per month) | 2017-01 – 2026-09, no missing month | CSV, UTF-8 |
| 臺北捷運各站進出人次 | data.gov.tw 133184 (Taipei DBAS) | Annual entries and exits per station | 2014 – 2025 | CSV |

- **Index files with monthly URLs**: `data/raw/mrt/taipei-128683-index.csv` and `taipei-128506-index.csv`. Each index row gives a `tcgmetro.blob.core.windows.net` URL.
- **Size warning**: one hourly OD month is about 300 MB (2025-12: 307,999,434 bytes, 8.4 M rows, about 200 s to download). All 117 months total roughly 35 GB. `node scripts/download.ts mrt --od=YYYY-MM` (or `--od=all`) streams each month, sums entries and exits per station, and keeps only a small JSON file in `data/raw/mrt/od-station-month/`; the raw CSV is never written to disk. Only 2025-12 has been aggregated so far (8,418,060 rows, 119 stations). Hourly OD files are downloaded only for the 24 backtest months (2019-01 to 2019-12 and 2023-01 to 2023-12); the other months are not downloaded. They cover the Taipei Metro only.
- **Station coverage**: the 2025-12 OD file has 119 stations, including the **Circular Line** (stations such as Shisizhang, Zhonghe, Xingfu, New Taipei Industrial Park). The annual series shows Circular Line stations from 2020.
- **Not covered**: Danhai LRT, Ankeng LRT and the Sanying Line (operated by New Taipei Metro). I found no station-level ridership dataset for them on data.gov.tw or the New Taipei Metro website. ❌ for these lines; follow-up options are the New Taipei Department of Rapid Transit annual statistics report (PDF) or a data request.
- **Name differences**: station names differ between files (e.g. `BL板橋` / `Y板橋` in OD files, `板橋Y` and `南京復興BR` in the annual series). A station alias table is needed.
- **Still needed**: a station → district table (station coordinates). Not checked yet.
- **Raw files** (source id `mrt`): `data/raw/mrt/daily/taipei-{entries|exits}-YYYY-MM.csv` (48 files), `taipei-133184-annual-station.csv`, the two index files, `od-station-month/`.

## 5. Social housing projects

- **Best source**: 內政部國土管理署 社會住宅即時資訊平台 (National Land Management Agency social housing portal).
  - Project list: `POST https://socialhousing.nlma.gov.tw/CPA_SocialHousing_Portal/ASMX/ScheduleApi.asmx/GetScheduleData` with JSON body `{"cityCode":"A"|"F","setupUnit":"","status":"All","pageNumber":1,"pageSize":1000}` (`A` = Taipei, `F` = New Taipei). The same list is available as XLSX via `GET …/ASMX/ExportScheduleExcel.ashx?cityCode=A&setupUnit=&statuses=`.
  - Per-project detail: `POST …/ASMX/houseAPI.asmx/GetCityDashboardData` with `{"setupplanGuid": …}`; returns district code, address, coordinates, floors and the dates of construction start, completion and move-in.
  - **Fields**: project name, builder (city government or central government via the National Housing and Urban Regeneration Center), status, number of units, award, start, completion and expected completion dates (ROC calendar).
  - **Counts** (I re-checked 158 and 117 against the saved JSON):

    | | Taipei | New Taipei |
    |---|---|---|
    | Projects | 158 (111 completed, 47 under construction) | 117 (63 completed, 54 under construction) |
    | Units | 18,529 completed + 6,836 under construction | 11,111 + 12,951 |
    | Completed in 2015–2025 | 64 | 52 |
    | Districts with a project | 12 / 12 | 17 / 29 |
    | Projects with coordinates | 155 | 114 |

  - **Gaps**: only two statuses (completed, under construction); planned projects are not in the list. The completed Taipei list includes 41 older public rental sites completed from 1971, which must be filtered by date. Projects under construction have only an expected completion date.
  - **License**: none stated on the portal. ⚠️ Record it as "no license stated" in `SOURCES.md` and consider asking the agency.
  - **Timeliness**: live; the export was dated 2026-11-11.
- **Second source**: data.taipei 臺北市社會住宅興建工程進度 (Taipei Urban Development Department, dataset 00007283, OGDL v1), `GET https://hms.udd.gov.taipei/api/BigData/project`. 86 rows with district, coordinates, planned units and status, but **no completion year**.
- **Not found**: a New Taipei social housing dataset on data.gov.tw or data.ntpc.gov.tw. The New Taipei Housing and Urban Regeneration Center pages (nthurc.org.tw) list 40 managed projects in HTML without completion years and add nothing beyond the national portal.
- **Raw files** (source id `social-housing`): `data/raw/social-housing/` (list JSON and XLSX, 275 project detail files in `nlma-portal-dashboard/`, Taipei UDD JSON). The MOI summary PDF dated 2026-10-31 and the nthurc.org.tw HTML pages in the same folder were fetched by hand during the first check and are not reproduced by the scripts.

## 6. Central bank rates, mortgage rates, CPI

| Series | Agency | Catalog | Download URL | Format | Level | Period checked |
|---|---|---|---|---|---|---|
| Discount rate, secured and short-term accommodation rates (change dates) | Central Bank (中央銀行) | 6022 | https://www.cbc.gov.tw/Public/Data/opendata/webF1.csv | CSV | National | Changes from 2000-12-29 to the latest, 2024-03-22 (2.000%) |
| Same, daily-format history | Central Bank | 10783 | https://www.cbc.gov.tw/public/data/OpenData/經研處/EG28D01.csv | CSV | National | 1989-04-01 – 2024-03-22 (change dates) |
| Five major banks: new loans and rates, incl. **home-purchase loans** (購屋貸款) | Central Bank | 6551 | https://www.cbc.gov.tw/public/data/OpenData/經研處/EH45M01.csv | CSV | National | Monthly 1997-01 – 2026-09 |
| CPI basic groups incl. **rent** (房租) and housing (居住類), base 2021 = 100 | DGBAS (主計總處) | 6019 | https://ws.dgbas.gov.tw/001/Upload/461/relfile/11525/230555/pr0101a1m.xml | XML | National | Monthly 1981-01 – 2026-10 |
| CPI item groups incl. 住宅租金 | DGBAS | 9158 | https://ws.dgbas.gov.tw/001/Upload/461/relfile/11525/230543/pr0101a3m.xml | XML | National | Monthly 2013-01 – 2026-10 |
| Taipei City CPI basic groups incl. rent | Taipei DBAS | 131822 | `https://tsis.dbas.gov.taipei/statis/webMain.aspx?sys=220&ymf=10301&kind=21&type=0&funid=A21000102&cycle=1&outmode=12&compmode=00&outkind=3&deflst=2` | CSV | Taipei City | Monthly 2014-01 – 2026-10 |

- All licenses: OGDL v1.
- The latest policy-rate change in the files is 2024-03-22. Confirm against Central Bank press releases that no change happened after that date before building the rate events.
- No New Taipei City CPI was found; use the national CPI for New Taipei.
- **Raw files**: `data/raw/macro/`.

## 7. House-price-to-income ratio (MOI, city level, quarterly)

- **Agency**: MOI, published on the Real Estate Information Platform (內政部不動產資訊平台).
- **Page**: https://pip.moi.gov.tw/Publicize/Info/E1050 (房價負擔能力統計). Not on data.gov.tw.
- **Format**: one **PDF** release per quarter, URL pattern `https://pip.moi.gov.tw/Upload/CustomFile/Doc/{name}.pdf` (file names vary; all links are in `data/raw/_meta/pip-E1050.html`). No CSV or XLSX was found. The platform's 統計資訊整合查詢 tool (Info/E3010) has no category for this indicator.
- **Contents**: house-price-to-income ratio and mortgage-burden ratio (房貸負擔率) for the nation and every city and county. Example from the 2026 Q1 release: Taipei ratio 14.72, burden 64.41%; New Taipei ratio 12.63, burden 55.30%.
- **Spatial level**: city. **No district-level values.** The pipeline publishes the city ratio only. It also publishes the district median total price (`medianTotalPrice`) with the same sale filter as the ratio's numerator; dividing it by the district household income gives a district figure that the MOI does not publish.
- **Coverage**: 38 PDFs downloaded, 2016 Q3 – 2026 Q1. 2018 Q3 and Q4 are a single combined release. **2015 Q1 – 2016 Q2 are not linked** on the page, and guessed file names return an HTML error page. ⚠️ Follow-up options: ask the agency, or derive the ratio for those 6 quarters from real-price registration and income data with a documented method.
- **Access note**: the site rejects requests without a browser User-Agent (it returns "Request Rejected").
- **Methodology**: the release text states the mortgage-burden ratio is based on a median-income household buying a median-priced home. The PDFs were not parsed, so method changes across years have not been checked yet.
- **License**: not stated on the page.
- **Raw files** (source id `affordability`): `data/raw/affordability/moi-affordability-YYYYQn.pdf` (`2018Q3-2018Q4` for the combined release).

## 8. Air-quality monitoring stations (Ministry of Environment) (out of scope)

- **Agency**: Ministry of Environment (環境部). License OGDL v1.
- **Station list**: data.gov.tw 6075 空氣品質監測站基本資料, API `https://data.moenv.gov.tw/api/v2/aqx_p_07?api_key={KEY}&format=JSON`. 80 stations nationwide, with county, district, address and TWD97 coordinates.
- **Hourly history**: data.gov.tw 28178, API `aqx_p_13`. One row per station, pollutant and day, with 24 hourly values. Starts 2013-12-30. Can be filtered: `&filters=siteid,EQ,{id}|itemengname,EQ,PM2.5`.
- **Monthly values**: data.gov.tw 28202, API `aqx_p_08`. Only 2019-11 onward, so not usable for 2015–2019.
- **API key**: required (`api_key 不存在` without one). The data.gov.tw catalog metadata embeds shared public keys; I used those for this check, and they share one limit of 5,000 calls per day, which ran out once. `node scripts/download.ts air` reads a free personal key from the environment variable `MOENV_API_KEY` and never writes it to disk.
- **Coverage, PM2.5, distinct days with at least one valid hourly value**: all 18 stations in the two cities have 346–366 days in each year 2015–2025, except Fuguijiao (Shimen), a background station that starts in late 2017 (28 days in 2017). The API returns about 495 rows per station for 2022, so some days appear twice; `scripts/sources/air.ts` counts distinct dates.
- **Stations and districts**:

  | City | Stations (district) |
  |---|---|
  | Taipei | Shilin (in **Beitou**), Yangming (Beitou, park), Zhongshan, Wanhua, Guting (Da'an), Songshan, Datong (traffic) |
  | New Taipei | Xizhi, Xindian, Tucheng, Banqiao, Xinzhuang, Cailiao (Sanchong), Sanchong (traffic), Yonghe (traffic), Linkou, Tamsui, Fuguijiao (Shimen, background) |

  **16 of 41 districts have a station.** The 25 without one are Xinyi, Zhongzheng, Wenshan, Nangang, Neihu, Shilin, Zhonghe, Shulin, Yingge, Sanxia, Ruifang, Luzhou, Wugu, Taishan, Shenkeng, Shiding, Pinglin, Sanzhi, Bali, Pingxi, Shuangxi, Gongliao, Jinshan, Wanli and Wulai. They need a documented assignment, such as the nearest station or inverse-distance weighting.
- The station list is the current one; stations closed before 2025 would not appear in it. None of the 18 current stations has a gap that suggests a replacement.
- **Alternative bulk files**: the airtw.moenv.gov.tw 歷年監測資料 page links yearly hourly files per air-quality basin on Google Drive. Only the default year (2025) can be read without a browser: the year selector is an ASP.NET postback that a firewall blocks from scripts. Not needed, because the API covers 2015–2025.
- **Raw files** (source id `air`): `data/raw/air/moenv-aqx_p_07.json` (stations), `aqx_p_13-PM25/` (daily rows with 24 hourly PM2.5 values per station, 2013-12 – 2026-11). `moenv-aqx_p_08.json` (monthly values) was fetched by hand during the first check and is not reproduced by the scripts.

## 9. Taipei and New Taipei district boundaries

- **Agency**: Department of Land Administration, MOI. Distributed by the National Land Surveying and Mapping Center via TGOS.
- **Dataset**: 鄉鎮市區界線(TWD97經緯度), data.gov.tw 7441. License OGDL v1.
- **Download URL**: https://www.tgos.tw/tgos/VirtualDir/Product/3fe61d4a-ca23-4f45-8aca-4a536f40f290/鄉(鎮、市、區)界線1140318.zip (edition dated 2025-03-18, 12.8 MB).
- **Format**: Esri Shapefile (Polygon), UTF-8 attributes, geographic coordinates on TWD97[2020] (GRS80; for web maps the difference from WGS84 is negligible).
- **Attributes**: `TOWNCODE` (official code, e.g. `63000030` = Da'an), `COUNTYNAME`, `TOWNNAME`, `TOWNENG` (e.g. "Da'an District"), `COUNTYCODE`.
- **Coverage**: 368 districts nationwide; **all 41** target districts are present.
- **GeoJSON** (now built by `scripts/pipeline/districts-file.ts` into `public/data/districts.json`; the earlier `scripts/build-boundaries.ts` and `boundaries.geojson` were retired): the script reads the shapefile with a small built-in reader (`scripts/geo/shapefile.ts`, no dependencies), simplifies the 41 districts, and embeds the geometry.
  - **Simplification** (`scripts/geo/simplify.ts`): Douglas–Peucker applied to shared borders, not to each district separately. Each border between two districts is simplified once and reused by both, so neighbors cannot develop gaps or overlaps.
  - **Result at the default 40 m tolerance**: 124,960 → 5,311 points, 4.9 MB → 113 KB. Every district's area changes by less than 1% (largest: Luzhou −0.73%). The source has one border edge that does not coincide between neighbors; the output has none.
  - **Feature properties**: `code` (official TOWNCODE), `name` (romanized), `city`.
  - **Winding order**: exterior rings clockwise. That is what d3-geo expects; RFC 7946 recommends the opposite, which would make d3-geo fill the whole globe.
  - **Note**: `structure.md` lists four files in `public/data/`. This adds a fifth.
- **Raw files** (source id `boundaries`): `data/raw/boundaries/town-boundaries-1140318.zip` and the extracted `town-1140318/TOWN_MOI_1140318.*`.

## 10. Policy tools: real 2015–2025 values

These are the "real policy track" inputs: the value of each of the 8 player tools in each year, so the engine can compute the player's difference from reality. All files in `data/raw/policy/` were collected by hand during this check and are **not yet reproduced by `scripts/`**. Unless noted, data.gov.tw datasets are OGDL v1, and law pages, agency web pages and PDFs state no license.

### 10.1 Social housing construction

See item 5: per-project units, district and completion dates for 2015–2025 from the NLMA portal.

### 10.2 Sublease and rental management program (社會住宅包租代管)

| Source | Content | Level / time | Coverage | Sample |
|---|---|---|---|---|
| data.gov.tw 155779 臺北市政府社會住宅包租代管媒合統計資料 (Taipei UDD), CSV | Units matched per year | Taipei, year | 2017–2025 (program starts 2017) | 2017 = 17, 2018 = 687, 2024 = 718 |
| MOI pip.moi.gov.tw/Publicize/Info/B5010?mode=7, HTML + PDF | Cumulative matches by phase (1–5) and channel (city / central), as of 2026-10-31 | City, cumulative | No yearly series | New Taipei phase 4: 5,568 city + 20,457 central |

- The Taipei yearly series appears to cover only the city-run channel. Its 2017–2025 sum (4,440) is close to MOI's Taipei city-channel total excluding 2026 (4,447).
- ⚠️ **Gap**: no yearly series for New Taipei, and no yearly series for the central channel in either city. The MOI phase totals could be spread over each phase's period, as a documented estimate.

### 10.3 Rent subsidy (租金補貼)

| Source | Content | Level / time | Coverage | Sample |
|---|---|---|---|---|
| MOI pip.moi.gov.tw Info/E3010 query (`/Publicize/Info/E30Query`), JSON | Households receiving subsidy: 6_1_3 (old program) and 6_3_1 (300億 program from 2022 Q4) | City, quarter | 2015 Q1 – 2025 Q4 when both series are combined; 2022 needs both | Taipei 2016 Q4 = 7,309; Taipei 2024 Q4 = 55,812; New Taipei 2024 Q4 = 88,526 |
| data.gov.tw 132047 臺北市歷年住宅補貼受理情形統計表 (Taipei UDD), CSV | Applications and approvals per year | Taipei, year | 2007–2026; 2023 and 2024 are one combined row | 2016 approved 8,939 |
| data.gov.tw 122939 新北市歷年住宅補貼受理情形統計表 (New Taipei UDD), CSV | Applications and approvals per year | New Taipei, year | 2007–2025 complete | 2016 approved 12,923; 2024 45,373 |
| data.gov.tw 169800 接受住宅補貼戶次及金額 (NLMA), CSV | Household-months and amount | City | **2023 only** | Taipei 354,515 household-months, amount 1,665,725.7 (unit not stated; likely NT$ thousand) |

- ⚠️ **Gap**: subsidy **amounts** exist only for 2023. For other years the cost must be estimated as households × an average monthly amount, with the method documented.
- The E3010 query endpoint is not documented and states no license.

### 10.4 Vacant / multiple-home holding tax (囤房稅)

Rates for residential property that is not owner-occupied:

| Period | Taipei | New Taipei | Source |
|---|---|---|---|
| National range from 2014-06 | 1.5–3.6% | 1.5–3.6% | 房屋稅條例, law.moj.gov.tw pcode G0340102 |
| 2014-07-01 → 2024-06-30 | 2.4% (≤2 units), 3.6% (3+ units) | ⚠️ not confirmed before 2017-07 | 臺北市房屋稅徵收自治條例 (laws.gov.taipei FL006143, versions 2014, 2017, 2021) |
| 2017-07-01 | — | 2.4% | 新北市房屋稅徵收率自治條例 (web.law.ntpc.gov.tw 1C0030089) |
| 2019-01-11 | — | 1.5% | same |
| 2023-08-30 | — | 1.5% (1 unit), 2.4% (2), 3.6% (3+) | same |
| From 2024-07-01 (囤房稅 2.0, nationwide unit count; first bill May 2025) | 3.2 / 3.8 / 4.2 / 4.8% for ≤2 / 3–4 / 5–6 / 7+ units | same tiers as Taipei | 房屋稅條例 2024-01-03 amendment; both city ordinances |

- House tax **revenue** per city: data.gov.tw 6742 (MOF statistics), net collections per calendar year, 2015–2025 complete (unit inferred as NT$ thousand). Taipei 2016 15,272,554; 2025 19,183,139. New Taipei 2016 11,216,500; 2025 16,249,771. This is total house tax, not only the non-owner-occupied part.
- The New Taipei law site states "未經允許不得複製". Cite it; do not copy the text.
- ⚠️ **Gap**: New Taipei's non-owner-occupied rate from 2015 to 2017-06.

### 10.5 MRT extension (out of scope)

Openings in Taipei and New Taipei, 2015-01-01 – 2025-12-31 (New Taipei DORTS route pages, `https://www.dorts.ntpc.gov.tw/about/route/{id}`; cross-checked with the Taipei Metro chronicle and Railway Bureau dataset 96918):

| Line / section | Opened | Length | Stations |
|---|---|---|---|
| Bannan line Tucheng extension to Dingpu | 2015-07-06 | 1.95 km | 1 |
| Taoyuan Airport MRT (has stations in New Taipei) | 2017-03-02 | 51.03 km | 22 |
| Danhai LRT Green Mountain line | 2018-12-24 | 7.34 km | 11 |
| Circular Line phase 1 | 2020-01-31 | 15.4 km | 14 |
| Danhai LRT Blue Coast line phase 1 | 2020-11-15 | 2.21 km | 3 |
| Ankeng LRT | 2023-02-10 | 7.5 km | 9 |

- Disruption: the Circular Line was suspended after the 2024-04-03 earthquake and fully resumed on 2024-12-12. This is a candidate event card.
- After 2025: Sanying Line 2026-06-30 (14.29 km, 12 stations); Xinyi line east extension around 2026-08 (news only). Under construction, with official expected dates: Wanda–Zhonghe line end of 2027; Tucheng–Shulin 2031; Circular Line north and south sections 2031; Xizhi–Donghu 2032.
- Spending: Taipei DORTS 捷運統計年報 2022 (PDF), table 65, annual network spending 2015–2022 (2015 NT$6.985 B, 2018 NT$11.582 B); 2023–2025 editions not found. New Taipei 軌道建設發展基金 in the 新北市捷運統計年報 (PDF), 2016–2025 (2024 NT$11.31 B).
- New Taipei network size by year (yearbook table 3-1): 2016 45.70 km / 35 stations, 2018 68.00 / 52, 2023–2025 93.11 / 78.
- The Airport MRT is operated by Taoyuan Metro. `tech.md` limits transit coverage to Taipei Metro and New Taipei Metro, so it is listed here but not in item 11.

### 10.6 Commuter pass subsidy

| Product | Start | Price | Source |
|---|---|---|---|
| 北北基桃 1280 公共運輸定期票 | 2018-04-16 (made permanent 2020-04-16; sales ended 2023-06-30) | NT$1,280 / 30 days | Taipei Metro chronicle; Taipei DOT annual report 2020 (PDF) |
| TPASS 基北北桃都會通 | 2023-07-01 | NT$1,200 / 30 days | Taipei Metro TPASS page |

- Usage, basis used by the pipeline: the Taipei City Department of Transportation said that, as of the end of October 2019, more than 5.15 million commuter passes had been sold (Newtalk, 2019-11-27, https://newtalk.tw/news/view/2019-11-27/332324). This is a lower bound.
- Earlier finding, not used (no source could be confirmed): 9.24 M 1280 passes sold by the end of 2020, peak of 320,000 valid passes per day (Taipei DOT annual report 2020).
- Central subsidy paid per city (公路局 dataset 117697, quarterly PDFs, OGDL v1), year-to-date at Q4: Taipei 2023 NT$596.4 M, 2024 NT$2,145.9 M, 2025 NT$897.5 M; New Taipei 2023 NT$380.1 M, 2024 NT$1,364.7 M, 2025 NT$571.7 M. The 2025 drop is unexplained; check whether the 2025 Q4 file is complete.
- ⚠️ **Gaps**: no official TPASS card or user counts, no local-government share of the cost, no confirmed start date for TPASS 2.0 rewards. tpass.gov.tw blocks scripts.
- Per `product.md`, TPASS is a central-government **event**; the player tool is the city's own commuter subsidy relative to it.

### 10.7 TOD floor-area bonus (out of scope)

| City | Rule | Dates | Size of bonus |
|---|---|---|---|
| Taipei | 臺北市大眾運輸導向可申請開發許可地區細部計畫 and its application rules (laws.taipei FL091350) | Rules from 2019-06-24, amended 2022-09-14 and 2023-08-16; revised plan announced 2022-05-24; applications 2022-05-25 – 2026-05-24 | Tier-1 stations: 30% (core) / 15% (general zone) of base floor area; tier-2: 20% / 10%; total capped at 2× base |
| New Taipei | TOD 增額容積 (purchased extra floor area), Urban and Rural Development Department notices | Phase 1 2019-08-29, phase 2 2020-01-31, 56-station revision 2021-11-04, phase 3 2026-05-20 | 150/200/300 m zones capped at 20–50%, 400/500 m zones 10–20%; price = assessed land value × 1.4 × (extra / base floor area) |

- ⚠️ **Gap**: no dataset of approved TOD cases or bonus floor area granted per year in either city. Before 2019 the real value is zero (no program).

### 10.8 Parks, green space and street trees (out of scope)

| Source | Content | Level / time | Coverage | Sample |
|---|---|---|---|---|
| data.gov.tw 13472 都市計畫公共設施用地已闢建面積 (MOI statistics), CSV via statis.moi.gov.tw | Built park and green-space area | City, year | 2014–2025 | Taipei parks 598.73 ha (2014) → 725.90 ha (2025) |
| data.gov.tw 145745 臺北市都市計畫公共設施用地面積 (Taipei DBAS), CSV | Planned and built area of parks and green space | Taipei, year | 2014–2025 | Built parks 728.69 ha (2025) |
| data.gov.tw 128366 臺北市公園基本資料 (Taipei Parks Office), JSON | 813 parks with district, area, construction year, coordinates | Taipei, park | Current list | A district park-area series can be rebuilt from construction years (only parks that still exist) |
| data.gov.tw 124566 新北市公園 (New Taipei Agriculture Dept.), CSV | 1,047 parks with district code | New Taipei, park | Current list | **No area and no year** |
| data.gov.tw 125339 新北市行道樹資料, CSV | Street-tree counts by road and species | New Taipei, road | Current | No year |
| data.gov.tw 128274 臺北市行道樹及公園樹木分布圖 | Every street and park tree with location and survey date | Taipei, tree | Current | Not downloaded (large) |

- ⚠️ The New Taipei built-park series in 13472 jumps between years (2017 769 ha, 2019 529 ha, 2021 703 ha, 2022 477 ha). That looks like reclassification rather than real change; treat it as unreliable or ask the city.
- ⚠️ **Gap**: no district-level park area over time for New Taipei, and no planting-year series for street trees in either city.

### 10.9 Spending per tool

`product.md` sets each year's budget to the real spending on the 5 tools (MRT, TOD and parks figures below are no longer used). Spending found so far: MRT (Taipei 2015–2022, New Taipei 2016–2025, PDF), rent subsidy (2023 only), TPASS central subsidy (2023–2025). ⚠️ City budget execution reports (決算) by program have **not been checked yet**; they are the likely source for the remaining tools.

**Raw files**: `data/raw/policy/housing/`, `data/raw/policy/transit/`, `data/raw/policy/parks/` (115 files).

## 11. Metro and light-rail stations → districts (source id `stations`)

| Source | Content | Format | License |
|---|---|---|---|
| TDX (MOTC Transport Data eXchange) `Rail/Metro/Station/TRTC` and `/NTMC` | Station id, name (zh / en), address, coordinates | JSON | TDX terms not verified |
| NLSC 輕軌捷運車站 (data.gov.tw 73230) | Danhai and Ankeng LRT station points, TWD97 TM2 | Shapefile | OGDL v1 |

- TDX works without an API key at a low rate limit. If `TDX_CLIENT_ID` and `TDX_CLIENT_SECRET` are set, the script requests a token instead. TDX's metro API does not include the Danhai or Ankeng LRT, so the NLSC shapefile fills that gap; its TM2 coordinates are converted with `scripts/geo/twd97.ts`.
- `node scripts/check.ts stations` assigns each station to a district by point-in-polygon on the MOI boundaries and writes `data/raw/_check/station-districts.csv`. Transfer stations are merged by name.
- **Result**: 151 stations (Taipei Metro 109, New Taipei Metro 21, Danhai LRT 13, Ankeng LRT 8); none fall outside the 41 districts.
- **The table is today's network.** It includes the 11 Sanying Line stations that opened in 2026, and in Yingge and Sanxia those are the only stations. Each station needs an opening date (item 10.5) before it is used for a given quarter.
- Stations per district (current network):

  | District | Stations | District | Stations | District | Stations |
  |---|---|---|---|---|---|
  | Tamsui | 16 | Zhonghe | 7 | Tucheng | 5 (1 Sanying) |
  | Xindian | 14 | Xinzhuang | 7 | Yingge | 5 (all Sanying) |
  | Da'an | 12 | Songshan | 5 | Sanxia | 5 (all Sanying) |
  | Zhongshan | 10 | Nangang | 5 | Luzhou | 3 |
  | Beitou | 9 | Xinyi | 6 | Shilin | 3 |
  | Zhongzheng | 7 | Sanchong | 6 | Datong | 2 |
  | Wenshan | 7 | | | Yonghe | 2 |
  | Neihu | 7 | | | Wanhua | 1 |
  | Banqiao | 7 | | | | |

  No station: Shulin, Xizhi, Ruifang, Wugu, Taishan, Linkou, Shenkeng, Shiding, Pinglin, Sanzhi, Shimen, Bali, Pingxi, Shuangxi, Gongliao, Jinshan, Wanli, Wulai. Taishan, Linkou and Xinzhuang have Airport MRT stations, which are outside the transit coverage in `tech.md`.
- **Border stations**: 7 stations lie on a district border, and their point and their official address fall in different districts: Gongguan and Taipower Building (address Zhongzheng, point Da'an); Zhongshan, Minquan W. Rd., Shuanglian, Yuanshan (address Datong, point Zhongshan); Yongan Market (address Zhonghe, point Yonghe). Pick one rule and document it.

## 12. Commute-time inputs for the 41×41 matrix (source ids `stations`, `commute`)

`tech.md` estimates the matrix from district centroid distances plus the MRT network. Available inputs:

| Input | Source | Coverage | Status |
|---|---|---|---|
| Run time and dwell time between adjacent stations | TDX `Rail/Metro/S2STravelTime/TRTC` (lines BL, BR, G, O, R; 173 segments) and `/NTMC` (Y, LB; 24 segments) | Current timetable | ✅ |
| Transfer walking time | Taipei Metro data.gov.tw 128417 (21 transfer stations, minutes) | Current | ✅ |
| LRT travel times | Not in the TDX metro API (accepts TRTC, KRTC, TYMC, KLRT, TMRT, NTMC only) | — | ⚠️ Estimate from official length and station count (item 10.5) and a cited average speed |
| Station locations | Item 11 | Current | ✅ |
| District centroids and distances | Computed from the geometry in `public/data/districts.json` | — | ✅ (to compute) |
| Observed commuting shares | 2020 census, table 14 per city (DGBAS, OGDL v1): employed residents by district of residence, working in the same district / another district of the same city / another county or abroad | 41/41 districts, November 2020 | ✅ Calibration target |
| District-to-district commuting matrix | Not published in the census tables; not found elsewhere | — | ❌ |
| Bus network | TDX bus data; not checked | — | Not checked |
| Average commute time per city (MOTC 民眾日常使用運具狀況調查) | Not checked | — | Not checked |

- Census examples: Yonghe 51.4% of employed residents work outside New Taipei, Xizhi 52.3%, Banqiao 31.7%; Gongliao 87.8% work in their own district. `node scripts/check.ts commute` prints all 41.
- The network changed during 2015–2025 (Danhai 2018, Circular Line 2020, Ankeng 2023; Circular Line suspended in 2024), so the matrix should be recomputed for each network state, not built once.
- **Raw files**: `data/raw/stations/` (TDX JSON, NLSC zip, transfer CSV), `data/raw/census/census2020-{taipei|ntpc}-s014-workplace.ods`.

---

## Gaps and how they are handled

1. **Income 2019 break** (item 1): handled by decision 1.
2. **Income 2024–2025** (item 1): handled by decision 1.
3. **Rural district rents** (items 2b, 2c): handled by decision 2.
4. **Migration 2015 Jan–Nov** (item 3b): use annual totals split by a documented seasonal pattern.
5. **No district-to-district migration matrix** (item 3b): migration shares between districts will rely on the commute-time matrix and cited parameters, not observed flows.
6. **MRT ridership**: handled by decision 3. Still open: no station-level ridership for the Danhai LRT, Ankeng LRT and Sanying Line.
7. **House-price-to-income ratio** (item 7): handled by decision 4.
8. **Licenses not stated**: the NLMA social housing portal, the MOI affordability PDFs, the E3010 query, law and agency pages, and TDX (terms not verified).
9. **API key** for MOENV data: handled by decision 5.
10. **Policy-tool gaps** (item 10): rent-subsidy amounts outside 2023; yearly sublease figures for New Taipei and for the central channel; New Taipei holding-tax rate 2015–2017-06; approved TOD cases; TPASS usage; New Taipei park area by district; spending per tool from city budget execution reports (not checked).
11. **Stations** (item 11): opening dates per station, and a rule for the 7 border stations.
12. **Commute matrix** (item 12): LRT travel times must be estimated; bus network and the MOTC travel survey not checked.
13. **Policy files are not scripted yet**: everything in `data/raw/policy/` was fetched by hand.

## Environment note

The machine runs Node v26.4.0, and `tech.md` now specifies Node 26 (decision 6). The scripts are TypeScript run directly by Node, which works without flags as long as the code uses only syntax Node can strip.

## Decisions

Recorded 2026-11-11 after review of this document.

1. **Income.** Comparisons between districts use the FIA tax-filing medians (item 1). The citywide trend uses DGBAS Family Income and Expenditure Survey disposable income per household by county instead (data.gov.tw 9415, OGDL v1; downloaded by `node scripts/download.ts income`). This series is complete for 2015–2025 with no break: Taipei NT$1,314,031 (2015) → 1,554,620 (2025), New Taipei NT$959,507 → 1,263,026. FIA levels are never compared across 2018/2019. FIA district values for 2024–2025 are extrapolated and marked `estimated: true`.
2. **Rural district rents.** Districts without enough rental records borrow the trend of a nearby reference district, multiplied by the ratio between the two districts in the MOI district rent statistics (item 2c), and are marked `estimated: true`. The time trend of rents comes from the CPI rent index (item 6); differences between districts come from real-price registration (item 2b). Note: the MOI rent statistics also omit 6 of these districts (Shiding, Pinglin, Shimen, Pingxi, Shuangxi, Wulai), so their ratio has to come from another documented step, for example the sale-price ratio.
3. **MRT ridership.** The hourly OD files are not downloaded. Station ridership uses the annual per-station series (data.gov.tw 133184), split into quarters with seasonal shares taken from the 2015–2016 daily station files (data.gov.tw 128683). `node scripts/download.ts mrt` already skips the OD files unless `--od` is given. Note: Circular Line stations opened in 2020, so they have no 2015–2016 daily data and need the seasonal shares of a comparable station.
4. **House-price-to-income ratio.** All 44 quarters are computed from real-price registration and income data. The MOI quarterly PDFs (2016 Q3 – 2025 Q4) are used only to validate the computed series.
5. **Air-quality API.** The user registers a personal MOENV API key and sets it in the `MOENV_API_KEY` environment variable. It is never stored in the repository.
6. **Node.** `tech.md` now specifies Node 26 LTS.
