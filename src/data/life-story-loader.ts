// Life-story data files: the Application_Supply_File, the Life_Event_File and the Life_Story_File (life-story design,
// "Data"). Validation of the Application_Supply_File; it is turned into the shape the game reads. Implemented by
// Claude Code. A load error never blocks the game: the caller shows the Character without the story.
import { parseQuarter } from '../simulation/quarter.ts';
import type { ApplicationSupply, ByYear, City } from '../game/life/applications.ts';
import type { Result } from './character-loader.ts';

export const CITIES: readonly City[] = ['Taipei', 'New Taipei'];

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** A year table: keys 2015 to 2025, values that pass `ok`. */
function byYear(x: unknown, ok: (v: number) => boolean, where: string): ByYear | string {
  if (!isObj(x)) return `${where}: not an object`;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(x)) {
    if (!/^20(1[5-9]|2[0-5])$/.test(k)) return `${where}: year ${k} outside 2015 to 2025`;
    if (!isNum(v) || !ok(v)) return `${where}.${k}: invalid value`;
    out[k] = v;
  }
  if (Object.keys(out).length === 0) return `${where}: empty`;
  return out;
}

const share = (v: number) => v > 0 && v <= 1;
const positive = (v: number) => v > 0;

/** Every source id of a list must exist in the file's `sources` (life-story Requirement 8.2). */
function sourcesProblem(list: unknown, known: ReadonlySet<string>, where: string): string | null {
  if (!Array.isArray(list) || list.length === 0) return `${where}: no sources`;
  for (const id of list) if (typeof id !== 'string' || !known.has(id)) return `${where}: unknown source ${String(id)}`;
  return null;
}

export function validateApplicationSupply(x: unknown): Result<ApplicationSupply> {
  const fail = (error: string): Result<ApplicationSupply> => ({ ok: false, error: `application-supply.json: ${error}` });
  if (!isObj(x) || x['schemaVersion'] !== 1) return fail('schemaVersion must be 1');
  const sources = x['sources'];
  if (!isObj(sources)) return fail('sources missing');
  for (const [id, s] of Object.entries(sources)) {
    if (!isObj(s) || typeof s['title'] !== 'string' || typeof s['url'] !== 'string' || !['official', 'secondary', 'gap'].includes(String(s['status']))) {
      return fail(`source ${id} needs title, url and status`);
    }
  }
  const known = new Set(Object.keys(sources));
  const sh = x['socialHousing'];
  const rs = x['rentSubsidy'];
  if (!isObj(sh) || !isObj(rs)) return fail('socialHousing and rentSubsidy required');

  const odds = (block: Obj, where: string) => {
    const r = block['realOdds'];
    if (!isObj(r)) return `${where}.realOdds missing`;
    const out: Record<string, { byYear: ByYear; fallback: number }> = {};
    for (const c of CITIES) {
      const e = r[c];
      if (!isObj(e)) return `${where}.realOdds.${c} missing`;
      const t = byYear(e['byYear'], share, `${where}.realOdds.${c}`);
      if (typeof t === 'string') return t;
      if (!isNum(e['fallback']) || !share(e['fallback'])) return `${where}.realOdds.${c}.fallback invalid`;
      if (typeof e['fallbackAssumption'] !== 'string') return `${where}.realOdds.${c}.fallbackAssumption missing`;
      const p = sourcesProblem(e['sources'], known, `${where}.realOdds.${c}`);
      if (p !== null) return p;
      out[c] = { byYear: t, fallback: e['fallback'] };
    }
    return out as Record<City, { byYear: ByYear; fallback: number }>;
  };
  const perCity = (block: unknown, where: string) => {
    if (!isObj(block)) return `${where} missing`;
    const out: Record<string, ByYear> = {};
    for (const c of CITIES) {
      const e = block[c];
      if (!isObj(e)) return `${where}.${c} missing`;
      const t = byYear(e['byYear'], positive, `${where}.${c}`);
      if (typeof t === 'string') return t;
      const p = sourcesProblem(e['sources'], known, `${where}.${c}`);
      if (p !== null) return p;
      out[c] = t;
    }
    return out as Record<City, ByYear>;
  };

  const shOdds = odds(sh, 'socialHousing');
  if (typeof shOdds === 'string') return fail(shOdds);
  const limits = perCity(sh['incomeLimit'], 'socialHousing.incomeLimit');
  if (typeof limits === 'string') return fail(limits);
  const ten = sh['tenancy'];
  if (!isObj(ten) || !isNum(ten['leaseQuarters']) || !isNum(ten['maxQuarters']) || ten['leaseQuarters'] <= 0 || ten['maxQuarters'] < ten['leaseQuarters']) {
    return fail('socialHousing.tenancy invalid');
  }
  const turnover = sh['turnoverQuarters'];
  if (!isObj(turnover) || !isNum(turnover['value']) || turnover['value'] <= 0) return fail('socialHousing.turnoverQuarters invalid');
  const rentShare = sh['rentShare'];
  if (!isObj(rentShare) || !CITIES.every((c) => isNum(rentShare[c]) && share(rentShare[c] as number))) return fail('socialHousing.rentShare invalid');

  const rsOdds = odds(rs, 'rentSubsidy');
  if (typeof rsOdds === 'string') return fail(rsOdds);
  const mle = perCity(rs['minimumLivingExpense'], 'rentSubsidy.minimumLivingExpense');
  if (typeof mle === 'string') return fail(mle);
  const steps = rs['incomeMultiple'];
  if (!Array.isArray(steps) || steps.length === 0) return fail('rentSubsidy.incomeMultiple missing');
  const multiple: { from: ReturnType<typeof parseQuarter> & string; k: number }[] = [];
  for (const st of steps) {
    const from = isObj(st) ? parseQuarter(String(st['from'])) : null;
    if (from === null || !isObj(st) || !isNum(st['k']) || st['k'] <= 0) return fail('rentSubsidy.incomeMultiple entry invalid');
    if (multiple.length > 0 && from <= multiple[multiple.length - 1]!.from) return fail('rentSubsidy.incomeMultiple not in order');
    multiple.push({ from, k: st['k'] });
  }
  const single = rs['singleUnder40'];
  const until = isObj(single) ? parseQuarter(String(single['until'])) : null;
  if (!isObj(single) || until === null || !CITIES.includes(single['city'] as City)) return fail('rentSubsidy.singleUnder40 invalid');
  const m = rs['multipliers'];
  const mFrom = isObj(m) ? parseQuarter(String(m['from'])) : null;
  if (
    !isObj(m) ||
    mFrom === null ||
    !isNum(m['singleYouth']) ||
    !isNum(m['newlywed']) ||
    !isNum(m['newlywedQuarters']) ||
    !Array.isArray(m['children']) ||
    !m['children'].every((v) => isNum(v) && v >= 1)
  ) {
    return fail('rentSubsidy.multipliers invalid');
  }

  return {
    ok: true,
    value: {
      socialHousing: {
        realOdds: shOdds,
        incomeLimit: limits,
        leaseQuarters: ten['leaseQuarters'],
        maxQuarters: ten['maxQuarters'],
        turnoverQuarters: turnover['value'],
        rentShare: { Taipei: rentShare['Taipei'] as number, 'New Taipei': rentShare['New Taipei'] as number },
      },
      rentSubsidy: {
        realOdds: rsOdds,
        minimumLivingExpense: mle,
        incomeMultiple: multiple,
        singleUnder40: { city: single['city'] as City, until },
        multipliers: {
          from: mFrom,
          singleYouth: m['singleYouth'],
          newlywed: m['newlywed'],
          newlywedQuarters: m['newlywedQuarters'],
          children: m['children'] as number[],
        },
      },
    },
  };
}
