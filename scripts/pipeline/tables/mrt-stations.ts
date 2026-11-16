/**
 * MRT annual-series row table (Requirement 11.2, 11.4, 11.8, 11.11, 11.12).
 *
 * One `MrtRowEntry` per station row of the annual series (data.gov.tw 133184, 統計期 103年–114年, 134 distinct
 * row names). 131 are station rows and 3 are `NON_STATION_ROWS`. A transfer station has one row per line
 * (`中山R`, `中山G`) and the Circular Line (Y line) has its own rows, so several rows can share one `station`.
 *
 * Field meaning:
 *  - `name`      row name exactly as in the annual series.
 *  - `station`   station name as merged from the TDX station files (`TRTC` and `NTMC`, same Chinese name merged
 *                into one station). It equals `name` without the trailing line letters, e.g. `板橋Y` -> `板橋`.
 *                Every `station` is a Chinese name present in `data/raw/stations/tdx-station-{TRTC,NTMC}.json`.
 *  - `dailyName` header of the column in the 2015–2016 daily files (Big5, no line suffix). It is the same for
 *                all rows of a transfer station, because the daily files do not split lines. Rows with no
 *                column in those files (the Circular Line rows) have none.
 *  - `opened`    "before-2015" or the ISO date on which the row's line section opened. See the basis below.
 *  - `comparable` station whose seasonal shares are borrowed (Requirement 11.8) when the row was not open for
 *                any full calendar year of 2015–2016. It names a `dailyName` of a row open for all of 2015 and 2016.
 *
 * Basis of the opening dates:
 *  - `2015-07-06`: Bannan line Tucheng extension to Dingpu, DATA-CHECK.md item 10.5 (New Taipei DORTS route pages,
 *    cross-checked with the Taipei Metro chronicle). The annual series agrees: row 頂埔 is 0 in 2014 and positive
 *    from 2015. The daily column 頂埔 first appears in the 2015-07 file, so 2016 is its one full year.
 *  - `2020-01-31`: Circular Line phase 1, DATA-CHECK.md item 10.5 (14 stations, Y07–Y20). The annual series agrees:
 *    the 14 rows are 0 in 2014–2019 and positive from 2020 (only 景安Y is 0 in every year: its riders are counted
 *    in the 景安 row, so it adds 0). Last day of 2020Q1 is on or after the opening date, so the rows are active from 2020Q1.
 *  - `before-2015`: every other row has a positive annual value in 2014 (統計期 103年) and a daily column in the
 *    first file (2015-01), so it was open before 2015-01-01. The Songshan Line sections opened 2014-11-15 are
 *    covered by this value: they are open for all of 2015 and 2016.
 *
 * Basis of the comparable stations (Requirement 11.8), chosen by `chooseComparable` (mrt-comparable.ts) from the TDX
 * station files and entered here (a test recomputes every choice). Only rows with shares can be comparable: rows with
 * `opened: 'before-2015'` and a `dailyName` (open in all 24 daily files). Rule:
 *  1. an ADJACENT station on the SAME line (previous or next TDX station ID of the line; branch links Xiaobitan G03A
 *     to G03, Xinbeitou R22A to R22, Luzhou O50 to O12) that has shares. If both neighbours qualify, the smaller
 *     distance by TDX coordinates wins (tie: lower station code);
 *  2. only when no adjacent same-line station has shares, the nearest station by TDX coordinates that has shares.
 * A row belongs to one line (its suffix, or its station's line for Circular Line rows). A transfer station's row on
 * another line is not "adjacent same line". All 14 Circular Line (Y) rows have only Y-line neighbours, and those have
 * no shares (the line opened 2020-01-31), so rule 2 selected all 14 and rule 1 none. The values equal the earlier
 * nearest-station choice, so no `comparable` changed. Rule 2 distances (km) are in `comparableKm`: 大坪林Y 0.00,
 * 十四張 -> 大坪林 1.39, 秀朗橋 -> 南勢角 1.59, 景平 -> 南勢角 0.76, 景安Y 0.00, 中和 -> 景安 1.32, 橋和 -> 景安 1.88,
 * 中原 -> 板橋 2.26, 板新 -> 板橋 0.97, 板橋Y 0.25, 新埔民生 -> 新埔 0.32, 頭前庄Y 0.00, 幸福 -> 頭前庄 1.13,
 * 新北產業園區 -> 先嗇宮 2.06. The Dingpu row (opened 2015-07-06) has shares from 2016 only and is never a comparable.
 *
 * Not in the table (no annual row): Danhai LRT, Ankeng LRT and Sanying Line (Requirement 11.12), the Airport MRT
 * (outside the transit coverage), and the Xinyi Line station 廣慈/奉天宮, which is in the TDX files but has no row
 * in the annual series 2014–2025.
 */
import { DataError } from '../errors.ts';
import type { ComparableRule } from './mrt-comparable.ts';

export interface MrtRowEntry {
  /** Row name as in the annual series, e.g. "板橋Y", "南京復興BR". */
  readonly name: string;
  /** Merged TDX station name, e.g. "板橋". */
  readonly station: string;
  /** Column name in the 2015–2016 daily files, when present. */
  readonly dailyName?: string;
  /** ISO date of the row's line section opening, or "before-2015". */
  readonly opened: string;
  /** Station whose seasonal shares are borrowed (Requirement 11.8). */
  readonly comparable?: string;
  /** Rule that selected `comparable`: adjacent station on the same line, or nearest by distance (`chooseComparable`). */
  readonly comparableRule?: ComparableRule;
  /** Distance in km from the row's TDX point to the comparable's TDX point. */
  readonly comparableKm?: number;
}

/** Annual-series rows that are not stations (Requirement 11.3). */
export const NON_STATION_ROWS: readonly string[] = ['一日票', '團體票', '其他'];

/** Opening date of the Bannan line extension to Dingpu (DATA-CHECK.md item 10.5). */
export const DINGPU_OPENED = '2015-07-06';
/** Opening date of Circular Line phase 1 (DATA-CHECK.md item 10.5). */
export const CIRCULAR_OPENED = '2020-01-31';

function before2015(name: string, station: string): MrtRowEntry {
  return { name, station, dailyName: station, opened: 'before-2015' };
}

function dingpu(name: string): MrtRowEntry {
  return { name, station: name, dailyName: name, opened: DINGPU_OPENED };
}

function circular(
  name: string,
  station: string,
  comparable: string,
  comparableRule: ComparableRule,
  comparableKm: number,
): MrtRowEntry {
  return { name, station, opened: CIRCULAR_OPENED, comparable, comparableRule, comparableKm };
}

/** One entry per station row of the annual series, in the order of the series. */
export const MRT_ROWS: readonly MrtRowEntry[] = [
  before2015('松山機場', '松山機場'),
  before2015('中山國中', '中山國中'),
  before2015('南京復興BR', '南京復興'),
  before2015('忠孝復興BR', '忠孝復興'),
  before2015('大安BR', '大安'),
  before2015('科技大樓', '科技大樓'),
  before2015('六張犁', '六張犁'),
  before2015('麟光', '麟光'),
  before2015('辛亥', '辛亥'),
  before2015('萬芳醫院', '萬芳醫院'),
  before2015('萬芳社區', '萬芳社區'),
  before2015('木柵', '木柵'),
  before2015('動物園', '動物園'),
  before2015('大直', '大直'),
  before2015('劍南路', '劍南路'),
  before2015('西湖', '西湖'),
  before2015('港墘', '港墘'),
  before2015('文德', '文德'),
  before2015('內湖', '內湖'),
  before2015('大湖公園', '大湖公園'),
  before2015('葫洲', '葫洲'),
  before2015('東湖', '東湖'),
  before2015('南港軟體園區', '南港軟體園區'),
  before2015('南港展覽館BR', '南港展覽館'),
  before2015('小碧潭', '小碧潭'),
  before2015('新店', '新店'),
  before2015('新店區公所', '新店區公所'),
  before2015('七張', '七張'),
  before2015('大坪林', '大坪林'),
  before2015('景美', '景美'),
  before2015('萬隆', '萬隆'),
  before2015('公館', '公館'),
  before2015('台電大樓', '台電大樓'),
  before2015('古亭', '古亭'),
  before2015('中正紀念堂', '中正紀念堂'),
  before2015('小南門', '小南門'),
  before2015('頂溪', '頂溪'),
  before2015('永安市場', '永安市場'),
  before2015('景安', '景安'),
  before2015('南勢角', '南勢角'),
  before2015('台大醫院', '台大醫院'),
  before2015('台北車站BL', '台北車站'),
  before2015('台北車站R', '台北車站'),
  before2015('中山R', '中山'),
  before2015('雙連', '雙連'),
  before2015('民權西路R', '民權西路'),
  before2015('圓山', '圓山'),
  before2015('劍潭', '劍潭'),
  before2015('士林', '士林'),
  before2015('芝山', '芝山'),
  before2015('明德', '明德'),
  before2015('石牌', '石牌'),
  before2015('唭哩岸', '唭哩岸'),
  before2015('奇岩', '奇岩'),
  before2015('北投', '北投'),
  before2015('新北投', '新北投'),
  before2015('復興崗', '復興崗'),
  before2015('忠義', '忠義'),
  before2015('關渡', '關渡'),
  before2015('竹圍', '竹圍'),
  before2015('紅樹林', '紅樹林'),
  before2015('淡水', '淡水'),
  dingpu('頂埔'),
  before2015('永寧', '永寧'),
  before2015('土城', '土城'),
  before2015('海山', '海山'),
  before2015('亞東醫院', '亞東醫院'),
  before2015('府中', '府中'),
  before2015('板橋', '板橋'),
  before2015('新埔', '新埔'),
  before2015('江子翠', '江子翠'),
  before2015('龍山寺', '龍山寺'),
  before2015('西門', '西門'),
  before2015('善導寺', '善導寺'),
  before2015('忠孝新生BL', '忠孝新生'),
  before2015('忠孝復興BL', '忠孝復興'),
  before2015('忠孝敦化', '忠孝敦化'),
  before2015('國父紀念館', '國父紀念館'),
  before2015('市政府', '市政府'),
  before2015('永春', '永春'),
  before2015('後山埤', '後山埤'),
  before2015('昆陽', '昆陽'),
  before2015('南港', '南港'),
  before2015('南港展覽館BL', '南港展覽館'),
  before2015('象山', '象山'),
  before2015('台北101/世貿', '台北101/世貿'),
  before2015('信義安和', '信義安和'),
  before2015('大安R', '大安'),
  before2015('大安森林公園', '大安森林公園'),
  before2015('北門', '北門'),
  before2015('中山G', '中山'),
  before2015('松江南京G', '松江南京'),
  before2015('南京復興G', '南京復興'),
  before2015('台北小巨蛋', '台北小巨蛋'),
  before2015('南京三民', '南京三民'),
  before2015('松山', '松山'),
  before2015('輔大', '輔大'),
  before2015('新莊', '新莊'),
  before2015('頭前庄', '頭前庄'),
  before2015('先嗇宮', '先嗇宮'),
  before2015('三重', '三重'),
  before2015('菜寮', '菜寮'),
  before2015('台北橋', '台北橋'),
  before2015('大橋頭', '大橋頭'),
  before2015('民權西路O', '民權西路'),
  before2015('中山國小', '中山國小'),
  before2015('行天宮', '行天宮'),
  before2015('松江南京O', '松江南京'),
  before2015('忠孝新生O', '忠孝新生'),
  before2015('東門', '東門'),
  before2015('蘆洲', '蘆洲'),
  before2015('三民高中', '三民高中'),
  before2015('徐匯中學', '徐匯中學'),
  before2015('三和國中', '三和國中'),
  before2015('三重國小', '三重國小'),
  before2015('迴龍', '迴龍'),
  before2015('丹鳳', '丹鳳'),
  circular('大坪林Y', '大坪林', '大坪林', 'nearest', 0.00),
  circular('十四張', '十四張', '大坪林', 'nearest', 1.39),
  circular('秀朗橋', '秀朗橋', '南勢角', 'nearest', 1.59),
  circular('景平', '景平', '南勢角', 'nearest', 0.76),
  circular('景安Y', '景安', '景安', 'nearest', 0.00),
  circular('中和', '中和', '景安', 'nearest', 1.32),
  circular('橋和', '橋和', '景安', 'nearest', 1.88),
  circular('中原', '中原', '板橋', 'nearest', 2.26),
  circular('板新', '板新', '板橋', 'nearest', 0.97),
  circular('板橋Y', '板橋', '板橋', 'nearest', 0.25),
  circular('新埔民生', '新埔民生', '新埔', 'nearest', 0.32),
  circular('頭前庄Y', '頭前庄', '頭前庄', 'nearest', 0.00),
  circular('幸福', '幸福', '頭前庄', 'nearest', 1.13),
  circular('新北產業園區', '新北產業園區', '先嗇宮', 'nearest', 2.06),
];

export interface BorderStation {
  /** Station name as in `MrtRowEntry.station`. */
  readonly station: string;
  /** English name for SOURCES.md. */
  readonly nameEn: string;
  /** District that contains the TDX station point (the one used by the pipeline, Requirement 11.1). */
  readonly pointDistrict: string;
  /** District named in the official station address. */
  readonly addressDistrict: string;
}

/**
 * The 7 stations whose TDX point and official address are in different districts (DATA-CHECK.md item 11, checked
 * against `StationAddress` and the point in `tdx-station-{TRTC,NTMC}.json`). The pipeline assigns them by point.
 * District names are the romanized display names of `scripts/lib/districts.ts`.
 */
export const BORDER_STATIONS: readonly BorderStation[] = [
  { station: '公館', nameEn: 'Gongguan', pointDistrict: "Da'an", addressDistrict: 'Zhongzheng' },
  { station: '台電大樓', nameEn: 'Taipower Building', pointDistrict: "Da'an", addressDistrict: 'Zhongzheng' },
  { station: '中山', nameEn: 'Zhongshan', pointDistrict: 'Zhongshan', addressDistrict: 'Datong' },
  { station: '民權西路', nameEn: 'Minquan W. Rd.', pointDistrict: 'Zhongshan', addressDistrict: 'Datong' },
  { station: '雙連', nameEn: 'Shuanglian', pointDistrict: 'Zhongshan', addressDistrict: 'Datong' },
  { station: '圓山', nameEn: 'Yuanshan', pointDistrict: 'Zhongshan', addressDistrict: 'Datong' },
  { station: '永安市場', nameEn: 'Yongan Market', pointDistrict: 'Yonghe', addressDistrict: 'Zhonghe' },
];

/**
 * Checks every row name of the annual series against the table (Requirement 11.11). A name that is neither in
 * `MRT_ROWS` nor in `NON_STATION_ROWS` throws a DataError naming the row and the year.
 */
export function checkRowNames(
  annualRows: readonly { readonly name: string; readonly year: number }[],
  rows: readonly MrtRowEntry[] = MRT_ROWS,
): void {
  const known = new Set<string>([...rows.map((r) => r.name), ...NON_STATION_ROWS]);
  for (const row of annualRows) {
    if (!known.has(row.name)) {
      throw new DataError('mrt-unknown-station', `${row.name} ${row.year}`, [
        `station row: ${row.name}`,
        `year: ${row.year}`,
        'add it to MRT_ROWS (or NON_STATION_ROWS) in scripts/pipeline/tables/mrt-stations.ts',
      ]);
    }
  }
}
