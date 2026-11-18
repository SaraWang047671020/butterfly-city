// Game_Controller example tests (task 9.3), on fixtures with a recording Save_Store port and a scheduler.
// Validates: Requirements 19.1, 7.1, 7.5, 7.7, 7.8, 7.11, 9.7, 9.8, 9.14, 7.14, 12.9, 12.11

import { describe, expect, it } from 'vitest';

import { convert } from '../../src/data/convert.ts';
import type { LoadedData } from '../../src/data/convert.ts';
import { GameController } from '../../src/game/controller.ts';
import type { SaveStorePort, Scheduler } from '../../src/game/controller.ts';
import { newSession, toSave } from '../../src/game/core/session.ts';
import { encodeSave } from '../../src/save/codec.ts';
import type { StoredRead } from '../../src/save/store.ts';
import { RULE_REGISTRY } from '../../src/simulation/registry.ts';
import type { QuarterKey } from '../../src/types/data-files.ts';
import type { Save } from '../../src/types/save.ts';
import type { FieldView, GameView } from '../../src/types/view.ts';
import { readFixture } from '../data/fixtures/index.ts';

const T = 120_000;
const KEY = 'rentSubsidy|households|Taipei';

function load(): LoadedData {
  return convert({
    districts: readFixture('districts.json'),
    history: readFixture('history.json'),
    policyTrack: readFixture('policy-track.json'),
    events: readFixture('events.json'),
    params: readFixture('params.json'),
    commute: readFixture('commute-matrix.json'),
  });
}

class RecordingStore implements SaveStorePort {
  writes: Save[] = [];
  failWrites = false;
  stored: StoredRead;
  constructor(stored: StoredRead = { kind: 'none' }) {
    this.stored = stored;
  }
  write(save: Save): { readonly ok: boolean } {
    if (this.failWrites) return { ok: false };
    this.writes.push(save);
    this.stored = { kind: 'text', text: encodeSave(save) };
    return { ok: true };
  }
  readStored(): StoredRead {
    return this.stored;
  }
}

const SYNC: Scheduler = {
  defer(fn) {
    fn();
  },
};

function make(data: LoadedData, store: SaveStorePort, scheduler: Scheduler = SYNC): GameController {
  return new GameController({
    data,
    registry: RULE_REGISTRY,
    store,
    scheduler,
    demo: { ok: false, reason: 'No demo in this test.' },
  });
}

function storedAt(data: LoadedData, next: Save['next'], policy: Save['policy'] = []): StoredRead {
  const save: Save = { ...toSave(newSession(data, RULE_REGISTRY)), next, policy };
  return { kind: 'text', text: encodeSave(save) };
}

function started(data: LoadedData, store: SaveStorePort): GameController {
  const c = make(data, store);
  c.actions.continueStored();
  return c;
}

function quarters(v: GameView): { displayed: QuarterKey | null; planning: QuarterKey | null } {
  return { displayed: v.turnBar.displayed, planning: v.turnBar.planning };
}

function field(v: GameView, key: string): FieldView {
  for (const d of v.policyPanel.domains) {
    for (const t of d.tools) {
      if (t.kind !== 'active') continue;
      const f = t.fields.find((x) => x.key === key);
      if (f !== undefined) return f;
    }
  }
  throw new Error(`no field ${key}`);
}

describe('turn actions', () => {
  it('Next_Quarter_Action advances one quarter and writes the save', { timeout: T }, () => {
    const store = new RecordingStore();
    const c = make(load(), store);
    c.actions.startNew();
    const before = store.writes.length;
    c.actions.nextQuarter();
    expect(quarters(c.view())).toEqual({ displayed: '2015Q1', planning: '2015Q2' });
    expect(store.writes.length).toBeGreaterThan(before);
    expect(store.writes[store.writes.length - 1]?.next).toBe('2015Q2');
  });

  it('Fast_Forward_Action stops after 4 quarters', { timeout: T }, () => {
    const c = make(load(), new RecordingStore());
    c.actions.startNew();
    c.actions.fastForward();
    expect(quarters(c.view())).toEqual({ displayed: '2015Q4', planning: '2016Q1' });
  });

  it('Fast_Forward_Action stops at a Major_Event quarter', { timeout: T }, () => {
    const data0 = load();
    const data: LoadedData = { ...data0, events: data0.events.map((e) => ({ ...e, major: true })) };
    const first = data.events[0]?.firstQuarter;
    expect(first).toBe('2020Q1');
    const c = started(data, new RecordingStore(storedAt(data, '2019Q3')));
    c.actions.fastForward();
    expect(quarters(c.view())).toEqual({ displayed: '2020Q1', planning: '2020Q2' });
    expect(c.view().dialog?.kind).toBe('event-cards');
  });

  it('Fast_Forward_Action stops at 2025Q4', { timeout: T }, () => {
    const data = load();
    const c = started(data, new RecordingStore(storedAt(data, '2025Q2')));
    c.actions.fastForward();
    const v = c.view();
    expect(quarters(v)).toEqual({ displayed: '2025Q4', planning: null });
    expect(v.turnBar.complete).toBe(true);
  });

  it('Fast_Forward_Action stops at an Engine_Error', { timeout: T }, () => {
    const data0 = load();
    const params = { ...data0.engine.params } as Record<string, unknown>;
    delete params['commute.jobShare.63000010'];
    const data = { ...data0, engine: { ...data0.engine, params } } as unknown as LoadedData;
    const c = make(data, new RecordingStore());
    c.actions.startNew();
    c.actions.fastForward();
    const v = c.view();
    expect(v.turnBar.engineError).not.toBeNull();
    expect(quarters(v)).toEqual({ displayed: null, planning: '2015Q1' });
    expect(v.announcement?.politeness).toBe('assertive');
  });

  it('Fast_Forward_Action stops before a carried-value break', { timeout: T }, () => {
    const data = load();
    const diffs = Array.from({ length: 44 }, (_, i) => (i >= 12 ? 1e9 : 0)); // 2018Q1 on
    const policy: Save['policy'] = [{ tool: 'rentSubsidy', field: 'households', area: 'Taipei', diffs }];
    const c = started(data, new RecordingStore(storedAt(data, '2017Q3', policy)));
    expect(c.screen().kind).toBe('game');
    c.actions.fastForward();
    expect(quarters(c.view())).toEqual({ displayed: '2017Q4', planning: '2018Q1' });
  });
});

describe('policy adjustments', () => {
  it('a Policy_Adjustment for a Fixed_Quarter is rejected', { timeout: T }, () => {
    const data = load();
    const store = new RecordingStore(storedAt(data, 'complete'));
    const c = started(data, store);
    const writes = store.writes.length;
    c.actions.editField(KEY, '1');
    expect(field(c.view(), KEY).draft?.check.status).toBe('fixed-quarter');
    c.actions.applyField(KEY);
    c.actions.setToReal(KEY);
    expect(store.writes.length).toBe(writes);
    expect(store.writes[store.writes.length - 1]?.timeline ?? []).toEqual([]);
  });

  it('a Real_Track_Adjustment writes the real value of every later quarter and adds one Timeline_Entry', { timeout: T }, () => {
    const data = load();
    const store = new RecordingStore();
    const c = make(data, store);
    c.actions.startNew();
    const f0 = field(c.view(), KEY);
    const value = f0.limits.lower !== f0.player ? Math.ceil(f0.limits.lower) : Math.floor(f0.limits.upper);
    c.actions.editField(KEY, String(value));
    c.actions.applyField(KEY);
    expect(store.writes[store.writes.length - 1]?.timeline.length).toBe(1);
    c.actions.nextQuarter();
    c.actions.setToReal(KEY);
    const saved = store.writes[store.writes.length - 1];
    expect(saved?.timeline.length).toBe(2);
    expect(saved?.timeline[1]?.kind).toBe('real-track');
    expect(saved?.timeline[1]?.quarter).toBe('2015Q2');
    const series = saved?.policy.find((s) => s.tool === 'rentSubsidy' && s.field === 'households' && s.area === 'Taipei');
    expect(series?.diffs[0]).not.toBe(0);
    expect((series?.diffs ?? []).slice(1).every((d) => d === 0)).toBe(true);
    const f = field(c.view(), KEY);
    expect(f.real === null ? null : f.player).toBe(f.real === null ? null : f.real.value);
  });
});

describe('loading', () => {
  it('the same Save loaded twice gives deep-equal views', { timeout: T }, () => {
    const data = load();
    const text = storedAt(data, '2016Q2');
    const a = started(data, new RecordingStore(text));
    const b = started(data, new RecordingStore(text));
    expect(a.view()).toEqual(b.view());
  });
});

describe('guards and storage', () => {
  it('the busy guard ignores activations until the deferred work runs', { timeout: T }, () => {
    const queue: (() => void)[] = [];
    const store = new RecordingStore();
    const c = make(load(), store, { defer: (fn) => void queue.push(fn) });
    c.actions.startNew();
    c.actions.nextQuarter();
    expect(c.view().turnBar.busy).toBe(true);
    expect(queue.length).toBe(1);
    c.actions.nextQuarter();
    c.actions.fastForward();
    c.actions.startNew();
    expect(queue.length).toBe(1);
    expect(c.view().dialog).toBeNull();
    queue.shift()?.();
    const v = c.view();
    expect(v.turnBar.busy).toBe(false);
    expect(quarters(v)).toEqual({ displayed: '2015Q1', planning: '2015Q2' });
  });

  it('a declined confirmation keeps game and storage', { timeout: T }, () => {
    const data = load();
    const store = new RecordingStore(storedAt(data, '2016Q2'));
    const c = started(data, store);
    const writes = store.writes.length;
    const stored = store.stored;
    const before = c.view();
    c.actions.startNew();
    expect(c.view().dialog).toEqual({ kind: 'confirm', action: 'new-game' });
    c.actions.confirm(false);
    expect(c.view()).toEqual(before);
    expect(store.writes.length).toBe(writes);
    expect(store.stored).toBe(stored);
  });

  it('a failed write sets the storage warning until the next successful write', { timeout: T }, () => {
    const store = new RecordingStore();
    store.failWrites = true;
    const c = make(load(), store);
    c.actions.startNew();
    expect(c.view().turnBar.storageWarning).toBe(true);
    c.actions.selectDistrict(load().districts[0]!.code);
    expect(c.view().turnBar.storageWarning).toBe(true);
    store.failWrites = false;
    c.actions.selectDistrict(load().districts[1]!.code);
    expect(c.view().turnBar.storageWarning).toBe(false);
  });
});

describe('import dialog', () => {
  it('openImport opens the import dialog without an error', { timeout: T }, () => {
    const c = make(load(), new RecordingStore());
    c.actions.startNew();
    c.actions.openImport();
    expect(c.view().dialog).toEqual({ kind: 'import', error: null });
    c.actions.closeDialog();
    expect(c.view().dialog).toBeNull();
  });

  it('importSaveCode from the dialog reports a malformed code and keeps the game', { timeout: T }, () => {
    const store = new RecordingStore();
    const c = make(load(), store);
    c.actions.startNew();
    const writes = store.writes.length;
    c.actions.openImport();
    c.actions.importSaveCode('not a save code');
    const d = c.view().dialog;
    expect(d?.kind).toBe('import');
    expect(d?.kind === 'import' && d.error !== null).toBe(true);
    expect(store.writes.length).toBe(writes);
  });

  it('importSaveCode from the dialog replaces an untouched game with a valid code', { timeout: T }, () => {
    const data = load();
    const stored = storedAt(data, '2016Q2');
    const c = make(data, new RecordingStore());
    c.actions.startNew();
    c.actions.openImport();
    c.actions.importSaveCode(stored.kind === 'text' ? stored.text : '');
    expect(c.view().dialog).toBeNull();
    expect(c.view().turnBar.planning).toBe('2016Q2');
  });
});
