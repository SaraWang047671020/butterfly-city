// public/data/events.json shapes (event-library design). Types and constants only.
import type { QuarterKey } from './data-files.ts';

export const EVENT_TYPES = [
  'interest-rate',
  'credit-control',
  'tax',
  'housing-law',
  'housing-program',
  'transit',
  'public-health',
  'disaster',
] as const;
export const EVENT_ROLES = ['baseline', 'narrative'] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export type EventRole = (typeof EVENT_ROLES)[number];

export interface SourceLink {
  readonly label: string;
  readonly publisher: string;
  readonly url: string;
}

export interface EventCard {
  readonly id: string;
  readonly date: string;
  readonly datePrecision: 'day' | 'month' | 'year';
  readonly firstQuarter: QuarterKey;
  readonly lastQuarter: QuarterKey;
  readonly type: EventType;
  readonly title: string;
  readonly description: string;
  readonly role: EventRole;
  readonly major: boolean;
  readonly verified: boolean;
  readonly verificationNote: string;
  readonly sources: readonly SourceLink[];
}

export interface EventsFile {
  readonly schemaVersion: 1;
  readonly events: readonly EventCard[];
}

export type DatePrecision = EventCard['datePrecision'];

/** The 13 card keys in output order (event-library Requirement 1.2). The list is closed (Requirement 1.9). */
export const EVENT_CARD_KEYS = [
  'id',
  'date',
  'datePrecision',
  'firstQuarter',
  'lastQuarter',
  'type',
  'title',
  'description',
  'role',
  'major',
  'verified',
  'verificationNote',
  'sources',
] as const;

/** Text that the note of every month- or year-precision card contains (Requirement 1.11). */
export const DAY_UNKNOWN_TEXT = 'The day is not known.';
