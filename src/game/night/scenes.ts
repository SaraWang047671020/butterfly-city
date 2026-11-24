// Scenes of the night (night-ghosts Requirements 6 to 10, design "Scenes"). Pure: what each kind of place shows by day
// and by night, the progress of an Investigation, and the Heritage_Plan. A Kind C Memory_Scene has no ghost count,
// fear level or task to drive anything away; a Memorial_Point has no interaction (Requirements 9.1, 9.4).

export type SceneKind = 'A' | 'B' | 'C' | 'memorial';
export type Phase = 'day' | 'night';

export interface SceneSteps {
  readonly id: string;
  readonly kind: SceneKind;
  /** Investigation step ids in order (Kind B and C); empty for Kind A and Memorial_Points. */
  readonly steps: readonly string[];
}

/** What a place shows in a phase. */
export interface SceneLook {
  /** A ghost figure (Kind A and B at night). */
  readonly ghost: boolean;
  /** Restrained signs of a Memory_Scene at night (a figure that fades, a glimpse of the old landscape). */
  readonly signs: boolean;
  /** The plaque of a Memorial_Point or of a place in the Heritage_Plan. */
  readonly plaque: boolean;
  /** The Investigation can be opened. */
  readonly investigate: boolean;
}

export function lookOf(kind: SceneKind, phase: Phase, inHeritagePlan: boolean): SceneLook {
  const night = phase === 'night';
  return {
    ghost: night && (kind === 'A' || kind === 'B'),
    signs: night && kind === 'C',
    plaque: kind === 'memorial' || inHeritagePlan,
    investigate: night && (kind === 'B' || kind === 'C'),
  };
}

export interface Progress {
  /** Steps found, in order. */
  readonly found: readonly string[];
}

/** The next step to find, or null WHEN the Investigation is complete (or the place has none). */
export function nextStep(s: SceneSteps, p: Progress): string | null {
  return s.steps.find((id) => !p.found.includes(id)) ?? null;
}

/** Finds a step: only the next one in order counts, so the records unlock step by step (Requirement 9.2). */
export function findStep(s: SceneSteps, p: Progress, step: string): Progress {
  return nextStep(s, p) === step ? { found: [...p.found, step] } : p;
}

export const complete = (s: SceneSteps, p: Progress): boolean => s.steps.length > 0 && nextStep(s, p) === null;

/** A place may join the Heritage_Plan at the end of its Investigation (Kind B and C only, Requirement 9.3). */
export function canAddToHeritage(s: SceneSteps, p: Progress): boolean {
  return (s.kind === 'B' || s.kind === 'C') && complete(s, p);
}
