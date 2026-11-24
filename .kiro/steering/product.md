---
inclusion: always
---

# Product: Butterfly City

## One-liner

A virtual city built from real open data for the 41 districts of Taipei City and New Taipei City. The player becomes mayor in 2015, lives through events that really happened, rewrites ten years with their own policies, and finally compares their Taipei metro area with the real one.

Built for Kiroween 2026, Costume Contest track. Solo developer.

## Users and positioning

- **Users**: participatory budgeting voters; civics and general-education teachers and students.
- **Positioning**: a *policy consequence previewer*. Existing budget simulators only count money. Butterfly City shows who gets left behind after the money is spent.
- **Goals**: immersive, grounded in objective data, and genuinely educational.
- **Focus**: housing affordability in the two cities: rent, purchase price, commute and displacement. All five policy tools act on it.

## Player role

- The player is a fictional **joint mayor of Taipei and New Taipei**, controlling all 5 policy tools across both cities.
- Central-government policies (e.g., the New Youth Housing Loan, TPASS, central bank credit controls, interest rate changes) are **events**, not player controls.
- The rail network (MRT and LRT openings) and TOD zoning rules follow real history. They are baseline data and, where relevant, event cards. The player does not control them.

## Modes

| Mode | Status | Description |
|---|---|---|
| Historical | **MVP** | 2015 Q1 → 2025 Q4, one turn per quarter, 44 turns. Real events occur on their real dates. |
| Future | Later | 2026 → 2036. Events occur randomly at historical frequencies (seeded). |
| Live | If time allows | Daily news classified into events. Known conflict: requires a scheduled job (e.g., GitHub Actions) to fetch and produce JSON, and a rule-based classifier (no AI). Not designed yet. |

### Turn flow

- Time only advances when the player presses **Next quarter** or **Fast-forward one year**.
- Fast-forward automatically stops at major events.
- Events do not present player choices in the MVP. In Historical mode an event's effect is already in the real baseline, so an event never adds to or subtracts from an indicator directly. It can only change how strongly the player's policy differences act, or it is shown as narrative and explanation (see `simulation.md`).
- The player can adjust policies at any time. Every adjustment is recorded on a **policy timeline**.
- Progress is saved in the browser so the player can continue the next day.

## Policy tools (2 domains, 5 tools)

| Domain | Tool |
|---|---|
| Housing | Social housing construction |
| Housing | Sublease and rental management program (包租代管) |
| Housing | Rent subsidy |
| Housing | Vacant / multiple-home holding tax |
| Transit | Commuter pass subsidy |

The scope was narrowed from an earlier plan of 8 tools to keep the focus on housing affordability. MRT extension, TOD floor-area bonus, and parks, green space and street trees were removed. Real MRT openings, TOD rules and environmental data may still appear in the real baseline or as event cards, but the player cannot change them.

Each tool has: a cost at realistic magnitude, a time lag, primary effects, an allowed adjustment range, and cited parameter sources (see `simulation.md`).

At the start, every tool is set to its **real historical value**. The player adjusts up or down from reality.

### Budget

- One budget per year. The total equals the real historical spending on these 5 tools for that year.
- The player can only reallocate within that total. The budget can never be overspent, and each tool stays within its own allowed range (see `simulation.md`).
- Revenue from the holding tax may flow back into the budget (exact rule defined in the simulation spec).

## Events

- MVP event library: real events from 2015–2025, e.g., the House and Land Consolidated Income Tax, COVID-19, interest rate hikes and cuts, central bank credit controls, TPASS, the New Youth Housing Loan, earthquakes.
- Each event card has: real date, type, affected indicators, impact magnitude measured from data at the time, and source links. The measured impact explains what happened; it is already in the real baseline and is not applied a second time.
- Event card text describes **what happened only** (see `neutrality.md`).

## Citizens and ghosts (the Halloween theme is functional)

- At the start, the player **creates a Character** (play-loop spec): name, pronouns and look; where they grew up (born in Taipei, born in New Taipei, or moved from elsewhere in Taiwan); an occupation with its real regular monthly earnings (DGBAS, 2015–2025); and how they live (renting, or with family in the family's city) in a chosen district. The Character file is `data/config/characters.json`.
- Each quarter shows the Character's rent burden and commute time (the character chip and "My life"), computed from Engine output, the real earnings of the occupation and the rent of a small home (registered leases). Pronouns and look never change a number.
- Life decisions are made over time in "My life" (move home, change job, a partner of any gender moves in or out, marriage where the law of that quarter allows it, a child joins, a parent moves in or out); each shows the Character's numbers with and without the decision and changes no Engine result.
- The six fixed personas of the story-layer spec stay in the game as citizens: they stand in the city in Walk_Mode and appear in the People tab of the City report, e.g.:
  - 25-year-old renter living in Zhonghe, commuting to Xinyi
  - Elderly resident living alone in Wanhua
  - Dual-income family in Banqiao
  - Commuter in Tamsui
  - Small shop owner in Da'an
- Character and citizen updates are generated from **fixed text templates**. Generated text may be added later under the rules of "Direction after phase 1" below; every number still comes from the Engine.
- **A ghost is a person hidden by averages.** A resident becomes a ghost when rent burden or commute time crosses a cited threshold, or when they are forced to move out.
- The number of ghosts in each district is determined by simulation output. One ghost represents a fixed number of residents (default 1,000). Each district has a display cap, and the exact total is always shown as a number. Never place a ghost for decoration.

## Visual tone

- Default: a calm, futuristic city command center.
- As social risk rises, dark red tones, signal interference, and ghost silhouettes appear gradually and stay localized.
- No continuous full-screen flicker. All motion respects `prefers-reduced-motion` with static equivalents that carry the same information.

### UI design approval gate

The interface must look exceptionally polished. **Before implementing any UI (layout, palette, typography, map styling, ghost visuals, risk-escalation states), present a visual design proposal and get explicit user approval.** Do not write production UI code until the style is approved. Changes to an approved style also require approval.

## Learning and ending

- **Every number is explainable**: clicking any number opens a "Why?" breakdown into contributing causes, each with a source.
- **Ending**: your Taipei metro area vs. the real one, side by side. It lists who benefited and who was left behind, with international reference cases (Vienna, Singapore, Hong Kong).

## Required disclosure

Shown clearly in the UI:

> Initial data and events come from real open data. Policy outcomes are simulated, not predicted.

## Language

- UI text, README, code comments, and all `.kiro` steering and spec documents: English.
- The game itself is bilingual: English and Traditional Chinese (play-loop spec Requirement 12). District, station and landmark names are romanized in English and in Chinese characters in Traditional Chinese.
- Conversation with the user: Traditional Chinese.

## Direction after phase 1 (user decisions 2026-11-23 and 2026-11-24)

The user's long-term design document `docs/design-proposal/Butterfly_City_Hybrid_Game_Design.md` is the source of later phases. Its features are adapted to these decisions:

1. **Real Taipei and New Taipei stay.** The game keeps the 41 real districts and real 2015–2025 history. A fictional build-your-own city is not planned.
2. **Transit construction:** in Historical mode the metro and TOD rules follow real history, and the chain "transit → land value → rent → displacement" is told with real openings (for example the Circular Line, 2020). Player-built transit belongs to Future mode (2026–2036).
3. **Generated text (AI) may be tried** for narration only: news clippings, letters, the CITY CORE advisor's voice. The Engine decides every number; generated text may only use values of the game state and must pass the Banned_Term_List and the `neutrality.md` review. The site is static (GitHub Pages) with no server, so no API key may reach the browser: text is generated at build time, reviewed and committed, unless a server is added later.
4. **One turn is one quarter.** The open data is quarterly; monthly turns are not planned.
5. The player creates a Character and lives in the city they govern (play-loop spec); life decisions are made over time; a partner of any gender; bad endings are allowed and shown as outcomes, not verdicts.

Candidate later phases from the design document, after play-loop, street-change, life-story and polish: city memory and the mystery line (CITY CORE, records that do not match the street, an investigation), citizen groups and opinion by group, endings that weigh several outcomes, then interest groups and council votes.