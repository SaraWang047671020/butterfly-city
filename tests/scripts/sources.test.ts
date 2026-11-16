import { describe, expect, it } from 'vitest';
import { releaseLinks } from '../../scripts/sources/affordability.ts';
import { validDaysByYear, type DailyRow } from '../../scripts/sources/air.ts';
import { readWorkplace } from '../../scripts/sources/commute.ts';
import { districtTotals } from '../../scripts/sources/income.ts';
import { countByQuarter } from '../../scripts/sources/lvr.ts';
import { aggregateOd, parseIndex } from '../../scripts/sources/mrt.ts';
import { districtsInRentStats, readTenure } from '../../scripts/sources/rent.ts';
import { rocSlashDateYear } from '../../scripts/sources/social-housing.ts';
import { mergeByName } from '../../scripts/sources/stations.ts';
import { linesOf, makeOds } from './helpers.ts';

describe('income districtTotals', () => {
  it('reads district total rows under either first-column name', () => {
    const old = '"鄉鎮市區","村里","納稅單位(戶)","中位數"\n"新北市坪林區","坪林里","500","400"\n"新北市坪林區","合計","1,311","531"\n';
    const recent = '"縣市別","村里","納稅單位(戶)","中位數"\n"臺北市大安區","合計","105270","828"\n"基隆市中正區","合計","1","1"\n';
    expect(districtTotals(old)).toEqual([{ code: '65000200', households: 1311, median: 531 }]);
    expect(districtTotals(recent)).toEqual([{ code: '63000030', households: 105270, median: 828 }]);
  });
});

describe('lvr countByQuarter', () => {
  const header = '鄉鎮市區,交易標的,租賃年月日,主要用途,編號';
  const english = 'district,target,date,use,id';
  it('counts building transactions by transaction quarter, de-duplicated by id', () => {
    const season1 = [header, english, '萬華區,租賃房屋,1121108,住家用,A1', '萬華區,租賃土地,1121108,,A2', '萬華區,租賃房屋,1040215,商業用,A3'].join('\n');
    const season2 = [header, english, '萬華區,租賃房屋,1121108,住家用,A1', '烏來區,租賃房屋,1121108,住家用,B1'].join('\n');
    const { counts, duplicates } = countByQuarter([
      { cityZh: '臺北市', text: season1 },
      { cityZh: '臺北市', text: season2 },
    ]);
    expect(duplicates).toBe(1);
    expect(counts.get('63000070')?.get('2023Q4')).toEqual({ all: 1, residential: 1 });
    expect(counts.get('63000070')?.get('2015Q1')).toEqual({ all: 1, residential: 0 });
    // 臺北市烏來區 does not exist, so the row is ignored.
    expect(counts.size).toBe(1);
  });
});

describe('mrt', () => {
  it('parses index files with and without an item column', () => {
    expect(parseIndex('SeqNo,西元年,月,URL\n1,2017,1,http://x/a.csv\n')).toEqual([{ item: 'OD', year: 2017, month: 1, url: 'http://x/a.csv' }]);
    expect(parseIndex('SeqNo,項目,西元年,月,URL\n1,臺北捷運各站出站量統計,2015,2,http://y\n')[0]?.item).toBe('臺北捷運各站出站量統計');
  });

  it('sums OD trips by entry and exit station', async () => {
    const csv = '日期,時段,進站,出站,人次\n2025-12-01,08,板橋,西門,10\n2025-12-01,09,板橋,台北車站,5\n2025-12-02,08,西門,板橋,3\n';
    expect(await aggregateOd(linesOf(csv))).toEqual({
      entries: { 板橋: 15, 西門: 3 },
      exits: { 西門: 10, 台北車站: 5, 板橋: 3 },
      rows: 3,
      days: 2,
    });
  });
});

describe('air validDaysByYear', () => {
  it('counts distinct dates with at least one valid hourly value', () => {
    const rows = [
      { monitordate: '2022-01-01', monitorvalue00: '12', monitorvalue01: 'x' },
      { monitordate: '2022-01-01 ', monitorvalue00: '13' }, // duplicate day
      { monitordate: '2022-01-02', monitorvalue00: '#', monitorvalue01: '' }, // all invalid
      { monitordate: '2023-05-05', monitorvalue23: '7.5' },
    ] as unknown as DailyRow[];
    expect(Object.fromEntries(validDaysByYear(rows))).toEqual({ '2022': 1, '2023': 1 });
  });
});

describe('affordability releaseLinks', () => {
  it('extracts quarters from entity-encoded link text, including combined releases', () => {
    const encode = (s: string) => [...s].map((c) => `&#x${c.codePointAt(0)!.toString(16)};`).join('');
    const html =
      `<a href="https://pip.moi.gov.tw/Upload/CustomFile/Doc/115Q1.pdf">${encode('下載115年第1季房價負擔能力統計發布內容')}</a>` +
      '<a href="https://pip.moi.gov.tw/Upload/CustomFile/Doc/107Q3Q4.pdf" >下載107年第3、4季房價負擔能力</a>';
    expect(releaseLinks(html)).toEqual([
      { url: 'https://pip.moi.gov.tw/Upload/CustomFile/Doc/115Q1.pdf', quarters: ['2026Q1'] },
      { url: 'https://pip.moi.gov.tw/Upload/CustomFile/Doc/107Q3Q4.pdf', quarters: ['2018Q3', '2018Q4'] },
    ]);
  });
});

describe('census tables', () => {
  it('reads renting households per district from table 34', () => {
    const ods = makeOds([['總　計', '自有'], ['　　坪林區', '1 162', '947', '61', '41', '113', 'Pinglin District']]);
    expect(readTenure('新北市', ods)).toEqual([{ code: '65000200', households: 1162, renting: 41 }]);
  });

  it('reads the first (total) block of table 14 and ignores later blocks', () => {
    const ods = makeOds([
      ['松山區', '86 211', '43 377', '31 498', '11 336'],
      ['松山區', '40 000', '20 000', '15 000', '5 000'], // male block
    ]);
    expect(readWorkplace('臺北市', ods)).toEqual([
      { code: '63000010', workers: 86211, sameDistrict: 43377, otherDistrictSameCity: 31498, otherCountyOrAbroad: 11336 },
    ]);
  });

  it('finds districts in MOI rent statistics rows', () => {
    const ods = makeOds([['1', '新北市', '板橋區', '不分類'], ['2', '臺北市', '萬華區']]);
    expect([...districtsInRentStats(ods)].sort()).toEqual(['63000070', '65000010']);
  });
});

describe('small parsers', () => {
  it('parses ROC slash dates', () => {
    expect(rocSlashDateYear('112/02/23')).toBe(2023);
    expect(rocSlashDateYear('')).toBeUndefined();
    expect(rocSlashDateYear('(預計)115/03/31')).toBeUndefined();
  });

  it('merges transfer stations by name without mutating input', () => {
    const rows = [
      { system: 'TRTC', ids: ['BL12'], name: '台北車站', nameEn: 'Taipei Main Station', lon: 121.5, lat: 25.04 },
      { system: 'TRTC', ids: ['R10'], name: '台北車站', nameEn: 'Taipei Main Station', lon: 121.5, lat: 25.04 },
      { system: 'Ankeng LRT', ids: ['K9'], name: '十四張站', nameEn: '', lon: 121.52, lat: 24.98 },
      { system: 'NTMC', ids: ['Y07'], name: '十四張', nameEn: 'Shisizhang', lon: 121.52, lat: 24.98 },
    ];
    const merged = mergeByName(rows);
    expect(merged.map((m) => m.ids)).toEqual([['BL12', 'R10'], ['K9', 'Y07']]);
    expect(rows[0]!.ids).toEqual(['BL12']);
  });
});
