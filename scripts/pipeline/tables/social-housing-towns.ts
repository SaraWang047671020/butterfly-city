/**
 * The portal's own district codes. The NLMA social housing portal writes `CityCode` (A = Taipei, F = New
 * Taipei) and a two-digit `TownCode` in each project detail file. These are not the 8-digit MOI codes of
 * `scripts/lib/districts.ts`, so this table maps `<CityCode><TownCode>` to the romanized district name.
 *
 * Each entry was checked against the district named in the `Address` field of the detail files that carry
 * the code (2026-11 download). Codes that no project in the files uses are not listed; a project whose code
 * is not listed is excluded with the reason "TownCode outside the 41" (Requirement 13.5).
 */
export const PORTAL_TOWN_CODES: Readonly<Record<string, string>> = {
  A01: 'Songshan',
  A02: "Da'an",
  A03: 'Zhongzheng',
  A05: 'Wanhua',
  A09: 'Datong',
  A10: 'Zhongshan',
  A11: 'Wenshan',
  A13: 'Nangang',
  A14: 'Neihu',
  A15: 'Shilin',
  A16: 'Beitou',
  A17: 'Xinyi',
  F01: 'Xinzhuang',
  F02: 'Linkou',
  F03: 'Wugu',
  F04: 'Luzhou',
  F05: 'Sanchong',
  F06: 'Taishan',
  F07: 'Xindian',
  F09: 'Shenkeng',
  F14: 'Banqiao',
  F15: 'Sanxia',
  F16: 'Yingge',
  F17: 'Shulin',
  F18: 'Zhonghe',
  F19: 'Tucheng',
  F27: 'Tamsui',
  F28: 'Xizhi',
  F33: 'Yonghe',
};

export const PORTAL_CITY_LETTERS: Readonly<Record<string, 'Taipei' | 'New Taipei'>> = {
  A: 'Taipei',
  F: 'New Taipei',
};
