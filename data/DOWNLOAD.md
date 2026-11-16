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

Retrieved on 2026-11-11 for the first check. Re-running the scripts fetches the current version of each
source; several of them (population, social housing, MRT, CPI) are updated monthly or live.

**Not scripted yet**: the policy-tool files in `data/raw/policy/` (see DATA-CHECK.md item 10) were
fetched by hand; their URLs are listed in DATA-CHECK.md.
