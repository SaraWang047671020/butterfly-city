# Implementation Plan: life-story

Claude Code implements this spec (recorded in `KIRO-LOG.md`). Requirements approved 2026-11-24, design approved 2026-11-24, Design_Proposal approved 2026-11-24 (A, B1: the Shared_Draw number is shown). Commit after the full test suite passes and the browser checks of the task are done.

## Tasks

- [x] 1. Approvals
  - [x] 1.1 Requirements, design, research (`data/research/life-story-*-2026-11-24.md`)
  - [x] 1.2 Design_Proposal `docs/design-proposal/life-story-proposal.html` (Requirement 1.1)
  - [x] 1.3 Text drafts of the Life_Event_File and the Life_Story_File in English and Traditional Chinese, presented to the user; status `approved` per language after the user's statement (Requirement 1.2); review page `docs/design-proposal/life-story-texts.html`, approved 2026-11-24

- [ ] 2. Data files
  - [x] 2.1 `data/config/application-supply.json`: real odds per benefit, city and year; income limits; minimum living expense; tenancy; rent shares; subsidy multipliers; each value with its source or `gap` and an assumption (design, "Research results")
  - [ ] 2.2 `data/config/life-events.json` and `data/config/life-story.json` (drafts), copied to `public/data/` by `npm run story-files`; `data/SOURCES.md` lists the new sources (Requirement 8.2)
  - [ ] 2.3 Loader and validation (`src/data/life-story-loader.ts`; the Application_Supply_File is validated and tested, the Life_Event_File and Life_Story_File validators and the language and placeholder tests are still open); tests of both languages, placeholders and sources (Requirement 9.4)

- [ ] 3. Pure game modules (`src/game/life/`)
  - [x] 3.1 `life-state.ts`: tenure `social`, `subsidy`, the decisions `apply`, `buyPass`, `leave`
  - [x] 3.2 `applications.ts`: eligibility, odds per track, Shared_Draw, effects, tenancy and subsidy periods; property tests of Requirement 9.3
  - [x] 3.3 `tracks.ts`: the Life_State of each track per quarter
  - [x] 3.4 `ledger.ts`: the Personal_Ledger per track; property test of Requirement 9.2 (equal versions when the policy equals real history)
  - [ ] 3.5 `events.ts`: triggers, priority, cooldowns, the pick; tests of each trigger and of Requirement 9.5 (triggers read only the Player_Version)
  - [ ] 3.6 `story.ts` and `ending.ts`: Story_Line selection and filling, the Ending; determinism test (Requirement 9.1)
  - [x] 3.7 Boundary test lists the new modules (play-loop 11.5); the seeded random numbers moved from `src/ui/city/random.ts` to `src/game/random.ts` (re-exported) so that `src/game` imports nothing from `src/ui`

- [ ] 4. Controllers and storage
  - [ ] 4.1 `LifeController`: pending Life_Event, `choose`, the two-version view, Story_Lines, Ending
  - [ ] 4.2 Character_Store version 2 (`seed`, `choices`), reading version 1 records
  - [ ] 4.3 Fast-forward stops before a quarter with a Life_Event (StopReason `life-event`, Requirement 7.3)

- [ ] 5. Screens (approved Design_Proposal)
  - [ ] 5.1 Life_Event dialog (Dialog_Frame, radio group of options, both versions per option, odds bars, Escape chooses the "keep" option and says so)
  - [ ] 5.2 Quarter_Brief: Story_Lines, the Application result with the Shared_Draw (B1), the Two_Me_Panel with "Why?", then the Brief_Items
  - [ ] 5.3 My_Story page from the game menu
  - [ ] 5.4 Ending page
  - [ ] 5.5 UI strings in both languages (play-loop Requirement 12)

- [ ] 6. Finish
  - [ ] 6.1 Neutrality review of every new text in both languages, recorded in `KIRO-LOG.md`
  - [ ] 6.2 Browser checks: 360, 768, 1280 and 1920 px; keyboard only; reduced motion; English and Traditional Chinese; a full game with Fast-forward
  - [ ] 6.3 `product.md` and `structure.md` updated
