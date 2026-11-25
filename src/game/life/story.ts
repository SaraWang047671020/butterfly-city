// Story_Lines and the Ending (life-story Requirements 5 and 6, design "Story and Ending"). Pure. A Story_Line is a
// list of parts; each part is a key of the Life_Story_File (for example `difference.rentLower`) and the values of its
// placeholders, formatted for one language by the StoryFormat the caller passes. The selection is a fixed rule, so the
// same game always gives the same story (Requirement 5.2):
//   1. the event line: the start of the decade (2015Q1), or the choice of the quarter's Life_Event and the result of
//      its Application;
//   2. the difference line: rent, else money left, else commute, else "same as real history";
//   3. the situation line (not in the first quarter, which the start line describes).
import type { QuarterKey } from '../../types/data-files.ts';
import type { City, Eligibility, Track } from './applications.ts';
import type { LifeEventId } from './events.ts';
import type { PersonalLedger } from './ledger.ts';
import type { LifeState } from './life-state.ts';
import type { ApplicationOutcome } from './tracks.ts';

export interface StoryPart {
  readonly key: string;
  readonly values: Readonly<Record<string, string>>;
}
export type StoryLine = readonly StoryPart[];

/** Formats values for one language (the UI passes one per language). */
export interface StoryFormat {
  money(n: number): string;
  percent(n: number): string;
  minutes(n: number): string;
  count(n: number): string;
  /** An Application odds (0 to 1) as a percent with one decimal. */
  odds(p: number): string;
  /** The Shared_Draw (0 to 1). */
  draw(d: number): string;
  district(code: string): string;
  city(c: City): string;
  quarter(q: QuarterKey): string;
  occupation(id: string): string;
  /** The title of an Event_Option. */
  option(event: LifeEventId, option: string): string;
  /** The rule of an Ineligible result, in words. */
  rule(e: Eligibility): string;
}

/** Differences below these are "the same" in the story (they round to the same shown value). */
export const MONEY_STEP = 100;
export const MINUTE_STEP = 1;

export interface QuarterStoryInput {
  readonly name: string;
  readonly quarter: QuarterKey;
  /** The first computed quarter of the game (2015Q1): the start line. */
  readonly first: boolean;
  readonly states: Readonly<Record<Track, LifeState>>;
  readonly ledgers: Readonly<Record<Track, PersonalLedger>>;
  /** The Life_Event asked in this quarter and the option chosen. */
  readonly choice: { readonly event: LifeEventId; readonly option: string } | null;
  /** The Application decided in this quarter. */
  readonly outcome: ApplicationOutcome | null;
  /** The rent subsidy each track would pay (amount × multiplier), for a rent subsidy result. */
  readonly subsidyAmounts: Readonly<Record<Track, number | null>>;
  readonly rentShare: number | null;
  /** Dwelling size of the Player_Version in m² (Character_Numbers), for the start line. */
  readonly size: number;
}

const self = (s: LifeState) => s.members.find((m) => m.kind === 'self');

function startPart(i: QuarterStoryInput, f: StoryFormat): StoryPart {
  const s = i.states.player;
  const me = self(s);
  const l = i.ledgers.player;
  const values: Record<string, string> = {
    name: i.name,
    district: f.district(s.home),
    occupation: me?.occupation == null ? '' : f.occupation(me.occupation),
    work: me?.workCode == null ? f.district(s.home) : f.district(me.workCode),
  };
  if (s.tenure === 'family') return { key: 'start.family', values };
  return {
    key: 'start.renting',
    values: { ...values, size: f.count(Math.round(i.size)), rentBurden: l.rentBurden === null ? '—' : f.percent(l.rentBurden) },
  };
}

function applicationParts(i: QuarterStoryInput, o: ApplicationOutcome, f: StoryFormat): StoryPart[] {
  const name = i.name;
  const district = f.district(i.states.player.home);
  if (!o.eligibility.ok) return [{ key: `application.result.ineligible.${o.benefit}`, values: { name, rule: f.rule(o.eligibility) } }];
  const parts: StoryPart[] = [
    {
      key: `application.odds.${o.benefit}`,
      values: {
        city: f.city(o.city),
        supplyPlayer: f.count(Math.round(o.supply.player)),
        supplyReal: f.count(Math.round(o.supply.real)),
        oddsPlayer: f.odds(o.odds.player),
        oddsReal: f.odds(o.odds.real),
      },
    },
    { key: 'application.draw', values: { draw: f.draw(o.draw) } },
  ];
  const kind = o.success.player && o.success.real ? 'both' : o.success.player ? 'playerOnly' : o.success.real ? 'realOnly' : 'neither';
  const homeCode = o.home.player ?? o.home.real;
  const amount = (t: Track) => {
    const a = i.subsidyAmounts[t];
    return a === null ? '—' : f.money(a);
  };
  parts.push({
    key: `application.result.${kind}.${o.benefit}`,
    values: {
      name,
      district,
      homeDistrict: homeCode === null ? district : f.district(homeCode),
      amountPlayer: amount('player'),
      amountReal: amount('real'),
      rentShare: i.rentShare === null ? '—' : f.percent(i.rentShare * 100),
    },
  });
  return parts;
}

function differencePart(i: QuarterStoryInput, f: StoryFormat): StoryPart {
  const p = i.ledgers.player;
  const r = i.ledgers.real;
  const name = i.name;
  if (p.rent !== null && r.rent !== null && Math.abs(p.rent - r.rent) >= MONEY_STEP) {
    return { key: p.rent < r.rent ? 'difference.rentLower' : 'difference.rentHigher', values: { name, rentDiff: f.money(Math.abs(p.rent - r.rent)) } };
  }
  if (p.left !== null && r.left !== null && Math.abs(p.left - r.left) >= MONEY_STEP) {
    return { key: p.left > r.left ? 'difference.leftMore' : 'difference.leftLess', values: { name, leftDiff: f.money(Math.abs(p.left - r.left)) } };
  }
  if (p.commuteMinutes !== null && r.commuteMinutes !== null && Math.abs(p.commuteMinutes - r.commuteMinutes) >= MINUTE_STEP) {
    const longer = p.commuteMinutes > r.commuteMinutes;
    return { key: longer ? 'difference.commuteLonger' : 'difference.commuteShorter', values: { name, commuteDiff: f.minutes(Math.abs(p.commuteMinutes - r.commuteMinutes)) } };
  }
  return { key: 'difference.same', values: { name } };
}

function situationPart(i: QuarterStoryInput, f: StoryFormat): StoryPart {
  const s = i.states.player;
  const l = i.ledgers.player;
  const values = { name: i.name, district: f.district(s.home) };
  const burden = l.rentBurden === null ? '—' : f.percent(l.rentBurden);
  if (s.tenure === 'social') return { key: 'situation.social', values: { ...values, rentShare: i.rentShare === null ? '—' : f.percent(i.rentShare * 100) } };
  if (s.tenure === 'sublease') return { key: 'situation.sublease', values: { ...values, rentShare: i.rentShare === null ? '—' : f.percent(i.rentShare * 100) } };
  if (s.tenure === 'family') return { key: 'situation.family', values };
  if (l.subsidy > 0) return { key: 'situation.subsidy', values: { ...values, amount: f.money(l.subsidy) } };
  if (l.rentBurden !== null && l.rentBurden > 30) return { key: 'situation.stressed', values: { ...values, rentBurden: burden } };
  return { key: 'situation.renting', values: { ...values, rentBurden: burden } };
}

/** The 1 to 3 Story_Lines of a computed quarter (Requirement 5.2). */
export function quarterStory(i: QuarterStoryInput, f: StoryFormat): StoryLine[] {
  const lines: StoryLine[] = [];
  if (i.first) lines.push([startPart(i, f)]);
  const event: StoryPart[] = [];
  if (i.choice !== null) event.push({ key: 'choice', values: { name: i.name, option: f.option(i.choice.event, i.choice.option) } });
  if (i.outcome !== null) event.push(...applicationParts(i, i.outcome, f));
  if (event.length > 0) lines.push(event);
  lines.push([differencePart(i, f)]);
  if (!i.first) lines.push([situationPart(i, f)]);
  return lines.slice(0, 3);
}

// ---------------------------------------------------------------- Ending (Requirement 6)

export interface DecadeRow {
  readonly quarter: QuarterKey;
  readonly state: LifeState;
  readonly ledger: PersonalLedger;
}

export interface DecadeSummary {
  readonly quarters: number;
  /** Rent paid over the decade (monthly rent × 3 per quarter). */
  readonly totalRent: number;
  readonly meanBurden: number | null;
  readonly stressQuarters: number;
  readonly meanCommute: number | null;
  readonly totalLeft: number;
  readonly final: LifeState;
  readonly leftIn: QuarterKey | null;
}

const mean = (xs: readonly number[]): number | null => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);

/** The decade of one track, up to the quarter the Character left the cities (Requirement 6.2). */
export function decadeSummary(rows: readonly DecadeRow[]): DecadeSummary | null {
  const last = rows[rows.length - 1];
  if (last === undefined) return null;
  const leftIn = rows.find((r) => r.state.leftIn !== undefined)?.state.leftIn ?? null;
  const lived = leftIn === null ? rows : rows.filter((r) => r.quarter < leftIn);
  const burdens = lived.flatMap((r) => (r.ledger.rentBurden === null ? [] : [r.ledger.rentBurden]));
  const commutes = lived.flatMap((r) => (r.ledger.commuteMinutes === null ? [] : [r.ledger.commuteMinutes]));
  return {
    quarters: lived.length,
    totalRent: lived.reduce((a, r) => a + (r.ledger.rent ?? 0) * 3, 0),
    meanBurden: mean(burdens),
    stressQuarters: burdens.filter((b) => b > 30).length,
    meanCommute: mean(commutes),
    totalLeft: lived.reduce((a, r) => a + (r.ledger.left ?? 0) * 3, 0),
    final: (lived[lived.length - 1] ?? last).state,
    leftIn,
  };
}

/** The ending template of one version: the first rule that holds (Requirement 6.3). */
export function endingPart(name: string, s: DecadeSummary, f: StoryFormat): StoryPart {
  const values = {
    name,
    district: f.district(s.final.home),
    quarters: f.count(s.quarters),
    meanBurden: s.meanBurden === null ? '—' : f.percent(s.meanBurden),
    stressQuarters: f.count(s.stressQuarters),
  };
  if (s.leftIn !== null) return { key: 'ending.versions.left', values: { ...values, quarter: f.quarter(s.leftIn) } };
  if (s.final.tenure === 'social') {
    return { key: 'ending.versions.social', values: { ...values, since: s.final.socialSince === undefined ? '—' : f.quarter(s.final.socialSince) } };
  }
  if (s.final.tenure === 'sublease') {
    return { key: 'ending.versions.sublease', values: { ...values, since: s.final.subleaseSince === undefined ? '—' : f.quarter(s.final.subleaseSince) } };
  }
  if (s.final.tenure === 'family') return { key: 'ending.versions.family', values };
  if (s.meanBurden !== null && s.meanBurden > 30) return { key: 'ending.versions.stressed', values };
  return { key: 'ending.versions.renting', values };
}

/** Every key the selection can produce; the Life_Story_File must hold each one in both languages (Requirement 9.4). */
export const STORY_KEYS: readonly string[] = [
  'start.renting',
  'start.family',
  'choice',
  'application.draw',
  ...(['socialHousing', 'rentSubsidy', 'sublease'] as const).flatMap((b) => [
    `application.odds.${b}`,
    ...['both', 'playerOnly', 'realOnly', 'neither', 'ineligible'].map((k) => `application.result.${k}.${b}`),
  ]),
  ...['rentLower', 'rentHigher', 'leftMore', 'leftLess', 'commuteShorter', 'commuteLonger', 'same'].map((k) => `difference.${k}`),
  ...['social', 'sublease', 'subsidy', 'stressed', 'renting', 'family'].map((k) => `situation.${k}`),
  ...['left', 'social', 'sublease', 'family', 'stressed', 'renting'].map((k) => `ending.versions.${k}`),
  'ending.title',
];
