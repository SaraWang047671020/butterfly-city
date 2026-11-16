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
- Optional for TDX (station and travel-time data): `TDX_CLIENT_ID` and `TDX_CLIENT_SECRET` from
  https://tdx.transportdata.tw. Without them the anonymous, rate-limited access is used.

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
| `stations` | TDX metro stations and station-to-station travel times, NLSC LRT stations, transfer walking times | 0.2 MB | TDX works without a key at a low rate limit; optional `TDX_CLIENT_ID` / `TDX_CLIENT_SECRET` |
| `commute` | 2020 census table 14: where employed residents of each district work | 40 KB | |
| `social-housing` | NLMA portal project list and 275 project details | 6 MB | About 280 API calls on the first run |
| `macro` | Central Bank rates, DGBAS CPI, Taipei CPI | 43 MB | |
| `affordability` | MOI house-price-to-income ratio releases (PDF) | 11 MB | |
| `air` | MOENV stations and hourly values per station | 55 MB per pollutant | Needs `MOENV_API_KEY`; 5,000 calls per day per key |
| `boundaries` | MOI district boundary shapefile | 31 MB | |
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
