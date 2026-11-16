---
inclusion: always
---

# Tech Stack and Engineering Rules

## Stack

- **Language**: TypeScript, `strict` mode.
- **Build**: Vite.
- **UI**: no UI framework. Plain DOM APIs and SVG.
- **Map projection**: `d3-geo` (import only what is needed).
- **Testing**: Vitest; property-based tests with fast-check.
- **Runtime / package manager**: Node 26 LTS, npm. Scripts in `scripts/` are TypeScript run directly by Node (type stripping), so they use only erasable syntax (no `enum`, `namespace`, or parameter properties).
- **Hosting**: GitHub Pages, fully static. No backend, no login. Vite `base` is `/butterflycity/`.

## Dependency policy

- Pin exact versions (no `^` or `~`). Use `.npmrc` with `save-exact=true`. Commit `package-lock.json`.
- Before adding any package, explain to the user why it is needed and what the alternative is, then wait for approval.
- Do not add a dependency for something a few lines of code can do.

## Data pipeline

- Raw open data is processed **locally** by Node scripts in `scripts/` into static JSON in `public/data/`:
  - `districts.json`: district attributes, boundaries reference, adjacency and commute-time matrix
  - `history.json`: real quarterly baseline per district (2015 Q1 – 2025 Q4)
  - `policy-track.json`: real quarterly values of the 5 policy tools, each with a source and an estimate flag
  - `events.json`: event cards
  - `params.json`: simulation parameter table with sources
- The web app only reads these JSON files. It never fetches live data at runtime.
- Every field is documented in `data/SOURCES.md` with: agency, dataset name, URL, year, and license.
- Raw files that are too large are **not committed**. Instead, `data/DOWNLOAD.md` records how to obtain them (URL, query, date retrieved). `data/raw/` is gitignored except for small files.

### Data handling decisions

- **Annual to quarterly**: annual datasets are interpolated to quarters. The method is documented in `SOURCES.md`.
- **Not yet published years** (e.g., district-level income for 2024–2025): extrapolate from the latest trend, mark the field `estimated: true`, and show the estimate flag in the UI.
- **Commute-time matrix (41×41)**: estimated by a local script from district centroid distances plus the MRT network. The method is documented in `SOURCES.md`. If TDX is used, its API key lives only in a local environment variable and never enters the repository.
- **Transit coverage**: Taipei Metro and New Taipei Metro (Circular Line, Danhai LRT, Ankeng LRT).

### Allowed sources (free only)

Central Bank of the Republic of China (Taiwan), DGBAS, Ministry of Finance, Ministry of the Interior, Central Weather Administration, Ministry of Environment, National Land Surveying and Mapping Center, Taipei and New Taipei open data portals, Wikipedia year-in-review pages, FRED.

- **Wikipedia (CC BY-SA)**: do not copy text. Write event descriptions from scratch and cite Wikipedia as a reference link with attribution.
- **FRED**: use only series that are public domain or permit redistribution. Check each series' notes.
- Taiwan government open data is typically under the Open Government Data License, version 1.0. Record the license per dataset anyway.

## Save system

- Saves are stored in `localStorage`.
- Export and import a save code (a portable string encoding the save).
- Save data has a `schemaVersion`. Imported save codes are untrusted input: validate structure, types, and ranges before use, and fail with a clear message instead of crashing.

## Accessibility and motion

- Respect `prefers-reduced-motion`.
- No continuous full-screen flashing; risk effects escalate gradually and stay localized.
- Districts are keyboard focusable with accessible names. Color is never the only carrier of meaning.

## Testing

- Run once, never in watch mode: `npx vitest --run`.
- Required invariants and property-based tests are listed in `simulation.md`.
- Data scripts get unit tests for parsing and transformation.
- Save import/export gets round-trip and malformed-input tests.

## Security

- No API keys, passwords, tokens, or company data anywhere in the repository.

## Environment

- Windows with Git Bash and PowerShell. `package.json` scripts must work in both shells: no POSIX-only commands (`rm -rf`, `cp`) and no inline `VAR=value` env syntax. Use Node scripts for file operations.
- The agent does not start long-running processes such as `npm run dev`; ask the user to run them.

## Common commands

```bash
npm install
npm run dev          # run manually by the user
npm run build
npx vitest --run
npm run backtest     # recompute docs/BACKTEST.md (once the engine exists)
npm run data         # rebuild public/data/*.json from data/raw (once scripts exist)
```
