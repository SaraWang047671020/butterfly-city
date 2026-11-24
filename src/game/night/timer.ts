// Day_Timer (night-ghosts Requirement 3, design "Day_Timer"). Pure: the UI ticks it with the browser clock while no
// dialog is open and the tab is visible; WHEN `left` reaches 0 the quarter is computed as with Next quarter.
// The timer can be paused, extended, set to 3, 5 or 8 minutes, or turned off (WCAG 2.2.1).

export const LENGTHS = [180, 300, 480] as const;
export const DEFAULT_LENGTH = 300;
export const EXTEND_BY = 120;
/** Seconds a group of Mission_Ghosts takes from the next day, and the shortest day (Requirement 5.5). */
export const PENALTY_PER_GROUP = 30;
export const MIN_LENGTH = 120;

export interface DayTimer {
  /** Seconds of this day (after the night's shortening). */
  readonly length: number;
  readonly left: number;
  readonly running: boolean;
  /** Turned off in the settings: no countdown, no shortening. */
  readonly off: boolean;
}

/** The timer of a new day: the chosen length minus the night's penalty, never below the minimum (and never longer). */
export function newDay(chosen: number, missionGhostGroups: number, off: boolean): DayTimer {
  const length = off ? chosen : Math.max(Math.min(chosen, MIN_LENGTH), chosen - PENALTY_PER_GROUP * Math.max(0, missionGhostGroups));
  return { length, left: length, running: !off, off };
}

/** Advances the running timer by `seconds`; returns the new state and whether it just ran out. */
export function tick(t: DayTimer, seconds: number): { readonly timer: DayTimer; readonly expired: boolean } {
  if (t.off || !t.running || t.left <= 0 || seconds <= 0) return { timer: t, expired: false };
  const left = Math.max(0, t.left - seconds);
  return { timer: { ...t, left, running: left > 0 }, expired: left === 0 };
}

export const pause = (t: DayTimer): DayTimer => (t.off ? t : { ...t, running: false });
export const resume = (t: DayTimer): DayTimer => (t.off || t.left <= 0 ? t : { ...t, running: true });
/** More time (Requirement 3.2): +2 minutes, repeatable. */
export const extend = (t: DayTimer): DayTimer => (t.off ? t : { ...t, left: t.left + EXTEND_BY, length: t.length + EXTEND_BY });
export const turnOff = (t: DayTimer): DayTimer => ({ ...t, off: true, running: false });
export const turnOn = (t: DayTimer): DayTimer => ({ ...t, off: false, running: t.left > 0 });

/** "4:12" */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The moments announced politely (not every second): 1 minute and 30 seconds left. */
export function announceAt(before: number, after: number): 60 | 30 | null {
  if (before > 60 && after <= 60) return 60;
  if (before > 30 && after <= 30) return 30;
  return null;
}
