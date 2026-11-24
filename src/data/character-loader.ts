// Character_File and Wage_File: types, validation and loading (play-loop Requirements 2.3 to 2.5, 3.4, 12.4).
// Implemented by Claude Code. A load error never blocks the game: the caller shows it where the Character is used.
// Every displayed text of the Character_File is a LocalText in both languages; the UI picks the language.
import { quarterIndex } from '../simulation/quarter.ts';
import type { QuarterKey } from '../types/data-files.ts';

export interface LocalText {
  readonly en: string;
  readonly 'zh-Hant': string;
}

export interface Origin {
  readonly id: string;
  readonly name: LocalText;
  readonly text: LocalText;
  /** City where the family lives ("Taipei", "New Taipei"), or null when the family lives elsewhere. */
  readonly familyCity: string | null;
}

export interface Occupation {
  readonly id: string;
  readonly name: LocalText;
  readonly text: LocalText;
  /** DGBAS industry section, a key of the Wage_File earnings. */
  readonly industry: string;
  readonly industryName: LocalText;
  readonly wageNote: LocalText;
  readonly workCodes: readonly string[];
}

export interface Dwelling {
  readonly persons: number;
  readonly size: number; // m²
  readonly status: string;
  readonly assumption?: LocalText;
}

export interface PronounSet {
  readonly label: LocalText;
  readonly subject: LocalText;
  readonly object: LocalText;
  readonly possessive: LocalText;
}

export interface LegalFact {
  readonly id: string;
  readonly from: QuarterKey;
  readonly date: string;
  readonly text: LocalText;
  readonly source: { readonly citation: string; readonly url: string };
}

export interface CharacterFile {
  readonly schemaVersion: 2;
  readonly origins: readonly Origin[];
  readonly occupations: readonly Occupation[];
  readonly dwellings: readonly Dwelling[];
  readonly appearance: { readonly body: readonly string[]; readonly hair: readonly string[]; readonly colour: readonly string[] };
  readonly pronouns: Readonly<Record<'she' | 'he' | 'they', PronounSet>>;
  readonly legal: readonly LegalFact[];
  /** Texts of Character_Creation, the Life dialog and the First_Play_Guide, by group and key. */
  readonly creation: Readonly<Record<string, unknown>>;
  readonly decisions: Readonly<Record<string, unknown>>;
  readonly guide: readonly LocalText[];
}

export interface WageFile {
  readonly schemaVersion: 1;
  readonly unit: string;
  readonly source: { readonly citation: string; readonly url: string; readonly license: string };
  readonly method: string;
  readonly coverage: string;
  readonly earnings: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const placeholders = (t: string): string => [...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

/** A LocalText with both languages non-empty and the same Placeholders; null when valid, else the problem. */
export function localTextProblem(x: unknown): string | null {
  if (!isObj(x)) return 'not a { en, zh-Hant } text';
  const en = x['en'];
  const zh = x['zh-Hant'];
  if (typeof en !== 'string' || en.trim() === '') return 'missing English';
  if (typeof zh !== 'string' || zh.trim() === '') return 'missing Traditional Chinese';
  if (placeholders(en) !== placeholders(zh)) return `Placeholders differ (${placeholders(en)} / ${placeholders(zh)})`;
  return null;
}

/** Every LocalText under a node (objects with an `en` key), with its dotted path. */
function localTexts(node: unknown, path: string, out: [string, unknown][]): [string, unknown][] {
  if (isObj(node) && 'en' in node) out.push([path, node]);
  else if (Array.isArray(node)) node.forEach((v, i) => localTexts(v, `${path}[${i}]`, out));
  else if (isObj(node)) for (const [k, v] of Object.entries(node)) localTexts(v, path === '' ? k : `${path}.${k}`, out);
  return out;
}

export function validateCharacterFile(x: unknown, districtCodes: ReadonlySet<string>, industries: ReadonlySet<string>): Result<CharacterFile> {
  const where = 'characters.json';
  if (!isObj(x) || x['schemaVersion'] !== 2) return fail(`${where}: schemaVersion must be 2`);
  const origins = x['origins'];
  if (!Array.isArray(origins) || origins.length !== 3) return fail(`${where}: origins must have 3 entries`);
  const occ = x['occupations'];
  if (!Array.isArray(occ) || occ.length < 6 || occ.length > 8) return fail(`${where}: occupations must have 6 to 8 entries`);
  for (const o of occ as Record<string, unknown>[]) {
    const id = String(o['id']);
    const codes = o['workCodes'];
    if (!Array.isArray(codes) || codes.length < 2 || codes.length > 4) return fail(`${where}: occupation ${id} needs 2 to 4 workCodes`);
    for (const c of codes) if (!districtCodes.has(String(c))) return fail(`${where}: occupation ${id} names unknown district ${String(c)}`);
    if (!industries.has(String(o['industry']))) return fail(`${where}: occupation ${id} industry ${String(o['industry'])} is not in wages.json`);
  }
  const dw = x['dwellings'];
  if (!Array.isArray(dw)) return fail(`${where}: dwellings missing`);
  for (let p = 1; p <= 5; p++) {
    const d = (dw as Record<string, unknown>[]).find((e) => e['persons'] === p);
    if (d === undefined || typeof d['size'] !== 'number' || !(d['size'] > 0)) return fail(`${where}: no dwelling size for ${p} persons`);
  }
  const pr = x['pronouns'];
  if (!isObj(pr)) return fail(`${where}: pronouns missing`);
  for (const id of ['she', 'he', 'they']) {
    const set = pr[id];
    if (!isObj(set)) return fail(`${where}: pronoun set ${id} missing`);
    for (const k of ['label', 'subject', 'object', 'possessive']) {
      const p = localTextProblem(set[k]);
      if (p !== null) return fail(`${where}: pronouns.${id}.${k}: ${p}`);
    }
  }
  const legal = x['legal'];
  if (!Array.isArray(legal)) return fail(`${where}: legal missing`);
  for (const l of legal as Record<string, unknown>[]) {
    const from = String(l['from']);
    if (!/^\d{4}Q[1-4]$/.test(from) || quarterIndex(from as QuarterKey) < 0 || quarterIndex(from as QuarterKey) > 43) return fail(`${where}: legal ${String(l['id'])} from ${from} is not a quarter of the game`);
  }
  for (const [path, t] of localTexts(x, '', [])) {
    const p = localTextProblem(t);
    if (p !== null) return fail(`${where}: ${path}: ${p}`);
  }
  return { ok: true, value: x as unknown as CharacterFile };
}

export function validateWageFile(x: unknown): Result<WageFile> {
  const where = 'wages.json';
  if (!isObj(x) || x['schemaVersion'] !== 1) return fail(`${where}: schemaVersion must be 1`);
  const e = x['earnings'];
  if (!isObj(e) || Object.keys(e).length === 0) return fail(`${where}: earnings missing`);
  for (const [code, years] of Object.entries(e)) {
    if (!isObj(years)) return fail(`${where}: earnings.${code} is not an object`);
    for (let y = 2015; y <= 2025; y++) {
      const v = years[String(y)];
      if (typeof v !== 'number' || !(v > 0)) return fail(`${where}: no wage for ${code} in ${y}`);
    }
  }
  return { ok: true, value: x as unknown as WageFile };
}

export interface CharacterFiles {
  readonly characters: CharacterFile;
  readonly wages: WageFile;
}

/** Fetches and validates the Character_File and the Wage_File from `${baseUrl}data/`. */
export async function loadCharacterFiles(
  fetchText: (url: string) => Promise<string>,
  baseUrl: string,
  districtCodes: ReadonlySet<string>,
): Promise<Result<CharacterFiles>> {
  try {
    const [c, w] = (await Promise.all(['characters.json', 'wages.json'].map((n) => fetchText(`${baseUrl}data/${n}`)))) as [string, string];
    const wages = validateWageFile(JSON.parse(w));
    if (!wages.ok) return wages;
    const characters = validateCharacterFile(JSON.parse(c), districtCodes, new Set(Object.keys(wages.value.earnings)));
    if (!characters.ok) return characters;
    return { ok: true, value: { characters: characters.value, wages: wages.value } };
  } catch (e) {
    return fail(`character files: ${(e as Error).message}`);
  }
}
