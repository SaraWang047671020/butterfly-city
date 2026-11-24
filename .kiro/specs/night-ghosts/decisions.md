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
