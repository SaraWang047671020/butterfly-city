import { focusableIn, focusIfConnected, wrapFocusIndex } from './focus.ts';

/** Dialog_Frame sizes (play-loop Requirement 9.1): md about 40rem, lg about 64rem, full screen; all full screen on phones. */
export type DialogSize = 'md' | 'lg' | 'full';

export interface DialogOpenOptions {
  /** Dialog title; it is the accessible name (aria-labelledby points at it). */
  readonly title: string;
  /** Small line above the title (for example the quarter a decision applies from). Optional. */
  readonly kicker?: string;
  /** Content built by the caller. */
  readonly body: Node;
  /** Buttons of the action row, in order; the primary action goes last (play-loop Requirement 9.1). Optional. */
  readonly actions?: readonly HTMLElement[];
  /** Control that opened the dialog; focus returns here on close. */
  readonly opener: HTMLElement | null;
  /** Called on Escape (the `cancel` event) and by the Close control. Must cancel the action and close the dialog. Defaults to `close()`. */
  readonly onCancel?: () => void;
  readonly size?: DialogSize;
  /** False hides the Close control (a step the player must complete, such as Character_Creation). Default true. */
  readonly closable?: boolean;
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
 * The Dialog_Frame (play-loop Requirement 9): one <dialog> opened with showModal(), with a header (kicker, title,
 * Close control), a body and an action row. showModal puts it in the top layer, so it takes pointer events even
 * inside the pointer-transparent overlay. Focus moves to the first focusable element of the body (or of the action
 * row, then the Close control), Tab wraps inside, Escape arrives as `cancel`, and focus returns to the opener, or to
 * the fallback when the opener is gone (game-ui Requirements 17.12 to 17.15). No layout or position is set here.
 */
export function createDialogManager(doc: Document, getFallbackFocus: () => HTMLElement | null, closeLabel: string): DialogManager {
  const root = doc.createElement('dialog');
  root.className = 'ui-dialog';
  const titleId = `ui-dialog-title-${++dialogCounter}`;
  const header = doc.createElement('div');
  header.className = 'ui-dialog-header';
  const titles = doc.createElement('div');
  titles.className = 'ui-dialog-titles';
  const kicker = doc.createElement('p');
  kicker.className = 'ui-dialog-kicker';
  const heading = doc.createElement('h2');
  heading.id = titleId;
  heading.className = 'ui-dialog-title';
  titles.append(kicker, heading);
  const closeButton = doc.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'ui-dialog-close';
  closeButton.setAttribute('aria-label', closeLabel);
  closeButton.textContent = '×';
  header.append(titles, closeButton);
  const content = doc.createElement('div');
  content.className = 'ui-dialog-body';
  const footer = doc.createElement('div');
  footer.className = 'ui-dialog-actions';
  root.append(header, content, footer);
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
    footer.replaceChildren();
    onCancel = null;
    restoreFocus();
  };

  root.addEventListener('cancel', (event) => {
    event.preventDefault(); // the controller decides what closing means
    (onCancel ?? close)();
  });
  closeButton.addEventListener('click', () => (onCancel ?? close)());

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
      root.dataset['size'] = options.size ?? 'md';
      closeButton.hidden = options.closable === false;
      kicker.textContent = options.kicker ?? '';
      kicker.hidden = options.kicker === undefined;
      heading.textContent = options.title;
      content.replaceChildren(options.body);
      footer.replaceChildren(...(options.actions ?? []));
      footer.hidden = footer.childElementCount === 0;
      if (!root.open) root.showModal();
      content.scrollTop = 0;
      const first = focusableIn(content)[0] ?? focusableIn(footer)[0] ?? closeButton;
      first.focus();
    },
    close,
    isOpen: () => root.open,
  };
}
