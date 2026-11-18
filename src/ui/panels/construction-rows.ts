// Construction rows of the Policy_Panel (Requirement 10). Independent block: mount `root` into a host.
// Styling comes from src/styles (class names only here). The bar is a native <progress>, so it needs no motion.
import type { ConstructionRowView } from '../../types/view.ts';
import { reconcileKeyed, setAttr, setText, type Component } from '../component.ts';
import { UI_STRINGS } from '../strings.ts';
import { constructionLabels } from './policy-text.ts';

const C = UI_STRINGS.construction;

interface RowParts {
  readonly li: HTMLLIElement;
  readonly district: HTMLElement;
  readonly quarters: HTMLElement;
  readonly units: HTMLElement;
  readonly progressText: HTMLElement;
  readonly bar: HTMLProgressElement;
  readonly after: HTMLElement;
}

export function rowKey(row: ConstructionRowView): string {
  return `${row.district}|${row.committed}`;
}

export function createConstructionRows(doc: Document): Component<readonly ConstructionRowView[]> {
  const root = doc.createElement('section');
  root.className = 'ui-construction';
  const heading = doc.createElement('h3');
  heading.className = 'ui-construction-heading';
  heading.textContent = C.heading;
  const empty = doc.createElement('p');
  empty.className = 'ui-construction-empty';
  empty.textContent = C.none;
  const list = doc.createElement('ul');
  list.className = 'ui-construction-list';
  root.append(heading, empty, list);

  const cache = new Map<string, RowParts>();
  const byKey = new Map<string, ConstructionRowView>();

  const span = (cls: string): HTMLElement => {
    const el = doc.createElement('span');
    el.className = cls;
    return el;
  };

  const create = (): RowParts => {
    const li = doc.createElement('li');
    li.className = 'ui-construction-row';
    const district = span('ui-construction-district');
    const quarters = span('ui-construction-quarters');
    const units = span('ui-construction-units');
    const progressText = span('ui-construction-progress-text');
    const bar = doc.createElement('progress');
    bar.className = 'ui-construction-bar';
    const after = span('ui-construction-after');
    li.append(district, quarters, units, progressText, bar, after);
    return { li, district, quarters, units, progressText, bar, after };
  };

  const adapter = new Map<string, HTMLLIElement>();

  return {
    root,
    update(rows) {
      byKey.clear();
      for (const r of rows) byKey.set(rowKey(r), r);
      empty.hidden = rows.length > 0;
      list.hidden = rows.length === 0;
      reconcileKeyed(
        list,
        adapter,
        rows.map(rowKey),
        (key) => {
          const parts = create();
          cache.set(key, parts);
          return parts.li;
        },
      );
      for (const key of [...cache.keys()]) if (!adapter.has(key)) cache.delete(key);
      for (const [key, parts] of cache) {
        const row = byKey.get(key);
        if (row === undefined) continue;
        const labels = constructionLabels(row);
        setText(parts.district, row.districtName);
        setText(parts.quarters, `${C.committedQuarter} ${row.committed}, ${C.effectQuarter} ${row.effect}`);
        setText(parts.units, labels.units);
        setText(parts.progressText, labels.progress);
        parts.bar.max = row.lag;
        parts.bar.value = row.progress;
        setAttr(parts.bar, 'aria-label', labels.progress);
        parts.after.hidden = !row.afterEnd;
        setText(parts.after, row.afterEnd ? C.completesAfter : '');
      }
    },
  };
}
