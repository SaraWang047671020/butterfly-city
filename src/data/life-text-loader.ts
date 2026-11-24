// The Life_Event_File and the Life_Story_File (life-story design, "Data"): validation, both languages and the same
// placeholders in each (Requirement 9.4), and the lookup of a template by its dotted key. Implemented by Claude Code.
import { LIFE_EVENT_IDS, type EventRule, type LifeEventId } from '../game/life/events.ts';
import { placeholdersOf } from '../narrative/fill.ts';
import type { LocalText, Result } from './character-loader.ts';
import type { ApplicationSupply } from '../game/life/applications.ts';
import { STORY_KEYS } from '../game/life/story.ts';
import { validateApplicationSupply } from './life-story-loader.ts';

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** A text tree of the Life_Story_File: objects, arrays of objects with an `id`, and LocalText leaves. */
export type TextTree = Readonly<Record<string, unknown>>;

const LEAF_KEYS = new Set(['en', 'zh-Hant', 'id', 'when']);
const isLocal = (x: unknown): x is LocalText =>
  isObj(x) && typeof x['en'] === 'string' && typeof x['zh-Hant'] === 'string' && Object.keys(x).every((k) => LEAF_KEYS.has(k));

/** Every LocalText of a tree: both languages non-empty and the same placeholders (Requirement 9.4). */
export function textProblems(x: unknown, where = ''): string[] {
  if (isLocal(x)) {
    const en = x.en.trim();
    const zh = x['zh-Hant'].trim();
    if (en === '' || zh === '') return [`${where}: a language is empty`];
    const a = [...placeholdersOf(en)].sort().join(',');
    const b = [...placeholdersOf(zh)].sort().join(',');
    return a === b ? [] : [`${where}: placeholders differ (en ${a}; zh-Hant ${b})`];
  }
  if (Array.isArray(x)) return x.flatMap((v, i) => textProblems(v, `${where}[${isObj(v) && typeof v['id'] === 'string' ? v['id'] : i}]`));
  if (isObj(x)) {
    return Object.entries(x).flatMap(([k, v]) => (k === 'notes' || k === 'status' || k === 'effect' ? [] : textProblems(v, where === '' ? k : `${where}.${k}`)));
  }
  return [];
}

/** The template at a dotted key; an array segment is matched by the `id` of its items. */
export function textAt(tree: TextTree, key: string): LocalText | null {
  let cur: unknown = tree;
  for (const seg of key.split('.')) {
    if (Array.isArray(cur)) cur = cur.find((v) => isObj(v) && v['id'] === seg);
    else if (isObj(cur)) cur = cur[seg];
    else return null;
  }
  return isLocal(cur) ? cur : null;
}

export const EFFECT_KINDS = ['none', 'move', 'pickMove', 'pickJob', 'apply', 'buyPass', 'leave', 'parentJoins', 'changeJob', 'partnerEditor', 'marry', 'childJoins'] as const;
export type EffectKind = (typeof EFFECT_KINDS)[number];

export interface EventOption {
  readonly id: string;
  readonly effect: { readonly kind: EffectKind } & Readonly<Record<string, unknown>>;
  readonly title: LocalText;
  readonly text: LocalText;
}

export interface LifeEventDef extends EventRule {
  readonly title: LocalText;
  readonly text: LocalText;
  readonly reasons?: Readonly<Record<string, LocalText>>;
  readonly options: readonly EventOption[];
}

export interface LifeEventFile {
  readonly keepLabel: LocalText;
  readonly events: readonly LifeEventDef[];
}

export function validateLifeEventFile(x: unknown): Result<LifeEventFile> {
  const fail = (error: string): Result<LifeEventFile> => ({ ok: false, error: `life-events.json: ${error}` });
  if (!isObj(x) || x['schemaVersion'] !== 1) return fail('schemaVersion must be 1');
  if (!isObj(x['status'])) return fail('status missing');
  const texts = textProblems(x);
  if (texts.length > 0) return fail(texts[0]!);
  const events = x['events'];
  if (!Array.isArray(events)) return fail('events missing');
  const seen = new Set<string>();
  for (const e of events) {
    const id = isObj(e) ? String(e['id']) : '?';
    if (!isObj(e) || !(LIFE_EVENT_IDS as readonly string[]).includes(id)) return fail(`unknown event ${id}`);
    if (seen.has(id)) return fail(`event ${id} twice`);
    seen.add(id);
    if (!isNum(e['priority']) || !isNum(e['cooldownQuarters']) || e['cooldownQuarters'] < 0) return fail(`event ${id}: priority and cooldownQuarters`);
    if (!isLocal(e['title']) || !isLocal(e['text'])) return fail(`event ${id}: title and text`);
    const options = e['options'];
    if (!Array.isArray(options) || options.length < 2 || options.length > 5) return fail(`event ${id}: 2 to 5 options`);
    for (const o of options) {
      if (!isObj(o) || typeof o['id'] !== 'string' || !isObj(o['effect']) || !(EFFECT_KINDS as readonly string[]).includes(String(o['effect']['kind']))) {
        return fail(`event ${id}: option effect`);
      }
      if (!isLocal(o['title']) || !isLocal(o['text'])) return fail(`event ${id}: option ${o['id']} texts`);
    }
  }
  const missing = LIFE_EVENT_IDS.filter((id) => !seen.has(id));
  if (missing.length > 0) return fail(`missing events ${missing.join(', ')}`);
  if (!isLocal(x['keepLabel'])) return fail('keepLabel missing');
  return {
    ok: true,
    value: {
      keepLabel: x['keepLabel'],
      events: (events as Obj[]).map((e) => ({
        id: e['id'] as LifeEventId,
        priority: e['priority'] as number,
        forced: e['forced'] === true,
        cooldownQuarters: e['cooldownQuarters'] as number,
        ...(isNum(e['fromYear']) ? { fromYear: e['fromYear'] } : {}),
        title: e['title'] as LocalText,
        text: e['text'] as LocalText,
        ...(isObj(e['reasons']) ? { reasons: e['reasons'] as Record<string, LocalText> } : {}),
        options: e['options'] as EventOption[],
      })),
    },
  };
}

export function validateLifeStoryFile(x: unknown, keys: readonly string[]): Result<TextTree> {
  const fail = (error: string): Result<TextTree> => ({ ok: false, error: `life-story.json: ${error}` });
  if (!isObj(x) || x['schemaVersion'] !== 1) return fail('schemaVersion must be 1');
  const texts = textProblems(x);
  if (texts.length > 0) return fail(texts[0]!);
  const missing = keys.filter((k) => textAt(x, k) === null);
  if (missing.length > 0) return fail(`missing templates ${missing.join(', ')}`);
  return { ok: true, value: x };
}

/** Whether both languages of a file are approved (Requirement 1.2). */
export function isApproved(x: unknown): boolean {
  if (!isObj(x) || !isObj(x['status'])) return false;
  return x['status']['en'] === 'approved' && x['status']['zh-Hant'] === 'approved';
}

// ---------------------------------------------------------------- loading (life-story task 4.1)


/** The raw parts of the Application_Supply_File the Ending reads: source titles and the sourced gender shares. */
export interface SupplyNotes {
  readonly sources: Readonly<Record<string, { readonly title: string }>>;
  readonly gender: Readonly<
    Record<string, { readonly share?: number; readonly women?: number; readonly men?: number; readonly scope: LocalText; readonly source: string }>
  >;
}

export interface LifeStoryFiles {
  readonly supply: ApplicationSupply;
  readonly notes: SupplyNotes;
  readonly events: LifeEventFile;
  readonly texts: TextTree;
}

/** Loads and validates the three life-story files; an error result never blocks the game (the Character has no story). */
export async function loadLifeStoryFiles(fetchText: (url: string) => Promise<string>, baseUrl: string): Promise<Result<LifeStoryFiles>> {
  try {
    const get = async (name: string): Promise<unknown> => JSON.parse(await fetchText(`${baseUrl}data/${name}`)) as unknown;
    const [supplyRaw, eventsRaw, textsRaw] = await Promise.all([get('application-supply.json'), get('life-events.json'), get('life-story.json')]);
    const supply = validateApplicationSupply(supplyRaw);
    if (!supply.ok) return supply;
    const events = validateLifeEventFile(eventsRaw);
    if (!events.ok) return events;
    const texts = validateLifeStoryFile(textsRaw, STORY_KEYS);
    if (!texts.ok) return texts;
    const raw = supplyRaw as Obj;
    if (!isObj(raw['gender'])) return { ok: false, error: 'application-supply.json: gender missing' };
    return { ok: true, value: { supply: supply.value, notes: raw as unknown as SupplyNotes, events: events.value, texts: texts.value } };
  } catch (e) {
    return { ok: false, error: `life story files: ${(e as Error).message}` };
  }
}
