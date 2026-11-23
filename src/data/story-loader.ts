// Story_Files: types, validation and loading (story-layer Requirement 1, task 1). Implemented by Claude Code.
// A story load error never blocks the game: the caller shows the error in the story parts only (Requirement 1.4).
// Unknown extra fields (notes, household, age, model-limits templates) are ignored.

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

export function validateCitizenFile(x: unknown, districtCodes: ReadonlySet<string>): Result<CitizenFile> {
  if (!isObj(x) || x['schemaVersion'] !== 1) return fail('citizens.json: schemaVersion must be 1');
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
    for (const k of ['id', 'name', 'homeDistrict', 'homeCode', 'intro', 'picker']) if (!str(p[k])) return fail(`${at}.${k} missing`);
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
    for (const [state, text] of Object.entries(states)) if (!str(text)) return fail(`citizens.json: templates.${group}.${state} is not text`);
  }
  return { ok: true, value: x as unknown as CitizenFile };
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

export function validateLimitsFile(x: unknown): Result<LimitsFile> {
  if (!isObj(x) || x['schemaVersion'] !== 1) return fail('model-limits.json: schemaVersion must be 1');
  const p = x['page'];
  if (!isObj(p) || !['title', 'intro', 'disclosure', 'sourcesLink'].every((k) => str(p[k]))) return fail('model-limits.json: page fields missing');
  const ss = x['sections'];
  if (!Array.isArray(ss) || ss.length === 0) return fail('model-limits.json: sections missing');
  for (const [i, s] of ss.entries()) {
    if (!isObj(s) || !str(s['id']) || !str(s['title']) || !Array.isArray(s['items'])) return fail(`model-limits.json: sections[${i}] incomplete`);
    for (const [k, it] of (s['items'] as unknown[]).entries()) {
      if (!isObj(it) || !str(it['id']) || !str(it['title']) || !str(it['text'])) return fail(`model-limits.json: sections[${i}].items[${k}] incomplete`);
    }
  }
  return { ok: true, value: x as unknown as LimitsFile };
}

export function validateModelFacts(x: unknown): Result<ModelFacts> {
  if (!isObj(x) || x['schemaVersion'] !== 1) return fail('model-facts.json: schemaVersion must be 1');
  for (const k of ['commuteModelled', 'commuteSurvey']) {
    const v = x[k];
    if (!num(v) || v <= 0) return fail(`model-facts.json: ${k} must be a positive number`);
  }
  if (!str(x['backtestResult'])) return fail('model-facts.json: backtestResult missing');
  return { ok: true, value: x as unknown as ModelFacts };
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
): Promise<Result<StoryFiles>> {
  try {
    const [c, s, l, f] = await Promise.all(
      ['citizens.json', 'income-spread.json', 'model-limits.json', 'model-facts.json'].map((n) => fetchText(`${baseUrl}data/${n}`)),
    ) as [string, string, string, string];
    const citizens = validateCitizenFile(JSON.parse(c), districtCodes);
    if (!citizens.ok) return citizens;
    const spread = validateIncomeSpread(JSON.parse(s), districtCodes);
    if (!spread.ok) return spread;
    const limits = validateLimitsFile(JSON.parse(l));
    if (!limits.ok) return limits;
    const facts = validateModelFacts(JSON.parse(f));
    if (!facts.ok) return facts;
    return { ok: true, value: { citizens: citizens.value, spread: spread.value, limits: limits.value, facts: facts.value } };
  } catch (e) {
    return fail(`story files: ${(e as Error).message}`);
  }
}
