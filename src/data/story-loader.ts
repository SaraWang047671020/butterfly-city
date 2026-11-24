// Story_Files: types, validation and loading (story-layer Requirement 1, task 1). Implemented by Claude Code.
// A story load error never blocks the game: the caller shows the error in the story parts only (Requirement 1.4).
// Unknown extra fields (notes, household, age, model-limits templates) are ignored.
// Every displayed text is in both languages (play-loop Requirement 12.4): the validators reject a text missing in one
// language or with different Placeholders, and return the file in the language of the App.
import { localTextProblem, type LocalText } from './character-loader.ts';

export type Lang = 'en' | 'zh-Hant';

export interface Persona {
  readonly id: string;
  readonly name: string;
  readonly homeDistrict: string;
  readonly homeCode: string;
  readonly workDistrict: string | null;
  readonly workCode: string | null;
  readonly dwellingSize: number;
  readonly incomePercentile: number; // 0 < p < 100
  readonly intro: string;
  readonly picker: string;
}

export interface CitizenFile {
  readonly schemaVersion: 1;
  readonly personas: readonly Persona[];
  readonly thresholds: {
    readonly rentRisk: { readonly value: number };
    readonly commuteMonth: { readonly tripsPerDay: number; readonly workdaysPerMonth: number };
  };
  readonly templates: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

export interface IncomeSpread {
  readonly schemaVersion: 1;
  readonly incomeYear: number;
  readonly source: { readonly citation: string; readonly dataset: string; readonly license: string };
  readonly method: string;
  readonly sigma: Readonly<Record<string, number>>;
}

export interface LimitsFile {
  readonly schemaVersion: 1;
  readonly page: { readonly title: string; readonly intro: string; readonly disclosure: string; readonly sourcesLink: string };
  readonly sections: readonly {
    readonly id: string;
    readonly title: string;
    readonly items: readonly { readonly id: string; readonly title: string; readonly text: string }[];
  }[];
}

export interface ModelFacts {
  readonly schemaVersion: 1;
  readonly commuteModelled: number;
  readonly commuteSurvey: number;
  readonly backtestResult: string;
}

export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const str = (x: unknown): x is string => typeof x === 'string' && x.length > 0;

/** The first problem of the LocalText fields `keys` of `o` (optional ones may be absent), or null. */
function textsProblem(o: Record<string, unknown>, keys: readonly string[], at: string, optional: readonly string[] = []): string | null {
  for (const k of keys) {
    if (optional.includes(k) && o[k] === undefined) continue;
    const p = localTextProblem(o[k]);
    if (p !== null) return `${at}.${k}: ${p}`;
  }
  return null;
}

const textIn = (x: unknown, lang: Lang): string => (x as LocalText)[lang];

export function validateCitizenFile(x: unknown, districtCodes: ReadonlySet<string>, lang: Lang = 'en'): Result<CitizenFile> {
  if (!isObj(x) || x['schemaVersion'] !== 2) return fail('citizens.json: schemaVersion must be 2');
  const th = x['thresholds'];
  if (!isObj(th) || !isObj(th['rentRisk']) || !num(th['rentRisk']['value'])) return fail('citizens.json: thresholds.rentRisk.value missing');
  const cm = th['commuteMonth'];
  if (!isObj(cm) || !num(cm['tripsPerDay']) || !num(cm['workdaysPerMonth'])) return fail('citizens.json: thresholds.commuteMonth missing');
  const ps = x['personas'];
  if (!Array.isArray(ps) || ps.length === 0) return fail('citizens.json: personas missing');
  const ids = new Set<string>();
  for (const [i, p] of ps.entries()) {
    const at = `citizens.json: personas[${i}]`;
    if (!isObj(p)) return fail(`${at} is not an object`);
    for (const k of ['id', 'homeDistrict', 'homeCode']) if (!str(p[k])) return fail(`${at}.${k} missing`);
    const tp = textsProblem(p, ['name', 'intro', 'picker', 'household'], at, ['household']);
    if (tp !== null) return fail(tp);
    if (ids.has(p['id'] as string)) return fail(`${at}.id is a duplicate`);
    ids.add(p['id'] as string);
    if (!districtCodes.has(p['homeCode'] as string)) return fail(`${at}.homeCode is not a district code`);
    if (p['workCode'] !== null && !districtCodes.has(p['workCode'] as string)) return fail(`${at}.workCode is not a district code or null`);
    if (!num(p['dwellingSize']) || (p['dwellingSize'] as number) <= 0) return fail(`${at}.dwellingSize must be positive`);
    const pc = p['incomePercentile'];
    if (!num(pc) || pc <= 0 || pc >= 100) return fail(`${at}.incomePercentile must be between 0 and 100`);
  }
  const t = x['templates'];
  if (!isObj(t)) return fail('citizens.json: templates missing');
  for (const [group, states] of Object.entries(t)) {
    if (!isObj(states)) return fail(`citizens.json: templates.${group} is not an object`);
    for (const [state, text] of Object.entries(states)) {
      const tp = localTextProblem(text);
      if (tp !== null) return fail(`citizens.json: templates.${group}.${state}: ${tp}`);
    }
  }
  const personas = (ps as Record<string, unknown>[]).map((p) => ({
    ...p,
    name: textIn(p['name'], lang),
    intro: textIn(p['intro'], lang),
    picker: textIn(p['picker'], lang),
    ...(p['household'] === undefined ? {} : { household: textIn(p['household'], lang) }),
  }));
  const templates = Object.fromEntries(
    Object.entries(t).map(([g, states]) => [g, Object.fromEntries(Object.entries(states as Record<string, unknown>).map(([k, v]) => [k, textIn(v, lang)]))]),
  );
  return { ok: true, value: { ...x, schemaVersion: 1, personas, templates } as unknown as CitizenFile };
}

export function validateIncomeSpread(x: unknown, districtCodes: ReadonlySet<string>): Result<IncomeSpread> {
  if (!isObj(x) || x['schemaVersion'] !== 1) return fail('income-spread.json: schemaVersion must be 1');
  const s = x['sigma'];
  if (!isObj(s)) return fail('income-spread.json: sigma missing');
  const keys = Object.keys(s);
  if (keys.length !== districtCodes.size || keys.some((k) => !districtCodes.has(k))) {
    return fail(`income-spread.json: sigma must have exactly the ${districtCodes.size} district codes`);
  }
  for (const k of keys) {
    const v = s[k];
    if (!num(v) || v <= 0) return fail(`income-spread.json: sigma.${k} must be a finite positive number`);
  }
  if (!isObj(x['source']) || !str(x['method'])) return fail('income-spread.json: source or method missing');
  return { ok: true, value: x as unknown as IncomeSpread };
}

export function validateLimitsFile(x: unknown, lang: Lang = 'en'): Result<LimitsFile> {
  if (!isObj(x) || x['schemaVersion'] !== 2) return fail('model-limits.json: schemaVersion must be 2');
  const p = x['page'];
  if (!isObj(p)) return fail('model-limits.json: page fields missing');
  const pageKeys = ['title', 'intro', 'disclosure', 'sourcesLink'];
  const pp = textsProblem(p, pageKeys, 'model-limits.json: page');
  if (pp !== null) return fail(pp);
  const ss = x['sections'];
  if (!Array.isArray(ss) || ss.length === 0) return fail('model-limits.json: sections missing');
  for (const [i, s] of ss.entries()) {
    if (!isObj(s) || !str(s['id']) || !Array.isArray(s['items'])) return fail(`model-limits.json: sections[${i}] incomplete`);
    const sp = textsProblem(s, ['title'], `model-limits.json: sections[${i}]`);
    if (sp !== null) return fail(sp);
    for (const [k, it] of (s['items'] as unknown[]).entries()) {
      if (!isObj(it) || !str(it['id'])) return fail(`model-limits.json: sections[${i}].items[${k}] incomplete`);
      const ip = textsProblem(it, ['title', 'text'], `model-limits.json: sections[${i}].items[${k}]`);
      if (ip !== null) return fail(ip);
    }
  }
  const page = Object.fromEntries(pageKeys.map((k) => [k, textIn(p[k], lang)]));
  const sections = (ss as Record<string, unknown>[]).map((sec) => ({
    id: sec['id'],
    title: textIn(sec['title'], lang),
    items: (sec['items'] as Record<string, unknown>[]).map((it) => ({ id: it['id'], title: textIn(it['title'], lang), text: textIn(it['text'], lang) })),
  }));
  return { ok: true, value: { schemaVersion: 1, page, sections } as unknown as LimitsFile };
}

export function validateModelFacts(x: unknown, lang: Lang = 'en'): Result<ModelFacts> {
  if (!isObj(x) || x['schemaVersion'] !== 1) return fail('model-facts.json: schemaVersion must be 1');
  for (const k of ['commuteModelled', 'commuteSurvey']) {
    const v = x[k];
    if (!num(v) || v <= 0) return fail(`model-facts.json: ${k} must be a positive number`);
  }
  const bp = localTextProblem(x['backtestResult']);
  if (bp !== null) return fail(`model-facts.json: backtestResult: ${bp}`);
  return { ok: true, value: { ...x, backtestResult: textIn(x['backtestResult'], lang) } as unknown as ModelFacts };
}

export interface StoryFiles {
  readonly citizens: CitizenFile;
  readonly spread: IncomeSpread;
  readonly limits: LimitsFile;
  readonly facts: ModelFacts;
}

/** Fetches and validates the four Story_Files from `${baseUrl}data/`. */
export async function loadStoryFiles(
  fetchText: (url: string) => Promise<string>,
  baseUrl: string,
  districtCodes: ReadonlySet<string>,
  lang: Lang = 'en',
): Promise<Result<StoryFiles>> {
  try {
    const [c, s, l, f] = await Promise.all(
      ['citizens.json', 'income-spread.json', 'model-limits.json', 'model-facts.json'].map((n) => fetchText(`${baseUrl}data/${n}`)),
    ) as [string, string, string, string];
    const citizens = validateCitizenFile(JSON.parse(c), districtCodes, lang);
    if (!citizens.ok) return citizens;
    const spread = validateIncomeSpread(JSON.parse(s), districtCodes);
    if (!spread.ok) return spread;
    const limits = validateLimitsFile(JSON.parse(l), lang);
    if (!limits.ok) return limits;
    const facts = validateModelFacts(JSON.parse(f), lang);
    if (!facts.ok) return facts;
    return { ok: true, value: { citizens: citizens.value, spread: spread.value, limits: limits.value, facts: facts.value } };
  } catch (e) {
    return fail(`story files: ${(e as Error).message}`);
  }
}
