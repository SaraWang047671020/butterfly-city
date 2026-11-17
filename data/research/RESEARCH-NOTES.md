# Research Notes: Events, Parameters, Commute Times

Prepared 2026-11-16 as input for the `event-library` spec, `params.json` and the commute-time matrix. These are notes, not final data. Every row has a **status**:

- **verified**: confirmed by a primary source or several consistent reports (link given).
- **check**: very likely right, but confirm against the named primary source before it goes into a data file.
- **secondary**: the number comes from a summary or news report of a study, not the study itself. Usable as a range end, but cite carefully.
- **gap**: no usable source found yet.

All numbers that go into `params.json` must keep the source link. Contested values are given as low / central / high, per `neutrality.md`.

---

## 1. Event list, Historical mode 2015–2025

Reminder from `simulation.md`: in Historical mode an event never moves an indicator by itself. It is either a **modifier** (it changes how strongly a player's policy difference acts) or **narrative only**.

### 1a. Interest rates (Central Bank)

Exact dates must be taken from the Central Bank file already downloaded (`webF1.csv`, data.gov.tw 6022). Decision day is usually the Thursday board meeting; the new rate applies from the next day.

| Effective date | Change | Discount rate after | Status |
|---|---|---|---|
| 2015-09-25 | cut 0.125 | 1.750% | verified against `cbc-webF1-discount-rate.csv` (2026-11-17) |
| 2015-12-18 | cut 0.125 | 1.625% | verified (file) |
| 2016-03-25 | cut 0.125 | 1.500% | verified (file) |
| 2016-07-01 | cut 0.125 | 1.375% | verified (file) |
| 2020-03-20 | cut 0.125 (COVID) | 1.250% | verified (file); corrected 2026-11-17, earlier draft said cut 0.25 to 1.125% |
| 2022-03-18 | hike 0.125 | 1.375% | verified (file); corrected 2026-11-17, earlier draft said hike 0.25 |
| 2022-06-17 | hike 0.125 | 1.500% | verified (file) |
| 2022-09-23 | hike 0.125 | 1.625% | verified (file) |
| 2022-12-16 | hike 0.125 | 1.750% | verified (file) |
| 2023-03-24 | hike 0.125 | 1.875% | verified (file) |
| 2024-03-22 | hike 0.125 | 2.000% | verified (`DATA-CHECK.md` item 6) |

Suggested role: **modifier**. While rates are rising, a district with more social housing or more subsidized renters than reality is less exposed to the rent increase. Needs a cited modifier parameter (gap, see 2f).

### 1b. Central Bank selective credit controls (mortgage limits)

| Wave | Announced | Main content | Status |
|---|---|---|---|
| 1 | 2020-12-07 (effective 12-08; corrected 2026-11-17, earlier draft said 12-08) | Corporate buyers: first home max LTV 60%, further homes 50%, no grace period; third-plus homes 60%; land loans 65% | verified ([CBC press release](https://www.cbc.gov.tw/tw/cp-302-124848-b6248-1.html)) |
| 2 | 2021-03-18 (effective 03-19) | Corporate buyers 40%; third home 55%; fourth-plus homes 50%; high-value homes 55% | verified ([CBC press release](https://www.cbc.gov.tw/tw/cp-302-132477-e11d9-1.html)) |
| 3 | 2021-09-23 (effective 09-24) | No grace period on second-home loans in the six special municipalities and Hsinchu; land loans 60% | verified ([CBC press release](https://www.cbc.gov.tw/tw/cp-357-141562-49221-1.html)) |
| 4 | 2021-12-16 (effective 12-17) | High-value and third-plus homes 40%; land loans 50% with a commitment to start construction | verified ([CBC press release](https://www.cbc.gov.tw/tw/cp-302-145044-c2737-1.html)) |
| 5 | 2023-06-15 (effective 06-16) | Second home in six special municipalities and Hsinchu: max LTV 70% | verified ([TechNews](https://finance.technews.tw/2023/06/16/the-fifth-wave-of-housing-market-regulation/)) |
| 6 | 2024-06-13 | Second home in special areas: max LTV 60% | verified ([TechNews](https://finance.technews.tw/2024/07/26/the-housing-market-shows-no-signs-of-cooling-down/)) |
| 7 | 2024-09-19 (effective 09-20) | Second home max LTV 50% nationwide; no grace period on first loan for existing owners; corporate, luxury and third-plus homes max 30% | verified ([CNA](https://cna.com.tw/news/afe/202410090292.aspx), [CTEE](https://www.ctee.com.tw/news/20240919701806-430301)) |

Suggested role: **narrative only** in the MVP (these act on buyers, not on the player's tools).

### 1c. Tax and housing law

| Date | Event | Status | Suggested role |
|---|---|---|---|
| 2016-01-01 | House and Land Consolidated Income Tax 1.0 takes effect | verified ([MOF history archive](https://museum.mof.gov.tw/singlehtml/2646203fe1924614b3df4c43bbde02a2?cntId=b7e0a498b02e498c93abd809f6c5a981)) | narrative |
| 2021-07-01 | House and Land Consolidated Income Tax 2.0 (longer holding periods for lower rates) | verified ([MOF](https://www.mof.gov.tw/singlehtml/979b54e408fb499eae3c1d9efe978868?cntId=e8e486a87e6a4489adfb8bdbcb6f33cd)) | narrative |
| 2023-07-01 | Equalization of Land Rights Act amendments: pre-sale contract resale ban, permit system for corporate home purchases, fines up to NT$50 million | verified ([LTN](https://ec.ltn.com.tw/article/breakingnews/4331743), [Business Weekly](https://www.businessweekly.com.tw/business/blog/3011349)) | narrative |
| 2024-07-01 | Holding tax 2.0: non-owner-occupied residential rate range 1.5–3.6% → 2–4.8%, national aggregation of holdings; first bills May 2025 | verified ([cnyes](https://news.cnyes.com/news/id/5414648), [CTEE](https://ctee.com.tw/news/policy/924197.html)) | **this is the player's holding-tax tool**: real value in the policy track, not an event effect |

### 1d. Central housing and transport programs

| Date | Event | Status | Suggested role |
|---|---|---|---|
| 2017-04-18 | Social housing sublease and management (包租代管) pilot approved by the Executive Yuan for the six special municipalities (10,000 homes over 3 years); all six had started by January 2018. Earlier draft gave only "2017" | verified ([MOI report to the Executive Yuan, 2018-06-21](https://www.ey.gov.tw/File/163B867C023309D1?A=C)); also [NLMA PDF](https://www.nlma.gov.tw/uploads/files/ff7affc3e0db7ba1b01b8dc7bca9e5d9.pdf) | player tool (policy track) |
| 2018-04-16 | Taipei–New Taipei NT$1,280 30-day pass (MRT, city buses, first 30 min YouBike free) | verified ([NTPC Q&A PDF](https://www.traffic.ntpc.gov.tw/userfiles/1130901/files/1070315-%E5%AE%9A%E6%9C%9F%E7%A5%A8QA(%E4%BF%AE).pdf), [TVBS](https://news.tvbs.com.tw/life/1010600)) | player tool (commuter pass track) |
| 2022-07-01 | NT$30 billion expanded central rent subsidy: applications open; target 500,000 households (from about 120,000); first payments October 2022; top-ups for ages 20–35 (×1.2), newlyweds (×1.3), families with children (×1.4–1.8) | verified ([TechNews](https://finance.technews.tw/2022/06/30/expanded-rental-subsidy-program/), [GVM](https://city.gvm.com.tw/article/88542)) | player tool (rent subsidy track) |
| 2023-07-01 | TPASS Keelung–Taipei–New Taipei–Taoyuan NT$1,200 pass usable (sales from 06-15) | verified ([CNA](https://www.cna.com.tw/news/ahel/202306150164.aspx)) | commuter pass track (central); see open question 8 in the engine spec |
| 2023-08-01 | New Youth Housing Loan (新青安): max loan NT$10 million, 40 years, 5-year grace period, subsidized rate 1.775% | verified ([GVM](https://www.gvm.com.tw/article/104998), [cnyes](https://m.cnyes.com/news/id/5659125)) | narrative (or modifier on sale prices if wanted later) |
| 2024-08 | Central Bank asks banks to set their own targets for total real-estate lending; several banks limit new mortgage lending (real-estate loans 37.61% of total lending at end of June 2024) | verified, month only ([CBC report](https://www.cbc.gov.tw/dl-223320-cbe9df80e89d4cf49b52d17e1cec140b.html), [UDN](https://money.udn.com/money/story/5613/9761283)) | narrative |

### 1e. Shocks and rail openings

| Date | Event | Status | Suggested role |
|---|---|---|---|
| 2017-03-02 | Taoyuan Airport MRT opens (stations in New Taipei: Sanchong, Xinzhuang, Taishan, Linkou) | verified ([Taoyuan Metro](https://www.tymetro.com.tw/tymetro-new/tw/_pages/news/show-343-31.html)) | baseline (commute matrix changes) |
| 2018-12-24 | Danhai LRT first section opens (Tamsui; ceremony 12-23, passenger service from 12-24) | verified ([New Taipei Metro](https://ntmetro.com.tw/news/?id=794&mode=data&parent_id=10436&type_id=10449)) | baseline |
| 2020-01-31 | MRT Circular Line first section opens (Xindian–Zhonghe–Banqiao–Xinzhuang) | verified ([New Taipei DORTS](https://www.dorts.ntpc.gov.tw/about/route/zj6Dd5ajdA1o)) | baseline |
| 2020-01-21 | First COVID-19 case in Taiwan (earlier draft gave only "2020-01") | verified ([CDC](https://www.cdc.gov.tw/Bulletin/Detail/6oHuoqzW9e_onW0AaMEemg?typeid=9)) | narrative |
| 2021-05-15 | COVID-19 Level 3 alert in Taipei and New Taipei (nationwide 05-19; lowered 07-27) | verified ([CDC 05-15](https://www.cdc.gov.tw/Bulletin/Detail/E7bi2j8UYj1Rmz73OPE7Yg?typeid=9), [05-19](https://www.cdc.gov.tw/Bulletin/Detail/abDtRS-xzztQeAchjX9fqw?typeid=9), [07-27](https://www.cdc.gov.tw/Bulletin/Detail/e0v8zImE3rGJ0072A86NHA?typeid=9)) | narrative; possible modifier on commuter pass effect (ridership collapsed) |
| 2023-02-10 | Ankeng LRT opens (Xindian) | verified ([New Taipei Metro](https://www.ntmetro.com.tw/basic/?mode=detail&node=578)) | baseline |
| 2024-04-03 | Hualien earthquake, magnitude 7.1 (CWA report No. 019; centred in Shoufeng; intensity 5- in Taipei and New Taipei). Corrected 2026-11-17, earlier draft said M7.2 | verified ([CWA](https://scweb.cwa.gov.tw/zh-tw/earthquake/details/2024040307580971019)) | narrative |

---

## 2. Parameters for the 5 tools

### 2a. Social housing construction

| Parameter | Low / central / high | Source | Status |
|---|---|---|---|
| Unit cost per dwelling, Taipei | NT$5.45 M / 7.8 M / 8.6 M | Computed from project totals: Jingfeng (NT$490 M, 90 units), Dongxin (NT$690 M, 88 units), Peiying budget (NT$822.7 M, 96 units) ([Storm](https://www.storm.mg/article/3088809), [CNA](https://www.cna.com.tw/news/aloc/202512040148.aspx), [Control Yuan PDF](https://www.cy.gov.tw/AP_Home/Op_Upload/eDoc/%E5%87%BA%E7%89%88%E5%93%81/109/1090000021010801895p.pdf)) | secondary (3 projects only; better: Taipei UDD budget) |
| Construction lag (start → completion) | derive from data | **Use the NLMA portal start and completion dates already downloaded** (`DATA-CHECK.md` item 5): median and quartiles of completed projects. Better than the 3–5 year guess in the brief. | to compute in the pipeline |
| Effect on nearby sale prices | −2.5% / 0 / +6.5% | Diamond & McQuade (2019), JPE 127(3): +6.5% in low-income areas, −2.5% in high-income areas, average about 0; effect within 0.1 mile ([NBER w22204](https://www.nber.org/papers/w22204)). A Taipei Wenshan study found a positive premium within 1 km ([NCCU thesis](https://thesis.lib.nccu.edu.tw/thesis/detail/ae095418e323335227b07060f76eb4f7)). | verified (US); Taiwan evidence thin |

Suggestion: keep the spillover central value at 0. The main channel in the model should be direct: households housed below market rent, so fewer cross the rent-burden threshold.

### 2b. Sublease and management (包租代管)

| Parameter | Value | Source | Status |
|---|---|---|---|
| Tenant rent | 80% of market rent; disadvantaged households 50–70% | [CNA, Kaohsiung program](https://www.cna.com.tw/news/aloc/202110270245.aspx), [Money Weekly](https://www.moneyweekly.com.tw/_Article?AID=59942) | secondary; confirm in the NLMA program rules |
| National units in program | > 109,000 | NLMA, reported 2026 ([CTEE](https://www.ctee.com.tw/news/20260430701027-430104)) | secondary |
| Landlord incentives | tax-free amount NT$15,000 per unit per month (Taipei tax comparison table) | [Taipei PDF](https://www-ws.gov.taipei/001/Upload/336/relfile/16016/4068/3ad22b1d-9504-4f75-ac4a-7acd1101d08c.pdf) | secondary |
| Cost per unit to government (service fees, rent gap, insurance) | gap | NLMA program plan | gap |

### 2c. Rent subsidy

| Parameter | Low / central / high | Source | Status |
|---|---|---|---|
| National budget and coverage after 2022 | NT$30 billion a year, 500,000 households | [TechNews](https://finance.technews.tw/2022/06/30/expanded-rental-subsidy-program/) | verified |
| Pass-through to market rent (share of subsidy captured by landlords) | 0.16 / 0.50 / 0.78 | France about 78% (Fack 2006; Laferrère & Le Blanc 2004, 50–80%); UK about 50% (Gibbons & Manning 2006); US about 16%. Summarized in a 2023 LIS paper ([Bérard](https://www.lisdatacenter.org/wp-content/uploads/files/2023-LIS2ER-B%C3%A9rard.pdf)) and Finnish work ([VATT WP 149](https://www.doria.fi/bitstream/handle/10024/185961/vatt-working-papers-149-the-incidence-of-housing-allowances--quasi-experimental-evidence.pdf)) | secondary for UK and US; read the original papers before citing exact numbers |

Contested, so it must stay a range (`neutrality.md`). No Taiwan estimate found.

### 2d. Holding tax (囤房稅)

| Parameter | Value | Source | Status |
|---|---|---|---|
| Real rates | 1.5–3.6% before 2024-07-01; 2–4.8% after; six special municipalities start at 3.2% (≤ 2 homes) up to 4.8% (7+ homes) per the MOF draft | [cnyes](https://news.cnyes.com/news/id/5414648), [yam](https://n.yam.com/Article/20240216497353) | verified (draft levels: check final Taipei and New Taipei ordinances) |
| Effect on vacancy | central: vacancy falls by 13% of its level (France, 1999 vacancy tax), effect twice as large where vacancy started high | Segú (2020), J. Public Economics 185 ([IDEAS](https://ideas.repec.org/a/eee/pubeco/v185y2020ics0047272719301409.html)) | verified (abstract) |
| Upper reference | Vancouver Empty Homes Tax: declared vacant homes −36% (2017→2021), −67% (2017→2024) | City of Vancouver annual reports ([2021](https://vancouver.ca/files/cov/vancouver-2021-empty-homes-tax-annual-report.pdf), [2025](https://vancouver.ca/files/cov/2025-empty-homes-tax-annual-report.pdf)) | verified, but descriptive, not causal, and the tax is much higher than Taiwan's |

**New data source to add:** MOI "low-use (electricity) housing" statistics (低度使用(用電)住宅), **every half year, by district**: homes with average use ≤ 60 kWh per month. This is the natural vacancy baseline for the holding-tax tool, and the 2024-07 reform gives a possible second backtest. ([UDN](https://money.udn.com/money/story/5621/9339429), [NOWnews](https://www.nownews.com/news/6792559)). Status: check that district tables go back to 2015.

Note on units: Segú's tax is a share of rental value, Taiwan's is a share of assessed house value. The conversion needs a documented assumption; flag it in `params.json`.

### 2e. Commuter pass subsidy

| Parameter | Low / central / high | Source | Status |
|---|---|---|---|
| Fare elasticity of transit ridership | −0.2 / −0.3 / −0.5 | Simpson–Curtin rule (−0.3); Litman, *Transit Price Elasticities and Cross-Elasticities* (2004, updated), long-run values higher ([VTPI](https://www.vtpi.org/tranelas.pdf), [JPT](https://digitalcommons.usf.edu/jpt/vol7/iss2/3/)) | verified for −0.3; read Litman's table for the range ends |
| Observed: 1,280 pass (2018) | MRT + buses +3.3% in year 1; Taipei DOT: +65,976 MRT trips per day | [Business Today](https://www.businesstoday.com.tw/article/category/183027/post/201904250012/), [Newtalk](https://newtalk.tw/news/view/2019-11-27/332324) | secondary |
| Observed: TPASS (2023) | Taipei Metro +22% year on year in the first month (with post-COVID recovery mixed in); New Taipei Metro +24% in 2023 | [CNA](https://www.cna.com.tw/news/ahel/202308010407.aspx), [NTPC DORTS PDF](https://www.dorts.ntpc.gov.tw/cdn/file/20260821/95396612-4f8a-40cc-9e2d-fd55818f57f4.pdf) | secondary; **compute the backtest from our own MRT data instead** |

For the backtest (engine spec Requirement 20), the observed effect should come from `history.json` MRT entries around 2023-07, with 2019 as a pre-COVID comparison, because 2022 was still depressed by COVID.

### 2f. Ghost thresholds and modifiers

| Parameter | Value | Source | Status |
|---|---|---|---|
| Rent burden: burdened | > 30% of income | HUD definition ([HUD User](https://www.huduser.gov/portal/node/10587), [CRS R48450](https://www.everycrsreport.com/reports/R48450.html)) | verified |
| Rent burden: severely burdened | > 50% of income | same | verified |
| Taiwan reference | MOI mortgage burden: ≤ 30% reasonable, 30–40% slightly low, 40–50% low, > 50% too low | [GVM](https://www.gvm.com.tw/article/85847) | secondary; cite MOI's own release |
| Commute: tolerable one-way time | about 45 min (survey-based) | [TVBS](https://news.tvbs.com.tw/life/832402) | secondary; original study unknown |
| Commute: observed New Taipei → Taipei | about 57 min | MOTC daily transport survey, reported by TVBS (2017) | secondary |
| Rate-rise modifier on policy effects | gap | none found | gap: either drop rate events to narrative only, or document an assumption |

Suggested ghost rule: rent ghost above 50% (severe) and "at risk" between 30% and 50%; commute ghost above 60 min one way, range 45–60.

---

## 3. Commute-time matrix (41 × 41)

### What exists

- **No open district-to-district commute-time table** was found. The 2020 census asks about place of work, but the district-level tables could not be located (gap).
- **TDX** (MOTC transport data platform) publishes metro data, including station-to-station travel time for Taipei Metro, behind a **free API key** after registration. Status: check the exact endpoint name in the TDX API docs.
- **Taipei Metro's own API** needs a membership application by e-mail (about 10 working days) ([metro.taipei](https://www.metro.taipei/cp.aspx?n=BDEB860F2BE3E249)). Too slow to rely on.
- City-level calibration point: New Taipei residents commuting to Taipei take about 57 minutes (see 2f).

### Recommended method (estimated, documented)

For each pair of districts *i → j* and each quarter, take the faster of two modes:

1. **Rail**: walk or feeder from the centroid of *i* to its nearest open station + in-vehicle time on the rail network (shortest path over station-to-station times, plus a transfer penalty) + from the station nearest the centroid of *j* to that centroid.
2. **Road**: centroid-to-centroid straight-line distance × a detour factor ÷ an average urban speed + a fixed access time.

Inputs and their sources:

| Input | Source |
|---|---|
| District centroids | already built by `data-pipeline` (`districts.json`) |
| Station coordinates and opening dates | the station → district table from `data-pipeline` task 9 |
| Station-to-station times | TDX (free key) **or**, if no key: station count × average inter-station time from the published timetable; document the value |
| Transfer penalty, walking speed, detour factor, road speed, access time | cited planning values; each one a `params.json` row with a source |

Properties:
- The matrix changes when a line opens (2017-03 Airport MRT, 2018-12 Danhai LRT, 2020-01 Circular Line, 2023-02 Ankeng LRT), which matches `simulation.md` ("the matrix follows the real rail network of each quarter").
- Every value is `estimated: true` with a Method_Id.
- Sanity check: the population-weighted average from New Taipei districts to Taipei districts should land near the 57-minute survey figure. Report the difference in `SOURCES.md`; do not tune to it.

Suggested place: a small separate spec or a final task group in `data-pipeline`, producing `public/data/commute.json`.

---

## Decisions (2026-11-16)

1. **TDX key**: Sara registers a free TDX key for real station-to-station times. The key is kept only in the local environment variables `TDX_CLIENT_ID` and `TDX_CLIENT_SECRET`, never in the repository.
2. **Low-use housing statistics**: added as a data source (vacancy baseline for the holding-tax tool, and a possible second backtest around the 2024-07 holding tax 2.0).
3. **Rate-rise modifier**: no source found, so interest-rate events are **narrative only** in the MVP.
4. **Commuter-pass backtest**: the observed effect comes from our own MRT data, 2023 compared with 2019 (not 2022, which was still depressed by COVID).
