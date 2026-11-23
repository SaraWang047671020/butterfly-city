// Dialogs (game-ui Requirements 7.6, 12.7, 12.8, 12.10, 13.1, 13.6, 13.12, 13.13, 14.10, 14.11, 17.12, 17.14).
// One component whose root is the dialog manager's <dialog>. An outer container mounts it; it floats in the top
// layer once opened. No page layout or position here; class names are styled in src/styles/dialogs.css.
// Import and export fields keep their own text, so an update with the same dialog never rewrites a focused field.
import type { DialogView, UiActions } from '../../types/view.ts';
import type { Component } from '../component.ts';
import { createDialogManager } from '../a11y/dialog.ts';
import type { DialogManager, DialogSize } from '../a11y/dialog.ts';
import { createRangeSourceView } from '../explain/range-source-view.ts';
import { formatRange } from '../format/range.ts';
import { fieldLabel, formatAmount, toolName } from '../panels/policy-text.ts';
import { fillTemplate, UI_STRINGS, quarterLabel } from '../strings.ts';
import '../../styles/dialogs.css';
import '../../styles/range-source.css';

const D = UI_STRINGS.dialogs;
const DEMO = UI_STRINGS.demo;

export interface DialogsDeps {
  /** Control that should take focus when a dialog closes and its opener is gone (the Next_Quarter_Action). */
  readonly getFallbackFocus: () => HTMLElement | null;
  /** Control that opened the dialog, when the outer container knows it. */
  readonly getOpener?: () => HTMLElement | null;
}

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(doc: Document, label: string, onClick: () => void, primary = false): HTMLButtonElement {
  const b = el(doc, 'button', primary ? 'dialog__button dialog__button--primary' : 'dialog__button', label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}


/** Key that identifies which dialog is open. The same key means update in place, a new key rebuilds. */
function dialogKey(view: DialogView): string {
  switch (view.kind) {
    case 'confirm':
      return `confirm:${view.action}`;
    case 'event-cards':
      return `event-cards:${view.cards.map((c) => c.id).join(',')}`;
    default:
      return view.kind;
  }
}

interface Built {
  readonly title: string;
  readonly body: HTMLElement;
  /** Buttons of the Dialog_Frame action row, primary last. */
  readonly actions: readonly HTMLElement[];
  readonly size?: DialogSize;
  readonly onCancel: () => void;
  /** Applies a later view of the same dialog without rebuilding the body. */
  readonly refresh: (view: DialogView) => void;
}

function copyField(
  doc: Document,
  actions: UiActions,
  initialText: string,
): { readonly block: HTMLElement; readonly refresh: (text: string, copyFailed: boolean) => void } {
  const block = el(doc, 'div', 'dialog__field');
  const area = el(doc, 'textarea', 'dialog__textarea');
  area.readOnly = true;
  area.rows = 6;
  area.value = initialText;
  area.setAttribute('aria-label', D.exportTitle);
  const status = el(doc, 'p', 'dialog__status');
  status.setAttribute('role', 'status');
  const copy = button(doc, D.copy, () => {
    const clipboard = doc.defaultView?.navigator.clipboard;
    const fail = (): void => {
      area.focus();
      area.select();
      actions.reportCopyFailed();
    };
    if (clipboard === undefined) {
      fail();
      return;
    }
    clipboard.writeText(area.value).then(
      () => {
        status.textContent = UI_STRINGS.storage.copied;
      },
      fail,
    );
  });
  block.append(area, status, copy);
  return {
    block,
    refresh(text, copyFailed) {
      if (area.value !== text) area.value = text;
      if (copyFailed) {
        status.textContent = UI_STRINGS.storage.copyFailed;
        area.focus();
        area.select();
      }
    },
  };
}

function buildConfirm(doc: Document, actions: UiActions, view: Extract<DialogView, { kind: 'confirm' }>): Built {
  const text =
    view.action === 'new-game'
      ? { title: D.confirmNewGameTitle, body: D.confirmNewGame }
      : view.action === 'load-demo'
        ? { title: D.confirmLoadDemoTitle, body: D.confirmLoadDemo }
        : { title: D.confirmImportTitle, body: D.confirmImport };
  const body = el(doc, 'div', 'dialog__content');
  body.append(el(doc, 'p', 'dialog__text', text.body));
  return {
    title: text.title,
    body,
    actions: [button(doc, D.cancel, () => actions.confirm(false)), button(doc, D.confirm, () => actions.confirm(true), true)],
    onCancel: () => actions.confirm(false),
    refresh: () => undefined,
  };
}

function importErrorText(error: { step: string; path: string; reason: string }): string {
  return fillTemplate(UI_STRINGS.importMessages.errorAt, { path: error.path, reason: error.reason });
}

function buildImport(doc: Document, actions: UiActions): Built {
  const body = el(doc, 'div', 'dialog__content');
  const id = `dialog-import-${Math.random().toString(36).slice(2, 8)}`;
  const label = el(doc, 'label', 'dialog__label', D.importLabel);
  label.htmlFor = id;
  const area = el(doc, 'textarea', 'dialog__textarea');
  area.id = id;
  area.rows = 6;
  area.spellcheck = false;
  area.autocomplete = 'off';
  const errorId = `${id}-error`;
  const error = el(doc, 'p', 'dialog__error');
  error.id = errorId;
  error.setAttribute('role', 'alert');
  error.hidden = true;
  const confirm = button(doc, D.confirm, () => actions.importSaveCode(area.value), true);
  body.append(label, area, error);
  return {
    title: D.importTitle,
    body,
    actions: [button(doc, D.cancel, () => actions.closeDialog()), confirm],
    onCancel: () => actions.closeDialog(),
    refresh(view) {
      if (view.kind !== 'import') return;
      if (view.error === null) {
        error.hidden = true;
        error.textContent = '';
        area.removeAttribute('aria-describedby');
        area.removeAttribute('aria-invalid');
      } else {
        error.hidden = false;
        error.textContent = importErrorText(view.error);
        area.setAttribute('aria-describedby', errorId);
        area.setAttribute('aria-invalid', 'true');
      }
    },
  };
}

function buildExport(doc: Document, actions: UiActions, view: Extract<DialogView, { kind: 'export' | 'stored-export' }>): Built {
  const field = copyField(doc, actions, view.text);
  const body = el(doc, 'div', 'dialog__content');
  body.append(field.block);
  field.refresh(view.text, view.copyFailed);
  return {
    title: view.kind === 'export' ? D.exportTitle : D.storedTextTitle,
    body,
    actions: [button(doc, D.close, () => actions.closeDialog(), true)],
    onCancel: () => actions.closeDialog(),
    refresh(next) {
      if (next.kind === 'export' || next.kind === 'stored-export') field.refresh(next.text, next.copyFailed);
    },
  };
}

function buildEventCards(doc: Document, actions: UiActions, view: Extract<DialogView, { kind: 'event-cards' }>): Built {
  const body = el(doc, 'div', 'dialog__content');
  const list = el(doc, 'ul', 'dialog__cards');
  for (const card of view.cards) {
    const li = el(doc, 'li', 'dialog__card');
    const date = card.firstQuarter === card.lastQuarter ? quarterLabel(card.firstQuarter) : `${quarterLabel(card.firstQuarter)} - ${quarterLabel(card.lastQuarter)}`;
    li.append(
      el(doc, 'p', 'dialog__card-date', date),
      el(doc, 'h3', 'dialog__card-title', card.title),
      el(doc, 'p', 'dialog__card-text', card.description),
    );
    if (card.sources.length > 0) {
      const sources = el(doc, 'ul', 'dialog__sources');
      for (const s of card.sources) {
        const item = el(doc, 'li', 'dialog__source');
        const a = el(doc, 'a', 'dialog__link', s.name);
        a.href = s.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        item.append(a);
        sources.append(item);
      }
      li.append(sources);
    }
    if (card.sources.some((s) => /(^|\.)wikipedia\.org$/.test(safeHost(s.url)))) {
      li.append(el(doc, 'p', 'dialog__attribution', UI_STRINGS.timeline.wikipediaAttribution));
    }
    list.append(li);
  }
  body.append(list);
  return {
    title: D.eventCardTitle,
    body,
    actions: [button(doc, UI_STRINGS.timeline.dismissCards, () => actions.dismissEventCards(), true)],
    size: 'lg',
    onCancel: () => actions.dismissEventCards(),
    refresh: () => undefined,
  };
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function buildRangeSource(doc: Document, actions: UiActions, view: Extract<DialogView, { kind: 'range-source' }>): Built {
  const block = createRangeSourceView(doc);
  block.update(view.source);
  const body = el(doc, 'div', 'dialog__content');
  body.append(block.root);
  return {
    title: D.rangeSourceTitle,
    body,
    actions: [button(doc, D.close, () => actions.closeDialog(), true)],
    size: 'lg',
    onCancel: () => actions.closeDialog(),
    refresh(next) {
      if (next.kind === 'range-source') block.update(next.source);
    },
  };
}

function buildDemo(doc: Document, actions: UiActions, view: Extract<DialogView, { kind: 'demo' }>): Built {
  const body = el(doc, 'div', 'dialog__content');
  const close = button(doc, D.cancel, () => actions.closeDialog());
  let buttons: HTMLElement[];
  if (view.demo === null) {
    const reason = view.unavailableReason ?? '';
    body.append(el(doc, 'p', 'dialog__error', fillTemplate(DEMO.loadError, { reason })));
    buttons = [button(doc, D.close, () => actions.closeDialog(), true)];
  } else {
    const demo = view.demo;
    const list = el(doc, 'ul', 'dialog__demo-list');
    for (const e of demo.entries) {
      list.append(
        el(
          doc,
          'li',
          'dialog__demo-item',
          fillTemplate(DEMO.adjustment, {
            quarter: quarterLabel(e.quarter),
            tool: toolName(e.tool),
            field: fieldLabel(e.tool, e.field),
            area: e.area,
            value: e.kind === 'real-track' || e.value === null ? DEMO.realTrack : formatAmount(e.value),
          }),
        ),
      );
    }
    const ghost = formatRange(demo.ghostDifference, 0, '');
    body.append(
      list,
      el(doc, 'p', 'dialog__text', fillTemplate(DEMO.ghostLine, { value: ghost.text })),
      el(
        doc,
        'p',
        'dialog__text',
        fillTemplate(DEMO.rentBurdenLine, {
          district: demo.rentBurden.districtName,
          value: formatAmount(demo.rentBurden.difference),
        }),
      ),
      el(doc, 'p', 'dialog__note', DEMO.examplesNote),
    );
    buttons = [close, button(doc, D.confirm, () => actions.confirmDemo(), true)];
  }
  return { title: DEMO.descriptionHeading, body, actions: buttons, onCancel: () => actions.closeDialog(), refresh: () => undefined };
}

function build(doc: Document, actions: UiActions, view: DialogView): Built {
  switch (view.kind) {
    case 'confirm':
      return buildConfirm(doc, actions, view);
    case 'import':
      return buildImport(doc, actions);
    case 'export':
    case 'stored-export':
      return buildExport(doc, actions, view);
    case 'event-cards':
      return buildEventCards(doc, actions, view);
    case 'range-source':
      return buildRangeSource(doc, actions, view);
    case 'demo':
      return buildDemo(doc, actions, view);
  }
}

export interface DialogsComponent extends Component<DialogView | null> {
  readonly root: HTMLDialogElement;
  readonly manager: DialogManager;
}

/** Creates the dialogs component. `update(null)` closes the open dialog without calling any action. */
export function createDialogs(doc: Document, actions: UiActions, deps: DialogsDeps): DialogsComponent {
  const manager = createDialogManager(doc, deps.getFallbackFocus, D.close);
  let currentKey: string | null = null;
  let current: Built | null = null;
  let lastOpener: HTMLElement | null = null;
  return {
    root: manager.root,
    manager,
    update(view) {
      if (view === null) {
        if (manager.isOpen()) manager.close();
        currentKey = null;
        current = null;
        return;
      }
      const key = dialogKey(view);
      if (key === currentKey && current !== null && manager.isOpen()) {
        current.refresh(view);
        return;
      }
      const built = build(doc, actions, view);
      currentKey = key;
      current = built;
      // While a dialog is already open, keep the original opener so focus returns to the control that started it.
      if (!manager.isOpen()) {
        lastOpener = deps.getOpener?.() ?? (doc.activeElement instanceof HTMLElement ? doc.activeElement : null);
      }
      const opener = lastOpener;
      manager.open({ title: built.title, body: built.body, actions: built.actions, size: built.size ?? 'md', opener, onCancel: built.onCancel });
      built.refresh(view);
    },
  };
}
