/**
 * The 41 districts of Taipei City and New Taipei City.
 *
 * - `code`: official administrative code (TOWNCODE in the MOI district boundary data). Primary key.
 * - `zh`: county + district name exactly as written in government source files. Used only to match
 *   source rows; never shown in the UI.
 * - `name`: romanized display name (from TOWNENG in the MOI boundary data, without " District").
 */

export type City = 'Taipei' | 'New Taipei';

export interface DistrictRef {
  readonly code: string;
  readonly city: City;
  readonly zh: string;
  readonly name: string;
}

const TAIPEI: ReadonlyArray<readonly [string, string, string]> = [
  ['63000010', '松山區', 'Songshan'],
  ['63000020', '信義區', 'Xinyi'],
  ['63000030', '大安區', "Da'an"],
  ['63000040', '中山區', 'Zhongshan'],
  ['63000050', '中正區', 'Zhongzheng'],
  ['63000060', '大同區', 'Datong'],
  ['63000070', '萬華區', 'Wanhua'],
  ['63000080', '文山區', 'Wenshan'],
  ['63000090', '南港區', 'Nangang'],
  ['63000100', '內湖區', 'Neihu'],
  ['63000110', '士林區', 'Shilin'],
  ['63000120', '北投區', 'Beitou'],
];

const NEW_TAIPEI: ReadonlyArray<readonly [string, string, string]> = [
  ['65000010', '板橋區', 'Banqiao'],
  ['65000020', '三重區', 'Sanchong'],
  ['65000030', '中和區', 'Zhonghe'],
  ['65000040', '永和區', 'Yonghe'],
  ['65000050', '新莊區', 'Xinzhuang'],
  ['65000060', '新店區', 'Xindian'],
  ['65000070', '樹林區', 'Shulin'],
  ['65000080', '鶯歌區', 'Yingge'],
  ['65000090', '三峽區', 'Sanxia'],
  ['65000100', '淡水區', 'Tamsui'],
  ['65000110', '汐止區', 'Xizhi'],
  ['65000120', '瑞芳區', 'Ruifang'],
  ['65000130', '土城區', 'Tucheng'],
  ['65000140', '蘆洲區', 'Luzhou'],
  ['65000150', '五股區', 'Wugu'],
  ['65000160', '泰山區', 'Taishan'],
  ['65000170', '林口區', 'Linkou'],
  ['65000180', '深坑區', 'Shenkeng'],
  ['65000190', '石碇區', 'Shiding'],
  ['65000200', '坪林區', 'Pinglin'],
  ['65000210', '三芝區', 'Sanzhi'],
  ['65000220', '石門區', 'Shimen'],
  ['65000230', '八里區', 'Bali'],
  ['65000240', '平溪區', 'Pingxi'],
  ['65000250', '雙溪區', 'Shuangxi'],
  ['65000260', '貢寮區', 'Gongliao'],
  ['65000270', '金山區', 'Jinshan'],
  ['65000280', '萬里區', 'Wanli'],
  ['65000290', '烏來區', 'Wulai'],
];

export const DISTRICTS: readonly DistrictRef[] = [
  ...TAIPEI.map(([code, zh, name]) => ({ code, city: 'Taipei' as const, zh: `臺北市${zh}`, name })),
  ...NEW_TAIPEI.map(([code, zh, name]) => ({ code, city: 'New Taipei' as const, zh: `新北市${zh}`, name })),
];

const byZh = new Map(DISTRICTS.map((d) => [d.zh, d]));

/**
 * Finds a district by its Chinese county + district name. Accepts the variant spelling 台北市 and
 * surrounding whitespace, which some source files use.
 */
export function districtByZh(zh: string): DistrictRef | undefined {
  return byZh.get(zh.trim().replace(/^台北市/, '臺北市'));
}

/** Returns the districts whose code is not in `foundCodes`. */
export function missingDistricts(foundCodes: Iterable<string>): DistrictRef[] {
  const set = new Set(foundCodes);
  return DISTRICTS.filter((d) => !set.has(d.code));
}
