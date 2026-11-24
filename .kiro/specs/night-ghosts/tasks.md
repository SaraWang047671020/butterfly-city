# Implementation Plan: night-ghosts

Claude Code implements this spec (recorded in `KIRO-LOG.md`). Requirements approved 2026-11-24, design approved 2026-11-24 with the `product.md` amendment (applied). Commit after the full suite passes and the browser checks of the task are done.

## Tasks

- [x] 1. Approvals
  - [x] 1.1 Requirements and design; `product.md` ghost rule amended (Requirement 1.3)
  - [ ] 1.2 Scene_Database list and record texts (both languages), approved by the user (Requirement 1.2)
  - [ ] 1.3 Ghost_Line drafts (both languages), approved by the user (Requirement 5A.2)
  - [ ] 1.4 Design_Proposal of the screens (Requirement 1.1)

- [x] 2. Pure game modules (`src/game/night/`)
  - [x] 2.1 `timer.ts`: the Day_Timer state and transitions; tests (minimum length, off, pause)
  - [x] 2.2 `missions.ts`: Mission types, the seeded Mission_Offer, targets from real history, the check; tests (offer rules, determinism, never touching the Engine)
  - [x] 2.3 `night.ts`: Mission_Ghosts, night pressure, next timer length; tests (Kind B, C and memorial never count)
  - [x] 2.4 `lines.ts` and `scenes.ts`: Ghost_Line pick, Investigation progress, Heritage_Plan
  - [x] 2.5 Boundary test lists the new modules

- [ ] 3. Data
  - [ ] 3.1 `data/config/missions.json`, `scenes.json`, `ghost-lines.json`; validators in `src/data/night-loader.ts`; copies by `npm run story-files`; `data/SOURCES.md`
  - [ ] 3.2 File tests (both languages, placeholders, sources, status, no lines for Kind C or memorial points)

- [ ] 4. Controller and storage
  - [ ] 4.1 `NightController` (phase, picked Mission, results, investigations, Heritage_Plan); `src/save/night-store.ts`

- [ ] 5. Screens (after the Design_Proposal)
  - [ ] 5.1 Day light and night look of the City_View; Mission_Ghost, ghost and scene meshes; local darkening and fog
  - [ ] 5.2 Day_Timer bar and settings; Mission_Offer dialog; Mission result in the Quarter_Brief; "Start the day"
  - [ ] 5.3 Kind A and B encounters, Investigation dialog, Memory_Scene signs, Memorial_Points, City_Archive

- [ ] 6. Finish: neutrality review, browser checks (360 to 1920 px, keyboard, reduced motion, both languages, without WebGL), docs
