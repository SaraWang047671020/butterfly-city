// Validator for public/data/events.json (event-library Requirements 1, 3.2, 3.4, 5.7, 6.1, 6.4, 6.6).
// Pure, never throws: every problem becomes a ValidationError with a JSON path. Shared by the event builder
// and the web app loader.

import { EVENT_CARD_KEYS, EVENT_ROLES, EVENT_TYPES, DAY_UNKNOWN_TEXT } from '../types/events-file.ts';
import { dateToQuarter, isValidDate, precisionOf } from './event-dates.ts';
import type { ValidationError } from './validate.ts';

const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const QUARTER_PATTERN = /^(\d{4})Q([1-4])$/;
const FIRST_DATE = '2015-01-01';
const LAST_DATE = '2025-12-31';
const FIRST_QUARTER = '2015Q1';
const LAST_QUARTER = '2025Q4';

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

const nonEmpty = (x: unknown): x is string => typeof x === 'string' && x.trim() !== '';

/** Start of the date period, padded to a day, for the range check. */
function startOf(date: string): string {
  if (date.length === 4) return `${date}-01-01`;
  if (date.length === 7) return `${date}-01`;
  return date;
}

function inQuarterRange(q: string): boolean {
  return QUARTER_PATTERN.test(q) && q >= FIRST_QUARTER && q <= LAST_QUARTER;
}

export function validateEventsFile(x: unknown): ValidationError[] {
  const errors: ValidationError[] = [];
  const add = (path: string, rule: string, message: string): void => {
    errors.push({ file: 'events.json', path, rule, message });
  };

  if (!isRecord(x)) {
    add('$', 'type', 'events.json must be an object');
    return errors;
  }
  for (const k of Object.keys(x)) {
    if (k !== 'schemaVersion' && k !== 'events') add(`$.${k}`, 'keys', `unexpected top-level key "${k}"`);
  }
  if (x['schemaVersion'] !== 1) add('$.schemaVersion', 'type', 'schemaVersion must be 1');
  const events = x['events'];
  if (!Array.isArray(events)) {
    add('$.events', 'type', 'events must be an array');
    return errors;
  }

  const seen = new Set<string>();
  const allowed = new Set<string>(EVENT_CARD_KEYS);
  let previous: { date: string; id: string } | null = null;

  events.forEach((card: unknown, i) => {
    const at = `$.events[${i}]`;
    if (!isRecord(card)) {
      add(at, 'type', 'card must be an object');
      return;
    }
    for (const k of Object.keys(card)) {
      if (!allowed.has(k)) add(`${at}.${k}`, 'keys', `unexpected card key "${k}"; a card carries no effect fields`);
    }
    for (const k of EVENT_CARD_KEYS) {
      if (!(k in card)) add(`${at}.${k}`, 'required', `field "${k}" is required`);
    }

    const id = card['id'];
    if (typeof id !== 'string' || !ID_PATTERN.test(id) || id.length > 60) {
      add(`${at}.id`, 'id', 'id must match ^[a-z0-9]+(-[a-z0-9]+)*$ with at most 60 characters');
    } else if (seen.has(id)) {
      add(`${at}.id`, 'id', `duplicate id "${id}"`);
    } else {
      seen.add(id);
    }

    const date = card['date'];
    const precision = card['datePrecision'];
    let dateOk = false;
    if (typeof date !== 'string' || !isValidDate(date)) {
      add(`${at}.date`, 'date', 'date must be a calendar date as YYYY-MM-DD, YYYY-MM or YYYY');
    } else if (precisionOf(date) !== precision) {
      add(`${at}.datePrecision`, 'date', `datePrecision must be "${precisionOf(date)}" for date ${date}`);
    } else if (startOf(date) < FIRST_DATE || startOf(date) > LAST_DATE) {
      add(`${at}.date`, 'date', `date must lie between ${FIRST_DATE} and ${LAST_DATE}`);
    } else {
      dateOk = true;
    }

    const first = card['firstQuarter'];
    const last = card['lastQuarter'];
    if (typeof first !== 'string' || !inQuarterRange(first)) {
      add(`${at}.firstQuarter`, 'quarter', `firstQuarter must be a quarter from ${FIRST_QUARTER} to ${LAST_QUARTER}`);
    } else if (dateOk && first !== dateToQuarter(date as string)) {
      add(`${at}.firstQuarter`, 'quarter', `firstQuarter must be ${dateToQuarter(date as string)}, the quarter of the date`);
    }
    if (typeof last !== 'string' || !inQuarterRange(last)) {
      add(`${at}.lastQuarter`, 'quarter', `lastQuarter must be a quarter from ${FIRST_QUARTER} to ${LAST_QUARTER}`);
    } else if (typeof first === 'string' && inQuarterRange(first) && last < first) {
      add(`${at}.lastQuarter`, 'quarter', 'lastQuarter must not be before firstQuarter');
    }

    if (!(EVENT_TYPES as readonly unknown[]).includes(card['type'])) {
      add(`${at}.type`, 'type', `type must be one of ${EVENT_TYPES.join(', ')}`);
    }
    if (!(EVENT_ROLES as readonly unknown[]).includes(card['role'])) {
      add(`${at}.role`, 'role', `role must be one of ${EVENT_ROLES.join(', ')}`);
    }
    if (!nonEmpty(card['title'])) add(`${at}.title`, 'type', 'title must be a non-empty string');
    if (!nonEmpty(card['description'])) add(`${at}.description`, 'type', 'description must be a non-empty string');
    if (typeof card['major'] !== 'boolean') add(`${at}.major`, 'type', 'major must be a boolean');
    if (typeof card['verified'] !== 'boolean') add(`${at}.verified`, 'type', 'verified must be a boolean');

    const note = card['verificationNote'];
    if (typeof note !== 'string') {
      add(`${at}.verificationNote`, 'type', 'verificationNote must be a string');
    } else {
      if (card['verified'] === true && note.trim() === '') {
        add(`${at}.verificationNote`, 'verification', 'a verified card needs a verificationNote');
      }
      if ((precision === 'month' || precision === 'year') && !note.includes(DAY_UNKNOWN_TEXT)) {
        add(`${at}.verificationNote`, 'verification', `a ${precision}-precision card's note must contain "${DAY_UNKNOWN_TEXT}"`);
      }
    }

    const sources = card['sources'];
    if (!Array.isArray(sources) || sources.length === 0) {
      add(`${at}.sources`, 'sources', 'at least one source is required');
    } else {
      sources.forEach((s: unknown, j) => {
        const sp = `${at}.sources[${j}]`;
        if (!isRecord(s)) {
          add(sp, 'sources', 'source must be an object');
          return;
        }
        for (const k of Object.keys(s)) {
          if (k !== 'label' && k !== 'publisher' && k !== 'url') add(`${sp}.${k}`, 'keys', `unexpected source key "${k}"`);
        }
        if (!nonEmpty(s['label'])) add(`${sp}.label`, 'sources', 'label must be a non-empty string');
        if (!nonEmpty(s['publisher'])) add(`${sp}.publisher`, 'sources', 'publisher must be a non-empty string');
        let ok = false;
        if (typeof s['url'] === 'string') {
          try {
            ok = new URL(s['url']).protocol === 'https:';
          } catch {
            ok = false;
          }
        }
        if (!ok) add(`${sp}.url`, 'sources', 'url must be an absolute https URL');
      });
    }

    if (typeof date === 'string' && typeof id === 'string') {
      if (previous !== null && (date < previous.date || (date === previous.date && id <= previous.id))) {
        add(at, 'order', 'cards must be sorted by date, then id');
      }
      previous = { date, id };
    }
  });

  return errors;
}
