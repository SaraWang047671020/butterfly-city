// Template selection and filling for one Persona (story-layer Requirements 3.6, 4.3 to 4.6). Pure.
import type { CitizenFile } from '../data/story-loader.ts';
import { FillError, fillTemplate } from './fill.ts';

export interface StoryState {
  readonly rent: 'below' | 'atRisk' | 'ghost';
  readonly commute: 'none' | 'below' | 'atRisk' | 'ghost';
  readonly comparison: 'same' | 'lower' | 'higher';
  readonly showRange: boolean;
  readonly stateChange: 'becameGhost' | 'leftGhost' | null;
  readonly showBecameGhostReal: boolean;
}

export type StoryLine = { readonly id: string; readonly text: string } | { readonly id: string; readonly error: FillError };

function line(templates: CitizenFile['templates'], id: string, values: Readonly<Record<string, string>>): StoryLine | null {
  const [group, state] = id.split('.') as [string, string];
  const template = templates[group]?.[state];
  if (template === undefined) return null;
  try {
    return { id, text: fillTemplate(id, template, values) };
  } catch (e) {
    if (e instanceof FillError) return { id, error: e };
    throw e;
  }
}

/** The lines of one quarter: rent, commute, comparison (and range), then a state change when one applies. */
export function storyLines(templates: CitizenFile['templates'], state: StoryState, values: Readonly<Record<string, string>>): StoryLine[] {
  const ids = [`rent.${state.rent}`, `commute.${state.commute}`, `comparison.${state.comparison}`];
  if (state.showRange) ids.push('comparison.range');
  if (state.stateChange !== null) ids.push(`stateChange.${state.stateChange}`);
  if (state.showBecameGhostReal) ids.push('stateChange.becameGhostReal');
  return ids.map((id) => line(templates, id, values)).filter((l): l is StoryLine => l !== null);
}

/** The ending lines, shown once 2025Q4 is computed (Requirement 5.5). */
export function endingLines(templates: CitizenFile['templates'], values: Readonly<Record<string, string>>): StoryLine[] {
  return Object.keys(templates['ending'] ?? {})
    .map((state) => line(templates, `ending.${state}`, values))
    .filter((l): l is StoryLine => l !== null);
}
