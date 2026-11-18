// Landmark_Table (city-3d Requirement 7.1). Display data only: the City_View draws a simplified model at each position.
// Coordinates are the values each cited page gives, read on 2026-11-18. Names identify the buildings only (7.5).
// Neutral naming: the plaza building pair is listed as the National Theater and Concert Hall (the performing arts venues),
// not by a memorial name.

export type LandmarkModelId =
  | 'tower101'
  | 'grandHotel'
  | 'theaterConcertHall'
  | 'presidentialOffice'
  | 'mainStation'
  | 'ferrisWheel'
  | 'longshanTemple'
  | 'loversBridge'
  | 'banqiaoStation';

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

export const LANDMARKS: readonly Landmark[] = [
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
    clearRadius: 8,
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
    clearRadius: 10,
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
    clearRadius: 7,
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
    clearRadius: 7,
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
    clearRadius: 6,
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
    clearRadius: 5,
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
    clearRadius: 6,
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
    clearRadius: 7,
    rotation: 0,
    model: 'banqiaoStation',
    source: wiki('Banqiao station', 'https://en.wikipedia.org/wiki/Banqiao_station'),
  },
];
