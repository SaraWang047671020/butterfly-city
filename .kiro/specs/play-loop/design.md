# Design Document

## Overview

This design implements the play-loop requirements in three layers, keeping the existing boundaries of game-ui Requirement 18:

1. **Data**: two new files, the Character_File (`data/config/characters.json`, hand-written content) and the Wage_File (`public/data/wages.json`, generated).
2. **Pure game logic** in `src/game/life/` and `src/game/brief.ts`: the Life_State, the Character_Numbers, the availability of Life_Decisions and the Brief_Item rule. No DOM, no storage, no Engine change.
3. **UI** in `src/ui/`: the Dialog_Frame first (every later screen uses it), then Character_Creation, the Life dialog, the Policy_Cards and Policy_Dialog, the Quarter_Brief, the City_Report, the District_Card and the First_Play_Guide.

The Engine, `params.json`, the Save schema and the Save_Code stay unchanged. The Character and its Life_Timeline live in their own store, like the followed Persona of the story layer.

## Architecture

```
data/config/characters.json ──copy──▶ public/data/characters.json ─┐
DGBAS earnings (raw, gitignored) ─▶ scripts/story/wages.ts ─▶ public/data/wages.json ─┤
                                                                                     ▼
                                     src/data/character-loader.ts (fetch + validate)
                                                                                     ▼
src/save/character-store.ts ◀──▶ src/game/controller.ts ──▶ src/game/life/* (pure)
   (Character, Life_Timeline,          │  view.character, view.brief       src/game/brief.ts (pure)
    guideDone)                         ▼
                              src/ui/app.ts ── Policy_Cards, Turn_Bar, District_Card, city tools
                                    │
                                    └── src/ui/dialogs/frame.ts (Dialog_Frame)
                                          ├─ character/creation.ts     ├─ brief/quarter-brief.ts
                                          ├─ life/life-dialog.ts       ├─ report/city-report.ts
                                          └─ policy/policy-dialog.ts   └─ guide/first-play.ts
                              src/ui/city/index.ts ── walkTo(place), setAvatar(look), setHousehold(figures)
```

`main.ts` loads the two files with the other story files, creates the Character_Store and passes both to the Game_Controller and the App.

## Data

### Character_File (`data/config/characters.json`)

Hand-written, drafted by Claude Code, `"status": "draft"` until the user approves (Requirement 10.4). Copied to `public/data/` by `npm run story-files`. Shape:

```jsonc
{
  "schemaVersion": 1,
  "status": "draft",
  "origins": [ { "id": "taipei", "name": "...", "text": "...", "familyCity": "Taipei City" } ],
  "occupations": [
    { "id": "software", "name": "...", "text": "...", "industry": "J",   // DGBAS industry code
      "workCodes": ["63000100", "63000090"] }
  ],
  "dwellings": [ { "persons": 1, "size": 20, "status": "gap", "assumption": "..." } ],
  "appearance": { "body": [...], "hair": [...], "colour": [...] },      // ids only; tokens in tokens.css
  "pronouns": { "she": {...}, "he": {...}, "they": {...} },          // subject, object, possessive
  "legal": [
    { "id": "same-sex-marriage", "from": "2019Q2", "date": "2019-05-24",
      "text": "...", "source": { "citation": "...", "url": "..." } }
  ],
  "decisions": { "move": {...}, "changeJob": {...}, "partnerIn": {...}, ... },   // title, text, confirm
  "brief": { "completion": "...", "majorEvent": "...", "indicatorUp": "...", "indicatorDown": "...", "none": "..." },
  "guide": [ "...", "...", "...", "...", "..." ]
}
```

The validator (`src/data/character-loader.ts`) checks the counts of Requirement 2.3 (3 origins, 6 to 8 occupations), 2 to 4 valid work District_Codes per occupation, a dwelling size for 1 to 5 persons, every pronoun set complete, every `legal.from` a Quarter_Key, and every Template a non-empty string whose Placeholders are known.

### Wage_File (`public/data/wages.json`)

Written by `scripts/story/wages.ts` (`npm run story-files`) from the DGBAS earnings and productivity statistics (薪資與生產力統計, industry and service sector earnings survey): the annual mean of the **regular monthly earnings** (經常性薪資) of full-time employees per industry, 2015 to 2025. The raw table is downloaded by `scripts/download.ts` into `data/raw/` (gitignored), like every other source. The exact table id and URL are recorded in `data/SOURCES.md` when the download is added; the design does not fix them before they are checked.

```jsonc
{ "schemaVersion": 1, "unit": "TWD per month", "source": {...}, "method": "...",
  "earnings": { "J": { "2015": 0, "...": 0, "2025": 0 }, "...": {} } }
```

Regular earnings, not total earnings, because bonuses are paid irregularly and rent is paid monthly. This choice and the fact that a mean is above the median of most industries are written into the model limitations page (`model-limits.json`, new item, drafted for the user).

## Pure game logic

### Life_State (`src/game/life/life-state.ts`)

```ts
interface Member { kind: 'self' | 'partner' | 'child' | 'parent'; occupation: string | null; workCode: string | null;
                   pronouns: PronounId; look: Look }
interface LifeState { home: DistrictCode; tenure: 'renting' | 'family'; members: readonly Member[]; married: boolean }
type LifeDecision =
  | { kind: 'move'; home: DistrictCode; tenure: 'renting' | 'family' }
  | { kind: 'changeJob'; occupation: string; workCode: DistrictCode }
  | { kind: 'partnerIn'; partner: Omit<Member, 'kind'> } | { kind: 'partnerOut' }
  | { kind: 'marry' } | { kind: 'childJoins' } | { kind: 'parentJoins' } | { kind: 'parentLeaves' };
interface LifeEntry { quarter: QuarterKey; decision: LifeDecision }

function lifeStateAt(start: LifeState, timeline: readonly LifeEntry[], qi: number, quarters: readonly QuarterKey[]): LifeState
```

`lifeStateAt` folds the entries whose quarter is at or before `qi` in timeline order. `partnerOut` also clears `married`. A child and a parent have no occupation and are not earners.

### Availability (`src/game/life/availability.ts`)

`available(state, planning, file): readonly { kind, ok: true } | { kind, ok: false, reasonId }[]`. Rules:

| Decision | Available when |
|---|---|
| move, changeJob | always (move to `family` only in the origin city of a Taipei or New Taipei origin) |
| partnerIn | no partner |
| partnerOut | a partner |
| marry | a partner, not married, and the legal rule below |
| childJoins | always; at most 3 children |
| parentJoins / parentLeaves | no parent / a parent |

**Same-sex marriage rule.** The pronoun set is a display choice and must not decide a legal fact (a Character or a partner may use "they"). So the partner step asks one explicit question, "Are you and your partner the same sex in law?" (`sameSexInLaw: boolean`), stored on the partner. `marry` with `sameSexInLaw` is available from the `from` quarter of the `same-sex-marriage` legal fact (2019Q2); before it, the dialog shows that fact's `text` and `source` in place of the action (Requirement 3A.3). The flag changes no number (property test, Requirement 11.2).

A "child joins" decision does not distinguish birth and adoption in phase 1, so no adoption rule applies. Joint adoption by same-sex couples (amendment passed 2023-05-16) is recorded for phase 3 and will be checked against the law text before it is used.

### Character_Numbers (`src/game/life/numbers.ts`)

```ts
function characterNumbers(state: LifeState, year: number, rentPerM2: number | null,
                          wages: WageFile, dwellings: DwellingTable, commute: CommuteMatrix): CharacterNumbers
// income  = Σ earners wages[industry(occupation)][year]          (null if any earner's wage is missing)
// rent    = tenure === 'family' ? 0 : rentPerM2 × size(persons)
// burden  = rent / income × 100
// commute = matrix minutes home → self.workCode (null when same district, "no trip" as in story-facts)
```

`rentPerM2` is the central `rent` Result_Range of the home district for the player run, and the `history.json` rent for the real run (the zero-delta identity of the story layer). The Game_Controller computes both and passes `{ player, real, previous }` in `view.character`.

### Brief_Items (`src/game/brief.ts`)

```ts
function briefItems(input: { completions; majorEvents; changes: { district; indicator; prevDiff; diff }[] }): BriefItem[]
// score(change) = |diff − prevDiff| ÷ max(|CHANGE_BOUNDS[indicator]|)
// candidates: completions (score ∞), Major_Events (score ∞), changes with score > 0
// order: completions, Major_Events, then score descending, then district name; take 3
```

`CHANGE_BOUNDS` moves from `src/ui/city/colours.ts` to `src/game/core/change-bounds.ts` so that the pure rule and the City_View share it; `colours.ts` re-exports it. The differences are the `difference` field the Map view model already has (city-3d change mode), computed for every indicator, not only the selected one.

## Controller additions

- `view.character: CharacterView | null`: the Character, the Life_State of the Planning_Quarter, the Character_Numbers `{ player, real, previous }` for the Displayed_Quarter, the available Life_Decisions.
- `view.brief: BriefView | null`: the Brief_Items of the last Computation_Run, cleared on the next edit or run.
- `actions.createCharacter(c)`, `actions.previewLife(decision) → { with, without }`, `actions.applyLife(decision)`, `actions.dismissBrief()`, `actions.guideDone()`.
- `applyLife` rejects a Fixed_Quarter and writes to the Character_Store through the store port, never to the Save.

## UI

### Dialog_Frame (`src/ui/a11y/dialog.ts`)

Implemented as the existing dialog manager, which every dialog already used: `open({ title, kicker?, body, actions?, size?: 'md' | 'lg' | 'full', opener, onCancel })`. (The first draft named a new `frame.ts`; one manager avoids two modal paths.) A native modal `<dialog>` (`showModal`), so focus is trapped by the browser and the dialog sits in the top layer above the pointer-transparent overlay. The existing dialogs of `dialogs.ts` (new game, export, import, Event_Cards, "Why?") and the station dialog are moved onto it. Sizes: `md` min(40rem, 100% − 2 gutters), `lg` min(64rem, …), full screen below 40rem. All values are tokens.

### Character_Creation (`src/ui/character/creation.ts`)

A `full` Dialog_Frame in four short steps with a step indicator: **Who** (name, pronouns, look with a live 3D-free preview drawn in SVG), **Roots** (origin; for a Taipei or New Taipei origin the choice "live with family"), **Work** (occupation cards with wage of 2015 and the source; work district list), **Home** (district list sorted by rent per m², with a small map). The last step shows the Character_Numbers of 2015Q1 with sources and the Confirm control. "Random character" fills every step with seeded choices.

### Life dialog (`src/ui/life/life-dialog.ts`)

An `lg` Dialog_Frame opened from "My life" in the Turn_Bar. Left: the household as figures and the current numbers. Right: one card per Life_Decision; unavailable ones show their reason or legal fact. Choosing one shows its form (district, occupation, partner) and the with / without comparison from `previewLife`, then Confirm.

### Policy_Cards and Policy_Dialog (`src/ui/policy/`)

`policy-cards.ts` renders the three Active_Tool cards from `view.policyPanel.domains`. `policy-dialog.ts` opens an `lg` Dialog_Frame per tool. It reuses the field logic of `createPolicyPanel` by mounting the existing component filtered to one tool (a new `only?: ToolId` prop) inside the "Details and sources" disclosure, and adds above it:

- a slider per editable field whose `input` event writes into the same input element the panel already validates, so there is one value and one validation path (Requirement 11.4);
- for the district-scoped field a district picker (list plus the small SVG map of the district outlines already used by the 2D fallback);
- the Quick_Preview, filled from the `EditCheckView` the panel already receives (`checkBudget` figures, Lag) in plain words: "+120 units in Banqiao · TWD 1.2 bn · ready 2017Q3 · TWD 3.4 bn left in 2016".

The benefits and costs statements of game-ui Requirement 8.12 are shown above the disclosure.

### Quarter_Brief (`src/ui/brief/quarter-brief.ts`)

A `md` Dialog_Frame shown after Event_Cards. A headline per Brief_Item with a "Go there" button, then a "Your quarter" block with the Character_Numbers and arrows for the change from the previous quarter and from real history (text, not only arrows). "Go there" calls `cityView.walkTo(place)`.

### City_View additions

- `walkTo({ district, kind: 'site' | 'station' | 'centre' })`: enters Walk_Mode with the Avatar at the site of the social housing layer, the station nearest the district centre, or `nearestFree` of the centre.
- `setAvatar(look)`: the Avatar's body, hair and clothing colour from token ids.
- `setHousehold(members)`: the household members walk with the Avatar at home (phase 1: shown standing at the home door; walking behaviour in phase 2).

### City_Report (`src/ui/report/city-report.ts`)

A `full` Dialog_Frame with a tab list (ARIA tabs). Each tab mounts an existing component unchanged: District_Panel and District_List ("Districts"), Map_Indicator switch and legend ("Map colours"), Timeline_View with the Life_Timeline merged after the entries of each quarter ("Timeline"), Story_Panel ("People"), Limits_Dialog content ("Model limits"). The main screen keeps the Turn_Bar, Policy_Cards, city tools, District_Card, Illustration_Note and disclosure.

### District_Card (`src/ui/district-card.ts`)

A small card positioned at the screen projection of the district centre (a CSS2D-free DOM element moved each frame from `cityView.project(code)`), clamped inside the viewport, docked at the bottom below 64rem. Values come from the same view model fields as the District_Panel (Requirement 7.5).

### First_Play_Guide (`src/ui/guide/first-play.ts`)

A non-modal callout with an arrow that points at a target element by selector, five steps from the Character_File `guide` texts. It listens for the player's own actions (opening a Policy_Card, applying, Next quarter, Go there, opening the report) to move on, and never calls an action itself.

## Testing

- Validators of both files (unit) and a committed-file check like `model-facts.test.ts`.
- `lifeStateAt`: fold order, `partnerOut` clears `married` (unit); timeline prefix property (applying entries up to `qi` then the rest equals applying all).
- `characterNumbers`: hand calculation for a renter and a family case; property: pronouns, look and `sameSexInLaw` change no number.
- Availability: same-sex marriage unavailable in 2019Q1, available in 2019Q2; Fixed_Quarter rejection.
- `briefItems`: order, limit 3, empty case; property: the result is a prefix of the full sorted candidate list.
- Policy_Dialog: slider and input always equal (DOM test); Quick_Preview cost equals the `checkBudget` figure.
- Dialogs: a Playwright-free DOM check that each `<dialog>` is opened with `showModal`, plus the manual pointer-click check of Requirement 9.3 recorded in `KIRO-LOG.md`.
- Static: module boundaries, no colour or ms literals, Banned_Term_List over the Character_File.

## Order of work

1. Dialog_Frame and moving the existing dialogs (fixes the size problem the user reported first).
2. Data files, loader, Character_Store, pure logic and tests.
3. Character_Creation and the Life dialog.
4. Policy_Cards and Policy_Dialog.
5. Quarter_Brief and `walkTo`.
6. City_Report and District_Card; main screen cleared.
7. First_Play_Guide; strings review; manual checks.
