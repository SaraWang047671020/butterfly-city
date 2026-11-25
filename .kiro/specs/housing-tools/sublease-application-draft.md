# Draft: the sublease Application of the life story (housing-tools task 4.2)

Drafted by Claude Code on 2026-11-25 for the user's approval (Requirement 4.4). Nothing here is in the game yet.

## How it works

| Item | Proposal | Source or assumption |
|---|---|---|
| Who can apply | A renting household whose income is below the city's social housing limit (the 50th-percentile limit already in `application-supply.json`), from 2017 (programme start) | Taipei rental rules 2017: income below the 50th-percentile limit and income per person at most 3.5 × the minimum living expense; Taipei phase 4 application form (2023): 1,630,000 a year |
| When the Life_Event comes | A quarter in which the city matches homes on the Player_Version track, the household rents and is eligible; priority 70 (after the rent subsidy window), cooldown 4 quarters | as the other Application events |
| Odds per track | `min(1, oddsReal × homes matched on the track ÷ homes matched in real history)`, as the other Applications | **oddsReal is a gap:** no count of applicants is published for either city. Taipei UDD (2024) only says supply is short of demand. Proposal: 30 % per quarter, labelled as an assumption |
| The home | In a district of the same city picked like a social housing home; rent = market rent × `sublease.rentShare` (0.85, the Engine's value) | S17, S20 |
| How long | 3-year contract, renewed while the income stays below the limit; at most 9 years, longer than the rest of the game. At a renewal with the income above the limit, the tenancy ends (the tenancy-end Life_Event, sublease texts) | S17 |
| Ending, gender line | Sublease tenants, national: 58 % women (2025-09) | MOI gender statistics, `data/research/life-story-social-housing-2026-11-24.md` |

The rent-pressure Life_Event also gets the option "Register for the sublease programme" (only when eligible).

## Texts (Traditional Chinese / English)

| Key | 繁體中文 | English |
|---|---|---|
| event `subleaseOffer` title | {city}的包租代管有房子可以租 | {city}'s sublease programme has homes to let |
| event text | {city}這一季有民間房子透過包租代管出租，房租最多是市價的 {rentShare}%。{name}的家庭年所得（{income}）低於門檻 {limit}，可以登記承租。 | {city} is letting private homes through the sublease programme this quarter, at no more than {rentShare} % of market rent. {name}'s household income ({income} a year) is below the limit of {limit}, so {name} can register as a tenant. |
| option `notNow` | 先不要 — 繼續在{district}租屋。 | Not now — Keep renting in {district}. |
| option `register` | 登記承租 — 兩個{name}都會登記，抽到同一個號碼，結果在季報公布。媒合到的房子可能在{city}的別區。 | Register — Both versions of {name} register and draw the same number. The result comes with the brief. A matched home can be in another district of {city}. |
| rent-pressure option `sublease` | 登記包租代管 — 只有今年符合資格時才有這個選項。 | Register for the sublease programme — Only when the household is eligible this year. |
| `application.odds.sublease` | 這一季{city}在你的城市透過包租代管媒合了 {supplyPlayer} 戶，真實歷史是 {supplyReal} 戶。機會在你的城市是 {oddsPlayer}%，在真實歷史是 {oddsReal}%（申請人數沒有公開，真實歷史的機會是遊戲的假設）。 | In your city {supplyPlayer} homes were matched in {city} this quarter through the sublease programme; in real history {supplyReal}. The chance was {oddsPlayer} % in your city and {oddsReal} % in real history (the number of applicants is not published, so the real chance is an assumption of the game). |
| `application.result.both.sublease` | 兩個版本的{name}都媒合到了，下一季搬進{homeDistrict}的包租代管房子，房租是市價的 {rentShare}%。 | {name} is matched with a sublease home in {homeDistrict} in both versions and moves in next quarter, at {rentShare} % of market rent. |
| `…playerOnly.sublease` | 在你的城市，{name}媒合到了，下一季搬進{homeDistrict}的包租代管房子。在真實歷史裡沒有媒合到，繼續在{district}租屋。 | In your city {name} is matched with a sublease home in {homeDistrict} and moves in next quarter. In real history {name} is not matched and keeps renting in {district}. |
| `…realOnly.sublease` | 在真實歷史裡，{name}媒合到了{homeDistrict}的包租代管房子。在你的城市媒合的戶數比較少，{name}沒有媒合到，繼續在{district}租屋。 | In real history {name} is matched with a sublease home in {homeDistrict}. In your city, with fewer homes matched, {name} is not matched and keeps renting in {district}. |
| `…neither.sublease` | 兩個版本的{name}都沒有媒合到包租代管的房子。 | {name} is not matched with a sublease home in either version. |
| `…ineligible.sublease` | {name}家今年不符合資格：{rule} | {name}'s household is not eligible this year: {rule} |
| situation (new) | {name}住在{district}的包租代管房子，房租是市價的 {rentShare}%。 | {name} lives in a sublease home in {district}, at {rentShare} % of market rent. |
| ending version (new) | 2025 年底，{name}住在{district}的包租代管房子，從 {since} 起。這十年，房租平均佔家庭收入的 {meanBurden}%。 | At the end of 2025, {name} lives in a sublease home in {district}, since {since}. Over the ten years the rent took {meanBurden} % of household income on average. |
| `ending.gender.sublease` | 包租代管承租人：女性 {share}%（{scope}；{source}）。 | Sublease tenants: {share} % women ({scope}; {source}). |
| tenancy end, sublease title | {name}的包租代管租約到期 | {name}'s sublease tenancy ends |
| tenancy end, sublease text | {name}在{district}的包租代管房子住了 {years} 年。家庭所得已經超過門檻，續約不能再用包租代管的條件。租約下一季到期。 | {name} has lived in a sublease home in {district} for {years} years. The household income is now above the limit, so the contract cannot be renewed on the programme's terms. The tenancy ends next quarter. |
