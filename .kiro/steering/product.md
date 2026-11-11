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

## Player role

- The player is a fictional **joint mayor of Taipei and New Taipei**, controlling all 8 policy tools across both cities.
- Central-government policies (e.g., the New Youth Housing Loan, TPASS, central bank credit controls, interest rate changes) are **events**, not player controls.

## Modes

| Mode | Status | Description |
|---|---|---|
| Historical | **MVP** | 2015 Q1 → 2025 Q4, one turn per quarter, 44 turns. Real events occur on their real dates. |
| Future | Later | 2026 → 2036. Events occur randomly at historical frequencies (seeded). |
| Live | If time allows | Daily news classified into events. Known conflict: requires a scheduled job (e.g., GitHub Actions) to fetch and produce JSON, and a rule-based classifier (no AI). Not designed yet. |

### Turn flow

- Time only advances when the player presses **Next quarter** or **Fast-forward one year**.
- Fast-forward automatically stops at major events.
- Events are shocks only in the MVP; they do not present player choices.
- The player can adjust policies at any time. Every adjustment is recorded on a **policy timeline**.
- Progress is saved in the browser so the player can continue the next day.

## Policy tools (3 domains, 8 tools)

| Domain | Tool |
|---|---|
| Housing | Social housing construction |
| Housing | Sublease and rental management program (包租代管) |
| Housing | Rent subsidy |
| Housing | Vacant / multiple-home holding tax |
| Transit | MRT extension |
| Transit | Commuter pass subsidy |
| Transit | TOD floor-area bonus |
| Environment | Parks, green space, and street trees |

Each tool has: a cost at realistic magnitude, a time lag, primary effects, and cited parameter sources (see `simulation.md`).

At the start, every tool is set to its **real historical value**. The player adjusts up or down from reality.

### Budget

- One budget per year. The total equals the real historical spending on these 8 tools for that year.
- The player can only reallocate within that total. The budget can never be overspent.
- Revenue from the holding tax may flow back into the budget (exact rule defined in the simulation spec).

## Events

- MVP event library: real events from 2015–2025, e.g., the House and Land Consolidated Income Tax, COVID-19, interest rate hikes and cuts, central bank credit controls, TPASS, the New Youth Housing Loan, earthquakes.
- Each event card has: real date, type, affected indicators, impact magnitude measured from data at the time, and source links.
- Event card text describes **what happened only** (see `neutrality.md`).

## Citizens and ghosts (the Halloween theme is functional)

- At the start, the player picks one citizen to follow from 5–6 fixed personas, e.g.:
  - 25-year-old renter living in Zhonghe, commuting to Xinyi
  - Elderly resident living alone in Wanhua
  - Dual-income family in Banqiao
  - Commuter in Tamsui
  - Small shop owner in Da'an
- Each quarter shows the citizen's rent burden, commute time, and where they live.
- Citizen updates are generated from **fixed text templates**. No AI.
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
- District names use romanized English only, e.g., Wanhua, Banqiao, Zhonghe, Da'an.
- Conversation with the user: Traditional Chinese.
