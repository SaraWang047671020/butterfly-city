// Source registry: one SourceEntry per dataset (design: "Source registry").
// The id prefix is the scripts/download.ts id that fetches the dataset.
// URLs point to catalogue or agency pages, never to download endpoints that carry keys.
import type { SourceEntry } from '../../../src/types/data-files.ts';

const OGDL = 'OGDL v1.0';
const NOT_STATED = 'not stated';
const MOI_DLA = 'MOI Department of Land Administration';
const MOI_DHR = 'MOI Department of Household Registration';
const MOI_PIP = 'MOI (Real Estate Information Platform)';

// Entries are in a fixed order; output files list the referenced subset in this order.
export const SOURCE_REGISTRY: readonly SourceEntry[] = [
  {
    id: 'boundaries/moi-7441',
    agency: 'MOI Department of Land Administration (distributed by NLSC via TGOS)',
    dataset: '鄉鎮市區界線(TWD97經緯度)',
    datasetEn: 'Township and district boundaries (TWD97 longitude/latitude)',
    url: 'https://data.gov.tw/dataset/7441',
    years: [2025, 2025],
    license: OGDL,
  },
  {
    id: 'population/moi-32973',
    agency: MOI_DHR,
    dataset: '村里戶數、單一年齡人口',
    datasetEn: 'Households and population by single year of age, by village',
    url: 'https://data.gov.tw/dataset/32973',
    years: [2015, 2017],
    license: OGDL,
  },
  {
    id: 'population/ris-odrp014',
    agency: MOI_DHR,
    dataset: 'ODRP014 open API',
    datasetEn: 'Households and population by single year of age, by village (with district code), open API ODRP014',
    url: 'https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP014',
    years: [2018, 2025],
    license: OGDL,
  },
  {
    id: 'population/moi-32975',
    agency: MOI_DHR,
    dataset: '遷入遷出統計表',
    datasetEn: 'Move-in and move-out statistics',
    url: 'https://data.gov.tw/dataset/32975',
    years: [2015, 2017],
    license: OGDL,
  },
  {
    id: 'population/ris-odrp011',
    agency: MOI_DHR,
    dataset: 'ODRP011 open API',
    datasetEn: 'Move-in and move-out by village, open API ODRP011',
    url: 'https://www.ris.gov.tw/rs-opendata/api/v1/datastore/ODRP011',
    years: [2018, 2025],
    license: OGDL,
  },
  {
    id: 'population/moi-77144',
    agency: MOI_DHR,
    dataset: '77144 CSV (2024-08)',
    datasetEn: 'Move-in and move-out CSV for 2024-08, which the open API does not return',
    url: 'https://data.gov.tw/dataset/77144',
    years: [2024, 2024],
    license: OGDL,
  },
  {
    id: 'population/taipei-dbas-a05002802',
    agency: 'Taipei City DBAS',
    dataset: '各區人口增加 (annual)',
    datasetEn: 'Population change by district, annual',
    url: 'https://tsis.dbas.gov.taipei/statis/webMain.aspx?sys=220&ymf=10300&kind=21&type=0&funid=a05002802&cycle=4&outmode=12&compmode=0&outkind=1&deflst=2&nzo=1',
    years: [2015, 2015],
    license: OGDL,
  },
  {
    id: 'population/ntpc-124872',
    agency: 'New Taipei City DBAS',
    dataset: '戶籍動態',
    datasetEn: 'Household registration dynamics',
    url: 'https://data.gov.tw/dataset/124872',
    years: [2015, 2015],
    license: OGDL,
  },
  {
    id: 'income/fia-103066',
    agency: 'Fiscal Information Agency, MOF',
    dataset: '綜稅綜合所得總額全國各縣市鄉鎮村里統計分析表',
    datasetEn: 'Comprehensive income tax statistics by county, township and village',
    url: 'https://data.gov.tw/dataset/103066',
    years: [2014, 2023],
    license: OGDL,
  },
  {
    id: 'income/dgbas-9415',
    agency: 'DGBAS',
    dataset: '家庭收支調查 平均每戶可支配所得 (by county)',
    datasetEn: 'Household Income and Expenditure Survey, average disposable income per household by county',
    url: 'https://data.gov.tw/dataset/9415',
    years: [2015, 2025],
    license: OGDL,
  },
  {
    id: 'lvr/moi-25119',
    agency: MOI_DLA,
    dataset: '實價登錄 sales',
    datasetEn: 'Real-price registration, sales',
    url: 'https://data.gov.tw/dataset/25119',
    years: [2015, 2026],
    license: OGDL,
  },
  {
    id: 'lvr/moi-25118',
    agency: MOI_DLA,
    dataset: '實價登錄 rentals',
    datasetEn: 'Real-price registration, rentals',
    url: 'https://data.gov.tw/dataset/25118',
    years: [2015, 2026],
    license: OGDL,
  },
  {
    id: 'rent/moi-rent-stats',
    agency: MOI_PIP,
    dataset: '全國行政區租金統計',
    datasetEn: 'Rent statistics by administrative district',
    url: 'https://pip.moi.gov.tw/Publicize/Info/E1080',
    years: [2024, 2024],
    license: NOT_STATED,
  },
  {
    id: 'macro/dgbas-6019',
    agency: 'DGBAS',
    dataset: '消費者物價基本分類指數',
    datasetEn: 'Consumer price index, basic classification',
    url: 'https://data.gov.tw/dataset/6019',
    years: [2015, 2025],
    license: OGDL,
  },
  {
    id: 'macro/taipei-dbas-131822',
    agency: 'Taipei City DBAS',
    dataset: '臺北市消費者物價基本分類指數',
    datasetEn: 'Taipei consumer price index, basic classification',
    url: 'https://data.gov.tw/dataset/131822',
    years: [2015, 2025],
    license: OGDL,
  },
  {
    id: 'mrt/trtc-133184',
    agency: 'Taipei Rapid Transit Corporation (via Taipei DBAS)',
    dataset: '臺北捷運各站進出人次',
    datasetEn: 'Taipei Metro station entries and exits',
    url: 'https://data.gov.tw/dataset/133184',
    years: [2015, 2025],
    license: OGDL,
  },
  {
    id: 'mrt/trtc-128683',
    agency: 'Taipei Rapid Transit Corporation',
    dataset: '臺北捷運各站進出量統計',
    datasetEn: 'Taipei Metro station entry and exit volumes',
    url: 'https://data.gov.tw/dataset/128683',
    years: [2015, 2016],
    license: OGDL,
  },
  {
    id: 'stations/tdx-metro-station',
    agency: 'MOTC Transport Data eXchange',
    dataset: 'Rail/Metro/Station TRTC, NTMC',
    datasetEn: 'Metro station locations, Taipei Metro and New Taipei Metro',
    url: 'https://tdx.transportdata.tw/',
    years: [2025, 2026],
    license: NOT_STATED, // TDX terms of use not verified (DATA-CHECK.md gap 8)
  },
  {
    id: 'social-housing/nlma-portal',
    agency: 'National Land Management Agency, MOI',
    dataset: '社會住宅即時資訊平台',
    datasetEn: 'Social housing real-time information portal',
    url: 'https://socialhousing.nlma.gov.tw/CPA_SocialHousing_Portal/',
    years: [1971, 2026],
    license: NOT_STATED,
  },
  {
    id: 'affordability/moi-e1050',
    agency: MOI_PIP,
    dataset: '房價負擔能力統計',
    datasetEn: 'Housing affordability statistics',
    url: 'https://pip.moi.gov.tw/Publicize/Info/E1050',
    years: [2016, 2025],
    license: NOT_STATED, // cited only by the price-to-income validation note
  },
  // Policy sources. Where the design gives the URL as "per row of a committed table", the entry
  // carries the agency page below. The real URL is replaced by the first cited row of the committed
  // table when the `policy` download source and the tables record it (task 11).
  {
    id: 'policy/moi-e3010',
    agency: MOI_PIP,
    dataset: '住宅補貼 tables 6_1_3 and 6_3_1 (rent subsidy households)',
    datasetEn: 'Housing subsidy tables 6_1_3 and 6_3_1, rent subsidy households',
    url: 'https://pip.moi.gov.tw/Publicize/Info/E3010',
    years: [2015, 2025],
    license: NOT_STATED,
  },
  {
    id: 'policy/moi-169800',
    agency: 'MOI',
    dataset: '租金補貼 household-months and amounts',
    datasetEn: 'Rent subsidy household-months and amounts',
    url: 'https://data.gov.tw/dataset/169800',
    years: [2023, 2023],
    license: OGDL,
  },
  {
    id: 'policy/moi-b5010',
    agency: MOI_PIP,
    dataset: '包租代管 cumulative matches by phase',
    datasetEn: 'Sublease and rental management program, cumulative matches by phase',
    url: 'https://pip.moi.gov.tw/Publicize/Info/B5010',
    years: [2017, 2026],
    license: NOT_STATED,
  },
  {
    id: 'policy/house-tax-act',
    agency: 'Ministry of Finance',
    dataset: '房屋稅條例 (House Tax Act), rate range for other residential buildings',
    datasetEn: 'House Tax Act, rate range for other residential buildings',
    url: 'https://www.mof.gov.tw/',
    years: [2014, 2025],
    license: NOT_STATED,
  },
  {
    id: 'policy/taipei-ordinance',
    agency: 'Taipei City Government',
    dataset: 'Taipei house tax collection rules',
    url: 'https://www.gov.taipei/',
    years: [2015, 2025],
    license: NOT_STATED,
  },
  {
    id: 'policy/ntpc-ordinance',
    agency: 'New Taipei City Government',
    dataset: 'New Taipei house tax collection rules',
    url: 'https://www.ntpc.gov.tw/',
    years: [2017, 2025],
    license: NOT_STATED,
  },
  {
    id: 'policy/mof-6742',
    agency: 'MOF',
    dataset: '賦稅統計 house tax collections by county',
    datasetEn: 'Tax statistics, house tax collections by county',
    url: 'https://data.gov.tw/dataset/6742',
    years: [2015, 2025],
    license: OGDL,
  },
  {
    id: 'policy/trtc-products',
    agency: 'Taipei Rapid Transit Corporation',
    dataset: 'Commuter pass products and prices',
    url: 'https://www.metro.taipei/',
    years: [2018, 2025],
    license: NOT_STATED,
  },
  {
    id: 'policy/taipei-dot-2020',
    agency: 'Taipei City Department of Transportation',
    dataset: 'Commuter pass cumulative sales to 2020-12-31',
    url: 'https://www.dot.gov.taipei/',
    years: [2018, 2020],
    license: NOT_STATED,
  },
];

const CREDENTIAL_PARAM = /^(api_?key|key|token|access_token|client_secret|secret)$/i;

/** Replaces the value of every credential query parameter with REDACTED. Idempotent; the rest of the URL is unchanged. */
export function redactUrl(url: string): string {
  const q = url.indexOf('?');
  if (q < 0) return url;
  const hashAt = url.indexOf('#', q);
  const queryEnd = hashAt < 0 ? url.length : hashAt;
  const query = url.slice(q + 1, queryEnd);
  const redacted = query
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq < 0) return pair;
      let name = pair.slice(0, eq);
      try {
        name = decodeURIComponent(name);
      } catch {
        // keep the raw name
      }
      return CREDENTIAL_PARAM.test(name) ? `${pair.slice(0, eq)}=REDACTED` : pair;
    })
    .join('&');
  return url.slice(0, q + 1) + redacted + url.slice(queryEnd);
}

const BY_ID: ReadonlyMap<string, SourceEntry> = new Map(SOURCE_REGISTRY.map((s) => [s.id, s]));

export function sourceById(id: string): SourceEntry {
  const entry = BY_ID.get(id);
  if (entry === undefined) throw new Error(`Unknown source id: ${id}`);
  return entry;
}

/** Entries for the given ids, in registry order, without duplicates. Throws on an unknown id. */
export function referencedSources(ids: Iterable<string>): SourceEntry[] {
  const wanted = new Set<string>();
  for (const id of ids) {
    sourceById(id);
    wanted.add(id);
  }
  return SOURCE_REGISTRY.filter((s) => wanted.has(s.id));
}
