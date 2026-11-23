# Implementation Plan

Implemented by Claude Code, not Kiro (user decision 2026-11-18, to save Kiro credits). Phase order is fixed by the user: 1 → 2 → 3 → 4. Phase 4 is dropped first if time runs out before 2026-12-02.

## Phase 1: City_View in the game

- [x] 1. Approval and packages
  - [x] 1.1 Pin `three` 0.170.0 and `@types/three` 0.170.0 (installed 2026-11-18)
  - [x] 1.2 Record the package approval in `KIRO-LOG.md` (Requirement 1.3; recorded by Kiro in the 2026-11-18 Design_Proposal row)
  - [x] 1.3 Build the City_Design_Proposal (`docs/design-proposal/city-3d-proposal.html`, presented 2026-11-18) (screenshots from the Prototype, overlay layout at 4 widths, colours, Ghost_Figure, district states, reduced motion) and present it (Requirement 1.1)
  - [x] 1.4 Record the approval (Requirement 1.2; approved in full 2026-11-18)

- [x] 2. Spec alignment
  - [x] 2.1 Mark game-ui Requirements 3, 4 and 16 and the Map_View tasks as replaced by this spec
  - [x] 2.2 Update `tech.md` and `structure.md` for three.js and `src/ui/city/`

- [x] 3. Controller additions (`src/game/`)
  - [x] 3.1 `ghosts` and `priceIndex` in `MapDistrictView` (Requirement 2.2)
  - [x] 3.2 `cityStatic()` (Requirement 2.1)
  - [x] 3.3 Tests of Requirement 2.4

- [x] 4. Pure modules (`src/ui/city/`, no three import)
  - [x] 4.1 `projection.ts`, `geometry.ts`
  - [x] 4.2 `placement.ts`, `street-grid.ts`, `routing.ts`
  - [x] 4.3 `focus-order.ts`, `colours.ts`
  - [x] 4.4 Unit and property tests of Requirement 13.1 to 13.3
  - [x] 4.5 Boundary test for `three` imports (Requirement 13.4)

- [x] 5. Rendering modules (checked by hand on 2026-11-18 with `prototype/city-view.html`, real data, Engine run to 2019Q2)
  - [x] 5.1 `tokens.ts` and the `--city-*` tokens in the Token_File (after game-ui task 13)
  - [x] 5.2 `scene.ts`, `districts.ts`, `buildings.ts`
  - [x] 5.3 `traffic.ts`, `ghosts.ts`
  - [x] 5.4 `camera.ts`, `picking.ts`, keyboard focus and live region (Requirement 5)
  - [x] 5.5 `index.ts`: `mountCityView`, subscriptions, reduced motion, pause control, Quality_Level, fallback, lifecycle (Requirements 10, 12). The DOM buttons for pause and quality are placed in task 6.1; `mountCityView` exposes `setPaused` and `setQuality`.

- [ ] 6. Overlay layout and wiring (after game-ui tasks 16 and 17)
  - [x] 6.1 City and UI layers; panel containers at ≥ 1024 px; bottom sheets below (Requirement 9). `src/styles/layout.css` and the panel structure in `src/ui/app.ts` (2026-11-23): compact Turn_Bar top centre, Policies and Map panels left, District right, Timeline as a panel that starts hidden below 1600 px; below 64rem a tab row opens one panel as a sheet above the Turn_Bar at the bottom. Checked by hand at 1280 × 800 and 360 × 740.
  - [x] 6.2 Illustration_Note in the Map panel next to the legend, at every width (on narrow screens behind the Map tab) (Requirement 11)
  - [ ] 6.3 Manual checks of Requirement 13.5, recorded in `KIRO-LOG.md`

## Phase 2: Landmarks

- [x] 7. Landmark_Table and models (checked by hand 2026-11-18 with `prototype/city-view.html`)
  - [x] 7.1 `src/ui/city/landmarks/table.ts` with coordinates and sources (Requirement 7.1); coordinates read from the English Wikipedia coordinates line of each page on 2026-11-18
  - [x] 7.2 Test of Requirement 7.3 (`tests/ui/city/landmarks.test.ts`, also the clearing of buildings, trees and streets)
  - [x] 7.3 Models: Taipei 101, Grand Hotel, National Theater and Concert Hall, Presidential Office Building, Taipei Main Station, Dazhi Ferris wheel (turning), Longshan Temple, Tamsui Fisherman's Wharf bridge, Banqiao Station. Changes from the first list (neutrality.md): the Liberty Square pair is shown as the National Theater and Concert Hall, not under a memorial name that carries a politician's name; the Ferris wheel is named by its area, not by the operating company; Banqiao Station added so that New Taipei has two Landmarks.
  - [x] 7.5 Every district has at least one Landmark (user decision 2026-11-18): 35 more Landmarks built from 24 archetypes in `landmarks/archetypes.ts` (temples, old streets, courtyard houses, museums, arena, stadium, exhibition hall, stations, parks, zoo, bridges, dam, lighthouses with a turning beam, waterfalls, Yehliu rocks). Coordinates from English Wikipedia, or Chinese Wikipedia where the English page has none (8 districts); each checked to lie in its district (test). 44 Landmarks in total.
  - [x] 7.4 Building, tree and street removal around Landmarks, labels within 150 units (Requirements 7.2, 7.4)

## Phase 3: Walk_Mode and Metro_Travel

- [x] 8. Walk_Mode (checked by hand 2026-11-18: walking down a Da'an street, collision, follow camera)
  - [x] 8.1 `collision.ts` and tests (`tests/ui/city/collision.test.ts`, property: a move that starts free never ends blocked)
  - [x] 8.2 `walk.ts`: Avatar, follow camera (pulled in front of buildings), W A S D and arrows, Shift to run, touch joystick, mode switch, Escape (Requirements 8.1 to 8.4). The DOM toggle button is placed in task 6.1; `mountCityView` exposes `setMode` and `onModeChange`.
- [x] 9. Metro_Travel (checked by hand 2026-11-18: Fuzhong → Taipei 101/World Trade Center in 2022Q1)
  - [x] 9.1 Station_File: `scripts/metro/build.ts`, `npm run stations` → `src/ui/city/metro/station-data.ts` (118 stations, 129 segments, 6 lines), tests in `tests/ui/city/metro.test.ts` (Requirement 8.5)
  - [x] 9.2 Not needed: the Station_File is a generated module bundled with the City_View; the open network follows `MapViewModel.quarter`
  - [x] 9.3 `metro/network.ts` (pure), `metro/render.ts`: lines in official colours, station markers and labels, prompt with E key or button, station dialog (Kiro's dialog manager), fade transition; Walk_Mode starts at the district's station (Requirements 8.2, 8.6, 8.7)

## Phase 4: Citizen encounters and street detail

- [x] 10. Citizen_Encounters (2026-11-23): the 6 Personas stand next to the metro station of their home district in Walk_Mode, with a name label and a ring; walking up shows "<name> is here", and E or the Talk button opens a dialog with the Persona's intro and the filled story lines of the Displayed_Quarter (story-layer `buildStoryFacts` and `storyLines`; a line without a value shows "no value"). Checked by hand: Mrs. Lin in Wanhua, 2022Q1, 35.7% of income on rent
- [ ] 11. Street detail near the Avatar: arcades, signs, street lights, finer windows
