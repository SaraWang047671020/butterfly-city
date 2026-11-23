// Landmark_Table (city-3d Requirement 7.1). Display data only: the City_View draws a simplified model at each position.
// Coordinates are the values each cited page gives, read on 2026-11-18. Names identify the buildings only (7.5).
// Every district has at least one Landmark (user decision 2026-11-18). Where the English Wikipedia has no page with
// coordinates, the Chinese Wikipedia page is cited.
// Neutral naming: the plaza building pair is listed as the National Theater and Concert Hall (the performing arts venues),
// not by a memorial name.

import type { ArchetypeId } from './archetypes.ts';

export type LandmarkModelId =
  | 'tower101'
  | 'grandHotel'
  | 'theaterConcertHall'
  | 'presidentialOffice'
  | 'mainStation'
  | 'ferrisWheel'
  | 'longshanTemple'
  | 'loversBridge'
  | 'banqiaoStation'
  | ArchetypeId;

export interface Landmark {
  readonly id: string;
  readonly name: string;
  readonly district: string; // District_Code
  readonly lon: number;
  readonly lat: number;
  /** Radius in world units kept clear of illustrative buildings, trees and streets. */
  readonly clearRadius: number;
  /** Rotation of the model about the vertical axis, in degrees. */
  readonly rotation: number;
  readonly model: LandmarkModelId;
  readonly source: { readonly citation: string; readonly url: string; readonly read: string };
}

const wiki = (title: string, url: string) => ({ citation: `Wikipedia, "${title}" (coordinates line)`, url, read: '2026-11-18' });
const zhWiki = (title: string, url: string) => ({ citation: `Chinese Wikipedia, "${title}" (coordinates line)`, url, read: '2026-11-18' });
const en = (title: string) => wiki(title.replace(/_/g, ' '), `https://en.wikipedia.org/wiki/${title}`);

type Row = readonly [id: string, name: string, district: string, lat: number, lon: number, model: LandmarkModelId, clearRadius: number, source: Landmark['source']];
const row = ([id, name, district, lat, lon, model, clearRadius, source]: Row): Landmark => ({ id, name, district, lat, lon, model, clearRadius, rotation: 0, source });

/** Landmarks for the districts that the city Landmarks below do not cover, so that every district has one. */
const DISTRICT_LANDMARKS: readonly Landmark[] = [
  row(['taipei-arena', 'Taipei Arena', '63000010', 25.05071, 121.55, 'arena', 16, en('Taipei_Arena')]),
  row(['daan-forest-park', 'Daan Forest Park', '63000030', 25.02973, 121.53614, 'park', 14, en('Daan_Forest_Park')]),
  row(['dadaocheng', 'Dadaocheng', '63000060', 25.05722, 121.51167, 'oldStreet', 12, en('Dadaocheng')]),
  row(['taipei-zoo', 'Taipei Zoo', '63000080', 24.995, 121.58417, 'zoo', 15, en('Taipei_Zoo')]),
  row(['nangang-exhibition-center', 'Taipei Nangang Exhibition Center', '63000090', 25.05565, 121.6172, 'hall', 18, en('Taipei_Nangang_Exhibition_Center')]),
  row(['dahu-park', 'Dahu Park', '63000100', 25.08222, 121.60472, 'lakeBridge', 14, en('Dahu_Park')]),
  row(['national-palace-museum', 'National Palace Museum', '63000110', 25.1022, 121.5486, 'palaceMuseum', 20, en('National_Palace_Museum')]),
  row(['beitou-hot-spring-museum', 'Beitou Hot Spring Museum', '63000120', 25.13667, 121.50722, 'bathhouse', 8, en('Beitou_Hot_Spring_Museum')]),
  row(['new-taipei-metropolitan-park', 'New Taipei Metropolitan Park', '65000020', 25.05667, 121.48083, 'park', 14, en('New_Taipei_Metropolitan_Park')]),
  row(['hongludi-fude-temple', 'Hongludi Nanshan Fude Temple', '65000030', 24.97181, 121.49775, 'earthGodTemple', 12, zhWiki('烘爐地南山福德宮', 'https://zh.wikipedia.org/wiki/%E7%83%98%E7%88%90%E5%9C%B0%E5%8D%97%E5%B1%B1%E7%A6%8F%E5%BE%B7%E5%AE%AE')]),
  row(['fuhe-bridge', 'Fuhe Bridge', '65000040', 25.00667, 121.52861, 'girderBridge', 10, zhWiki('福和橋', 'https://zh.wikipedia.org/wiki/%E7%A6%8F%E5%92%8C%E6%A9%8B')]),
  row(['xinzhuang-baseball-stadium', 'Xinzhuang Baseball Stadium', '65000050', 25.04116, 121.44772, 'stadium', 17, en('Xinzhuang_Baseball_Stadium')]),
  row(['bitan', 'Bitan', '65000060', 24.95724, 121.53596, 'suspensionBridge', 14, en('Bitan')]),
  row(['shulin-station', 'Shulin Station', '65000070', 24.9913, 121.4246, 'smallStation', 9, en('Shulin_railway_station')]),
  row(['yingge-ceramics-museum', 'Yingge Ceramics Museum', '65000080', 24.94931, 121.35203, 'museum', 10, en('New_Taipei_City_Yingge_Ceramics_Museum')]),
  row(['sanxia-old-street', 'Sanxia Old Street', '65000090', 24.93303, 121.36942, 'oldStreet', 12, en('Sanxia_Old_Street')]),
  row(['xizhi-gongbei-temple', 'Xizhi Gongbei Temple', '65000110', 25.09463, 121.64214, 'temple', 9, en('Xizhi_Gongbei_Temple')]),
  row(['jinguashi', 'Jinguashi', '65000120', 25.117, 121.85, 'hillVillage', 14, en('Jinguashi')]),
  row(['chengtian-temple', 'Chengtian Temple', '65000130', 24.95036, 121.44675, 'templeWhite', 10, zhWiki('承天禪寺', 'https://zh.wikipedia.org/wiki/%E6%89%BF%E5%A4%A9%E7%A6%AA%E5%AF%BA')]),
  row(['luzhou-lee-residence', 'Luzhou Lee Residence', '65000140', 25.08538, 121.46667, 'courtyardHouse', 10, zhWiki('蘆洲李宅', 'https://zh.wikipedia.org/wiki/%E8%98%86%E6%B4%B2%E6%9D%8E%E5%AE%85')]),
  row(['lingyun-temple', 'Lingyun Temple', '65000150', 25.12543, 121.42597, 'temple', 9, zhWiki('凌雲禪寺', 'https://zh.wikipedia.org/wiki/%E5%87%8C%E9%9B%B2%E7%A6%AA%E5%AF%BA')]),
  row(['dingtaishan-temple', 'Dingtaishan Temple', '65000160', 25.04375, 121.42357, 'temple', 9, zhWiki('頂泰山巖', 'https://zh.wikipedia.org/wiki/%E9%A0%82%E6%B3%B0%E5%B1%B1%E5%B7%96')]),
  row(['zhulinshan-guanyin-temple', 'Zhulinshan Guanyin Temple', '65000170', 25.08365, 121.38932, 'temple', 9, zhWiki('竹林山觀音寺', 'https://zh.wikipedia.org/wiki/%E7%AB%B9%E6%9E%97%E5%B1%B1%E8%A7%80%E9%9F%B3%E5%AF%BA')]),
  row(['shenkeng-old-street', 'Shenkeng Old Street', '65000180', 25.00144, 121.61408, 'oldStreet', 12, en('Shenkeng_Old_Street')]),
  row(['feicui-dam', 'Feicui Dam', '65000190', 24.90917, 121.58, 'dam', 14, en('Feicui_Dam')]),
  row(['pinglin-tea-museum', 'Pinglin Tea Museum', '65000200', 24.93444, 121.7125, 'courtyardHouse', 10, en('Ping-Lin_Tea_Museum')]),
  row(['sanzhi-fucheng-temple', 'Sanzhi Fucheng Temple', '65000210', 25.25707, 121.50145, 'temple', 9, zhWiki('三芝福成宮', 'https://zh.wikipedia.org/wiki/%E5%B0%8F%E5%9F%BA%E9%9A%86%E7%A6%8F%E6%88%90%E5%AE%AE')]),
  row(['fuguijiao-lighthouse', 'Fuguijiao Lighthouse', '65000220', 25.29854, 121.53667, 'lighthouseBanded', 6, en('Fuguijiao_Lighthouse')]),
  row(['shihsanhang-museum', 'Shihsanhang Museum of Archaeology', '65000230', 25.15675, 121.40519, 'museum', 10, en('Shihsanhang_Museum_of_Archaeology')]),
  row(['shifen-waterfall', 'Shifen Waterfall', '65000240', 25.04939, 121.78774, 'waterfall', 12, en('Shifen_Waterfall')]),
  row(['shuangxi-station', 'Shuangxi Station', '65000250', 25.03878, 121.86661, 'smallStation', 9, en('Shuangxi_railway_station')]),
  row(['cape-santiago-lighthouse', 'Cape Santiago Lighthouse', '65000260', 25.00742, 122.00192, 'lighthouse', 6, en('Cape_Santiago_Lighthouse,_Taiwan')]),
  row(['ju-ming-museum', 'Ju Ming Museum', '65000270', 25.24639, 121.61111, 'pyramidMuseum', 12, en('Ju_Ming_Museum')]),
  row(['yehliu', 'Yehliu', '65000280', 25.2131, 121.698, 'rocks', 12, en('Yehliu')]),
  row(['wulai-waterfall', 'Wulai Waterfall', '65000290', 24.8475, 121.55232, 'waterfall', 12, en('Wulai_Waterfall')]),
];

const CITY_LANDMARKS: readonly Landmark[] = [
  {
    id: 'taipei-101',
    name: 'Taipei 101',
    district: '63000020',
    lon: 121.5647,
    lat: 25.0336,
    clearRadius: 9,
    rotation: 0,
    model: 'tower101',
    source: wiki('Taipei 101', 'https://en.wikipedia.org/wiki/Taipei_101'),
  },
  {
    id: 'grand-hotel',
    name: 'Grand Hotel',
    district: '63000040',
    lon: 121.52578,
    lat: 25.07733,
    clearRadius: 13,
    rotation: 0,
    model: 'grandHotel',
    source: wiki('Grand Hotel (Taipei)', 'https://en.wikipedia.org/wiki/Grand_Hotel_(Taipei)'),
  },
  {
    id: 'theater-concert-hall',
    name: 'National Theater and Concert Hall',
    district: '63000050',
    lon: 121.51806,
    lat: 25.035,
    clearRadius: 15,
    rotation: 0,
    model: 'theaterConcertHall',
    source: wiki('National Theater and Concert Hall', 'https://en.wikipedia.org/wiki/National_Theater_and_Concert_Hall'),
  },
  {
    id: 'presidential-office',
    name: 'Presidential Office Building',
    district: '63000050',
    lon: 121.51194,
    lat: 25.04,
    clearRadius: 14,
    rotation: 90,
    model: 'presidentialOffice',
    source: wiki('Presidential Office Building, Taipei', 'https://en.wikipedia.org/wiki/Presidential_Office_Building,_Taipei'),
  },
  {
    id: 'taipei-main-station',
    name: 'Taipei Main Station',
    district: '63000050',
    lon: 121.517,
    lat: 25.0475,
    clearRadius: 10,
    rotation: 0,
    model: 'mainStation',
    source: wiki('Taipei Main Station', 'https://en.wikipedia.org/wiki/Taipei_Main_Station'),
  },
  {
    id: 'dazhi-ferris-wheel',
    name: 'Dazhi Ferris wheel',
    district: '63000040',
    lon: 121.55754,
    lat: 25.08282,
    clearRadius: 8,
    rotation: 30,
    model: 'ferrisWheel',
    source: wiki('Miramar Entertainment Park', 'https://en.wikipedia.org/wiki/Miramar_Entertainment_Park'),
  },
  {
    id: 'longshan-temple',
    name: 'Longshan Temple',
    district: '63000070',
    lon: 121.49944,
    lat: 25.03722,
    clearRadius: 8,
    rotation: 0,
    model: 'longshanTemple',
    source: wiki('Longshan Temple (Taipei)', 'https://en.wikipedia.org/wiki/Longshan_Temple_(Taipei)'),
  },
  {
    id: 'tamsui-lovers-bridge',
    name: "Tamsui Fisherman's Wharf",
    district: '65000100',
    lon: 121.41056,
    lat: 25.18303,
    clearRadius: 11,
    rotation: 0,
    model: 'loversBridge',
    source: wiki("Tamsui Fisherman's Wharf", 'https://en.wikipedia.org/wiki/Tamsui_Fisherman%27s_Wharf'),
  },
  {
    id: 'banqiao-station',
    name: 'Banqiao Station',
    district: '65000010',
    lon: 121.4635,
    lat: 25.0144,
    clearRadius: 10,
    rotation: 0,
    model: 'banqiaoStation',
    source: wiki('Banqiao station', 'https://en.wikipedia.org/wiki/Banqiao_station'),
  },
];

export const LANDMARKS: readonly Landmark[] = [...CITY_LANDMARKS, ...DISTRICT_LANDMARKS];
