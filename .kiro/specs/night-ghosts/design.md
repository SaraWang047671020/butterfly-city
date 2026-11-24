# Design Document

Approved by the user on 2026-11-24 ("設計核准"), with the `product.md` amendment below (applied).

## Overview

A quarter becomes a day and a night. The Day_Phase is the Decide_Step with a Day_Timer and a Mission picked from three ghosts' requests; the Night_Phase starts with the Quarter_Brief and lets the player walk the night city, where Model_Ghosts, Mission_Ghosts, Kind A and B ghosts and Memory_Scene signs appear. Everything new lives beside the Engine: no Mission, ghost, scene or Heritage_Plan choice changes an Engine input or result (Requirement 4.5, Principle 4).

```
 Day_Phase (Decide_Step)                          Night_Phase (after Compute_Step)
 ┌──────────────────────────────┐   timer 0 or    ┌───────────────────────────────────────┐
 │ Mission_Offer (3 givers)     │   Next quarter  │ Quarter_Brief: Mission result + line   │
 │ pick one · Day_Timer         │ ──────────────► │ city at night: Model_Ghosts,          │
 │ policies · Life_Event        │                 │ Mission_Ghosts, A/B ghosts, C signs   │
 └──────────────────────────────┘ ◄────────────── │ Walk_Mode · Investigations · Archive  │
           "Start the day" (timer shortened by Mission_Ghosts)  └───────────────────────┘
```

## Architecture

New pure modules in `src/game/night/` (no import of `src/ui`):

| Module | Content |
|---|---|
| `missions.ts` | Mission types, the Mission_Offer of a day (seeded), targets from real history, the check of a picked Mission |
| `night.ts` | Mission_Ghosts of a quarter, the night pressure per district, the next Day_Timer length |
| `timer.ts` | The Day_Timer as a pure state (length, left, paused, off) and its transitions |
| `lines.ts` | The pick of a Ghost_Line for a ghost and a moment (seeded) |
| `scenes.ts` | Investigation steps, progress, the Heritage_Plan, what each scene shows by day and night |
| `controller.ts` | `NightController`: phase (day or night), the picked Mission, results, investigations and the Heritage_Plan; reads the game session like the LifeController; never changes it |

Data and storage: `src/data/night-loader.ts` validates `data/config/scenes.json` (Scene_Database), `data/config/ghost-lines.json` and `data/config/missions.json`, copied to `public/data/` by `npm run story-files`; `src/save/night-store.ts` keeps the night record under its own key (`butterflycity.night.v1`).

UI (after the Design_Proposal): `src/ui/night/` (timer bar, Mission_Offer dialog with the three givers, Investigation dialog, City_Archive page), `src/ui/city/` (day light, night look, Mission_Ghost and scene meshes, the local darkening and fog of a swallowed district).

## Missions (Requirement 4)

A Mission must be reachable by the decisions of the day it is picked. Social housing completes years after it starts and other tools act with a lag, so a Mission targets what the day's decisions set, or an indicator that responds to many past decisions (stated as harder):

| Type | Tool | Target of the quarter | Difficulty |
|---|---|---|---|
| `startHomes` | socialHousing | units started in a district ≥ real × 1.1 (at least real + 50) | easy: set this day |
| `subsidise` | rentSubsidy | households subsidised in a city ≥ real × 1.1 | easy |
| `passSupport` | commuterPass | pass subsidy in a city ≥ real + NT$100 | easy |
| `fewerAbove` | any | people above a rent or commute line in a district fewer than real history by ≥ 1 % of the district's people (the Ghost difference) | hard: needs earlier decisions |
| `metroRiders` | commuterPass | MRT entries in a district ≥ real × 1.02 | hard: lagged |

The values come from the policy timeline and the Engine results of the computed quarter; real history from the Real_Policy_Track and `history.json`. The factors (1.1, 50, 100, 1 %, 1.02) are design choices of the Mission file with the text "game rule, not a policy target".

**Offer.** Each day: 3 Missions from at least 2 types, with one easy and one hard, seeded by the seed and the quarter, over Active_Tools only; across a year every Active_Tool appears at least once. **Givers**: `startHomes`, `subsidise`, `fewerAbove` (rent) → a Model_Ghost of the district or a Kind B ghost whose place is in the district or city; `passSupport`, `metroRiders`, `fewerAbove` (commute) → a Kind A ghost of the roads and transit (the phantom passenger of the 辛亥隧道, the old woman of the 北宜公路) or a Model_Ghost. Never Kind C or a Memorial_Point (Requirement 4.2).

## Night (Requirement 5)

- **Mission_Ghosts**: a picked Mission not met adds 3 Mission_Ghosts to its district (or to the 3 districts of the city with the most Model_Ghosts for a city Mission). They gather at the nearest Kind A place within 3 km, else at the district centre. Look: a lantern-headed folklore figure in `--city-mission-ghost`, distinct from the Model_Ghost sheet and the butterflies, named in the map legend.
- **Pressure**: per district, Model_Ghosts + Mission_Ghosts ≥ 8 → darkened ground, local fog, dimmer windows (Requirement 5.3); the District_Card says "The night swallows this district: N ghosts of the simulation, M ghosts from a mission not met". Never a full-screen effect.
- **Next day**: every group of Mission_Ghosts shortens the next Day_Timer by 30 s, never below 2 minutes; the Mission_Offer dialog says why.

## Day_Timer (Requirement 3)

State `{ length, left, running, off }`. The UI ticks it once a second with the browser clock while no dialog is open and the tab is visible; at 0 it calls Next quarter. Settings (menu, "Save and settings"): pause, +2 minutes, length 3, 5 or 8 minutes, off (stored in the browser). Shown as "4:12 left" with a bar; a polite live announcement at 1 minute and at 30 seconds (not every second).

## Scenes (Requirements 6 to 10)

`scenes.json` record: `id`, `kind` (`A` | `B` | `C` | `memorial`), names, `lat`/`lon` (projected like the Landmarks), `facts[]` (text in both languages + source id), `invention` (what may be invented; empty for C and memorial), `ghost` (A and B: name, look, Ghost_Line set id), `steps[]` (Investigation: where to go and what is found, each with a fact or an archive item and its source), `heritage` (what the City_View shows when the place is in the Heritage_Plan), `status` per language. Sources in the same file, like the Application_Supply_File.

- **Kind A**: a ghost figure at night; walking near shows the legend ("it is said that …", source) and its idle Ghost_Line.
- **Kind B**: a ghost at night with its question; the Investigation sends the player to 2 to 4 places to find archive items (old photographs, maps, news, with source and licence); the ending Ghost_Line depends on the Heritage_Plan.
- **Kind C**: by day an ordinary place; at night a figure that fades when approached and a short glimpse of the old landscape (none under reduced motion), and "an unreadable record" added to the City_Archive. The Investigation unlocks the sourced records step by step; at the end the player may add the place to the Heritage_Plan (a soft light and a plaque on the City_View).
- **Memorial_Point**: a small plaque marker day and night; the panel shows the date, one factual sentence and its source.

## Ghost_Lines (Requirement 5A)

`ghost-lines.json`: sets per ghost (Kind A, Kind B, and `model` for the Model_Ghosts of any district) with moments `meet`, `ask`, `met`, `notMet`, `idle`, several lines each, both languages, status. Placeholders only from the game state (`{district}`, `{rent}`, `{target}` …). The validator rejects a set for a Kind C place or a Memorial_Point. Claude Code drafts the lines; the user approves them before they are shown.

## product.md amendment (Requirement 1.3, proposed text)

> The number of Model_Ghosts in each district is determined by simulation output … Never place a Model_Ghost for decoration. **Exception (night-ghosts spec, approved by the user): Mission_Ghosts are a game element added at night for a Mission not met; they look different, are counted separately, are named as a game element in the legend, and never change a simulation number.**

## Testing

Property tests: Missions, Mission_Ghosts, the timer and scenes never change an Engine result (run the Engine with and without them); the same seed and inputs give the same offer, givers, lines and night; Kind B, C and Memorial_Points never count toward the pressure; no giver is Kind C or a Memorial_Point; the next Day_Timer is never below its minimum. File tests for the three data files (both languages, placeholders, sources, status; no Ghost_Line for Kind C or a Memorial_Point).

## Research (Scene_Database)

Filled in from the research of 2026-11-24 (official sources and coordinates of every place).
