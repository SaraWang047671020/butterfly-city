import { focusableIn, focusIfConnected, wrapFocusIndex } from './focus.ts';

export interface DialogOpenOptions {
  /** Dialog title; it is the accessible name (aria-labelledby points at it). */
  readonly title: string;
  /** Content built by the caller. */
  readonly body: Node;
  /** Control that opened the dialog; focus returns here on close. */
  readonly opener: HTMLElement | null;
  /** Called on Escape (the `cancel` event). Must cancel the action and close the dialog. Defaults to `close()`. */
  readonly onCancel?: () => void;
}

export interface DialogManager {
  /** The single <dialog>. An outer container mounts it; it floats in the top layer once opened. */
  readonly root: HTMLDialogElement;
  open(options: DialogOpenOptions): void;
  close(): void;
  isOpen(): boolean;
}

let dialogCounter = 0;

/**
 * One <dialog> opened with showModal(). Focus moves to the first focusable element, Tab wraps inside,
 * Escape arrives as `cancel`, and focus returns to the opener, or to the Next_Quarter_Action when the opener is gone
 * (Requirements 17.12 to 17.15). No layout or position is set here.
 */
export function createDialogManager(doc: Document, getFallbackFocus: () => HTMLElement | null): DialogManager {
  const root = doc.createElement('dialog');
  root.className = 'ui-dialog';
  const titleId = `ui-dialog-title-${++dialogCounter}`;
  const heading = doc.createElement('h2');
  heading.id = titleId;
  heading.className = 'ui-dialog-title';
  const content = doc.createElement('div');
  content.className = 'ui-dialog-body';
  root.append(heading, content);
  root.setAttribute('aria-labelledby', titleId);

  let opener: HTMLElement | null = null;
  let onCancel: (() => void) | null = null;

  const restoreFocus = (): void => {
    const target = opener;
    opener = null;
    if (!focusIfConnected(target)) focusIfConnected(getFallbackFocus());
  };

  const close = (): void => {
    if (root.open) root.close();
    content.replaceChildren();
    onCancel = null;
    restoreFocus();
  };

  root.addEventListener('cancel', (event) => {
    event.preventDefault(); // the controller decides what closing means
    (onCancel ?? close)();
  });

  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const items = focusableIn(root);
    if (items.length === 0) {
      event.preventDefault();
      root.focus();
      return;
    }
    const active = doc.activeElement as HTMLElement | null;
    const index = active === null ? -1 : items.indexOf(active);
    const next = wrapFocusIndex(items.length, index, event.shiftKey);
    // Only intercept at the ends or when focus is outside the list; otherwise the browser order is already correct.
    const atEdge = index === -1 || (event.shiftKey ? index === 0 : index === items.length - 1);
    if (atEdge) {
      event.preventDefault();
      items[next]?.focus();
    }
  });

  return {
    root,
    open(options) {
      opener = options.opener;
      onCancel = options.onCancel ?? null;
      heading.textContent = options.title;
      content.replaceChildren(options.body);
      if (!root.open) root.showModal();
      const first = focusableIn(root)[0];
      if (first !== undefined) first.focus();
      else {
        root.tabIndex = -1;
        root.focus();
      }
    },
    close,
    isOpen: () => root.open,
  };
}
