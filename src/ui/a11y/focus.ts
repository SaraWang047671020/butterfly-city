/** Pure: index to focus after Tab or Shift+Tab inside a trap of `count` focusable elements. */
export function wrapFocusIndex(count: number, current: number, backwards: boolean): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return backwards ? count - 1 : 0;
  if (backwards) return current === 0 ? count - 1 : current - 1;
  return current === count - 1 ? 0 : current + 1;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),' +
  'textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Focusable descendants of `root` in DOM order (which is the visual reading order here). */
export function focusableIn(root: Element): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true',
  );
}

/** Moves focus to `target` if it is still in the document. Returns whether focus moved. */
export function focusIfConnected(target: HTMLElement | null | undefined): boolean {
  if (target === null || target === undefined || !target.isConnected) return false;
  target.focus();
  return true;
}
