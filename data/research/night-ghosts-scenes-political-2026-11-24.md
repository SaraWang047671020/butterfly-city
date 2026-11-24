# Historical scene database: political and conflict memory sites (Taipei / New Taipei)

Access date for every source below: **2026-11-24**.
Status key: **official** = government agency, gazette, Control Yuan, cultural-heritage registry or public university; **secondary** = reputable news (CNA, PTS, Taipei Times/LTN, CommonWealth) or a published memoir.

## Method notes (read first)

- **Coordinates.** I took coordinates in this order of preference:
  1. The official heritage registry: the 文化部文化資產局 open dataset behind 國家文化資產網 (nchdb). Datasets used: https://data.boch.gov.tw/opendata/v2/assetsCase/1.1.json (古蹟), `1.2.json` (歷史建築), `1.4.json` (紀念建築), `2.1.json` (考古遺址), `3.1.json` (文化景觀) and `3.2.json` (史蹟). Each record has `longitude` and `latitude`.
  2. OpenStreetMap, through the Nominatim search API.
  3. Wikipedia (zh or en) page coordinates, through the MediaWiki API.

  Every coordinate has been rounded to 5 decimals. Where a site has no single point (for example a cemetery or a battlefield), this is stated.
- **促轉會 gazette.** The gazette PDF named in the brief (行政院公報 第028卷第027期, 2022-02-14) is 促轉會公告 111年2月9日 促轉二字第1115200018號: **白色恐怖不義遺址 17處**. Its text layer is not machine-readable, so I rendered the pages and read them. Page numbers are cited as "gazette p.X". Its Taipei / New Taipei entries are:
  - 安康接待室
  - 新店軍人監獄 / 保安司令部軍法處看守所安坑分所
  - 景美 (新店二十張)
  - 原臺灣警備總司令部保安處看守所 (臺北博愛路)
  - 原國防部保密局臺北看守所
  - 原空軍總司令部軍法處 (仁愛路)
  - 原調查局誠舍 / 臺北監獄 (愛國東路)
  - 原刑警總隊拘留所 (寧夏路)
  - 原馬場町刑場
  - 原極樂公墓 (六張犁)

  It does **not** list 東本願寺, 青島東路三號 or 安坑刑場.
- **The 228 batch.** The 25-site 228 batch is a separate announcement (reported as 111年2月17日 促轉二字第1115200029號). I could not open that gazette. It is cited only through Executive Yuan and PTS reports.
- **Names.** I left out all individual names except where a name is part of an official site or event name (陳文成事件, 鄭南榕紀念館, 林宅血案 / 林義雄宅). No politician is named except inside an official site or report title.

---

## 1.1 頂下郊拚 (1853, 艋舺 → 大稻埕)

**Location.** There is no single battle site. Three officially registered places are tied to the event.

| Pin | Address | Lat, Lon | Coordinate source |
|---|---|---|---|
| 艋舺龍山寺 (國定古蹟), base of the 三邑 side | 臺北市萬華區廣州街211號 | 25.03678, 121.49993 | nchdb open data, caseId 20181206000001 |
| 艋舺清水巖 (直轄市定古蹟), burned in the fight | 臺北市萬華區康定路81號 | 25.04032, 121.50214 | nchdb open data, caseId 19850819000015 |
| 台北霞海城隍廟 (直轄市定古蹟), destination of the 同安 refugees | 臺北市大同區迪化街一段61號 | 25.05560, 121.51017 | nchdb open data, caseId 19850819000011 |

The original 八甲莊 temple site: **not found** (no coordinate source).

**Investigation steps**
1. **What the place was.** 艋舺 was a Qing-era river-port town settled by 泉州三邑 and 同安 migrants. Its temples were tied to the merchant guilds (郊) and to local affairs.
   - Source: 國家文化資產網「艋舺龍山寺」指定理由／歷史沿革, https://nchdb.boch.gov.tw/assets/advanceSearch/monument/20181206000001 (official)
2. **What happened and when.** In 咸豐3年 (1853) the 「頂下郊拚」 broke out over control of the 艋舺 wharves and their levies. The 三邑 side attacked the 同安 side's stronghold, and the 同安 people withdrew to 大稻埕.
   - Source: same 艋舺龍山寺 record (official)
3. **What was lost.** 艋舺清水巖 (built 1787) was destroyed in the 1853 fighting and rebuilt in 1867. The 霞海城隍 temple at 八甲莊 burned. Believers carried the statue out of the fire to 大稻埕.
   - Sources: 國家文化資產網「艋舺清水巖」, https://nchdb.boch.gov.tw/assets/advanceSearch/monument/19850819000015 (official); 「台北霞海城隍廟」, https://nchdb.boch.gov.tw/assets/advanceSearch/monument/19850819000011 (official)
4. **People affected.** The 大稻埕 temple also honours the 「三十八義勇公」, described as those killed in an attack while escorting the statue from 艋舺 to 大稻埕. No other casualty figure was found.
   - Source: 台北霞海城隍廟 record (official)
5. **Today.** The 霞海城隍廟 was built at its present site in 1859. Its 五月十三迎城隍 procession is a registered folk custom.
   - Sources: 台北霞海城隍廟 record (official); 國家文化資產網 民俗「台北霞海城隍廟五月十三迎城隍」, https://nchdb.boch.gov.tw/assets/advanceSearch/folklore/20100726000001 (official; record name and address only seen)

**Room for invention.** Do not invent a death toll, named fighters or dialogue. The only sourced number is the honorific 38 in 「三十八義勇公」. Both communities' temples are active today, so present it as an inter-group conflict with no villain side. Generic period atmosphere (wharf, fire, carrying a statue) is safe.

---

## 1.2 滬尾之役 (1884, 淡水)

**Location**

| Pin | Address | Lat, Lon | Coordinate source |
|---|---|---|---|
| 清法戰爭滬尾古戰場城岸遺蹟 (歷史建築), the battlefield earthworks at 沙崙 | 新北市淡水區中正路 (several segments) | 25.18770, 121.41881 | nchdb open data, caseId 20130130000001 |
| 滬尾礮臺 (國定古蹟), built **after** the war | 新北市淡水區中正路一段6巷31號 | 25.17902, 121.42957 | nchdb, caseId 19850819000043; Wikipedia gives 25.17901, 121.42956 |
| 滬尾湖南勇古墓 (直轄市定古蹟) | 中正東路與竿蓁一街交叉口斜坡上 | 25.16570, 121.44959 | nchdb, caseId 19980829000006 |

**Investigation steps**
1. **What the place was.** 淡水 was northern Taiwan's main port and the river gateway to 臺北府城. Qing forces had built batteries at 沙崙, 中崙 and 油車口.
   - Source: 國家文化資產網「滬尾礮臺」, https://nchdb.boch.gov.tw/assets/advanceSearch/monument/19850819000043 (official)
2. **Defences.** In 1884 the defenders sank stone-filled boats at the narrowest point of the river mouth and laid mines, buoys and nets. They also piled sand-earth walls (城岸) about 4 m high at 沙崙.
   - Source: 國家文化資產網「清法戰爭滬尾古戰場城岸遺蹟」, https://nchdb.boch.gov.tw/assets/advanceSearch/historicalBuilding/20130130000001 (official)
3. **What happened and when.** In October 1884 French ships attacked 滬尾. The heritage record says both sides fought hard here with heavy casualties. The landing date of **8 October 1884** at the 沙崙 beach comes only from secondary sources.
   - Official source: 城岸遺蹟 record above
   - Secondary sources for the date: 天下雜誌 Smile Taiwan, 「走入淡水1884年經典戰役」, https://smiletaiwan.cw.com.tw/article/4017 (secondary; seen in search results only)
   - Casualty numbers: **not found** in an official source
4. **People.** The 擢勝營 (Hunan troops) and local militia took part. Six 擢勝營 soldiers who died in 淡水 in 1881 (before the war) are buried at the 湖南勇古墓. Their names are recorded in the official heritage record.
   - Source: 國家文化資產網「滬尾湖南勇古墓」, https://nchdb.boch.gov.tw/assets/advanceSearch/monument/19980829000006 (official)
5. **Today.** After the war the coast was refortified. 滬尾礮臺 (gate inscription 「北門鎖鑰」) was finished around 1889, never saw combat, and is now an open monument. The earthworks are cut by roads into four segments.
   - Source: 滬尾礮臺 and 城岸遺蹟 records (official)

**Room for invention.** Do not invent casualty counts, French or Qing soldiers' words, or a "glorious victory" framing. This is a foreign war, not a political-blame topic, but keep it descriptive. 滬尾礮臺 is post-war, so do not stage the battle inside it.

---

## 1.3 芝山巖事件 (1896, 士林)

**Location**

| Pin | Address | Lat, Lon | Coordinate source |
|---|---|---|---|
| 芝山岩惠濟宮 (直轄市定古蹟), where the early Japanese school was set up | 臺北市士林區至誠路一段326巷26號 | 25.10300, 121.53072 | nchdb, caseId 19850819000021 |
| 「六氏先生墓」 | 芝山公園 | 25.10323, 121.53237 | OpenStreetMap way 260043156 |

Also registered: 芝山岩考古遺址 (國定) at 25.10333, 121.53133 (nchdb, caseId 20250602000001).

**Investigation steps**
1. **What the place was.** 芝山岩惠濟宮 (built 1752–1764) housed a 義學 in the Qing era. At the start of Japanese rule a 國語傳習所 (Japanese-language school) was set up here.
   - Source: 國家文化資產網「芝山岩惠濟宮」, https://nchdb.boch.gov.tw/assets/advanceSearch/monument/19850819000021 (official). This record's wording on the attack date is unclear. Use the date in step 2.
2. **What happened and when.** On 1 January 1896 six Japanese education-department staff were attacked and killed here by an armed group.
   - Source: nippon.com, 片倉佳史「芝山巖事件和平井數馬」, 2022-09-16, https://www.nippon.com/hk/japan-topics/g02191/ (secondary)
3. **People.** The number is six. Their names appear on Japanese-era memorials, but these are not official Taiwanese memorial records, so this file gives no names. The official record describes local resentment of the school (「鄉人仇之」). The colonial government presented the six as martyrs. Interpretations conflict.
   - Sources: nchdb 惠濟宮 (official); nippon.com (secondary)
4. **Today.** The hill is 芝山公園 / 芝山岩 with a nationally designated archaeological site. The record says it was designated a 史蹟 in 1933 and a 二級古蹟 cultural-history park was set up in 1993.
   - Source: 國家文化資產網「芝山岩考古遺址」, https://nchdb.boch.gov.tw/assets/advanceSearch/archaeologicalSite/20250602000001 (official)

**Room for invention.** This history is **contested**: martyrs in the colonial narrative versus anti-colonial resistance in postwar narratives. Present both framings as historical interpretations and take no side. Do not invent the attackers' identities, motives or words, or the victims' last words.

---

## 1.4 緝菸血案 / 天馬茶房 (1947-02-27, 大稻埕)

**Location.** 原天馬茶房前 (sidewalk). Reported address: 臺北市大同區南京西路189號 (Taipei Times). A CommonWealth article puts the marker at 南京西路187號; the two numbers conflict.

| Pin | Lat, Lon | Coordinate source |
|---|---|---|
| Node 「天馬茶房」 | 25.05400, 121.51208 | OpenStreetMap node 2112377307 |
| 「二二八事件引爆地紀念碑」 | 25.05396, 121.51246 | OpenStreetMap node 4524864136 |

**Investigation steps**
1. **What the place was.** A teahouse on 南京西路 (then 太平町) in 大稻埕. The original building was demolished in 2005. The present building is an ordinary apartment block bearing the teahouse sign.
   - Source: Taipei Times, "Tracing the footsteps of 228" (via LTN), https://news.ltn.com.tw/news/focus/breakingnews/3454279 (secondary)
2. **What happened and when.** On the evening of 27 Feb 1947, Monopoly Bureau investigators and police seized contraband cigarettes from an elderly woman vendor and struck her. In the commotion a bystander was shot and killed.
   - Source: same Taipei Times article (secondary). The official 228 Foundation (228.org.tw) pages could not be retrieved (HTTP 400).
3. **People.** One vendor injured and one bystander killed. The names appear in many accounts but were not confirmed from an official memorial record, so they are left out.
4. **Memorial status.** The 促轉會 named 「天馬茶房」 among the first 25 不義遺址 tied to the 228 Incident. A Chinese / English plaque marking the "flash point of the 228 Incident" stands just east of the site.
   - Sources: PTS「促轉會正式公告首批不義遺址 共25處與228事件有關」, https://news.pts.org.tw/article/519105 (secondary); Taipei Times as above (secondary)

**Room for invention.** No dialogue for the vendor, the bystander or the officers. Do not stage the shooting. Use only the plaque, the street and the evening. Families are alive. Accounts differ on details (which officer fired, where exactly), so avoid them.

---

## 1.5 專賣局臺北分局 (1947-02-28)

**Location.** 原辰馬商會本町店鋪 (歷史建築), today 彰化銀行臺北分行, 臺北市中正區重慶南路一段25、27號.

- 25.04562, 121.51336 (nchdb open data, caseId 20121029000001)
- Cross-check: OpenStreetMap 「彰化商業銀行」, 27 重慶南路一段, gives 25.04562, 121.51340

**Investigation steps**
1. **What the place was.** Built in 1929 and transferred in 1935 to 株式會社辰馬商會 as its 本町 shop. It became state property after 1945 and has been used by 彰化銀行臺北分行 since 1968.
   - Source: 國家文化資產網「原辰馬商會本町店鋪」, https://nchdb.boch.gov.tw/assets/advanceSearch/historicalBuilding/20121029000001 (official)
2. **What happened and when.** During the 1947 228 Incident the building was run by the 專賣局 and was surrounded by protesting crowds. The registry lists this as a reason for its protection.
   - Source: same record, registerReason 2 (official)
3. **Detail.** On 28 Feb 1947 most staff had fled. Protesters took items out of the office and burned them in the street, then moved south.
   - Source: Taipei Times "Tracing the footsteps of 228", https://news.ltn.com.tw/news/focus/breakingnews/3454279 (secondary)
   - A secondary claim that 2 people were killed and 4 injured here was **not confirmed** from an official source, so it is left out.
4. **Today.** It is a working bank branch and a registered 歷史建築 (2012, 北市文化二字第10130396200號).
   - Source: nchdb record (official)

**Room for invention.** The building is a working bank today, so do not depict bank staff or customers as connected to 1947. No invented victims at this spot. Casualty figures here are disputed.

---

## 1.6 長官公署前 (1947-02-28, today 行政院)

**Location.** 行政院 (國定古蹟), 臺北市中正區忠孝東路一段1號.

- 25.04576, 121.52012 (nchdb open data, caseId 19980730000003)
- Cross-checks: OpenStreetMap gives 25.04628, 121.52099; Wikipedia gives 25.04639, 121.52097

**Investigation steps**
1. **What the place was.** Built as 臺北市役所 and completed in 1941. After the war it became 臺灣省行政長官公署, the island's highest administrative office.
   - Source: 國家文化資產網「行政院」指定理由, https://nchdb.boch.gov.tw/assets/advanceSearch/monument/19980730000003 (official)
2. **What happened and when.** In the 1947 228 Incident, office guards fired machine guns at the crowd in front of the building, causing deaths and injuries. In May 1947 the office was dissolved and reorganised as 臺灣省政府.
   - Source: same record (official)
3. **People.** The official sources give no casualty number ("傷亡" / "死傷" only). Leave the number blank (**not found**).
   - Sources: nchdb (official); CNA 2024-02-26, https://www.cna.com.tw/news/aipl/202402265002.aspx (secondary)
4. **Memorial.** Designated a 不義遺址 in 2022 as 「臺灣省行政長官公署暨廣場」. On 2024-02-26 the Executive Yuan unveiled 3 site markers. Each shows the date, place, an account of events and oral testimony, plus a QR code to the 不義遺址 database.
   - Source: 行政院新聞稿「政院揭不義遺址標示」(2024-02-26), https://www.ey.gov.tw/Page/9277F759E41CCD91/4be85f53-f0c4-4d0c-953b-db1a9e28d6d8 (official)

**Room for invention.** This is a working government building. The game must not show present-day staff or offices as perpetrators. Show only the plaza at night and the official markers. No invented shooters or victims and no casualty number.

---

## 1.7 臺灣廣播電臺, 新公園 (today 臺北二二八紀念館)

**Location.** 臺北放送局 (直轄市定古蹟), 臺北市中正區凱達格蘭大道3號, inside 二二八和平紀念公園.

- 25.04038, 121.51561 (nchdb open data, caseId 20200904000001)
- Cross-checks: OpenStreetMap gives 25.04037, 121.51555; Wikipedia gives 25.04041, 121.51557

**Investigation steps**
1. **What the place was.** 臺北放送局 was built in the 1930s, designed by 栗山俊一. Its loudspeaker pavilion (放送亭) carried the 15 Aug 1945 surrender broadcast.
   - Source: 國家文化資產網「臺北放送局」, https://nchdb.boch.gov.tw/assets/advanceSearch/monument/20200904000001 (official)
2. **What happened.** During the 228 Incident the station was used both by party, government and military figures to announce policy, and by people's representatives to report on how the incident was being handled.
   - Source: same record, registerReason 3 (official)
3. **Today.** The building opened as the Taipei 228 Memorial Museum on 28 Feb 1997. It was designated a municipal monument in 2020 (北市文化文資字第10930200601號).
   - Sources: Taipei Times 2013-02-28, https://www.taipeitimes.com/News/feat/archives/2013/02/28/2003555884 (secondary; opening date seen in search result only); nchdb (official, for the designation)

**Room for invention.** Do not script specific broadcasts or invent what was said on air. Only the documented functions are known: government announcements and reports by representatives. Use the radio as an object (static, an empty microphone) with no invented speech.

---

## 1.8 四六事件 (1949, 臺大 / 師院)

**Location.** No official memorial pin was found.

| Pin | Lat, Lon | Coordinate source |
|---|---|---|
| 國立臺灣師範大學 (then 臺灣省立師範學院) campus | 25.02591, 121.52749 | Wikipedia |
| 國立臺灣大學 campus | 25.01638, 121.53679 | Wikipedia |

The exact dormitory buildings are **not found**.

**Investigation steps**
1. **What the places were.** National Taiwan University and the Taiwan Provincial Normal College, the two main universities in Taipei in 1949.
   - Source: Taipei Times, "Minister apologizes to April 6 Incident victims", 2001-01-12, https://www.taipeitimes.com/News/local/archives/2001/01/12/0000069434 (secondary)
2. **What happened and when.** In March 1949 two students riding one bicycle were stopped by police, and students from both schools protested. On the night of 5–6 April 1949 military police arrested students, including at the normal college's dormitories.
   - Source: Newtalk 2020-04-06, https://newtalk.tw/news/view/2020-04-06/386677 (secondary; seen via search results)
3. **People.** Arrest figures conflict between sources: Taipei Times reports 21 at NTU and 7 at the normal college under the initial warrant, with "several hundred" arrested overall, while other compilations give different totals. Treat all numbers as **contested** and do not show them.
   - Source: Taipei Times 2001 (secondary)
4. **Remembered.** In January 2001 the Minister of Education formally apologised to victims and families. Both university presidents said the incident would be recorded in their school histories.
   - Source: Taipei Times 2001 (secondary)
   - Scholarly reference (not opened): 陳翠蓮、李鎧揚《四六事件與台灣大學》, 臺大出版中心, 2018

**Room for invention.** No official 不義遺址 record was found. Students' families and alumni are alive, and the roles of the then university heads are debated. Do not name or portray administrators. No invented student speeches. Campus at night with archive documents only.

---

## 1.9 保安處, 東本願寺 (西門町)

**Location.** Former 東本願寺 臺北別院, today 獅子林商業大樓, 臺北市萬華區西寧南路36號.

- 25.04534, 121.50638 (OpenStreetMap way 249841159)

**Investigation steps**
1. **What the place was.** A Japanese 淨土真宗 (Higashi Honganji) temple. An Indian-style main hall was built in 1936 after a 1930 fire.
   - Source: Taipei Times, Han Cheung, "Taiwan in Time: From place of worship to palace of hell", 2021-03-14, https://www.taipeitimes.com/News/feat/archives/2021/03/14/2003753793 (secondary)
2. **What happened and when.** The military took over the building in 1946. Until 1967 it was used as a detention and interrogation centre, mostly for political prisoners. The article uses the Taiwan Garrison Command name. Other accounts say "保安處", and the agency naming is not confirmed officially.
   - Source: same article (secondary)
3. **People.** No sourced total of detainees was found. The article reports about 20 people held in a 10 m² space; this is a reported detail, not an official figure.
   - Source: same article (secondary)
4. **Today and status.** The temple was demolished, and the 獅子林 commercial building was completed in 1976. 國家人權博物館 listed 「台北東本願寺」 among 45 White Terror historical sites in 2020. It is **not** in the 2022 gazette batch of 17 不義遺址.
   - Sources: Taipei Times (secondary); PTS 「「不義遺址」史蹟點 人權博物館認列45處」, 2020-01-17, https://news.pts.org.tw/article/463335 (secondary)
   - Demolition and move dates differ between accounts (1967 vs 1979)

**Room for invention.** It is a privately owned commercial building today. Do not connect present businesses to the past. No invented interrogations or prisoner voices. Named victims (for example 228-era figures) appear only in non-official accounts, so leave them out.

---

## 1.10 青島東路三號, 軍法處看守所

**Location.** Former 軍法處 compound at 青島東路3號. Its present-day location is approximately 臺北喜來登大飯店, 臺北市中正區忠孝東路一段12號.

- 25.04468, 121.52256 (OpenStreetMap way 267163040, Sheraton Grand Taipei)
- Cross-check: Wikipedia gives 25.04467, 121.52255

The exact old compound boundary is **not found**. "About here" is secondary wording.

**Investigation steps**
1. **What the place was.** A former Japanese army warehouse compound that became the 軍法處營區 at 青島東路. The 國防部臺灣軍人監獄 was set up there in 1947 and moved to 新店安坑 in 1952.
   - Source: 促轉會公告 111年2月9日 促轉二字第1115200018號, 行政院公報 第028卷第027期, gazette p.19–20, https://gazette.nat.gov.tw/EG_FileManager/eguploadpub/eg028027/ch01/type3/gov01/num1/Eg.pdf (official)
2. **What happened and when.** The 臺灣警備總司令部 軍法處 (military law office) and its detention centre were at 青島東路 until 1967–1968. They then moved to 新店 (景美).
   - Source: same gazette, pp.19 and 26 (official)
3. **People.** In 1950 it held political-case defendants awaiting military trial. A detainee's memoir (《青島東路三號》, excerpted by 遠見) describes crowding. Its numbers are personal estimates and should not be shown as fact.
   - Source: 遠見「北市青島東路三號 為何遭政府列為「不義遺址」？」, 2017-12-12, https://www.gvm.com.tw/article/41453 (secondary / memoir)
4. **Today.** The site is now hotel and commercial land, with no marker found. It was among the 45 White Terror sites inventoried by 文化部 / 人權館, but it is **not** in the 2022 gazette's 17 不義遺址.
   - Source: 遠見 (secondary)

**Room for invention.** The hotel is unrelated to the past. Do not place scenes inside it. Use the street corner only. No invented detainee words. Memoir quotations need the publisher's permission.

---

## 1.11 馬場町刑場 (today 馬場町紀念公園)

**Location.** 馬場町紀念公園, 臺北市萬華區 (riverside park, 青年公園 northwest side).

- 25.01914, 121.50406 (nchdb open data, 史蹟 caseId 20200306000001)
- Cross-check: Wikipedia gives 25.01922, 121.50408

**Investigation steps**
1. **What the place was.** A 1909 Japanese army 「臺北練兵場」 for infantry drill and cavalry riding. It was renamed 「馬場町」 in 1922 and was later an airfield.
   - Sources: 國家文化資產網 史蹟「馬場町刑場」, https://nchdb.boch.gov.tw/assets/advanceSearch/historicSite/20200306000001 (official); 促轉會 gazette p.58 (official)
2. **What happened and when.** From the late 1940s to the early 1950s it was the main execution ground for political-case defendants, used most in about 1950. Executions were carried out by 憲兵第四團. It stopped being used around 1954.
   - Sources: gazette p.58 (official); nchdb (official)
3. **People.** The number executed here "難以考證" (cannot be established). Do not show any total. The gazette names some executed people, but this file does not repeat them.
   - Sources: nchdb; gazette p.58 (official)
4. **Today.** Rebuilt as 馬場町紀念公園 in 2000, with a memorial mound and inscription. Registered as a Taipei 史蹟 in 2020. Announced as a 不義遺址 on 2022-02-09.
   - Source: gazette p.58 (official)

**Room for invention.** No count of executions, no reenacted shootings, no ghosts. The mound and the river are enough. The families of the executed take part in annual commemorations.

---

## 1.12 鹿窟事件 (1952, 石碇)

**Location.** 鹿窟事件紀念碑, 舊莊街二段, 光明里, 石碇區, 新北市.

- 25.03017, 121.66581 (OpenStreetMap node 1681484503)

The 光明寺 (菜廟), used as the interrogation post: location **not found**.

**Investigation steps**
1. **What the place was.** The mountain villages of 鹿窟 and nearby hamlets in 石碇, mostly miners' and farmers' households.
   - Source: 監察院 調查報告（公布版）鹿窟事件, 2017, https://cybsbox.cy.gov.tw/CYBSBoxSSL/edoc/download/24716 (official)
2. **What happened and when.** From the night of 28 Dec 1952 (民國41年), 保密局, 保安司令部, garrison and police units encircled the 鹿窟 hills. Troop estimates run from 3,800 (MND estimate) to over 10,000 (civilian claim). 光明寺 served as the joint command and interrogation post, and troops withdrew on 19 Jan 1953.
   - Source: same report (official)
3. **People.** Official documents cited by the report record **896** people held on 30 Dec 1952. Of these, **711** were released to mines or villages and **183** were questioned further. **231** cases were referred. **93** were convicted, including **28** death sentences. Other compilations give 35 death sentences because they include related base cases, so the report explains the difference.
   - Source: same report (official)
4. **Remembered.** The Control Yuan found serious misconduct, including torture and unfair trials, and asked for compensation measures. A memorial park with two monuments stands where 汐碇路, 碇南路 and 舊莊街 meet; it was reportedly built in late 2000.
   - Sources: 監察院 report (official); 中時評論 2023-02-23, https://www.chinatimes.com/opinion/20230223000003-262107 (secondary; seen via search results)

**Room for invention.** Villagers' descendants still live here, and the report quotes named testimonies. Do not invent testimony. Use only the report's aggregate numbers. Do not depict torture.

---

## 1.13 六張犁政治受難者墓區

**Location.** 戒嚴時期政治受難者墓園 (文化景觀), 臺北市信義區六張犁崇德街山區.

- 25.02181, 121.56011 (nchdb open data, caseId 20160604000001)
- 紀念公園 entrance: 25.01764, 121.56436 (OpenStreetMap way 515970373)
- Cadastral lots: 犁和段一小段263, 265, 270 and 吳興段二小段635, 637 (gazette p.63)

**Investigation steps**
1. **What the place was.** In 1949 the 六張犁 burial area was contracted to a private operator and renamed 極樂公墓.
   - Source: 促轉會 gazette p.63 「原極樂公墓（戒嚴時期政治受難者墓園）」 (official)
2. **What happened and when.** From the late 1940s to the 1960s it was where executed political-case defendants were buried, most often in 1950–1954. Bodies were buried here when no family claimed them, often because notices did not reach families, families could not afford the fee to claim the body, or they were afraid to come forward.
   - Sources: gazette p.63 (official); 國家文化資產網「戒嚴時期政治受難者墓園」, https://nchdb.boch.gov.tw/assets/advanceSearch/culturalLandscape/20160604000001 (official)
3. **People.** At least **287** political prisoners were buried here according to the gazette. The heritage record gives "兩百餘座" graves. The full list is still incomplete.
   - Sources: gazette p.63; nchdb (official)
4. **Today.** The graves were rediscovered in 1993 by a family member searching for a relative. Taipei set up a 白色恐怖調查委員會 in 1996 and finished a memorial park and stele in 2002. The site was registered as a 文化景觀 in 2016 and announced as a 不義遺址 in 2022.
   - Source: gazette p.63 (official)

**Room for invention.** This is a real cemetery with identifiable graves, and families still visit. Do not render readable names on generated gravestones. No spirits, no dialogue. Treat it as quiet, respectful space.

---

## 1.14 安坑刑場 (新店)

**Location.** 新店區安華路 (formerly 刑場路), described as "now the 新店第三公墓".

- 24.96114, 121.52128 (OpenStreetMap relation 4657255, centroid of 新店區第三公墓). Approximate only.

The exact execution spot is **not found** officially.

**Investigation steps**
1. **What the place was.** An execution ground on a hillside next to the 新店軍人監獄.
   - Source: 自由時報「促轉會訪安坑刑場 保存不義遺址」, 2019-08-01, https://news.ltn.com.tw/news/politics/breakingnews/2870471 (secondary)
2. **When used.** Opened about 1954. Replaced by civilian prisons around 1988, so about 34 years of use.
   - Source: same article (secondary)
3. **People.** No sourced total was found (**not found**).
4. **Today and status.** Cemetery land. 促轉會 visited in 2019 to define its extent with New Taipei's funeral office. It is **not** among the 17 sites in the 2022 gazette.
   - Source: LTN (secondary); gazette p.1 list (official, for absence)

**Room for invention.** The location is imprecise, so the game must say "near here". No execution scenes, no counts, no named victims.

---

## 1.15 新店軍人監獄

**Location.** 法務部矯正署新店戒治所, 新北市新店區莒光路42號 (address as given in the gazette).

- 24.95741, 121.52234 (OpenStreetMap relation 18200548)

**Investigation steps**
1. **What the place was.** 國防部臺灣軍人監獄 was founded in 1947 at the 青島東路 military law compound and moved to 新店安坑 in 1952. It was renamed 國防部新店監獄 in 1973 and closed in 2005. Part of it also served as the 保安司令部 / 警總軍法處看守所安坑分所.
   - Source: 促轉會 gazette p.19 (official)
2. **What happened and when.** Political prisoners were held here from 1952 to 1987. Until the 泰源 prison opened in 1962 it was the island's only military prison. The gazette records overcrowding, abuse, poor conditions and forced labour.
   - Source: gazette pp.19–20 (official)
3. **People.** Five radial cell blocks (仁, 義, 禮, 智, 信) had a total capacity of about **2,400**. 仁 and 智 held political-case prisoners. No total of prisoners was found.
   - Source: gazette p.20 (official)
4. **Today.** A correctional facility in active use since 2006 (新店戒治所), not open to the public. Announced as a 不義遺址 on 2022-02-09.
   - Sources: gazette p.20 (official); PTS 2023-07-15, https://news.pts.org.tw/article/646444 (secondary)

**Room for invention.** This is an operating prison with current inmates and staff. Do not suggest public access or depict the interior. Show it from outside. The gazette names some prisoners, but leave them out.

---

## 1.16 安康接待室 (新店)

**Location.** 新店安康接待室 (直轄市定古蹟), 新北市新店區雙城路12號.

- 24.94971, 121.49058 (nchdb open data, caseId 20230105000001)
- Cross-check: OpenStreetMap gives 24.94962, 121.49062

**Investigation steps**
1. **What the place was.** Built in 1973 and in use from January 1974. It was the 調查局's main site for questioning and holding suspects in major political and criminal cases.
   - Source: 國家文化資產網「新店安康接待室」, https://nchdb.boch.gov.tw/assets/advanceSearch/monument/20230105000001 (official)
2. **What happened and when.** Used from 1974 to 1987 by the 調查局, nominally under 警總. In the 1979 美麗島事件 the first interrogation group was based here, and 7 of the 8 defendants later sent to military trial were questioned here.
   - Source: 促轉會 gazette p.14 (official)
3. **People.** Testimonies collected by the gazette describe detainees cut off from family and lawyers, harsh treatment, and poor conditions. No total number of detainees was found.
   - Source: gazette p.14 (official)
4. **Today.** Part of 國家人權博物館 白色恐怖景美紀念園區, open by guided booking only. Designated a monument on 2022-12-29 and announced as a 不義遺址 on 2022-02-09.
   - Source: nchdb (official)

**Room for invention.** Many people questioned here, including later public figures, are alive. Do not name or voice them. Show the cells empty. No reenacted interrogations.

---

## 1.17 景美看守所 (白色恐怖景美紀念園區)

**Location.** 國家人權博物館 白色恐怖景美紀念園區, 新北市新店區復興路131號.

- 24.98793, 121.53337 (nchdb open data, 歷史建築 caseId 20071212000001)
- Cross-check: Wikipedia gives 24.98831, 121.53217

**Investigation steps**
1. **What the place was.** The 1957 軍法學校 site. In 1967–1968 the 臺灣警備總司令部 軍法處 moved here from 青島東路, and the new 仁愛樓 detention block opened in October 1968.
   - Source: 促轉會 gazette pp.25–26 (official)
2. **What happened and when.** From 1967 to 1992 political-case suspects were held, tried and imprisoned here by 警總 and the 國防部軍法局. The 1980 美麗島 military trial was held here.
   - Sources: gazette p.25 (official); 國家文化資產網「新店二十張景美軍事看守所」, https://nchdb.boch.gov.tw/assets/advanceSearch/historicalBuilding/20071212000001 (official)
3. **People.** The gazette records cramped cells, surveillance and coerced confessions. No total number of detainees was found.
   - Source: gazette p.25 (official)
4. **Today.** Preservation was decided in 2002. The 文建會 took over in 2007, and it became part of 國家人權博物館 in 2018. It is a registered 歷史建築 (2007) and a 不義遺址 (2022).
   - Sources: gazette p.26 (official); nchdb (official)

**Room for invention.** The museum runs survivor-led tours, and survivors are alive. Use only the museum's published narratives. No invented survivor quotes.

---

## 1.18 林宅血案 (1980, today 義光教會)

**Location.** 義光基督長老教會, 臺北市大安區信義路三段31巷16號.

- 25.03512, 121.53459 (OpenStreetMap node 2760112868; Wikipedia gives the same point)

**Investigation steps**
1. **What the place was.** The family home of a then provincial assemblyman. He was detained at the time in connection with the 1979 美麗島事件.
   - Source: PTS「45年前懸案奪3命 原林義雄宅邸成首座「具轉型正義意涵場址」」, 2025-09-02, https://news.pts.org.tw/article/768497 (secondary)
2. **What happened and when.** On 28 Feb 1980 intruders killed three family members (his mother and two daughters) and seriously injured his eldest daughter. The case remains unsolved.
   - Source: same article (secondary)
3. **Official review.** In February 2020 促轉會 published an investigation report on the case. It concluded that involvement of the authoritarian-era authorities could not be ruled out. That is not a judicial finding.
   - Sources: PTS「林宅血案封40年 今促轉會公佈調查報告」, https://news.pts.org.tw/article/466901 (secondary); CNA 2020-03-05, https://www.cna.com.tw/news/aipl/202003050478.aspx (secondary; not opened)
4. **Today.** In 1982 church members bought the house and made it a church (義光 = "light of God's justice"). In 2025 文化部 / 人權館 announced it as the first 「具轉型正義意涵場址」.
   - Source: PTS 2025 (secondary)

**Room for invention.** Extremely sensitive. The case is unsolved, the surviving family is alive and public, and the church is in active use. Do not depict the killings, a perpetrator or the victims' voices. Do not suggest who did it. Show only the church exterior and public facts.

---

## 1.19 陳文成事件 (1981, 臺大)

**Location.** 陳文成事件紀念廣場, 國立臺灣大學 campus (beside / behind the 研究生圖書館), 臺北市大安區.

- 25.01784, 121.53970 (OpenStreetMap way 1323677377)

**Investigation steps**
1. **What the place was.** A lawn behind the left side of the NTU research library.
   - Source: CNA「促轉會公布陳文成案四大發現 他殺可能性高」, 2020-05-04, https://www.cna.com.tw/news/aipl/202005040122.aspx (secondary)
2. **What happened and when.** On the morning of 2 July 1981 a visiting scholar teaching in the United States was taken from his home by the 警備總司令部 "for a talk" (約談). He was found dead on this lawn the next morning, 3 July 1981.
   - Source: CNA 2020 (secondary)
3. **Official review.** 促轉會's 2020 report found four things:
   - he and his relatives were closely monitored
   - no evidence shows he left 警總 control after being taken
   - the lawn was not where he died, and homicide is far more likely than suicide or accident
   - 警總 intervened in the investigation and obstructed the family's search for the truth

   These are a commission assessment, not a court ruling.
   - Source: CNA 2020 (secondary, quoting the report)
4. **Today.** The memorial square was opened by NTU on 2 Feb 2021, after student and alumni efforts beginning in 2012. NTU says its own archives on the case are scarce.
   - Source: PTS「經歷十多年努力 陳文成事件紀念廣場今正式啟用」, 2021-02-02, https://news.pts.org.tw/article/511626 (secondary)

**Room for invention.** His family and the memorial foundation are active. Do not portray his death or last hours. Do not invent his words or a perpetrator. The cause of death remains officially unresolved in court.

---

## 1.21 鄭南榕自焚 (1989, 鄭南榕紀念館)

**Location.** 鄭南榕紀念館, former office of 《自由時代》 magazine. Address: 臺北市松山區民權東路三段106巷3弄11號 (foundation contact: 3樓; postcode 105 = 松山區). Some sources say 中山區; postcode and OpenStreetMap indicate 松山區.

- 25.06167, 121.54556 (Wikipedia, "Cheng Nan-jung Liberty Museum"; low precision, about ±50 m)
- OpenStreetMap does not map the building. The lane (自由巷) runs between 25.06125, 121.54878 and 25.06147, 121.54578.

**Investigation steps**
1. **What the place was.** The office of 《自由時代》, a weekly founded in 1984. It published 302 issues over 5 years 8 months and was repeatedly banned and renamed.
   - Source: 鄭南榕基金會 official site, https://www.nylon.org.tw/ (secondary: a private foundation, though the museum's own account)
2. **What happened and when.** After the magazine printed a draft "Republic of Taiwan" constitution, its founder was charged with sedition. He stayed inside the office for 71 days. On 7 April 1989, as police entered, he set himself on fire and died.
   - Source: 鄭南榕基金會 (secondary)
3. **People.** One person died. He is named in the museum and the event name. No other casualties were reported.
4. **Today.** The museum opened at the site on 10 Dec 1999 and preserves the burned editor's room. The lane was marked 「自由巷」 by Taipei City in 2012. In 2016, 7 April became the national 言論自由日 (Freedom of Speech Day).
   - Sources: 鄭南榕基金會 (secondary); English Wikipedia references on 自由巷, seen via search results (secondary); CNA 2023, https://www.cna.com.tw/postwrite/chi/338478 (secondary; seen via search results)

**Room for invention.** His family and the foundation are alive and run the museum. Never depict the self-immolation, fire or body. Do not invent his words; the museum holds his manuscripts and quotes, and any quotation would need the foundation's permission. It is also politically sensitive (independence advocacy). Describe it neutrally, without endorsing or criticising the cause.

---

## Gaps and things not confirmed

- **228 Foundation (228.org.tw).** Its pages returned errors, so no step cites it.
- **The 228 batch of 不義遺址.** The 25-site gazette (reported 111-02-17, 促轉二字第1115200029號) was not opened. 天馬茶房's inclusion is cited only through PTS. The Executive Yuan site's inclusion is confirmed through the ey.gov.tw press release.
- **國家文化記憶庫 (tcmb) and 臺灣大百科.** No usable entries came up in searches for these places.
- **Not found:**
  - 1.2: an official landing date (8 Oct 1884 is from secondary sources)
  - 1.4: an official account of the shooting
  - 1.8, 1.9, 1.10, 1.14: official records (secondary only)
  - 1.14: the exact execution-ground location
  - 1.6, 1.11, 1.14, 1.17: official casualty or detainee totals (deliberately left blank)
