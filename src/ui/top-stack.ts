// Top stack of a narrow screen (play-loop task 12.3). Below 64rem the city tools, the character chip and the
// Walk_Mode prompts all sit at the top of the screen. The city tools wrap to two or three rows depending on the width
// and the language, and the prompts come and go, so fixed offsets let them cover each other (found at 360 px in
// English). Each block gets `--stack-top`: the bottom edge of the visible blocks above it plus a gap. The narrow
// layout in layout.css reads the variable; wide layouts ignore it.

/** Pure: the top of each block in order, given each block's height or null when it is not shown. */
export function stackTops(start: number, heights: readonly (number | null)[], gap: number): (number | null)[] {
  let next = start;
  return heights.map((h) => {
    if (h === null) return null;
    const top = next;
    next = top + h + gap;
    return top;
  });
}

/**
 * Keeps `--stack-top` of the blocks under `first` up to date. `first` stays where its own CSS puts it; `rest` are
 * stacked under it in order. Blocks found later (the Walk_Mode prompts are created by the City_View) are looked up
 * again on each update.
 */
export function keepTopStack(doc: Document, first: string, rest: readonly string[], gapPx: number): void {
  const win = doc.defaultView;
  if (win === null || typeof ResizeObserver === 'undefined') return;
  const observed = new Set<Element>();
  let queued = false;
  const update = (): void => {
    queued = false;
    const head = doc.querySelector<HTMLElement>(first);
    if (head === null) return;
    const blocks = rest.map((s) => doc.querySelector<HTMLElement>(s));
    for (const b of [head, ...blocks]) {
      if (b !== null && !observed.has(b)) {
        observed.add(b);
        observer.observe(b);
      }
    }
    const heights = blocks.map((b) => {
      if (b === null) return null;
      const r = b.getBoundingClientRect();
      return r.height > 0 ? r.height : null;
    });
    const tops = stackTops(Math.ceil(head.getBoundingClientRect().bottom) + gapPx, heights, gapPx);
    blocks.forEach((b, i) => {
      const top = tops[i];
      if (b !== null && top !== null && top !== undefined) b.style.setProperty('--stack-top', `${Math.ceil(top)}px`);
    });
  };
  const schedule = (): void => {
    if (queued) return;
    queued = true;
    win.requestAnimationFrame(update);
  };
  const observer = new ResizeObserver(schedule);
  // The prompts are shown and hidden with the `hidden` attribute while walking.
  new MutationObserver(schedule).observe(doc.body, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
  win.addEventListener('resize', schedule);
  schedule();
}
