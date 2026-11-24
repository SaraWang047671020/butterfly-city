// Missions (night-ghosts Requirement 4, design "Missions"). Pure. A Mission must be reachable by the decisions of the
// day it is picked: the easy types target what the day's policy sets; the hard types target indicators that respond to
// earlier decisions. Each Mission is asked by a Mission_Giver (Kind A, Kind B or a Model_Ghost, never Kind C or a
// Memorial_Point). Missions read the session and never change an Engine input or result (Requirement 4.5).
import { quarterIndex } from '../../simulation/quarter.ts';
import type { QuarterKey } from '../../types/data-files.ts';
import { hashSeed, mulberry32 } from '../random.ts';

export type MissionTool = 'socialHousing' | 'rentSubsidy' | 'commuterPass';
export type MissionType = 'startHomes' | 'subsidise' | 'passSupport' | 'fewerAbove' | 'metroRiders';
export type Track = 'player' | 'real';

export interface MissionRules {
  /** startHomes: real × factor, at least real + minExtra units. */
  readonly startHomes: { readonly factor: number; readonly minExtra: number };
  readonly subsidise: { readonly factor: number };
  /** passSupport: real subsidy + extra TWD. */
  readonly passSupport: { readonly extra: number };
  /** fewerAbove: fewer people above a line than real history by this share of the district's population. */
  readonly fewerAbove: { readonly share: number };
  readonly metroRiders: { readonly factor: number };
}

export const TYPE_TOOL: Readonly<Record<MissionType, MissionTool>> = {
  startHomes: 'socialHousing',
  subsidise: 'rentSubsidy',
  passSupport: 'commuterPass',
  fewerAbove: 'rentSubsidy',
  metroRiders: 'commuterPass',
};
export const EASY: ReadonlySet<MissionType> = new Set(['startHomes', 'subsidise', 'passSupport']);
const HARD: readonly MissionType[] = ['fewerAbove', 'metroRiders'];

/** A ghost that can ask for Missions: a Kind A or B scene, with the theme it speaks about. */
export interface GiverScene {
  readonly scene: string;
  readonly kind: 'A' | 'B';
  readonly district: string;
  readonly city: string;
  readonly theme: 'rent' | 'transit';
}

export type Giver = { readonly kind: 'model'; readonly district: string } | { readonly kind: 'A' | 'B'; readonly scene: string };

export interface Mission {
  readonly id: string;
  readonly type: MissionType;
  readonly tool: MissionTool;
  /** A District_Code, or a city name for the city tools. */
  readonly area: string;
  readonly quarter: QuarterKey;
  readonly target: number;
  /** The real-history value the target is built from (null WHEN missing: the Mission is not offered). */
  readonly real: number;
  readonly difficulty: 'easy' | 'hard';
  readonly giver: Giver;
}

/** What Missions read from the game: the policy values and indicators of both tracks. */
export interface MissionWorld {
  readonly activeTools: readonly MissionTool[];
  readonly districts: readonly { readonly code: string; readonly city: string }[];
  readonly givers: readonly GiverScene[];
  /** A policy value of a tool field for an area (District_Code or city) in a quarter. */
  policy(tool: MissionTool, field: string, area: string, quarter: QuarterKey, track: Track): number | null;
  /** MRT entries of a district in a quarter on a track. */
  mrtEntries(code: string, quarter: QuarterKey, track: Track): number | null;
  /** People above a rent or commute line compared with real history (player − real), in a computed quarter. */
  ghostDiff(code: string, quarter: QuarterKey): number | null;
  population(code: string, quarter: QuarterKey): number | null;
}

const FIELD: Readonly<Record<'startHomes' | 'subsidise' | 'passSupport', string>> = {
  startHomes: 'unitsStarted',
  subsidise: 'households',
  passSupport: 'subsidy',
};

/** The target of a type in an area and quarter, from real history; null WHEN the real value is missing. */
export function targetOf(r: MissionRules, w: MissionWorld, type: MissionType, area: string, q: QuarterKey): { readonly target: number; readonly real: number } | null {
  switch (type) {
    case 'startHomes': {
      const real = w.policy('socialHousing', FIELD.startHomes, area, q, 'real');
      return real === null ? null : { real, target: Math.ceil(Math.max(real * r.startHomes.factor, real + r.startHomes.minExtra)) };
    }
    case 'subsidise': {
      const real = w.policy('rentSubsidy', FIELD.subsidise, area, q, 'real');
      return real === null ? null : { real, target: Math.ceil(real * r.subsidise.factor) };
    }
    case 'passSupport': {
      const real = w.policy('commuterPass', FIELD.passSupport, area, q, 'real');
      return real === null ? null : { real, target: real + r.passSupport.extra };
    }
    case 'fewerAbove': {
      const pop = w.population(area, q);
      return pop === null ? null : { real: 0, target: Math.ceil(pop * r.fewerAbove.share) };
    }
    case 'metroRiders': {
      const real = w.mrtEntries(area, q, 'real');
      return real === null || real <= 0 ? null : { real, target: Math.ceil(real * r.metroRiders.factor) };
    }
  }
}

const cityType = (t: MissionType): boolean => t === 'subsidise' || t === 'passSupport';

function giverFor(w: MissionWorld, type: MissionType, area: string, rand: () => number): Giver {
  const theme: GiverScene['theme'] = type === 'passSupport' || type === 'metroRiders' ? 'transit' : 'rent';
  const inArea = w.givers.filter((g) => g.theme === theme && (cityType(type) ? g.city === area : g.district === area));
  const anywhere = w.givers.filter((g) => g.theme === theme);
  const pool = inArea.length > 0 ? inArea : theme === 'transit' ? anywhere : [];
  // A Model_Ghost speaks for its district half of the time, and always WHEN no scene fits.
  if (pool.length === 0 || (theme === 'rent' && rand() < 0.5)) {
    const district = cityType(type) ? (w.districts.filter((d) => d.city === area)[0]?.code ?? area) : area;
    return { kind: 'model', district };
  }
  const g = pool[Math.floor(rand() * pool.length)]!;
  return { kind: g.kind, scene: g.scene };
}

/**
 * The Mission_Offer of a day (Requirement 4.1): 3 Missions of at least 2 types, one easy and one hard; the easy one
 * rotates over the Active_Tools by quarter, so every tool appears at least once in a year. Seeded: the same game gives
 * the same offer. Missions whose real value is missing are not offered.
 */
export function missionOffer(r: MissionRules, w: MissionWorld, seed: number, q: QuarterKey): Mission[] {
  const rand = mulberry32(hashSeed(`${seed}:missions:${q}`));
  const tools = w.activeTools;
  if (tools.length === 0 || w.districts.length === 0) return [];
  const cities = [...new Set(w.districts.map((d) => d.city))].sort();
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const make = (type: MissionType): Mission | null => {
    if (!tools.includes(TYPE_TOOL[type]) && type !== 'fewerAbove') return null;
    const area = cityType(type) ? pick(cities) : pick(w.districts).code;
    const t = targetOf(r, w, type, area, q);
    if (t === null) return null;
    return {
      id: `${type}:${area}:${q}`,
      type,
      tool: TYPE_TOOL[type],
      area,
      quarter: q,
      target: t.target,
      real: t.real,
      difficulty: EASY.has(type) ? 'easy' : 'hard',
      giver: giverFor(w, type, area, rand),
    };
  };
  const easyTypes = (['startHomes', 'subsidise', 'passSupport'] as const).filter((t) => tools.includes(TYPE_TOOL[t]));
  const rotate = easyTypes[quarterIndex(q) % Math.max(1, easyTypes.length)];
  const wanted: MissionType[] = [];
  if (rotate !== undefined) wanted.push(rotate);
  wanted.push(pick(HARD));
  const rest = [...easyTypes, ...HARD].filter((t) => !wanted.includes(t));
  if (rest.length > 0) wanted.push(pick(rest));
  const out: Mission[] = [];
  for (const type of wanted) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const m = make(type);
      if (m !== null && !out.some((x) => x.id === m.id)) {
        out.push(m);
        break;
      }
    }
  }
  return out;
}

export interface MissionResult {
  readonly mission: Mission;
  /** The player's value of the computed quarter; null WHEN missing (the Mission counts as not met). */
  readonly value: number | null;
  readonly met: boolean;
}

/** Checks a picked Mission against the computed quarter (Requirement 4.4). */
export function checkMission(w: MissionWorld, m: Mission): MissionResult {
  let value: number | null;
  let met: boolean;
  switch (m.type) {
    case 'startHomes':
    case 'subsidise':
    case 'passSupport':
      value = w.policy(m.tool, FIELD[m.type], m.area, m.quarter, 'player');
      met = value !== null && value >= m.target;
      break;
    case 'fewerAbove': {
      const d = w.ghostDiff(m.area, m.quarter);
      value = d === null ? null : -d;
      met = value !== null && value >= m.target;
      break;
    }
    case 'metroRiders':
      value = w.mrtEntries(m.area, m.quarter, 'player');
      met = value !== null && value >= m.target;
      break;
  }
  return { mission: m, value, met };
}
