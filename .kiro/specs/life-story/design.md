# Design Document

## Overview

The Character gets a second life next to the first: the **Player_Version** lives in the player's city, the **Real_Version** in real history. Both start the same, make the same choices and meet the same Life_Events. They differ in two ways only: the Engine results of their track (rent per m², social housing completions, the policy values) and the outcome of Applications, which use one Shared_Draw on both tracks. Everything is a pure function of the Character, the seed, the choices, the Save and the Data_Files (Requirement 7.2).

```
           Life_Timeline (choices, both tracks)          Data_Files + Application_Supply_File
                       │                                          │
   Life_Event ◄── triggers.ts ◄── Player_Version ledger           │
       │ choice                                                   │
       ▼                                                          ▼
  timeline entry ──► tracks.ts ──► LifeState per track ◄── applications.ts (odds per track, Shared_Draw)
                                     │
                                     ▼
                              ledger.ts (Personal_Ledger per track)
                                     │
                      story.ts (Story_Lines)   ending.ts (Ending)
                                     │
                         LifeController.view() ──► UI (after the Design_Proposal)
```

## Architecture

New pure modules in `src/game/life/` (no import of `src/ui`, `src/save` or `src/data` beyond types; boundary test of play-loop 11.5 extended):

| Module | Content |
|---|---|
| `events.ts` | The trigger of each Life_Event (code, by id), the pick of at most one Life_Event per quarter, the Event_Options that apply |
| `applications.ts` | Eligibility, Application_Odds per track, the Shared_Draw, outcomes, tenancy and subsidy periods |
| `tracks.ts` | The Life_State of each track per quarter: the shared Life_Timeline plus the track's Application outcomes |
| `ledger.ts` | The Personal_Ledger per track (Requirement 4.1) |
| `story.ts` | Selection and filling of the Story_Lines (reuses `src/narrative/fill.ts`) |
| `ending.ts` | The decade summary and the ending template of each version |

Changed modules:

- `life-state.ts`: `LifeState.tenure` gains `'social'` (living in social housing, with the district and the quarter it started), and `LifeState` gains `subsidy: { from, until, amount } | null`. New `LifeDecision` kinds `apply` (`benefit: 'socialHousing' | 'rentSubsidy'`), `buyPass` and `leave` (leaves the two cities; ends the story). `apply` and the tenure and subsidy changes it causes are resolved per track in `tracks.ts`; `applyDecision` keeps its meaning for the other kinds.
- `controller.ts` (`LifeController`): the pending Life_Event of the Planning_Quarter, `choose(eventId, optionId)`, the two-version view, the Story_Lines of each computed quarter, the Ending.
- `src/game/core/turns.ts`: `fastForward` takes an optional `stopAfter(session)`; a new StopReason `life-event` (Requirement 7.3). The game controller gets the predicate from `main.ts`, which asks the LifeController whether a Life_Event is triggered for the new Planning_Quarter.
- `src/save/character-store.ts`: record version 2 with `seed` and `choices` (`{ quarter, event, option }[]`); a version 1 record is read with a seed derived from the Character's name and start and no choices.
- `src/data/character-loader.ts`: loads and validates the Life_Event_File, the Life_Story_File and the Application_Supply_File with the Character_File.

## Data

### Life_Event_File (`data/config/life-events.json`, copied to `public/data/`)

```json
{
  "schemaVersion": 1,
  "status": { "en": "draft", "zh-Hant": "draft" },
  "events": [
    {
      "id": "leaseEnd",
      "priority": 50,
      "cooldownQuarters": 8,
      "text": { "en": "...", "zh-Hant": "..." },
      "options": [
        { "id": "renew", "effect": { "kind": "none" }, "text": { "en": "...", "zh-Hant": "..." } },
        { "id": "move", "effect": { "kind": "pickMove" }, "text": { "en": "...", "zh-Hant": "..." } },
        { "id": "family", "effect": { "kind": "move", "tenure": "family" }, "text": { "en": "...", "zh-Hant": "..." } }
      ]
    }
  ],
  "eligibility": [ { "benefit": "socialHousing", "city": "Taipei", "from": "2015Q1", "incomeLimit": ..., "source": "..." } ]
}
```

Triggers are code (`events.ts`, keyed by id), so that each is a typed, tested function; the file holds the texts, priorities, cooldowns and options. An effect `pickMove` or `pickJob` opens the move or job picker of the "My life" dialog inside the Life_Event dialog.

### Application_Supply_File (`data/config/application-supply.json`, copied to `public/data/`)

Applicants per city and year for each benefit, the general-household share of social housing allocations, the turnover of social housing tenancies, and the subsidy periods, each with its source or `gap` and an assumption. The values come from the research of 2026-11-24 (section "Research results" below).

### Life_Story_File (`data/config/life-story.json`, copied to `public/data/`)

Templates with a selection condition, in both languages, with `status`. Template ids are stable; the Template_Filler of the story-layer spec fills them.

## Life_Events and triggers

At the start of each Decide_Step `pickEvent(state)` evaluates the triggers in priority order on the Player_Version of the Displayed_Quarter (Requirement 2.2) and returns the first one that is due, or none. Global rule: at most one per quarter; at least 4 quarters after the previous Life_Event (`MIN_GAP`; 3 in the first draft gave a Life_Event almost every 3 quarters, because the partner and child triggers hold most of the time), except the forced events (marked *), which come when due.

| Priority | Id | Trigger (Player_Version) | Options (→ effect) |
|---|---|---|---|
| 100 | `tenancyEnd`* | in social housing and the tenancy limit is reached | rent privately in a district (→ pick move) · apply again where the rules allow it (→ apply) · move in with family where allowed |
| 95 | `subsidyEnds`* | the rent subsidy period ends | apply again (→ apply) · stop |
| 90 | `rentPressure` | rent burden above 30 % for 4 quarters in a row | move to a cheaper district (→ pick move) · apply for the rent subsidy (→ apply) · move in with family · leave the two cities (→ leave) · keep things as they are |
| 80 | `socialHousingRound` | renting privately, eligible, social housing is let in the city this quarter on the Player_Version (completions above 0), or once a year in Q2 for the turnover lettings | apply · not now |
| 75 | `rentSubsidyWindow` | renting privately, eligible, no subsidy, the application window of the year (Q3 to 2021: one round a year from July; from 2022-07-01 open all year, asked in Q3) | apply · not now |
| 70 | `passLaunch` | 2018Q2 (the NT$1,280 pass goes on sale 2018-04-16), commutes to another district | buy the monthly pass (→ buyPass) · keep commuting as before |
| 60 | `leaseEnd` | renting privately, 8 quarters since the last move (assumption: no official statistic of lease length was found) | renew · move (→ pick move) · move in with family |
| 55 | `longCommute` | commute above 60 minutes for 4 quarters | move closer (→ pick move) · change job (→ pick job) · keep things as they are |
| 50 | `parentCare` | from 2018, once, no parent in the household | a parent moves in (→ parentJoins) · care arranged elsewhere |
| 40 | `jobOffer` | 12 quarters since the last job change | accept (→ changeJob to an offered occupation and district) · decline |
| 30 | `partner` | no partner, from 2016, cooldown 12 | a partner moves in (→ partner editor) · not now |
| 25 | `marriage` | partner for 4 quarters, the law of the quarter allows it | marry · not now |
| 20 | `child` | 12 quarters since the start, cooldown 12 | a child joins the household · not now |

Every Life_Event has a "keep things as they are" option (Requirement 2.5); Escape chooses it. A Life_Decision chosen in a Life_Event applies to both tracks; a `move` or `leave` also ends social housing and the subsidy on both tracks.

## Applications

For an `apply` entry of benefit `b` in quarter `q`, city `c` (the city of the Character's home, or of the work district where the rules allow working in the city):

- **Eligibility** (both tracks, the household of the Player_Version, the rules in force in `q`; values in "Research results"). If not eligible, the option is shown disabled with the rule and its source.
  - Social housing: household annual income below the city's 50th-percentile limit of the year; living, registered or working in the city; no home owned (always true: the Character rents or lives with family).
  - Rent subsidy: per-person monthly income below `k × minimum living expense` of the city and year (`k` = 1.5 to 2019, 2.5 in 2020 and 2021, 3 from 2022-07-01); renting privately; before 2019, a single person under 40 could not apply in Taipei (the Character is treated as under 40: assumption, the Character_File has no age).
- **Odds.** The sources give the real odds of each benefit (social housing: published lottery odds of rounds; rent subsidy: approved ÷ applications per city and year), not applicant counts for every year. Requirement 3.2 (`odds = supply ÷ applicants`) is therefore applied with the applicants implied by the real odds, `applicants = supplyReal ÷ oddsReal`, which gives

  `odds_t = min(1, oddsReal(b, c, year) × supply_t ÷ supplyReal)`

  and `odds_t = oddsReal` WHEN the two supplies are equal (Requirement 9.2). WHEN `supplyReal` is 0 (no round in real history that quarter), `odds_Real = 0` and `odds_Player = min(1, oddsReal × supply_Player ÷ meanSupplyReal(c))`, with the mean quarterly real supply of the city over the game.
  - Social housing supply = units let in the quarter in the city: the completions of the previous quarter (the Engine's social housing stock change on the Player_Version, `history.json` completions on the Real_Version) plus turnover `stock ÷ 24` of the previous quarter (a 6-year tenancy, "Research results"). The previous quarter, so that the odds are known when the Life_Event is asked (the Design_Proposal shows them in the dialog); changed during implementation from the completions of the quarter itself.
  - The rent subsidy odds shown in the dialog use the policy value of the Planning_Quarter at that moment; the result uses the value the quarter is computed with.
  - Rent subsidy supply = the rent subsidy households of the city in `q` (the player's policy timeline, or the Real_Policy_Track).
- **Shared_Draw**: `mulberry32(hashSeed(seed + ':' + b + ':' + q))()`; success on track `t` WHEN the draw is below `odds_t`. More supply never lowers the odds, and a success at lower odds is a success at higher odds (Requirement 9.3).
- **Effect** from `q + 1` on that track:
  - social housing: the Character moves to social housing in the district of the city with the most completions on that track in `q` (ties by District_Code; with no completion, the district with the largest stock), at `cityRentShare × rent per m² × dwelling size` (Taipei 0.85, New Taipei 0.80 of the market rent), for the tenancy of the city (3-year leases, 6 years in total). At each 3-year renewal the household must still be eligible; otherwise the `tenancyEnd` Life_Event comes.
  - rent subsidy: the rent is lowered by the subsidy amount per household of that track's policy value for the city, times the household multiplier from 2022-07-01 (single under 40: 1.2; married within 2 years: 1.3; 1, 2, 3+ children: 1.4, 1.6, 1.8; the largest that applies), never above the rent, for 4 quarters from the quarter after the result (changed during implementation: the real programme pays for the calendar year back to the month of the application, which a Q3 result paid only to the year end would undercount); the `subsidyEnds` Life_Event asks to apply again.
- **Message** (Requirement 3.5): one sentence with both supplies and both odds, filled from a Life_Story_File template.

## Personal_Ledger

`ledger(state_t, quarter, track)`: income (play-loop 3.1), rent (private: rent per m² × size × home premium; social: Applications section; minus the subsidy), transport (with a pass: price − subsidy of the commuter pass series of the track's policy values in `q`; before the pass, or without one: no transport line, with the note "Single fares are not modelled"), money left = income − rent − transport. Later specs add lines by a `LedgerLine` registry (Requirement 4.6).

## Story and Ending

`storyLines(quarter)`: the Life_Event of the quarter and its outcome first (one line), then the largest difference between the versions among rent, commute and money left (one line, if the difference is above a shown threshold), then the situation line (home, household, job). Each template has a condition on the situation; the first matching template in file order is used, so the result is deterministic. The Ending picks one template per version (still renting with a rent burden above 30 %, renting below it, in social housing, with family, left the two cities) and shows the decade table of Requirement 6.2 and the sourced gender shares.

## UI (after the Design_Proposal, Requirement 1)

- **Life_Event dialog**: Dialog_Frame, opened at the start of the Decide_Step before the Policy_Cards, with each option's effect on both versions.
- **Two_Me_Panel**: in the Quarter_Brief below the Story_Lines, and in the "My life" dialog for past quarters; two columns with the differences in words.
- **My_Story**: a page from the game menu, quarter by quarter.
- **Ending**: a full page after 2025Q4 or a `leave` choice.

## Testing

Property tests in `tests/game/life/`: determinism (9.1); equal versions when the policy equals real history in every quarter (9.2: the player run's rent and completions equal history, the policy values equal the track); odds monotone in supply and the Shared_Draw rule (9.3); file checks for both languages, placeholders and sources (9.4); a static check that the triggers read only the Player_Version (9.5). Unit tests for each trigger and for the tenancy and subsidy periods.

## Research results

Full notes with every source, URL and access date (2026-11-24): `data/research/life-story-social-housing-2026-11-24.md` and `data/research/life-story-rent-subsidy-2026-11-24.md`. The Application_Supply_File takes its values from these notes; a value marked `gap` carries its assumption text.

### Social housing

| Item | Value used | Source status |
|---|---|---|
| Real odds, Taipei | 2018 4.73 % (健康), 2019 4.0 % (5 sites, 167 units ÷ 4,163 applications), 2021 6.9 % (瑞光), 2022 5.8 % (4 sites), 2025 7.5 % (joint round; 南港機廠 15.78 % is a single large round and not used as the year value); other years 6.5 %, the middle of the "5 % to 8 % historical average" of the Taipei housing centre | secondary (news quoting the city); the other years `gap` |
| Real odds, New Taipei | 2020 29 % (央北, 926 ÷ 3,202), 2025 30 % (三峽國光二期); other years 11.5 %, the median of the 13 New Taipei rounds listed by the 社會住宅推動聯盟 | secondary; the other years `gap` (an NGO list without dates) |
| Tenancy | 3-year leases, 6 years in total, 12 for disadvantaged households (both cities; Taipei 2015, 2017 and 2023 texts; New Taipei 2021) | official |
| Income limit (household, year) | Taipei: 2018 145萬, 2019 153萬, 2020 158萬, 2022 167萬, 2025 180萬; New Taipei: 2021 128萬, 2023 133萬, 2024 137萬, 2025 144萬. Missing years: linear between known years; before the first known year, the first known value | official (some from search snippets); interpolated years `gap` |
| Rent | Taipei 85 % of the market rent, New Taipei 80 % for general households | official |
| Women among tenants | national, end of 2024: 55.9 % of 25,563 tenant households; New Taipei city housing 54.3 % (2020) to 55.9 % (2024) | official (New Taipei totals summed from per-estate figures) |

Not found: applicant counts split into general and priority households; Taipei rounds 2015 to 2017; annual city totals of applicants or units let.

### Rent subsidy

| Item | Value used | Source status |
|---|---|---|
| Real odds (approved ÷ applications) | Taipei 2015 88.6 %, 2016 90.3 %, 2017 90.2 %, 2018 89.5 %, 2019 89.4 %, 2020 80.8 %, 2021 76.9 %, 2022 82.9 %, 2023 and 2024 83.5 % (published together), 2025 90.7 %; New Taipei 2015 78.75 %, 2016 85.59 %, 2017 84.32 %, 2018 78.52 %, 2019 81.83 %, 2020 78.28 %, 2021 78.61 %, 2022 84.62 %, 2023 80.54 %, 2024 73.06 %, 2025 85.77 % | official (data.gov.tw 132047, 122939) |
| Income rule | 1.5 × minimum living expense per person to 2019 (and the 20th-percentile route to 2018, not modelled), 2.5 × in 2020 and 2021, 3 × from 2022-07-01 | official |
| Minimum living expense (NT$ per month) | Taipei 2015 14,794 · 2016 15,162 · 2017 15,544 · 2018 16,157 · 2019 16,580 · 2020 17,005 · 2022 18,682 (56,046 ÷ 3) · 2025 20,379; New Taipei 2015 12,840 · 2016 12,840 · 2017 13,700 · 2018 14,385 · 2019 14,666 · 2020 15,500 · 2022 15,800 · 2025 16,400 (49,200 ÷ 3). Missing years linear | official; 2022 New Taipei and 2025 secondary; interpolated years `gap` |
| Amount | the policy value of the track (`rentSubsidyAmountPerHousehold`), with the multipliers from 2022-07-01 | the policy track; multipliers official |
| Period | the real programme: the calendar year, apply again every year; the game: 4 quarters from the quarter after the result | official; the game's period is an assumption |
| Women among recipients | New Taipei approved 55.55 % (2015), 55.91 % (2018), 54.78 % (2020); Taipei 2023 and 2024 approved 56.3 % | official |

### Other

| Item | Value used | Source status |
|---|---|---|
| Lease length | no official statistic; the `leaseEnd` interval of 8 quarters is an assumption (a 2017 survey of rent subsidy applicants gives 5.3 years in the current home on average in Taipei, 5.2 in New Taipei) | `gap` |
| Monthly pass | NT$1,280 from 2018-04-16 to 2023-06-30, TPASS NT$1,200 from 2023-07-01: the policy track's `commuterPassPrice` | the policy track |
| Public transport share of commuters | Taipei 44 % to 48 %, New Taipei 30 % to 38 % (2014 to 2022); used only in the text of the `passLaunch` Life_Event | official (MOTC) |
| Women and public transport | Taipei 2024: 46.5 % of women's trips by public transport, 28.3 % of men's; for the Ending's commuter pass line | official (Taipei statistics, citing MOTC) |
