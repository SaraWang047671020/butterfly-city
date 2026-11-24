# Implementation Plan

Implemented by Claude Code, not Kiro (user decision 2026-11-23, to save Kiro credits). Goal: completeness, not the submission date (user decision 2026-11-23). Each numbered task ends with a commit after the full test suite passes and the change has been checked with real pointer clicks in a browser.

- [x] 0. Spec
  - [x] 0.1 Requirements, design and the draft Character_File (`data/config/characters.json`)
  - [x] 0.2 User approval of requirements, design and Character_File text, recorded in `KIRO-LOG.md` (2026-11-23)

- [x] 1. Approval gate (Requirement 1)
  - [x] 1.1 Play_Loop_Design_Proposal (`docs/design-proposal/play-loop-proposal.html`): Character_Creation, main screen in Overview_Mode and Walk_Mode, Policy_Dialog, Quarter_Brief, City_Report, District_Card, First_Play_Guide, Dialog_Frame, Life dialog, at 360 and 1280 CSS pixels
  - [x] 1.2 Record the decision in `KIRO-LOG.md`

- [x] 2. Dialog_Frame (Requirement 9; first because it fixes the size problem the user reported)
  - [x] 2.1 Dialog_Frame as the existing dialog manager `src/ui/a11y/dialog.ts` (header with kicker, title and Close control; body; action row; sizes md, lg, full) and its styles in `src/styles/dialogs.css` (tokens only). Deviation from the design: no separate `frame.ts`, because every dialog already went through this one manager.
  - [x] 2.2 Move the dialogs of `dialogs.ts`, the station dialog and the Limits_Dialog onto it
  - [x] 2.3 Static test `tests/static/dialog-frame.test.ts` (no DOM test library in the project; adding one needs the user's approval) and the manual pointer-click check of 9.3, recorded in `KIRO-LOG.md`

- [x] 2A. Language mechanism (Requirement 12.1 to 12.3, 12.6; before the new screens so that every new string is written once in both languages)
  - [x] 2A.1 `src/ui/strings.ts` split into `strings/en.ts` and `strings/zh-Hant.ts` with one key set; `main.ts` chooses the locale before the App is mounted; language control and reload with the game saved
  - [x] 2A.2 Key and Placeholder parity test; quarter format per language; unit and city names per language
  - [x] 2A.3 Chinese district, Landmark and station names from the boundary and TDX files (pipeline and `npm run stations`), with sources

- [ ] 3. Data
  - [ ] 3.1 `src/data/character-loader.ts`: fetch and validate the Character_File and the Wage_File (Requirement 2.3 to 2.5)
  - [ ] 3.2 DGBAS earnings download in `scripts/download.ts`, `scripts/story/wages.ts`, `public/data/wages.json`, `data/SOURCES.md` row (Requirement 3.4); confirm the industry codes and the coverage of the education industry against the table
  - [ ] 3.3 Copy the Character_File in `npm run story-files`; new item of `model-limits.json` on regular earnings and industry means (drafted for the user)
  - [ ] 3.4 Validator tests and the committed-file check (Requirement 11.1)

- [ ] 4. Pure logic (`src/game/life/`, `src/game/brief.ts`)
  - [ ] 4.1 `life-state.ts` (`lifeStateAt`)
  - [ ] 4.2 `availability.ts` with the legal rule of same-sex marriage
  - [ ] 4.3 `numbers.ts` (`characterNumbers`)
  - [ ] 4.4 Move `CHANGE_BOUNDS` to `src/game/core/change-bounds.ts`; `brief.ts` (`briefItems`)
  - [ ] 4.5 Unit and property tests of Requirements 11.2, 11.2a and 11.3

- [ ] 5. Store and controller
  - [ ] 5.1 `src/save/character-store.ts` (`butterflycity.character.v1`: Character, Life_Timeline, `guideDone`)
  - [ ] 5.2 Controller: `view.character`, `view.brief`, `createCharacter`, `previewLife`, `applyLife`, `dismissBrief`, `guideDone`; Fixed_Quarter rejection
  - [ ] 5.3 Tests: Character_Numbers of player and real run against a hand calculation; no Life_Decision changes an Engine result

- [ ] 6. Character_Creation (Requirement 2)
  - [ ] 6.1 `src/ui/character/creation.ts`: four steps, live SVG preview, sources, Random character
  - [ ] 6.2 New game flow: Character_Creation before the first Decide_Step; restore from the Character_Store on load
  - [ ] 6.3 City_View `setAvatar(look)`

- [ ] 7. Life dialog (Requirement 3A)
  - [ ] 7.1 `src/ui/life/life-dialog.ts`: decision cards, reasons and legal facts, with / without comparison
  - [ ] 7.2 "My life" in the Turn_Bar; Life_Decisions in the Timeline_View
  - [ ] 7.3 City_View `setHousehold(members)`

- [x] 8. Policy_Cards and Policy_Dialog (Requirement 5)
  - [x] 8.1 Not needed: the dialog renders its own fields with the Policy_Panel text helpers (`policy-text.ts`), so no field is shown twice
  - [x] 8.2 `src/ui/policy/policy-cards.ts` (cards and dialog) and `preview.ts`: slider bound to the input, district picker (a grouped list; the small map is left for task 10), Quick_Preview, details disclosure. Cards sit top left until task 10 moves them to the bottom centre
  - [x] 8.3 Tests of Requirement 11.4 (`tests/ui/policy-preview.test.ts`; slider and input share one `editField` path, checked by hand in the browser)

- [x] 9. Three-step quarter and Quarter_Brief (Requirements 4 and 6)
  - [x] 9.1 Turn_Bar step text and one primary action (Fast-forward is secondary)
  - [x] 9.2 `src/ui/brief/quarter-brief.ts`, after Event_Cards; `src/game/brief.ts` rule with the people candidate; `CHANGE_BOUNDS` moved to `src/game/core/change-bounds.ts`
  - [x] 9.3 City_View `walkTo(place)` and Go there
  - [x] 9.4 Year-end projection in the Quick_Preview (Requirement 5.9) and the blocked tool opening by itself (Requirement 5.10); Quick_Preview cost against the same quarter without the edit (fix of task 8)

- [x] 10. City_Report and District_Card (Requirement 7)
  - [x] 10.1 `src/ui/report/city-report.ts` with five tabs mounting the existing components (model limits built when the tab is first shown; the language control in the report tools row)
  - [x] 10.2 `src/ui/district-card.ts` and City_View `project(code)`; the card is placed between the Turn_Bar and the Policy_Cards
  - [x] 10.3 Main screen reduced to Turn_Bar, Policy_Cards, city tools, District_Card, Illustration_Note and disclosure; `layout.css` and `hud.css` updated. The small district map of the Policy_Dialog (task 8.2) stays a list: the District_Card and the report list cover district choice

- [ ] 11. First_Play_Guide (Requirement 8)
  - [ ] 11.1 `src/ui/guide/first-play.ts`; replay from the City_Report

- [ ] 11A. Translation of the existing text (Requirement 12.4, 12.5, 12.7, 12.8)
  - [ ] 11A.1 Chinese part of the Banned_Term_List
  - [ ] 11A.2 Bilingual fields and validators for `citizens.json`, `model-limits.json`, `events.json` and the policy effect texts; draft translations
  - [ ] 11A.3 User approval of the Traditional Chinese text, recorded in `KIRO-LOG.md`

- [ ] 12. Finish
  - [ ] 12.1 Strings review of Requirement 10.1 recorded in `KIRO-LOG.md`
  - [ ] 12.2 Module boundary and static checks (Requirement 11.5)
  - [ ] 12.3 Manual checks: keyboard only, reduced motion, WebGL disabled, 360 / 768 / 1280 / 1920 px, real pointer clicks on every dialog; recorded in `KIRO-LOG.md`
  - [ ] 12.4 Update `product.md` (player character in place of the fixed Persona choice) and `structure.md` (new folders)
