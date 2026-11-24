# night-ghosts: user decisions (2026-11-24)

Not a spec yet. This spec comes after `life-story` (user decision, question of 2026-11-24). Recorded here so that the requirements start from the user's words.

## The request

> 鬼的部分不夠明顯，要想一下怎麼加比較好 --> 可以融入歷史事件與地點（例如馬場町、川端橋等等），並且設計白天與夜晚模式，到了夜晚鬼會跑出來，如果白天沒有好好建設城市，鬼就會很多並且吞噬城市，需要在白天達到一定的任務才能在晚上避免鬼魂，任務包括讓多少人有社宅住或是多少人搭捷運之類的，每一種政策都可以有對應的任務。

## Decisions

1. **Places.** Folklore and old places become ghost places; real historical events become spirits or other characters without a negative meaning ("如果民間傳說與老地點弄成鬼，真正的歷史事件弄成精靈或其他比較沒有負面含義的角色呢?"). Historical events must be events that really happened; Claude Code lists the dark events of the two cities (political persecution, violent crimes and others) with sources, and the user chooses which ones are used ("歷史事件要找真的有發生的…列出來，讓我選要哪些").
2. **Missions and ghosts.** A mission not met adds extra ghosts at night ("沒達成任務就額外加鬼"). This changes the product rule of `product.md` ("The number of ghosts in each district is determined by simulation output … Never place a ghost for decoration"), so the spec must change `product.md` with the user's approval. Proposal for the requirements, to keep the numbers honest: the model's ghosts and the mission ghosts look different and are counted separately, and the exact model number stays on screen.
3. **Day and night with a timer.** A real-time timer per quarter, for example 5 minutes, so that the player feels the pressure to finish the missions in time; still one quarter per cycle ("我希望可以有計時的機制…假如說一季就是5分鐘之類的"). 44 quarters × 5 minutes is about 3 hours 40 minutes. WCAG 2.2.1 (Timing Adjustable) applies: the requirements must let the player pause, extend or turn off the timer.
4. **Order.** After `life-story`, before `housing-tools` and `more-policies`.

## Rules the spec must still respect

- `neutrality.md`: no verdict on the player; facts of historical events with date, place and source; no names of politicians unless part of an official title.
- `product.md`: risk visuals stay local; no continuous full-screen flicker; reduced motion.

## Events chosen by the user (2026-11-24)

From the sourced list `data/research/night-ghosts-dark-history-2026-11-24.md` (picker `docs/design-proposal/dark-history-picker.html`), 39 events: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 1.13, 1.14, 1.15, 1.16, 1.17, 1.18, 1.19, 1.21, 2.1, 2.2, 2.3, 2.4, 2.11, 2.12, 2.14, 2.15, 3.2, 3.5, 3.7, 3.8, 4.1, 4.2, 4.3, 4.5, 4.6, 5.1, 5.2.

The user chose them after the note that the high-sensitivity rows (recent cases with private victims, including children) can hurt the families and carry legal risk. The chosen high-sensitivity rows are 2.14, 2.15, 3.5, 3.7 and 3.8. The requirements of `night-ghosts` must therefore set how these appear: as memorial points only, with the date, place and a factual sentence with its source; no victim or perpetrator names; no depiction of the violence; no ghost and no game mechanic attached to them. The user also asked for more folklore and ghost-legend places (「我希望民間傳說跟鬼故事地點可以再多一點」); a second sourced list is being researched.

## Folklore places chosen by the user (2026-11-24)

From `data/research/night-ghosts-folklore-2026-11-24.md` (picker `docs/design-proposal/folklore-picker.html`), 11 places: 5.3.4 仙跡岩, 5.3.6 石門十八王公廟, 5.3.7 艋舺青山宮, 5.3.13 芝山岩 同歸所, 5.3.19 錦新大樓, 5.3.20 西寧國宅, 5.3.21 西門紅樓, 5.3.22 水湳洞 台金戲院, 5.3.23 北宜公路, 5.3.24 陽金公路, 5.3.25 淡金公路. With 5.1 三芝飛碟屋 and 5.2 辛亥隧道 from the first list, 13 ghost places. Six of them carry the flag "avoid implying specific deaths" (5.3.13, 5.3.19, 5.3.20, 5.3.22, 5.3.23, 5.3.24): the game tells the legend as a legend and never presents a place as the site of a particular death or as a suicide spot.

## Guidance the user brought from a conversation with ChatGPT (2026-11-24)

The user asked that the spec follow this guidance (pasted in the session, summarised here; the user's message is the record):

1. **Principle.** Historical events can be heavy, but the game does not have to be heavy all the time; ghosts can be frightening, but real victims are never turned into a horror spectacle.
2. **Three kinds of ghosts**, met in different ways:
   - **A. Folklore and urban-legend ghosts**: light, fantastic, exploration; they may be playful, funny, even help the player.
   - **B. Local-memory ghosts**: nostalgic and mysterious; from old streets, old buildings, vanished stations, demolished markets; not necessarily tragic; they miss a place or a way of life, or look for something lost.
   - **C. Historical-memory ghosts**: serious, restrained, reflective; tied to real events (war, political persecution, major disasters); never monsters, never there to scare; the player understands what happened through memory, sources and people's stories.
3. **A historical memory scene, not a haunted area** (example: 馬場町, "The Silent Ground"): an ordinary riverside park by day; at night, unusual signs (a figure by the memorial mound that vanishes, the old landscape showing for a moment, unreadable records in CITY CORE). The player investigates and unlocks sourced history, the memorial and people's records; the point is to understand why the place must be remembered, not to find and expel a ghost; the player may choose to include it in a heritage plan. No ghost count, no fear index, no task to drive anything away. Historical material must be verifiable; an invented ghost character must be labelled as invented, and invented lines must never be presented as a real victim's words.
4. **Different scenes, different play** (old execution grounds: memory echoes, sources, commemoration; war sites: echoes, messages of the missing; old streets and markets: old shopkeepers, former residents, nostalgia; abandoned hospitals: suspense; old stations: phantom passengers, trains that do not exist; folklore places: adventure, chase, interaction).
5. **Avoid**: victims as monsters (no weapon against them, not enemies to clear); death toll turned into a haunting score; history bent for drama (separate fact from fiction; official sources, memorial and research material, sources shown in the game).
6. **Ghosts do not always know why they exist** (some know their story, some remember only a place or a name, some do not know they are dead). Example: "The Old Shopkeeper", who asks every night "Is my shop still there?"; the player helps with old photos, interviews and historical maps; the ghost's story changes with the player's choices (keeping an old street, restoring a building, a local museum).
7. **World**: "Butterfly City — Where the Living and the Dead Coexist." Rough mood, not a rule: 40 % city building and governance, 25 % ghost exploration and encounters, 20 % people's stories and local memory, 15 % history and serious narrative. Players may come for the ghosts and leave interested in a place, a history, people they did not know.
8. **A historical scene database**: for each scene, the facts, the room for invention, the ghost setting and the interaction recorded separately. Starting sources for 馬場町: 文化部文化資產局 國家文化資產網 (馬場町刑場, historic site), 國家文化記憶庫, 促進轉型正義委員會 不義遺址 gazette.

## Ghost lines and ghosts who give Missions (2026-11-24)

The user's request: 「我覺得可以給鬼一些罐頭台詞，然後讓鬼指派任務給玩家」. Proposed limits in the requirements draft (Requirement 4.2 and 5A), to be confirmed with the requirements: Kind C ghosts and Memorial_Points never give Missions and have no invented lines; the Mission_Givers are Kind A ghosts, Kind B ghosts and Model_Ghosts (composite residents); a line after a Mission not met never blames the player.

## Missions as outcomes; order of the specs (2026-11-24)

The user: 「任務的部分現在都太簡單了，直接告訴玩家要去做什麼。應該是要給一個結果，然後讓玩家自己去判斷要用什麼方法才能達成。」 Answers: a Mission states an outcome (for example fewer people above the rent line in a district, a shorter mean commute), not a policy setting; its deadline is 4 to 8 quarters by how slowly the outcome responds; at most 2 Missions at a time (option chosen: 「依目標難度，4 到 8 季」). This changes the approved Requirement 4 and the design's Mission types; the change is written when the work returns to this spec.

The user also found the policy range too small for varied lines and Missions and approved the order: `housing-tools` (with the budget made the real constraint, see its requirements), then `more-policies` with public transport fares, childcare, elder care and urban renewal, then back to `night-ghosts` (「可以，照這個順序，more-policies 就做你建議的四種」). The pure night modules already committed stay; `missions.ts` will be redone for outcome Missions.
