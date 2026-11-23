// Stateful Game_Controller (design section 3). No DOM, no simulation formulas, no clock, no random source.
// Composes src/game/core/*, the Save_Store port and the Data_Loader output. The core does all computing.

import type { LoadedData } from '../data/convert.ts';
import { CITY_NAMES } from '../types/data-files.ts';
import type { DistrictCode, QuarterKey } from '../types/data-files.ts';
import type { Save } from '../types/save.ts';
import type { MapIndicatorId } from '../types/save.ts';
import type { EngineError, RuleRegistry, ToolId } from '../types/simulation.ts';
import type {
  Announcement,
  CityStaticView,
  DemoDescriptionView,
  DialogView,
  EditCheckView,
  EventCardView,
  FieldKey,
  GameView,
  ScreenView,
  StoredProblemView,
  UiActions,
  ValueRef,
} from '../types/view.ts';
import { decodeSaveCode, encodeSave } from '../save/codec.ts';
import type { SaveValidationContext } from '../save/codec.ts';
import type { StoredRead } from '../save/store.ts';
import { applyAdjustment, checkEditRange, checkEditSync } from './core/checks.ts';
import type { EditRequest } from './core/checks.ts';
import type { FieldTarget } from './core/policy.ts';
import { fromSave, newSession, toSave } from './core/session.ts';
import type { GameSession } from './core/session.ts';
import { computeNext, fastForward } from './core/turns.ts';
import type { CarriedProblem, TurnOutcome } from './core/turns.ts';
import { buildCityStatic, buildGameView, buildRangeSourceView } from './core/views.ts';
import type { ControllerUiState } from './core/views.ts';

/** Declared here as the design says; `SaveStore` of src/save/store.ts matches it. */
export interface SaveStorePort {
  write(save: Save): { readonly ok: boolean };
  readStored(): StoredRead;
}

/** `setTimeout(fn, 0)` in main.ts, synchronous in tests. */
export interface Scheduler {
  defer(fn: () => void): void;
}

/**
 * The demo as the controller needs it: the decoded Demo_Save and its description (built by src/game/demo.ts),
 * or the reason it is unavailable. Structural port, so this module does not import demo.ts.
 */
export type DemoPort =
  | { readonly ok: true; readonly save: Save; readonly description: DemoDescriptionView }
  | { readonly ok: false; readonly reason: string };

export interface GameControllerDeps {
  readonly data: LoadedData;
  readonly registry: RuleRegistry;
  readonly store: SaveStorePort;
  readonly scheduler: Scheduler;
  readonly demo: DemoPort;
}

type Pending =
  | { readonly action: 'new-game' }
  | { readonly action: 'load-demo' }
  | { readonly action: 'import'; readonly session: GameSession; readonly notice: VersionNotice };

type VersionNotice = { readonly saved: string; readonly current: string } | null;

interface Draft {
  readonly text: string;
  readonly generation: number;
  readonly check: EditCheckView;
}

type StartOption = 'continue' | 'new' | 'demo';

function parseKey(key: FieldKey): FieldTarget | null {
  const parts = key.split('|');
  if (parts.length !== 3) return null;
  const [tool, field, area] = parts as [string, string, string];
  return { tool: tool as ToolId, field, area };
}

function engineReason(e: EngineError): string {
  return `${e.code}: ${e.message}`;
}

export class GameController {
  readonly actions: UiActions;

  private readonly data: LoadedData;
  private readonly registry: RuleRegistry;
  private readonly store: SaveStorePort;
  private readonly scheduler: Scheduler;
  private readonly demo: DemoPort;
  private readonly listeners = new Set<(view: GameView) => void>();

  private session: GameSession | null = null;
  private busy = false;
  private storageWarning = false;
  private versionNotice: VersionNotice = null;
  private engineError: { readonly quarter: QuarterKey; readonly error: EngineError } | null = null;
  private carried: CarriedProblem | null = null;
  private drafts = new Map<FieldKey, Draft>();
  private dialog: DialogView | null = null;
  private pending: Pending | null = null;
  private announcement: Announcement | null = null;
  private focusRequest: { readonly id: number; readonly key: FieldKey } | null = null;
  /** The Quarter_Brief is open: set after a Computation_Run that computed a quarter, cleared by dismissBrief. */
  private briefOpen = false;
  private counter = 0;
  private generation = 0;

  // Start menu state (Requirements 12.4, 12.5, 12.7).
  private storedExists: boolean;
  private storedSave: Save | null = null;
  private storedProblem: StoredProblemView | null = null;

  constructor(deps: GameControllerDeps) {
    this.data = deps.data;
    this.registry = deps.registry;
    this.store = deps.store;
    this.scheduler = deps.scheduler;
    this.demo = deps.demo;
    this.storedExists = false;
    this.readStoredAtStart();
    this.actions = this.makeActions();
  }

  subscribe(listener: (view: GameView) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  view(): GameView {
    const ui: ControllerUiState = {
      busy: this.busy,
      storageWarning: this.storageWarning,
      versionNotice: this.versionNotice,
      engineError: this.engineError,
      carried: this.carried,
      drafts: new Map([...this.drafts].map(([k, d]) => [k, { text: d.text, check: d.check }])),
      dialog: this.dialog,
      announcement: this.announcement,
      focusRequest: this.focusRequest,
      briefOpen: this.briefOpen,
    };
    return buildGameView(this.session, ui, this.data);
  }

  private cityStaticCache: CityStaticView | null = null;

  /** Static district data for the City_View (city-3d Requirement 2.1); built once. */
  /** The current session, read-only, for the story layer's Story_Facts (story-layer task 4); null before a game starts. */
  storySession(): Readonly<GameSession> | null {
    return this.session;
  }

  cityStatic(): CityStaticView {
    this.cityStaticCache ??= buildCityStatic(this.data);
    return this.cityStaticCache;
  }

  /**
   * The start menu until the player picked "New game", "Continue" or "Load demo", the game after.
   * `view().dialog` is valid in both states (demo description, confirmations, stored text).
   */
  screen(): ScreenView {
    if (this.session !== null) return { kind: 'game', game: this.view() };
    const options: StartOption[] = [];
    if (this.storedSave !== null) options.push('continue');
    options.push('new', 'demo');
    return { kind: 'start', options, storedProblem: this.storedProblem };
  }

  // -------------------------------------------------------------------------
  // Plumbing
  // -------------------------------------------------------------------------

  private publish(): void {
    const v = this.view();
    for (const l of [...this.listeners]) l(v);
  }

  private nextId(): number {
    this.counter += 1;
    return this.counter;
  }

  private validationContext(): SaveValidationContext {
    return {
      registry: this.registry,
      districts: this.data.districts.map((d) => ({ code: d.code, city: d.city })),
    };
  }

  private persist(session: GameSession): void {
    const r = this.store.write(toSave(session));
    this.storageWarning = !r.ok;
    if (r.ok) this.storedExists = true;
  }

  private readStoredAtStart(): void {
    const r = this.store.readStored();
    this.storedSave = null;
    this.storedProblem = null;
    if (r.kind === 'none') return;
    if (r.kind === 'unavailable') {
      this.storedProblem = { kind: 'unavailable', step: null, path: null, reason: null };
      return;
    }
    this.storedExists = true;
    const d = decodeSaveCode(r.text, this.validationContext());
    if (d.ok) this.storedSave = d.save;
    else this.storedProblem = { kind: 'invalid', step: d.error.step, path: d.error.path, reason: d.error.reason };
  }

  private needsConfirm(): boolean {
    return this.storedExists || this.session !== null;
  }

  private resetTransient(): void {
    this.drafts = new Map();
    this.engineError = null;
    this.carried = null;
    this.announcement = null;
    this.focusRequest = null;
  }

  private replaceSession(session: GameSession, notice: VersionNotice): void {
    this.session = session;
    this.versionNotice = notice;
    this.storedSave = null;
    this.storedProblem = null;
    this.dialog = null;
    this.pending = null;
    this.resetTransient();
    this.persist(session);
  }

  private blocked(): boolean {
    return this.busy || this.session === null || this.session.next === 'complete';
  }

  /** `busy = true; publish; defer(compute)`; busy is cleared only in the view that carries the new values. */
  private compute(work: () => void): void {
    this.busy = true;
    this.publish();
    this.scheduler.defer(() => {
      try {
        work();
      } finally {
        this.busy = false;
      }
      this.publish();
    });
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  private makeActions(): UiActions {
    return {
      startNew: () => this.startNew(),
      continueStored: () => this.continueStored(),
      openDemo: () => this.openDemo(),
      confirmDemo: () => this.confirmDemo(),
      confirm: (answer) => this.confirm(answer),
      nextQuarter: () => this.turn(false),
      fastForward: () => this.turn(true),
      dismissEventCards: () => this.dismissEventCards(),
      dismissBrief: () => this.dismissBrief(),
      selectDistrict: (code) => this.selectDistrict(code),
      setMapIndicator: (id) => this.setMapIndicator(id),
      editField: (key, text) => this.editField(key, text),
      applyField: (key) => this.applyField(key),
      setToReal: (key) => this.setToReal(key),
      selectTimelineEntry: (index) => this.selectTimelineEntry(index),
      openRangeSource: (ref) => this.openRangeSource(ref),
      closeDialog: () => this.closeDialog(),
      exportSaveCode: () => this.exportSaveCode(),
      openImport: () => this.openImport(),
      importSaveCode: (text) => this.importSaveCode(text),
      exportStoredText: () => this.exportStoredText(),
      reportCopyFailed: () => this.reportCopyFailed(),
    };
  }

  private startNew(): void {
    this.focusRequest = null;
    if (this.busy) return;
    if (this.needsConfirm()) {
      this.pending = { action: 'new-game' };
      this.dialog = { kind: 'confirm', action: 'new-game' };
    } else {
      this.replaceSession(newSession(this.data, this.registry), null);
    }
    this.publish();
  }

  private continueStored(): void {
    this.focusRequest = null;
    if (this.busy || this.session !== null || this.storedSave === null) return;
    const r = fromSave(this.storedSave, this.data, this.registry);
    if (!r.ok) {
      this.storedSave = null;
      this.storedProblem = { kind: 'invalid', step: 'recompute', path: r.quarter, reason: engineReason(r.error) };
    } else {
      this.session = r.session;
      this.versionNotice = r.versionNotice;
      this.storedSave = null;
      this.storedProblem = null;
      this.resetTransient();
      this.persist(r.session);
    }
    this.publish();
  }

  private openDemo(): void {
    this.focusRequest = null;
    if (this.busy) return;
    this.dialog = this.demo.ok
      ? { kind: 'demo', demo: this.demo.description, unavailableReason: null }
      : { kind: 'demo', demo: null, unavailableReason: this.demo.reason };
    this.publish();
  }

  private confirmDemo(): void {
    this.focusRequest = null;
    if (this.busy || this.dialog === null || this.dialog.kind !== 'demo' || !this.demo.ok) return;
    if (this.needsConfirm()) {
      this.pending = { action: 'load-demo' };
      this.dialog = { kind: 'confirm', action: 'load-demo' };
    } else {
      this.loadDemo(this.demo.save);
    }
    this.publish();
  }

  /** Failure shows the reason and leaves game and storage unchanged (Requirement 14.12). */
  private loadDemo(save: Save): void {
    const r = fromSave(save, this.data, this.registry);
    if (!r.ok) {
      this.pending = null;
      this.dialog = { kind: 'demo', demo: null, unavailableReason: `${r.quarter}: ${engineReason(r.error)}` };
      return;
    }
    this.replaceSession(r.session, r.versionNotice);
  }

  private confirm(answer: boolean): void {
    this.focusRequest = null;
    const p = this.pending;
    if (p === null || this.dialog === null || this.dialog.kind !== 'confirm') return;
    this.pending = null;
    if (!answer) {
      this.dialog = null;
      this.publish();
      return;
    }
    if (p.action === 'new-game') this.replaceSession(newSession(this.data, this.registry), null);
    else if (p.action === 'load-demo') {
      if (this.demo.ok) this.loadDemo(this.demo.save);
      else this.dialog = { kind: 'demo', demo: null, unavailableReason: this.demo.reason };
    } else this.replaceSession(p.session, p.notice);
    this.publish();
  }

  private closeDialog(): void {
    this.focusRequest = null;
    if (this.dialog === null) return;
    this.dialog = null;
    this.pending = null;
    this.publish();
  }

  private turn(fast: boolean): void {
    if (this.blocked()) return;
    this.focusRequest = null;
    if (this.dialog !== null && this.dialog.kind === 'event-cards') this.dialog = null;
    this.engineError = null;
    this.carried = null;
    this.compute(() => {
      const s = this.session;
      if (s === null) return;
      const out: TurnOutcome<GameSession> = fast
        ? fastForward(s, (done) => this.persist(done))
        : computeNext(s);
      this.session = out.session;
      this.drafts = new Map();
      if (!fast && out.computed.length > 0) this.persist(out.session);
      this.engineError = out.engineError;
      this.carried = out.carried;
      this.briefOpen = out.computed.length > 0;
      if (out.majorEventIds.length > 0) {
        const cards = out.session.cards.filter((c) => out.majorEventIds.includes(c.id)).map(cardView);
        this.dialog = { kind: 'event-cards', cards };
      }
      this.announce(out);
    });
  }

  private announce(out: TurnOutcome<GameSession>): void {
    const last = out.computed[out.computed.length - 1] ?? null;
    if (last !== null) {
      const titles = out.runEventIds.map((id) => out.session.cards.find((c) => c.id === id)?.title ?? id);
      this.announcement = {
        id: this.nextId(),
        politeness: 'polite',
        quarter: last,
        eventTitles: titles,
        engineError: null,
      };
    }
    if (out.engineError !== null) {
      if (last !== null) this.publish();
      this.announcement = {
        id: this.nextId(),
        politeness: 'assertive',
        quarter: out.engineError.quarter,
        eventTitles: [],
        engineError: out.engineError.error,
      };
    }
  }

  private dismissBrief(): void {
    if (!this.briefOpen) return;
    this.briefOpen = false;
    this.publish();
  }

  private dismissEventCards(): void {
    this.focusRequest = null;
    if (this.dialog === null || this.dialog.kind !== 'event-cards') return;
    this.dialog = null;
    this.publish();
  }

  private selectDistrict(code: DistrictCode): void {
    this.focusRequest = null;
    const s = this.session;
    if (s === null) return;
    this.session = { ...s, selectedDistrict: code };
    this.persist(this.session);
    this.publish();
  }

  private setMapIndicator(id: MapIndicatorId): void {
    this.focusRequest = null;
    const s = this.session;
    if (s === null) return;
    this.session = { ...s, mapIndicator: id };
    this.persist(this.session);
    this.publish();
  }

  private knownTarget(key: FieldKey): FieldTarget | null {
    const t = parseKey(key);
    if (t === null) return null;
    const rule = this.registry.tools.find((r) => r.id === t.tool);
    return rule !== undefined && rule.fields.some((f) => f.id === t.field) ? t : null;
  }

  private editField(key: FieldKey, text: string): void {
    this.focusRequest = null;
    const s = this.session;
    const target = this.knownTarget(key);
    if (s === null || target === null) return;
    this.generation += 1;
    const generation = this.generation;
    const req: EditRequest = { target, kind: 'value', text };
    const check = checkEditSync(s, req);
    this.drafts.set(key, { text, generation, check });
    this.publish();
    if (check.status !== 'pending-range') return;
    this.scheduler.defer(() => {
      const cur = this.drafts.get(key);
      const now = this.session;
      if (cur === undefined || cur.generation !== generation || now !== s) return;
      this.drafts.set(key, { text, generation, check: checkEditRange(s, req) });
      this.publish();
    });
  }

  private applyField(key: FieldKey): void {
    if (this.blocked()) return;
    const target = this.knownTarget(key);
    const draft = this.drafts.get(key);
    if (target === null || draft === undefined) return;
    this.focusRequest = null;
    this.adjust(key, { target, kind: 'value', text: draft.text }, draft.text);
  }

  private setToReal(key: FieldKey): void {
    if (this.blocked()) return;
    const target = this.knownTarget(key);
    if (target === null) return;
    this.focusRequest = null;
    this.adjust(key, { target, kind: 'real-track', text: '' }, '');
  }

  private adjust(key: FieldKey, req: EditRequest, text: string): void {
    this.compute(() => {
      const s = this.session;
      if (s === null) return;
      const r = applyAdjustment(s, req);
      if (r.check.status !== 'ok') {
        this.generation += 1;
        this.drafts.set(key, { text, generation: this.generation, check: r.check });
        return;
      }
      this.session = r.session;
      this.drafts = new Map();
      this.carried = null;
      this.persist(r.session);
    });
  }

  private selectTimelineEntry(index: number): void {
    const s = this.session;
    const e = s?.timeline[index];
    if (s === null || e === undefined) return;
    const isCity = (CITY_NAMES as readonly string[]).includes(e.area);
    if (!isCity) {
      this.session = { ...s, selectedDistrict: e.area as DistrictCode };
      this.persist(this.session);
    }
    this.focusRequest = { id: this.nextId(), key: `${e.tool}|${e.field}|${e.area}` };
    this.publish();
  }

  private openRangeSource(ref: ValueRef): void {
    this.focusRequest = null;
    const s = this.session;
    if (s === null) return;
    const source = buildRangeSourceView(s, this.data, ref);
    if (source === null) return;
    this.dialog = { kind: 'range-source', source };
    this.publish();
  }

  private exportSaveCode(): void {
    this.focusRequest = null;
    if (this.session === null) return;
    this.dialog = { kind: 'export', text: encodeSave(toSave(this.session)), copyFailed: false };
    this.publish();
  }

  private exportStoredText(): void {
    this.focusRequest = null;
    const r = this.store.readStored();
    if (r.kind !== 'text') return;
    this.dialog = { kind: 'stored-export', text: r.text, copyFailed: false };
    this.publish();
  }

  private reportCopyFailed(): void {
    const d = this.dialog;
    if (d === null || (d.kind !== 'export' && d.kind !== 'stored-export')) return;
    this.dialog = { ...d, copyFailed: true };
    this.publish();
  }

  private openImport(): void {
    this.focusRequest = null;
    if (this.busy) return;
    this.dialog = { kind: 'import', error: null };
    this.publish();
  }

  /** Decode, recompute, then replace and write only on success (Requirements 13.6, 13.10 to 13.12). */
  private importSaveCode(text: string): void {
    this.focusRequest = null;
    if (this.busy) return;
    const fail = (step: string, path: string, reason: string): void => {
      this.pending = null;
      this.dialog = { kind: 'import', error: { step, path, reason } };
      this.publish();
    };
    const d = decodeSaveCode(text, this.validationContext());
    if (!d.ok) return fail(d.error.step, d.error.path, d.error.reason);
    const r = fromSave(d.save, this.data, this.registry);
    if (!r.ok) return fail('recompute', r.quarter, engineReason(r.error));
    const s = this.session;
    if (s !== null && (s.computed !== null || s.timeline.length > 0)) {
      this.pending = { action: 'import', session: r.session, notice: r.versionNotice };
      this.dialog = { kind: 'confirm', action: 'import' };
    } else {
      this.replaceSession(r.session, r.versionNotice);
    }
    this.publish();
  }
}

function cardView(card: GameSession['cards'][number]): EventCardView {
  return {
    id: card.id,
    type: card.type,
    firstQuarter: card.firstQuarter,
    lastQuarter: card.lastQuarter,
    title: card.title,
    description: card.description,
    sources: card.sources.map((x) => ({ name: x.label, url: x.url })),
    major: card.major,
  };
}
