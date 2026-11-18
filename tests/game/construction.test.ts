import { describe, expect, it } from 'vitest';
import { completionItems, constructionEntries } from '../../src/game/core/construction.ts';
import type { LagEntry, SimState } from '../../src/types/simulation.ts';

function entry(area: string, committed: string, effect: string, value: number, tool = 'socialHousing'): LagEntry {
  return { tool, area, committed, effect, value } as unknown as LagEntry;
}

function state(quarter: string, lagPipeline: LagEntry[]): SimState {
  return { quarter, lagPipeline } as unknown as SimState;
}

const names = new Map([
  ['63000010', 'Banqiao'],
  ['63000020', 'Zhonghe'],
]);

describe('constructionEntries', () => {
  it('progress is 0 at the commit quarter, with lag 8 and positive difference', () => {
    const rows = constructionEntries(state('2020Q1', [entry('A', '2020Q1', '2022Q1', 5)]), new Map());
    expect(rows).toEqual([
      {
        district: 'A',
        districtName: 'A',
        committed: '2020Q1',
        effect: '2022Q1',
        difference: 5,
        lag: 8,
        progress: 0,
        afterEnd: false,
      },
    ]);
  });

  it('progress is Lag - 1 one quarter before the effect, negative difference kept', () => {
    const rows = constructionEntries(
      state('2021Q4', [entry('63000010', '2020Q1', '2022Q1', -3)]),
      names,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ districtName: 'Banqiao', difference: -3, lag: 8, progress: 7 });
  });

  it('flags an effect quarter after 2025Q4 as afterEnd', () => {
    const rows = constructionEntries(
      state('2025Q4', [
        entry('A', '2025Q3', '2026Q1', 2),
        entry('B', '2024Q4', '2025Q4', 2),
      ]),
      new Map(),
    );
    expect(rows.map((r) => [r.district, r.afterEnd])).toEqual([
      ['B', false],
      ['A', true],
    ]);
  });

  it('skips zero differences and other tools', () => {
    const rows = constructionEntries(
      state('2020Q1', [
        entry('A', '2020Q1', '2022Q1', 0),
        entry('A', '2020Q1', '2022Q1', 4, 'rentSubsidy'),
      ]),
      new Map(),
    );
    expect(rows).toEqual([]);
  });

  it('sorts by effect, then district name, then committed', () => {
    const rows = constructionEntries(
      state('2021Q1', [
        entry('63000020', '2020Q1', '2022Q1', 1),
        entry('63000010', '2020Q1', '2022Q1', 1),
        entry('63000010', '2019Q4', '2021Q4', 1),
      ]),
      names,
    );
    expect(rows.map((r) => [r.districtName, r.effect])).toEqual([
      ['Banqiao', '2021Q4'],
      ['Banqiao', '2022Q1'],
      ['Zhonghe', '2022Q1'],
    ]);
  });
});

describe('completionItems', () => {
  it('returns [] for no states', () => {
    expect(completionItems([])).toEqual([]);
  });

  it('keeps entries whose effect is at or before the last quarter, once per (area, committed)', () => {
    const e1 = entry('A', '2020Q1', '2021Q1', 5);
    const e2 = entry('A', '2020Q1', '2021Q1', 5);
    const later = entry('B', '2020Q2', '2022Q2', 3);
    const items = completionItems([
      state('2020Q2', [e1, later]),
      state('2021Q1', [e2, later]),
    ]);
    expect(items).toEqual([
      { district: 'A', districtName: 'A', committed: '2020Q1', effect: '2021Q1', difference: 5 },
    ]);
  });

  it('uses the names map when given and keeps negative differences', () => {
    const items = completionItems(
      [state('2022Q1', [entry('63000020', '2020Q1', '2022Q1', -2)])],
      names,
    );
    expect(items).toEqual([
      {
        district: '63000020',
        districtName: 'Zhonghe',
        committed: '2020Q1',
        effect: '2022Q1',
        difference: -2,
      },
    ]);
  });
});
