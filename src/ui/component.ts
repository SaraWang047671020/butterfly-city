import type { UiActions } from '../types/view.ts';

/**
 * A UI block. It is created once and updated in place from a new view model (design decision G12).
 * A component owns no page layout: `root` is detached until an outer container mounts it.
 */
export interface Component<V> {
  readonly root: Element;
  update(view: V): void;
}

export type ComponentFactory<V> = (doc: Document, actions: UiActions) => Component<V>;

/** Places a component's root inside a host element given by the outer container. Returns an unmount function. */
export function mountComponent<V>(host: Element, component: Component<V>): () => void {
  host.appendChild(component.root);
  return () => {
    component.root.remove();
  };
}

/**
 * Keyed in-place update helper: keeps one child per key, creates it once, reorders without re-creating.
 * Children that are not in `keys` are removed. Focus is kept because existing nodes are only moved when
 * their position changes.
 */
export function reconcileKeyed<T extends Element>(
  parent: Element,
  cache: Map<string, T>,
  keys: readonly string[],
  create: (key: string) => T,
): void {
  const wanted = new Set(keys);
  for (const [key, el] of cache) {
    if (!wanted.has(key)) {
      el.remove();
      cache.delete(key);
    }
  }
  let cursor: ChildNode | null = parent.firstChild;
  for (const key of keys) {
    let el = cache.get(key);
    if (el === undefined) {
      el = create(key);
      cache.set(key, el);
    }
    if (el === cursor) {
      cursor = cursor.nextSibling;
    } else {
      parent.insertBefore(el, cursor);
    }
  }
}

/** Sets an attribute only when it differs, so in-place updates cause no needless mutation. */
export function setAttr(el: Element, name: string, value: string | null): void {
  if (value === null) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  } else if (el.getAttribute(name) !== value) {
    el.setAttribute(name, value);
  }
}

/** Sets text only when it differs. */
export function setText(el: Node, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}
