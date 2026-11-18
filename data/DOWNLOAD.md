# Obtaining the raw data

Raw files live in `data/raw/`, which is gitignored. They are downloaded by the scripts in `scripts/`.
Sources, coverage and known gaps are documented in `data/DATA-CHECK.md`.

## Requirements

- Node.js 26 (the scripts are TypeScript run directly by Node; no install step).
- `curl` on the PATH (built into Windows 10+ and Git Bash). It is used only when a government site's
  firewall rejects Node's own requests.
- For air-quality data only: a free API key from https://data.moenv.gov.tw in the environment variable
  `MOENV_API_KEY`. Never commit it.
  - PowerShell: `$env:MOENV_API_KEY = "..."`
  - Git Bash: `export MOENV_API_KEY=...`
- TDX (`stations`, `fares`, `timetables`): `TDX_CLIENT_ID` and `TDX_CLIENT_SECRET` from
  https://tdx.transportdata.tw. `fares` and `timetables` need both variables. If either is absent or blank, the source
  prints one message naming both variables, exits non-zero before any network call and writes no file. `stations` still
  works anonymously at a low rate limit. The access token is held in memory only; it is never written to a file, a log
  line or an error message, and HTTP error text is redacted. Never commit the values.
  - PowerShell: `$env:TDX_CLIENT_ID = "..."; $env:TDX_CLIENT_SECRET = "..."`
  - Git Bash: `export TDX_CLIENT_ID=...; export TDX_CLIENT_SECRET=...`

## Commands

```bash
node scripts/download.ts --help            # list sources
node scripts/download.ts all               # everything except hourly MRT OD files
node scripts/download.ts lvr income        # selected sources
node scripts/download.ts mrt --od=2025-12  # also aggregate one month of hourly MRT OD data
node scripts/download.ts mrt --od=all      # all months (about 35 GB streamed, a few hours)
node scripts/download.ts air --items=PM2.5,PM10   # no longer used by the data pipeline (air quality is out of scope)

node scripts/check.ts all                  # coverage reports used in DATA-CHECK.md
node scripts/find-datasets.ts "租金" "新北市"  # search the data.gov.tw catalog by title
```

Downloads are resumable: existing files are skipped unless `--force` is given.

### Backtest station data (24 months)

The backtest uses monthly Taipei Metro station entries and exits for 2019-01 to 2019-12 and 2023-01 to 2023-12
(data.gov.tw 128506). Run these 24 commands. Each downloads about 300 MB and takes about 200 s. The raw CSV is streamed
and not stored; each command writes `data/raw/mrt/od-station-month/YYYY-MM.json`. These files are used only in the
backtest and cover the Taipei Metro only (New Taipei Metro lines are not included).

```bash
node scripts/download.ts mrt --od=2019-01
node scripts/download.ts mrt --od=2019-02
node scripts/download.ts mrt --od=2019-03
node scripts/download.ts mrt --od=2019-04
node scripts/download.ts mrt --od=2019-05
node scripts/download.ts mrt --od=2019-06
node scripts/download.ts mrt --od=2019-07
node scripts/download.ts mrt --od=2019-08
node scripts/download.ts mrt --od=2019-09
node scripts/download.ts mrt --od=2019-10
node scripts/download.ts mrt --od=2019-11
node scripts/download.ts mrt --od=2019-12
node scripts/download.ts mrt --od=2023-01
node scripts/download.ts mrt --od=2023-02
node scripts/download.ts mrt --od=2023-03
node scripts/download.ts mrt --od=2023-04
node scripts/download.ts mrt --od=2023-05
node scripts/download.ts mrt --od=2023-06
node scripts/download.ts mrt --od=2023-07
node scripts/download.ts mrt --od=2023-08
node scripts/download.ts mrt --od=2023-09
node scripts/download.ts mrt --od=2023-10
node scripts/download.ts mrt --od=2023-11
node scripts/download.ts mrt --od=2023-12
```

The same commands are available as npm scripts: `npm run data:download -- <source>`, `npm run data:check -- <source>`,
District boundaries are built into `public/data/districts.json` by `npm run data`. Type checking and unit tests for the scripts need `npm install` once:
`npm run typecheck` and `npm test`.

## Sources

| Source id | What | Size on disk | Notes |
|---|---|---|---|
| `income` | MOF income tax by village, 2014–2023; DGBAS disposable income by county, 1998–2025 | 8 MB | 2024–2025 FIA files return HTTP 404 until published |
| `lvr` | MOI real-price registration, sales and rentals, seasons 2015S1–2026S3 | 0.4 GB | Unpublished seasons are reported as failed and retried next run |
| `rent` | MOI district rent statistics (ODS), Taipei rent index, 2020 census tenure tables | 0.2 MB | |
| `population` | MOI monthly population and migration by village; annual district migration | 0.4 GB | About 250 API calls on the first run |
| `mrt` | Taipei Metro daily station counts 2015–2016, annual series, OD indexes; OD months with `--od` | 2 MB plus ~10 KB per OD month | OD raw files are streamed, not stored |
| `stations` | TDX metro stations and station-to-station travel times (TRTC, NTMC), NLSC LRT stations, transfer walking times | 0.2 MB | TDX works without a key at a low rate limit; optional `TDX_CLIENT_ID` / `TDX_CLIENT_SECRET` |
| `fares` | TDX adult single-journey station-pair fares, 4 operators | not measured yet | Needs `TDX_CLIENT_ID` and `TDX_CLIENT_SECRET` |
| `timetables` | TDX station timetables and line headways, 4 operators | not measured yet | Needs `TDX_CLIENT_ID` and `TDX_CLIENT_SECRET` |
| `villages` | ODRP019 village population (ROC 114, 4 pages) and village boundary shapefile (data.gov.tw 130549, ROC 114 edition) | 2.7 MB + 22.2 MB | |
| `commute` | 2020 census table 14: where employed residents of each district work | 40 KB | |
| `social-housing` | NLMA portal project list and 275 project details | 6 MB | About 280 API calls on the first run |
| `macro` | Central Bank rates, DGBAS CPI, Taipei CPI | 43 MB | |
| `affordability` | MOI house-price-to-income ratio releases (PDF) | 11 MB | |
| `air` | MOENV stations and hourly values per station | 55 MB per pollutant | Needs `MOENV_API_KEY`; 5,000 calls per day per key |
| `boundaries` | MOI district boundary shapefile | 31 MB | |
| `low-use` | MOI low-use (low electricity use) housing counts and rates by district, Taipei and New Taipei, ROC 104–114H2 | not measured yet | Both method groups; see "Low-use source" below |
| `policy` | Rent subsidy households (MOI E3010 6_1_3, 6_3_1), subsidy amounts (data.gov.tw 169800), national tax revenue (MOF 6742) | 2.5 MB | E3010 endpoint is undocumented; 6742 changes monthly |

Retrieved on 2026-11-11 for the first check. Re-running the scripts fetches the current version of each
source; several of them (population, social housing, MRT, CPI) are updated monthly or live.

### Policy source (`policy`)

```bash
node scripts/download.ts policy            # fetch the four files below if missing
node scripts/download.ts policy --force    # re-fetch all four
node scripts/check.ts policy               # file sizes, cities, quarters, row counts
```

Retrieved on 2026-11-11 into `data/raw/policy/housing/`. The E3010 files are byte-identical to the earlier hand-fetched
copies. `datagov-6742.csv` is updated monthly, so a re-fetch is larger than the first copy.

| File | URL | License |
|---|---|---|
| `pip-e3010-6_1_3-taipei-newtaipei.json` | `https://pip.moi.gov.tw/Publicize/Info/E30Query?dataScope=全國縣市統計資訊&f01=6&f02=6_1&f03=6_1_3&f04=104Q1&f05=114Q4&location=A-F-` | not stated |
| `pip-e3010-6_3_1-taipei-newtaipei.json` | `https://pip.moi.gov.tw/Publicize/Info/E30Query?dataScope=全國縣市統計資訊&f01=6&f02=6_3&f03=6_3_1&f04=111Q4&f05=114Q4&location=A-F-` | not stated |
| `datagov-169800.csv` | `https://opdadm.moi.gov.tw/api/v1/no-auth/resource/api/dataset/76147D7F-A30A-446C-B6E2-C7F9B20D9920/resource/9817284B-AA54-46A9-9265-8C2396972E99/download` (from the data.gov.tw 169800 metadata) | OGDL v1 |
| `datagov-6742.csv` | `https://web02.mof.gov.tw/njswww/webMain.aspx?sys=220&ym=9000&kind=21&type=5&funid=i0424&cycle=41&outmode=12&compmode=00&outkind=2&fldspc=0,30,&codspc0=0,39,40,3,&utf=1` (from the data.gov.tw 6742 metadata) | OGDL v1 |

The E3010 query parameters are `f01` = table type, `f02` = table kind, `f03` = table id, `f04` / `f05` = first and last
quarter (ROC year and quarter), `location` = city codes (A = Taipei, F = New Taipei). The endpoint is not documented;
the parameters come from the site's own script (`data/raw/_meta/pip-info_e3010.js`).

Other policy files in `data/raw/policy/housing/` (other data.gov.tw tables, house-tax laws and ordinances, the sublease
PDF) were fetched by hand; their URLs are listed in DATA-CHECK.md.

### Low-use source (`low-use`)

```bash
node scripts/download.ts low-use           # fetch the missing files below
node scripts/check.ts low-use              # periods present, districts with a value, District_Codes without a value
```

| Field | Value |
|---|---|
| Agency | Ministry of the Interior (內政部), Real Estate Information Platform (不動產資訊平台); the statistics department publishes it since ROC 109 |
| Dataset | 低度使用(用電)住宅、待售新成屋 → 低度使用（用電）住宅統計結果查詢（縣市及鄉鎮市區）; counts (宅數) and rates (比率 %) of dwellings with an average of at most 60 kWh per month |
| URL | https://pip.moi.gov.tw/Publicize/Info/E1040 |
| Years offered | ROC 98–108 annual (the Nov–Dec average), ROC 109H1–114H2 half-yearly (H1 = May–Jun average, H2 = Nov–Dec average). The download covers ROC 104–114H2 (2015–2025H2) |
| License | not stated on the page |
| Date retrieved | 2026-11-17 (48 files: current ROC 104–114H2, original ROC 104–109H2, Taipei and New Taipei) |

Query: the page's own form. `GET` the page for the anti-forgery token and cookie, then `POST` to the same URL with
`F01` = method group, `F02` = period, `F03` = county code (`63000` Taipei, `65000` New Taipei), `F04`–`F06` empty and
`__RequestVerificationToken`. The answer is a CSV file with the columns county, district, `<period>宅數`, `<period>比率(%)`
(one row for the whole county named 全區 and one row per district). The firewall needs a browser User-Agent.

| `F01` | Method group (file name part) | Periods fetched |
|---|---|---|
| `DataGroup3` | `current`: the current method (the page's default query) | annual 104–108, then 109H1 to 114H2 |
| `DataGroup1` | `original`: the original method, kept for comparison | annual 104–108, 109H1, 109H2 |

Files: `data/raw/low-use/moi-low-use-{current,original}-{period}-{63000,65000}.csv`, where `{period}` is the ROC form value
(for example `109H1`, or `108` for an annual year). The two methods give different values for the same period
(the page links the method change to the ROC 110H1 booklet, appendix 3). No village-level data exists from ROC 109 on.

### TDX rail sources (`stations` LRT operators, `fares`, `timetables`)

```bash
node scripts/download.ts fares timetables   # needs TDX_CLIENT_ID and TDX_CLIENT_SECRET
node scripts/download.ts stations           # TRTC, NTMC travel times
```

Date retrieved: 2026-11-17 (`fares` 4 of 4 files, `timetables` 6 of 8, `stations` LRT S2STravelTime 0 of 2); the four unsupported requests were removed on 2026-11-17, so `timetables` now requests 6 files and `stations` requests S2STravelTime for TRTC and NTMC only. License: as stated by TDX, else `not stated`.
Not served by TDX (2026-11-17): HTTP 400 (not supported) for `S2STravelTime` NTDLRT, `S2STravelTime` NTALRT, `Frequency` NTDLRT and `Frequency` NTALRT. These four requests are not sent. The API answer lists the accepted
`S2STravelTime` operators as TRTC, KRTC, TYMC, KLRT, TMRT, NTMC and the accepted `Frequency` operators as TRTC, KRTC, TYMC, TMRT, NTMC.
`ODFare` and `StationTimeTable` work for all four operators. A 429 (rate limit) can occur on a first run; re-running fetches the missing files.
Operator codes: `TRTC` Taipei Metro, `NTMC` New Taipei Metro (Circular Line), `NTDLRT` Danhai LRT, `NTALRT` Ankeng LRT.
Query: `$format=JSON`, no filter; the base URL is `https://tdx.transportdata.tw/api/basic/v2/Rail/Metro`.

| Source | File (under `data/raw/`) | URL |
|---|---|---|
| `fares` | `fares/tdx-metro-od-fare-{TRTC,NTMC,NTDLRT,NTALRT}.json` | `<base>/ODFare/{operator}?%24format=JSON`. Each record has a `Fares` array with `TicketType` and `FareClass`; the adult single-journey entry is selected when the file is read |
| `timetables` | `timetables/tdx-timetable-{TRTC,NTMC,NTDLRT,NTALRT}.json` | `<base>/StationTimeTable/{operator}?%24format=JSON` |
| `timetables` | `timetables/tdx-frequency-{TRTC,NTMC,NTDLRT,NTALRT}.json` | `<base>/Frequency/{operator}?%24format=JSON` (headway of each line) |
| `stations` (LRT) | `stations/tdx-s2s-travel-time-{NTDLRT,NTALRT}.json` | `<base>/S2STravelTime/{operator}?%24format=JSON`. A 404 is reported as a failed file where TDX does not serve the operator |

### 2021 DGBAS Industry and Service Census employee PDFs (not fetched by `scripts/download.ts`)

Table 10 「工業及服務業場所單位年底從業員工人數－按行政區別分」 (year-end persons engaged by township and district) of the
110年 (2021) Industry and Service Census reports is transcribed by hand into `data/config/census-employees-2021.csv` and
`census-employees-2021-totals.csv` (task 22.3). The figure is 從業員工人數 (persons engaged: employees, owners and unpaid family
workers). The census excludes government agencies, schools and the armed forces. `scripts/download.ts` does not fetch the
PDFs and the pipeline never reads them. The extracted figures (`pdftotext`) are kept in
`data/raw/census/dgbas-2021-ics-table10-extracted.csv`; the two PDFs are saved as
`data/raw/census/dgbas-2021-ics-report-{taipei,newtaipei}.pdf`.

| Field | Value |
|---|---|
| Publisher | Directorate-General of Budget, Accounting and Statistics (DGBAS), Executive Yuan |
| URL (Taipei) | https://ws.dgbas.gov.tw/001/Upload/463/relfile/11768/233846/110年臺北市工業及服務業普查報告.pdf |
| URL (New Taipei) | https://ws.dgbas.gov.tw/001/Upload/463/relfile/11768/233846/110年新北市工業及服務業普查報告.pdf |
| Table id | 10 |
| Page | 140 (printed page number, both reports) |
| Date retrieved | 2026-11-17 |

### Village population and boundaries (`villages`)

```bash
node scripts/download.ts villages
```

Date retrieved: 2026-11-17 (ODRP019 and the boundary zip).

- ODRP019 households and population by household type and sex, ROC year 114 (MOI Department of Household Registration): https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP019/114 with `?PAGE=1..4`. 4 pages, 7,752 rows (2,000 + 2,000 + 2,000 + 1,752), saved as `data/raw/villages/moi-odrp019-114-page{1..4}.json`. There is no district total row.
- Village boundaries (TWD97 longitude and latitude), ROC 114 edition, data.gov.tw dataset 130549 "村里界歷史圖資(TWD97經緯度)" (National Land Surveying and Mapping Center): https://www.land.moi.gov.tw/chhtml/DownloadGovDoc?gsno=PY9YAR&gdid=533, saved as `data/raw/villages/village-boundaries-114.zip` (22.2 MB, read in place, not extracted). Nested structure: the outer zip holds one inner zip (`202609301104109864.zip`); the inner zip holds the folder `村里界歷史圖資_114/` with `VILLAGE_NLSC_11401031.shp/.dbf/.shx/.prj/.cpg/.qmd` (UTF-8 per its `.cpg`) and the unused `Village_Sanhe.*`. The layer is matched by the `VILLAGE_NLSC_` prefix. Entry names are Chinese; names without the zip UTF-8 flag are decoded as Big5. DBF fields used: `VILLCODE`, `COUNTYNAME`, `TOWNNAME`, `VILLNAME`.
- License: as stated, else `not stated`.
