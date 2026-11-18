import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateEventsFile } from '../../src/data/validate-events.ts';
import type { EventsFile } from '../../src/types/events-file.ts';
import { quarterAt } from '../../src/simulation/quarter.ts';

const file = JSON.parse(fs.readFileSync('public/data/events.json', 'utf8')) as EventsFile;
const rows = JSON.parse(fs.readFileSync('data/config/event-source-rows.json', 'utf8')) as { rows: { id: string }[] };
const table = JSON.parse(fs.readFileSync('data/config/events.json', 'utf8')) as { majorIds: string[] };
const QUARTERS = new Set(Array.from({ length: 44 }, (_, i) => quarterAt(i)));

describe('public/data/events.json (event-library task 6.2)', () => {
  it('passes the validator', () => {
    expect(validateEventsFile(file)).toEqual([]);
  });

  it('Property 5: Section 1 of the research notes has 35 data rows, equal to the rows file and the cards', () => {
    // Feature: event-library, Property 5: List equality
    const notes = fs.readFileSync('data/research/RESEARCH-NOTES.md', 'utf8').split(/\r?\n/);
    const start = notes.findIndex((l) => l.startsWith('## 1.'));
    const end = notes.findIndex((l, i) => i > start && l.startsWith('## 2.'));
    const dataRows = notes.slice(start, end).filter((l) => /^\| \d/.test(l));
    expect(dataRows.length).toBe(35);
    expect(rows.rows.length).toBe(35);
    expect(file.events.map((e) => e.id).sort()).toEqual(rows.rows.map((r) => r.id).sort());
  });

  it('marks exactly the 10 major ids, gives every card a source and every verified card a note', () => {
    expect(table.majorIds.length).toBe(10);
    expect(file.events.filter((e) => e.major).map((e) => e.id).sort()).toEqual([...table.majorIds].sort());
    for (const e of file.events) {
      expect(e.sources.length).toBeGreaterThan(0);
      if (e.verified) expect(e.verificationNote.length).toBeGreaterThan(0);
    }
  });

  it('rejects a copy with an effect field', () => {
    const first = file.events[0];
    expect(first).toBeDefined();
    const mutated = { ...file, events: [{ ...first, impact: 0.1 }, ...file.events.slice(1)] };
    expect(validateEventsFile(mutated).some((e) => e.rule === 'keys')).toBe(true);
  });

  it('engine shape: every quarter is one of the 44 keys and first is not after last', () => {
    for (const e of file.events) {
      expect(QUARTERS.has(e.firstQuarter)).toBe(true);
      expect(QUARTERS.has(e.lastQuarter)).toBe(true);
      expect(e.firstQuarter <= e.lastQuarter).toBe(true);
    }
  });
});
