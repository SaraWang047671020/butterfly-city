# Requirements Document

Approved by the user on 2026-11-24 ("核准").

## Introduction

The user found the ghosts of the game not visible enough and asked for day and night, missions, ghosts at night and real places of the two cities (2026-11-24). The decisions and the guidance the user brought are recorded in `decisions.md`; this spec turns them into requirements:

> 鬼的部分不夠明顯 … 可以融入歷史事件與地點 … 設計白天與夜晚模式，到了夜晚鬼會跑出來，如果白天沒有好好建設城市，鬼就會很多並且吞噬城市，需要在白天達到一定的任務才能在晚上避免鬼魂 … 每一種政策都可以有對應的任務。

World line (guidance 7): **Butterfly City — Where the Living and the Dead Coexist.** Players may come for the ghosts and leave interested in a place, a history, people they did not know.

### Principles (user decisions and guidance)

1. Historical events can be heavy; the game is not heavy all the time. Ghosts can be frightening; real victims are never a horror spectacle, never monsters, never enemies to clear, and a death toll never becomes a haunting score (guidance 1, 5).
2. Fact and fiction are kept apart. Every historical fact has a source shown in the game; an invented character is labelled as invented; invented words are never presented as the words of a real person (guidance 3, 5).
3. Folklore and old places become ghost places; real historical events become memory scenes and memorial points, with spirits or echoes without a negative meaning (user decision 1, guidance 2).
4. A mission not met adds extra ghosts at night (user decision 2). The ghosts of the simulation (people above a rent or commute line) stay what they are; the mission ghosts are a game element, look different and are counted separately, so the numbers stay honest. This changes the ghost rule of `product.md` and needs the user's approval (Requirement 1.3).
5. One quarter is one day and one night, with a real-time timer for the day (user decision 3); the timer can be paused, extended or turned off (WCAG 2.2.1).

### Answers of the user to the open questions (2026-11-24)

1. **Night pressure:** besides the look, the next day is shorter (option chosen: "下一天的時間變少"); never an effect on the simulation.
2. **Missions:** each day the player picks one Mission from a short list ("每天從幾個任務中選一個").
3. **Kinds of the places:** as proposed ("這樣分可以").
4. **Day_Timer:** on by default, 5 minutes ("預設開啟，5 分鐘").
5. **Ghost lines and ghosts who give Missions** (user request: "我覺得可以給鬼一些罐頭台詞，然後讓鬼指派任務給玩家"): ghosts speak scripted lines, and the Missions of a day are requests of ghosts. Proposed limits that keep Principles 1 and 2: Kind C ghosts and Memorial_Points never give Missions and never speak invented lines; the givers are Kind A ghosts, Kind B ghosts and Model_Ghosts (the people above a rent or commute line, speaking as invented composite voices); a line after a Mission not met describes the result and never blames the player.

### Who implements

Claude Code, as for play-loop and life-story (recorded in `KIRO-LOG.md`).

### Out of scope

- New Policy_Tools (`housing-tools`, `more-policies`); missions use the Active_Tools of their time and gain missions when those specs add tools.
- The CITY CORE advisor as a character with its own voice and the mystery line of the long-term design document (a later phase); this spec only uses "the city archive" as the place where found records are kept.
- Any change to the Engine: missions, mission ghosts, scenes and the heritage plan never change an Engine input or result.

## Glossary

- **Day_Phase**, **Night_Phase**: the two halves of a quarter. The Day_Phase is the Decide_Step (policies, Life_Events); the Night_Phase starts when the quarter is computed (the Quarter_Brief, ghosts, scenes) and ends when the player starts the next day.
- **Day_Timer**: the real-time countdown of a Day_Phase (default 5 minutes); WHEN it ends, the quarter is computed as with Next quarter.
- **Mission**: a target of one Active_Tool for the Day_Phase, checked when the quarter is computed (for example "social housing completions in the year at least N"). Each day the player picks one Mission from a Mission_Offer.
- **Mission_Offer**: the 3 Missions offered in a Day_Phase, each asked by a Mission_Giver.
- **Mission_Giver**: the ghost who asks for a Mission: a Kind A ghost, a Kind B ghost or a Model_Ghost of a district (user answer 5); never Kind C or a Memorial_Point.
- **Ghost_Line**: a scripted line of a ghost in both languages, labelled as invented, from the Ghost_Line file.
- **Model_Ghost**: the Ghost_Figure of the simulation (people above a rent or commute line compared with real history), as today.
- **Mission_Ghost**: a folklore ghost added at night for a Mission not met; a game element, not a simulation result.
- **Ghost_Kind**: A folklore and urban legend; B local memory; C historical memory (guidance 2).
- **Scene_Database**: `data/config/scenes.json`: one record per place: kind, location, facts with sources, the room for invention, the ghost or echo setting, the interaction, the texts in both languages and their approval status (guidance 8).
- **Memory_Scene**: a Ghost_Kind C place with an Investigation (guidance 3).
- **Memorial_Point**: a place shown with its date, a factual sentence and its source only, without ghost, echo or game mechanic (the recent cases with private victims, `decisions.md`).
- **Investigation**: the steps by which the player unlocks the sourced records of a Memory_Scene or the story of a B ghost.
- **Heritage_Plan**: the player's list of places the city chooses to remember (a game choice, no Engine effect).
- **City_Archive**: the page where found records, Memorial_Points and the Heritage_Plan are kept.

## Requirements

### Requirement 1: Approvals

1. THE Developer SHALL present a Design_Proposal of the day and night city, the Day_Timer, the Missions, the Mission_Ghosts and the night pressure, a Memory_Scene, a B ghost encounter and the City_Archive, at 1280 and 360 CSS pixels in both languages, before any of these screens is built (`product.md` approval gate).
2. THE Scene_Database SHALL list every place with its proposed Ghost_Kind or Memorial_Point; the user SHALL approve the list, and each record's texts SHALL be approved in both languages before its status is `approved`. A record that is not approved is not shown.
3. THE change of the ghost rule of `product.md` (Principle 4) SHALL be written as a proposed text and applied only after the user's approval.

### Requirement 2: Day and night

1. Each quarter SHALL have a Day_Phase and a Night_Phase. THE City_View SHALL show day light in the Day_Phase and the current night look in the Night_Phase, with a short transition (none under reduced motion).
2. THE Model_Ghosts, the Mission_Ghosts, the B ghosts and the Memory_Scene signs SHALL appear in the Night_Phase only.
3. THE Night_Phase SHALL begin with the Quarter_Brief and SHALL let the player walk the night city (Walk_Mode) before starting the next day with a "Start the day" control.

### Requirement 3: Day_Timer

1. THE Day_Phase SHALL show the Day_Timer with the time left in words and numbers; WHEN it reaches 0, the quarter SHALL be computed as with Next quarter. A new game starts with the Day_Timer on at 5 minutes (user answer 4).
2. THE Day_Timer SHALL stop while a dialog (Policy_Dialog, Life_Event, confirmation) is open, and THE settings SHALL offer pause, more time (+2 minutes, repeatable), the length (3, 5, 8 minutes) and off (WCAG 2.2.1); off is remembered in the browser.
3. Under reduced motion the Day_Timer SHALL not animate; its time left is still shown.

### Requirement 4: Missions

1. Each Day_Phase SHALL offer a Mission_Offer of 3 Missions, chosen by a fixed rule and the seed from the Mission file (at least one per Active_Tool over the year), each with a target relative to real history, its unit, its difficulty in words and its source data; the rules and values SHALL be in a Mission file with sources.
2. Each Mission of the offer SHALL be asked by a Mission_Giver with a Ghost_Line that ties the request to the giver (for example a Model_Ghost of Wanhua asking for lower rent, the phantom passenger of the Xinhai Tunnel asking for more people on the metro); the Mission's target, unit and source are shown with the line, so the request is never only flavour.
3. THE player SHALL pick one Mission of the offer before the Day_Timer runs out; WHEN none is picked, the first one applies and THE Game_Screen says so.
4. THE picked Mission SHALL be checked from the Engine results and the policy values of the computed quarter; THE Quarter_Brief SHALL show it as met or not met with both values, and the giver's Ghost_Line for that result, without praise or blame (`neutrality.md`: a line after a Mission not met describes what the giver sees, never blames the player).
5. A Mission SHALL never change an Engine input or result.

### Requirement 5: Ghosts at night

1. THE Model_Ghosts SHALL stay as defined by the simulation (`product.md`), with their exact number shown.
2. WHEN the picked Mission is not met, THE Night_Phase SHALL add a fixed number of Mission_Ghosts (Ghost_Kind A) in the districts the Mission is about; they SHALL look different from the Model_Ghosts, be counted separately, and be named as a game element in the legend ("folklore ghosts from missions not met").
3. WHERE the Model_Ghosts and Mission_Ghosts of a district pass a threshold, THE district SHALL darken and fog at night ("the night swallows the district"); the effect SHALL stay local, never flicker, and be shown in words in the District_Card.
4. Mission_Ghosts of a quarter SHALL leave when the next Day_Phase begins; meeting the Missions of later days keeps them away.
5. WHEN Mission_Ghosts were added in a quarter, THE next Day_Timer SHALL be shorter by a fixed amount per group (for example 30 seconds), never below a minimum (for example 2 minutes), and THE Day_Phase SHALL say why in words (user answer 1). WHILE the Day_Timer is off, there is no shortening (WCAG 2.2.1).
6. No Ghost_Kind B or C, no Memory_Scene and no Memorial_Point SHALL ever be part of the night pressure (guidance 5).

### Requirement 5A: Ghost_Lines

1. THE Ghost_Line file SHALL hold, for each Kind A and Kind B ghost and for the Model_Ghosts, lines in both languages for: meeting at night, asking for a Mission, a Mission met, a Mission not met, and idle talk; several lines per moment, picked by the seed so that the same game repeats them in the same way.
2. Every Ghost_Line SHALL be shown with the "invented" label of the City_Archive, SHALL pass the Banned_Term_List and the `neutrality.md` review, and SHALL be approved by the user in both languages before it is shown.
3. Kind A lines may be playful or eerie; Kind B lines may be nostalgic and may show that the ghost does not know why it is still there (guidance 6); Model_Ghost lines speak as composite residents of the district about rent, commute or moving away, and SHALL use only values of the game state for numbers.
4. Kind C ghosts and Memorial_Points SHALL have no Ghost_Line (Principle 2); a Memory_Scene speaks only through its sourced records.
5. A Ghost_Line SHALL never name a real private person, a party or a politician, and SHALL never imply how a real, identifiable person died.

### Requirement 6: Ghost kinds and the Scene_Database

1. Every place of the Scene_Database SHALL have exactly one Ghost_Kind (A, B, C) or be a Memorial_Point, and every fact a source (title, publisher, URL, access date).
2. Kind A (folklore and urban legend) SHALL be told as a legend ("it is said that …"), may be playful or frightening, and SHALL never imply how a real, identifiable person died; places flagged with real deaths in the research SHALL say so in their record.
3. Kind B (local memory) SHALL be invented characters tied to real places (old streets, demolished markets, vanished settlements), labelled as invented, who may not know why they are still there (guidance 6).
4. Kind C (historical memory) SHALL appear as echoes and records, not as characters with invented words; their content SHALL come from official records, memorial institutions and research.
5. Recent cases with private victims SHALL be Memorial_Points only.

### Requirement 7: Folklore places (Kind A)

1. In the Night_Phase, Kind A places SHALL show their legend when the player walks near, with a light encounter (for example a phantom passenger who asks for a stop, a playful ghost that leads the way), and its source.
2. Mission_Ghosts SHALL gather at the Kind A places of their districts.

### Requirement 8: Local-memory ghosts (Kind B)

1. A Kind B ghost SHALL appear at its place at night with a question (for example "Is my shop still there?") and an Investigation of 2 to 4 steps: places to visit and sourced records to find (old photos, maps, news), each with its source.
2. THE ghost's story SHALL change with the player's choices recorded in the Scene_Database (for example adding the place to the Heritage_Plan), and SHALL end without a verdict.

### Requirement 9: Memory_Scenes (Kind C) and Memorial_Points

1. A Memory_Scene SHALL look ordinary by day and show restrained signs at night (a figure that fades when approached, the old landscape for a moment, an unreadable record in the City_Archive); no ghost count, fear level or task to drive anything away (guidance 3).
2. ITS Investigation SHALL unlock the sourced records step by step: what happened, when, where, the memorial today; never more detail of violence than the sources state, never blame or names of politicians beyond official titles (`neutrality.md`).
3. AT the end of an Investigation the player MAY add the place to the Heritage_Plan; the City_View then marks it (a light, a plaque) and the City_Archive lists it.
4. A Memorial_Point SHALL show its date, one factual sentence and its source, by day and night, with no other interaction.

### Requirement 10: City_Archive

1. THE City_Archive (from the game menu) SHALL list the found records by place, the Memorial_Points, the Heritage_Plan and the Mission history, each record with its source and a "fact" or "invented" label.

### Requirement 11: Text, languages, accessibility

1. Every text SHALL exist in English and Traditional Chinese, pass the Banned_Term_List and the `neutrality.md` review, and be approved by the user before it is shown (Requirement 1.2).
2. Every scene and encounter SHALL be reachable by keyboard and from the district list without WebGL; no full-screen flicker; reduced motion gives still frames with the same information.

### Requirement 12: Storage and determinism

1. Mission results, Investigations and the Heritage_Plan SHALL be kept in the browser and SHALL be pure functions of the Save, the choices and the Data_Files; the Save_Code stays unchanged.

### Requirement 13: Tests

1. Property tests: Missions and Mission_Ghosts never change an Engine result; the same inputs give the same Mission_Offer, givers, Ghost_Lines, Mission_Ghosts and night pressure; Kind B, C and Memorial_Points never count toward the night pressure; no Mission_Giver is Kind C or a Memorial_Point; the Day_Timer is never shorter than its minimum.
2. File tests: every Scene_Database record has a kind, sources for every fact, both languages and a status; every Ghost_Line has both languages, the same placeholders and a status, and no Kind C place has a Ghost_Line; only approved records and lines are shown.

## Kinds of the chosen places (user answer 3)

- **A (folklore and urban legend)**: 5.1 三芝飛碟屋, 5.2 辛亥隧道, 5.3.4 仙跡岩, 5.3.6 石門十八王公廟, 5.3.7 艋舺青山宮, 5.3.13 芝山岩 同歸所, 5.3.19 錦新大樓, 5.3.20 西寧國宅, 5.3.21 西門紅樓, 5.3.22 水湳洞 台金戲院, 5.3.23 北宜公路, 5.3.24 陽金公路, 5.3.25 淡金公路.
- **B (local memory)**: 4.3 中華商場, 4.5 寶藏巖, 4.6 文萌樓.
- **C (historical memory, Memory_Scenes)**: 1.1 to 1.19 and 1.21, 2.1 to 2.4, 2.11, 2.12, 4.1 臺北監獄, 4.2 樂生療養院.
- **Memorial_Points only**: 2.14 復興航空235號班機空難, 2.15 八仙樂園粉塵爆炸, 3.2 白曉燕命案, 3.5 臺北捷運隨機殺人事件, 3.7 內湖女童命案, 3.8 北車・中山商圈隨機攻擊事件.

Numbers refer to `data/research/night-ghosts-dark-history-2026-11-24.md` and `data/research/night-ghosts-folklore-2026-11-24.md`.
