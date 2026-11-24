/** Pure: index to focus after Tab or Shift+Tab inside a trap of `count` focusable elements. */
export function wrapFocusIndex(count: number, current: number, backwards: boolean): number {
  if (count <= 0) return -1;
  if (current < 0 || current >= count) return backwards ? count - 1 : 0;
  if (backwards) return current === 0 ? count - 1 : current - 1;
  return current === count - 1 ? 0 : current + 1;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),' +
  'textarea:not([disabled]),details > summary:first-of-type,[tabindex]:not([tabindex="-1"])';

/**
 * Focusable descendants of `root` in DOM order (which is the visual reading order here). Only rendered elements
 * count: an element inside a `hidden` block, a `display: none` block or a closed `<details>` has no box and is
 * skipped by the browser's Tab order, so the trap must skip it too, or Tab from the real last element leaves the
 * dialog (play-loop task 12.3).
 */
export function focusableIn(root: Element): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.closest('[hidden],[aria-hidden="true"],[inert]') === null && el.getClientRects().length > 0,
  );
}

/**
 * Moves focus to `target` if it is still in the document and shown. Returns whether focus moved. A control inside
 * the closed menu (☰) is connected but hidden, so the caller's fallback is used instead.
 */
export function focusIfConnected(target: HTMLElement | null | undefined): boolean {
  if (target === null || target === undefined || !target.isConnected || target.getClientRects().length === 0) return false;
  target.focus();
  return true;
}
